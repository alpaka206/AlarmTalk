import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { getGoogleAccessToken, parseServiceAccountJson } from '../lib/google-oauth';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { resolveUserPk } from './billing-helpers';

// MARK: - POST /billing/google/confirm
//
// Android `PlayBillingManager` 가 구매 완료 후 호출하는 라우트.
//
// 검증 전략: 클라이언트가 보낸 purchaseToken 으로 Play Developer API
// (purchases.subscriptionsv2.get) 를 서버가 직접 조회한다. 구독 상태가
// ACTIVE/GRACE 인 경우에만 entitlement 를 반영하고, acknowledgement 가
// 보류 상태면 서버가 직접 acknowledge 한다 (클라이언트는 호출하지 않음 —
// 3일 내 미확인 시 Play 가 자동 환불하므로 서버 확인이 권위).
//
// 필요 secrets: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, ANDROID_PACKAGE_NAME.

export const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/**
 * Play Console 구독 상품 ID → plans.key 매핑.
 * iOS 의 applePlanKeyFromProductId 와 동일한 규칙 (단일 진실 공급원:
 * billing-helpers.ts 의 Apple 매핑 주석 참고).
 */
const GOOGLE_PRODUCT_TO_PLAN_KEY: Record<string, 'personal' | 'couple' | 'family'> = {
  personal_monthly: 'personal',
  couple_monthly: 'couple',
  family_monthly: 'family',
};

export function googlePlanKeyFromProductId(
  productId: string,
): 'personal' | 'couple' | 'family' | null {
  return GOOGLE_PRODUCT_TO_PLAN_KEY[productId] ?? null;
}

interface ConfirmRequest {
  purchase_token: string;
  product_id: string;
  package_name?: string;
}

function parseConfirmRequest(value: unknown): ConfirmRequest | { error: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }
  const raw = value as Record<string, unknown>;
  const purchaseToken = typeof raw.purchase_token === 'string' ? raw.purchase_token.trim() : '';
  const productId = typeof raw.product_id === 'string' ? raw.product_id.trim() : '';
  const packageName = typeof raw.package_name === 'string' ? raw.package_name.trim() : undefined;
  if (!purchaseToken) return { error: 'purchase_token is required' };
  if (!productId) return { error: 'product_id is required' };
  return { purchase_token: purchaseToken, product_id: productId, package_name: packageName };
}

export interface SubscriptionV2Response {
  subscriptionState?: string;
  acknowledgementState?: string;
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
  latestOrderId?: string;
}

export const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
]);

const billingGoogle = new Hono<AppEnv>();

billingGoogle.post('/google/confirm', async (c) => {
  const account = parseServiceAccountJson(c.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const expectedPackage = c.env.ANDROID_PACKAGE_NAME;
  if (!account || !expectedPackage) {
    return c.json(
      {
        error: 'Google billing is not configured on the server',
        error_code: 'GOOGLE_BILLING_UNCONFIGURED',
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = parseConfirmRequest(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, error_code: 'INVALID_REQUEST' }, 400);
  }

  if (parsed.package_name && parsed.package_name !== expectedPackage) {
    return c.json({ error: 'Package name mismatch', error_code: 'PACKAGE_MISMATCH' }, 400);
  }

  const planKey = googlePlanKeyFromProductId(parsed.product_id);
  if (!planKey) {
    return c.json(
      { error: `Unknown Google product id: ${parsed.product_id}`, error_code: 'UNKNOWN_PRODUCT' },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  // Play Developer API 로 구독 상태 조회 (클라이언트 주장 무시).
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(account, ANDROID_PUBLISHER_SCOPE);
  } catch (err) {
    logStructured('error', { at: 'billing.google.confirm', step: 'oauth', error: String(err) });
    return c.json(
      { error: 'Google verification failed', error_code: 'GOOGLE_VERIFICATION_FAILED' },
      502,
    );
  }

  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(expectedPackage)}`;
  const lookupRes = await fetch(
    `${baseUrl}/purchases/subscriptionsv2/tokens/${encodeURIComponent(parsed.purchase_token)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!lookupRes.ok) {
    const detail = (await lookupRes.text()).slice(0, 300);
    logStructured('warn', { at: 'billing.google.confirm', status: lookupRes.status, detail });
    const status = lookupRes.status === 404 || lookupRes.status === 400 ? 404 : 502;
    return c.json(
      {
        error: 'Google purchase not found or verification failed',
        error_code:
          status === 404 ? 'GOOGLE_PURCHASE_NOT_FOUND' : 'GOOGLE_VERIFICATION_FAILED',
      },
      status,
    );
  }

  const subscription = (await lookupRes.json()) as SubscriptionV2Response;
  if (!ENTITLED_STATES.has(subscription.subscriptionState ?? '')) {
    return c.json(
      {
        error: `Subscription is not active: ${subscription.subscriptionState ?? 'UNKNOWN'}`,
        error_code: 'SUBSCRIPTION_NOT_ACTIVE',
      },
      400,
    );
  }

  const lineItem = subscription.lineItems?.find((item) => item.productId === parsed.product_id)
    ?? subscription.lineItems?.[0];
  if (!lineItem?.expiryTime) {
    return c.json({ error: 'Missing expiry time', error_code: 'GOOGLE_VERIFICATION_FAILED' }, 502);
  }
  if (lineItem.productId && lineItem.productId !== parsed.product_id) {
    return c.json({ error: 'Product id mismatch', error_code: 'PRODUCT_MISMATCH' }, 400);
  }
  const expiresAt = new Date(lineItem.expiryTime);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return c.json({ error: 'Subscription is expired', error_code: 'SUBSCRIPTION_EXPIRED' }, 400);
  }

  const db = getDB(c.env);
  const plan = await loadPlanByKey(db, planKey);
  if (!plan) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }

  const result = await withWriteTransaction(db, (txDb) =>
    applyStoreEntitlement(txDb, {
      userPk,
      provider: 'google',
      // purchaseToken 은 구독 수명 동안 유지되는 안정 식별자.
      providerTransactionId: parsed.purchase_token,
      productId: parsed.product_id,
      plan,
      startsAt: new Date(),
      expiresAt,
      rawPayload: JSON.stringify({
        latestOrderId: subscription.latestOrderId ?? null,
        subscriptionState: subscription.subscriptionState,
      }),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Purchase belongs to another account', error_code: result.errorCode },
      result.status,
    );
  }

  // acknowledgement 보류 시 서버가 확인 처리 (3일 내 미확인 → Play 자동 환불).
  // acknowledge 는 멱등하므로 일시 실패 시 최대 3회 재시도해 자동환불 위험을 줄인다.
  if (subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    const ackUrl = `${baseUrl}/purchases/subscriptions/${encodeURIComponent(parsed.product_id)}/tokens/${encodeURIComponent(parsed.purchase_token)}:acknowledge`;
    let acknowledged = false;
    for (let attempt = 0; attempt < 3 && !acknowledged; attempt++) {
      try {
        const ackRes = await fetch(ackUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        if (ackRes.ok) {
          acknowledged = true;
        } else {
          logStructured('warn', {
            at: 'billing.google.acknowledge',
            attempt,
            status: ackRes.status,
            detail: (await ackRes.text()).slice(0, 300),
          });
        }
      } catch (err) {
        logStructured('error', { at: 'billing.google.acknowledge', attempt, error: String(err) });
      }
    }
  }

  return c.json({
    success: true,
    plan_key: planKey,
    subscription: result.subscription,
  });
});

export default billingGoogle;
