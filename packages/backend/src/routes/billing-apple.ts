// Apple 결제(StoreKit 2) 확인 라우트.
//
// 구조는 `billing-google.ts` 의 confirm 과 같다:
//   클라 주장 무시 → 스토어 API 로 검증 → applyStoreEntitlement 로 구독 반영.
// 다른 점은 애플이 purchaseToken 대신 **transactionId** 를 쓴다는 것뿐이다.
//
// ⚠ 기존 구글 경로는 이 파일과 완전히 분리돼 있다. 공유하는 것은 provider 를 인자로 받는
// `applyStoreEntitlement` 뿐이고, 그건 이미 provider-agnostic 하게 짜여 있었다.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logStructured } from '../lib/logger';
import { withWriteTransaction } from '../lib/transactions';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import {
  appleStoreKitConfigFromEnv,
  applePlanKeyFromProductId,
  fetchAppleTransaction,
  AppleTransactionNotFoundError,
} from '../lib/apple-storekit';
import { resolveUserPk } from './billing-helpers';

const billingApple = new Hono<AppEnv>();

interface ConfirmRequest {
  transaction_id: string;
}

function parseConfirmRequest(raw: unknown): ConfirmRequest | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object' };
  const body = raw as Record<string, unknown>;
  const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id.trim() : '';
  if (!transactionId) return { error: 'transaction_id is required' };
  // 길이 상한은 서버에도 둔다(CLAUDE.md 입력 규약) — 거대한 문자열이 URL·조회로 흘러가지 않게.
  if (transactionId.length > 128) return { error: 'transaction_id is too long' };
  return { transaction_id: transactionId };
}

billingApple.post('/apple/confirm', async (c) => {
  // 구성 가드 — 구글 경로와 동일하게 503 fail-closed.
  // App Store Connect 값(Issuer ID / Key ID / .p8 / 번들 ID)이 없으면 애플에 물어볼 수 없고,
  // 물어보지 못한 채로 통과시키면 클라 주장을 그대로 믿는 것이 된다.
  const config = appleStoreKitConfigFromEnv(c.env);
  if (!config) {
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

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  // 애플에 직접 조회한다. 클라가 보낸 것은 transaction id 문자열 하나뿐이고,
  // 상품·만료·소유 여부는 전부 이 응답이 권위다.
  let info;
  try {
    info = await fetchAppleTransaction(parsed.transaction_id, config);
  } catch (err) {
    if (err instanceof AppleTransactionNotFoundError) {
      return c.json(
        { error: 'Transaction not found', error_code: 'TRANSACTION_NOT_FOUND' },
        404,
      );
    }
    logStructured('error', {
      at: 'billing.apple.confirm',
      step: 'lookup',
      error: String(err),
    });
    return c.json(
      { error: 'Apple verification failed', error_code: 'APPLE_VERIFICATION_FAILED' },
      502,
    );
  }

  const planKey = applePlanKeyFromProductId(info.productId);
  if (!planKey) {
    return c.json(
      { error: `Unknown Apple product id: ${info.productId}`, error_code: 'UNKNOWN_PRODUCT' },
      400,
    );
  }

  // 환불·취소된 트랜잭션으로 권한을 얻을 수 없게 한다.
  if (info.revocationDate) {
    return c.json({ error: 'Transaction was revoked', error_code: 'TRANSACTION_REVOKED' }, 400);
  }

  // 자동 갱신 구독은 expiresDate 가 반드시 있다. 없으면 우리가 파는 상품이 아니다
  // (소모품·비소모품). 만료를 모르면 언제까지 권한을 줄지도 모르므로 거절한다.
  if (!info.expiresDate) {
    return c.json(
      { error: 'Transaction has no expiry', error_code: 'TRANSACTION_NOT_SUBSCRIPTION' },
      400,
    );
  }
  const expiresAt = new Date(info.expiresDate);
  if (expiresAt.getTime() <= Date.now()) {
    return c.json({ error: 'Subscription already expired', error_code: 'SUBSCRIPTION_EXPIRED' }, 400);
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
      // ⚠ originalTransactionId 를 쓴다. transactionId 는 **갱신마다 바뀌므로**
      // 그걸 키로 삼으면 매달 새 구독이 생긴다. originalTransactionId 는 구독 수명 동안
      // 고정이라 구글의 purchaseToken 과 같은 역할을 한다.
      providerTransactionId: info.originalTransactionId,
      productId: info.productId,
      plan,
      startsAt: new Date(info.purchaseDate),
      expiresAt,
      rawPayload: JSON.stringify({
        transactionId: info.transactionId,
        type: info.type,
        environment: info.environment ?? null,
      }),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Purchase belongs to another account', error_code: result.errorCode },
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
