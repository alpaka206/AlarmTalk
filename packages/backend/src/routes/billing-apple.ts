import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { applePlanKeyFromProductId, resolveUserPk } from './billing-helpers';

// MARK: - POST /billing/apple/confirm
//
// iOS `SubscriptionManager.syncWithBackend` 가 호출하는 라우트.
//
// 검증 전략: 클라이언트가 보낸 transaction_id 는 권위가 아니므로, App Store
// Server API (`GET /inApps/v1/transactions/{id}`) 를 서버가 직접 호출해 Apple 이
// 서명한 트랜잭션 정보를 TLS 신뢰 경로로 받아온다. 응답의 signedTransactionInfo
// (JWS) payload 에서 bundleId / productId / expiresDate 를 검증한 뒤 entitlement 를
// 반영한다. 프로덕션 404 시 샌드박스 엔드포인트로 폴백 (Apple 권장 패턴).
//
// 필요 secrets: APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_IAP_PRIVATE_KEY(p8),
// APPLE_BUNDLE_ID. 미설정 시 503 (fail-closed 유지).

interface ConfirmRequest {
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
}

function parseConfirmRequest(value: unknown): ConfirmRequest | { error: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }
  const raw = value as Record<string, unknown>;
  const transactionId = typeof raw.transaction_id === 'string' ? raw.transaction_id.trim() : '';
  const originalTransactionId =
    typeof raw.original_transaction_id === 'string' ? raw.original_transaction_id.trim() : '';
  const productId = typeof raw.product_id === 'string' ? raw.product_id.trim() : '';
  if (!transactionId) return { error: 'transaction_id is required' };
  if (!originalTransactionId) return { error: 'original_transaction_id is required' };
  if (!productId) return { error: 'product_id is required' };
  return {
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
  };
}

// MARK: - App Store Server API 클라이언트

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToString(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function importEcPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** App Store Server API 호출용 ES256 JWT (유효 5분). */
async function signAppStoreServerJwt(env: Env): Promise<string> {
  const header = base64UrlEncode(
    JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID, typ: 'JWT' }),
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: env.APPLE_ISSUER_ID,
      iat: issuedAt,
      exp: issuedAt + 300,
      aud: 'appstoreconnect-v1',
      bid: env.APPLE_BUNDLE_ID,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importEcPrivateKey(env.APPLE_IAP_PRIVATE_KEY!);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

interface AppleTransactionPayload {
  bundleId?: string;
  productId?: string;
  originalTransactionId?: string;
  transactionId?: string;
  expiresDate?: number;
  type?: string;
  revocationDate?: number;
}

/** JWS payload 디코드 — Apple 에서 TLS 로 직접 받은 응답이므로 서명 체인 검증은 생략. */
function decodeJwsPayload(jws: string): AppleTransactionPayload | null {
  const segments = jws.split('.');
  if (segments.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecodeToString(segments[1]!)) as AppleTransactionPayload;
  } catch {
    return null;
  }
}

type AppleLookupResult =
  | { ok: true; payload: AppleTransactionPayload; environment: 'production' | 'sandbox' }
  | { ok: false; status: number; detail: string };

async function fetchAppleTransaction(env: Env, transactionId: string): Promise<AppleLookupResult> {
  const token = await signAppStoreServerJwt(env);
  const hosts: Array<{ host: string; environment: 'production' | 'sandbox' }> = [
    { host: 'https://api.storekit.itunes.apple.com', environment: 'production' },
    { host: 'https://api.storekit-sandbox.itunes.apple.com', environment: 'sandbox' },
  ];

  let lastFailure: { status: number; detail: string } = { status: 502, detail: 'unreachable' };
  for (const { host, environment } of hosts) {
    const res = await fetch(
      `${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const json = (await res.json()) as { signedTransactionInfo?: string };
      const payload = json.signedTransactionInfo
        ? decodeJwsPayload(json.signedTransactionInfo)
        : null;
      if (!payload) {
        return { ok: false, status: 502, detail: 'Malformed signedTransactionInfo' };
      }
      return { ok: true, payload, environment };
    }
    lastFailure = { status: res.status, detail: (await res.text()).slice(0, 300) };
    // 프로덕션에서 찾지 못한 트랜잭션만 샌드박스로 폴백.
    if (res.status !== 404) break;
  }
  return { ok: false, ...lastFailure };
}

const billingApple = new Hono<AppEnv>();

billingApple.post('/apple/confirm', async (c) => {
  const configured =
    !!c.env.APPLE_ISSUER_ID &&
    !!c.env.APPLE_KEY_ID &&
    !!c.env.APPLE_IAP_PRIVATE_KEY &&
    !!c.env.APPLE_BUNDLE_ID;
  if (!configured) {
    return c.json(
      {
        error: 'Apple billing is not configured on the server',
        error_code: 'APPLE_BILLING_UNCONFIGURED',
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = parseConfirmRequest(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, error_code: 'INVALID_REQUEST' }, 400);
  }

  const { transaction_id, original_transaction_id, product_id } = parsed;

  // SKU 화이트리스트 검증.
  const planKey = applePlanKeyFromProductId(product_id);
  if (!planKey) {
    return c.json(
      { error: `Unknown Apple product id: ${product_id}`, error_code: 'UNKNOWN_PRODUCT' },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  // Apple 에 트랜잭션을 직접 조회해 검증 (클라이언트 주장 무시).
  let lookup: AppleLookupResult;
  try {
    lookup = await fetchAppleTransaction(c.env, transaction_id);
  } catch (err) {
    logStructured('error', { at: 'billing.apple.confirm', error: String(err) });
    return c.json(
      { error: 'Apple verification failed', error_code: 'APPLE_VERIFICATION_FAILED' },
      502,
    );
  }
  if (!lookup.ok) {
    logStructured('warn', {
      at: 'billing.apple.confirm',
      status: lookup.status,
      detail: lookup.detail,
    });
    const status = lookup.status === 404 ? 404 : 502;
    return c.json(
      {
        error: 'Apple transaction not found or verification failed',
        error_code: status === 404 ? 'APPLE_TRANSACTION_NOT_FOUND' : 'APPLE_VERIFICATION_FAILED',
      },
      status,
    );
  }

  const tx = lookup.payload;
  if (tx.bundleId !== c.env.APPLE_BUNDLE_ID) {
    return c.json({ error: 'Bundle id mismatch', error_code: 'BUNDLE_MISMATCH' }, 400);
  }
  if (tx.productId !== product_id) {
    return c.json({ error: 'Product id mismatch', error_code: 'PRODUCT_MISMATCH' }, 400);
  }
  if (tx.revocationDate) {
    return c.json({ error: 'Transaction was revoked', error_code: 'TRANSACTION_REVOKED' }, 400);
  }
  const expiresMillis = tx.expiresDate ?? 0;
  if (!expiresMillis || expiresMillis <= Date.now()) {
    return c.json({ error: 'Subscription is expired', error_code: 'SUBSCRIPTION_EXPIRED' }, 400);
  }
  // 프로덕션 환경에서는 샌드박스 트랜잭션으로 entitlement 를 열지 않는다.
  if (c.env.ENVIRONMENT === 'production' && lookup.environment === 'sandbox') {
    return c.json(
      { error: 'Sandbox transaction on production', error_code: 'SANDBOX_TRANSACTION' },
      400,
    );
  }

  const db = getDB(c.env);
  const plan = await loadPlanByKey(db, planKey);
  if (!plan) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }

  const result = await withWriteTransaction(db, (txDb) =>
    applyStoreEntitlement(txDb, {
      userPk,
      provider: 'apple',
      // 구독 단위 식별자 — 갱신 시 transactionId 는 바뀌지만 original 은 유지된다.
      providerTransactionId: tx.originalTransactionId ?? original_transaction_id,
      productId: product_id,
      plan,
      startsAt: new Date(),
      expiresAt: new Date(expiresMillis),
      rawPayload: JSON.stringify({
        transactionId: tx.transactionId,
        environment: lookup.environment,
      }),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Transaction belongs to another account', error_code: result.errorCode },
      result.status,
    );
  }

  return c.json({
    success: true,
    plan_key: planKey,
    subscription: result.subscription,
  });
});

export default billingApple;
