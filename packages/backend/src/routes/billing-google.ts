import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { personalPromoCoversFree } from '../lib/personal-promo';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { getGoogleAccessToken, parseServiceAccountJson } from '../lib/google-oauth';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { purchaseAccountMatches } from '../lib/purchase-account-binding';
import {
  notifyBillingStateChanged,
  refreshCompetingAppleRenewalState,
} from '../lib/billing-cancel';
import {
  ANDROID_PUBLISHER_SCOPE,
  ENTITLED_STATES,
  isRecoverablePlayState,
  type SubscriptionV2Response,
  googlePaymentAnchor,
  googlePlanKeyFromProductId,
  selectAuthoritativeLineItem,
} from '../lib/play-subscriptions';
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
//
// scope·응답 타입·ENTITLED_STATES 는 lib/play-subscriptions.ts 가 단일 출처
// (해지/RTDN/reconciliation 과 공유). 기존 import 경로 유지를 위해 re-export 한다.

export { ANDROID_PUBLISHER_SCOPE, ENTITLED_STATES, isRecoverablePlayState };
export type { SubscriptionV2Response };

export { googlePlanKeyFromProductId };

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

/** acknowledge 재시도 사이 백오프(ms). Workers 호환 — setTimeout 을 Promise 로 감싼다. */
const ACK_BACKOFF_MS = [200, 1000];

/**
 * Play 구독 acknowledgement 확인. acknowledge 는 멱등하므로 일시 실패(5xx/네트워크) 시
 * 위 백오프를 두고 최대 3회 시도한다. 4xx(이미 확인됨·잘못된 상태 등)는 재시도해도 동일하므로
 * 즉시 중단한다.
 *
 * confirm(구매 직후)·RTDN(구매/갱신 알림) 양쪽에서 재사용한다 — 앱이 confirm 을 못 보내도
 * RTDN 이 서버측 ack 재시도 경로가 되게 해, 미확인 시 3일 후 Play 자동 환불 위험을 줄인다.
 * 반환값은 확인 성공 여부지만, 호출자는 실패해도 흐름을 막지 않는다(다음 RTDN/재confirm 이 보강).
 */
export async function acknowledgeGoogleSubscription(params: {
  baseUrl: string;
  productId: string;
  purchaseToken: string;
  accessToken: string;
}): Promise<boolean> {
  const { baseUrl, productId, purchaseToken, accessToken } = params;
  const ackUrl = `${baseUrl}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // 직전 시도 실패 → 백오프 후 재시도 (200ms, 1000ms).
      await new Promise((resolve) => setTimeout(resolve, ACK_BACKOFF_MS[attempt - 1]));
    }
    try {
      const ackRes = await fetch(ackUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (ackRes.ok) return true;
      logStructured('warn', {
        at: 'billing.google.acknowledge',
        attempt,
        status: ackRes.status,
        detail: (await ackRes.text()).slice(0, 300),
      });
      // 4xx(이미 acknowledge 됨·잘못된 상태 등)는 재시도해도 동일하므로 즉시 중단. 5xx·네트워크만 재시도.
      if (ackRes.status < 500) return false;
    } catch (err) {
      logStructured('error', { at: 'billing.google.acknowledge', attempt, error: String(err) });
    }
  }
  return false;
}

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

  // ⚠ **선물 상품(1회성 `personal_gift_1m`)은 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store
  //   심사 지침 3.1.1, 두 번째 반려 — `routes/code.ts` 머리말). 받는 사람이 코드를 쳐서 여는 선물
  //   코드를 만들던 상품이다. 상품 목록(`googlePlanKeyFromProductId`)에서 빠졌으므로 다른 모르는 상품과
  //   똑같이 **여기서**, 구글 호출(OAuth 토큰·구매 조회·확인)을 하나도 하기 전에 400 으로 끝난다.
  //   확인(acknowledge)도 소비도 하지 않으니 Play 가 3일 뒤 자동 환불한다 — 코드는 나가지 않는다.
  //   예전 선물 갈래(`purchases/products` 조회·바우처 발급·`:consume`)는 통째로 지웠다.
  //   할인·무료 이용은 스토어 오퍼 코드(Play 프로모션 코드)로 준다.
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
        error_code: status === 404 ? 'GOOGLE_PURCHASE_NOT_FOUND' : 'GOOGLE_VERIFICATION_FAILED',
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

  const lineItem = selectAuthoritativeLineItem(subscription.lineItems, parsed.product_id);
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

  // 구매-계정 바인딩 검증 — store_transactions 최초 바인딩 전에 수행한다.
  // 계약(Android PlayBillingManager 와 공유): 클라는 구매 시
  // setObfuscatedAccountId(sha256hex(로그인 사용자 id — JWT sub 와 동일한 세션 user id))
  // 를 설정한다. Play 응답의 식별자가 호출자(sub 또는 users.id PK)의 해시와 다르면
  // 훔친/다른 계정의 purchaseToken 이므로 403 으로 거절한다.
  const obfuscatedId = subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId?.trim();
  if (obfuscatedId) {
    // 클라는 구매 시점 세션의 로그인 id(JWT sub)를 해시해 넣는다. userId 는 이제
    // users.id 로 정규화되므로, 구 토큰으로 결제한 사용자를 위해 원래 sub 도 함께 본다.
    const matches = await purchaseAccountMatches(obfuscatedId, [
      c.get('userLoginId'),
      c.get('userId'),
      userPk,
    ]);
    if (!matches) {
      logStructured('warn', {
        at: 'billing.google.confirm',
        step: 'account_binding',
        error: 'obfuscatedExternalAccountId mismatch',
      });
      return c.json(
        {
          error: 'Purchase is bound to another account',
          error_code: 'TRANSACTION_ACCOUNT_MISMATCH',
        },
        403,
      );
    }
  } else {
    // 식별자 부재 시 "최초 바인딩"은 거절한다. 출시 전 fresh DB 전제 — 새 클라는
    // 구매 시 항상 setObfuscatedAccountId 를 설정하므로 식별자 없는 토큰은 계약 이전
    // 구클라 구매뿐이고, 이는 앱 업데이트를 유도한다(허용하면 유출 토큰을 아무
    // 계정이나 선점하는 first-claim 구멍이 남는다). 이미 바인딩된 토큰의 재전송
    // (갱신)은 기존 로직대로 통과 — applyStoreEntitlement 의 소유자 검증
    // (409 TRANSACTION_OWNED_BY_OTHER_USER)이 심층방어로 남는다.
    const boundRes = await db.execute({
      sql: `SELECT user_id FROM store_transactions
            WHERE provider = 'google' AND provider_transaction_id = ?`,
      args: [parsed.purchase_token],
    });
    if (boundRes.rows.length === 0) {
      logStructured('warn', {
        at: 'billing.google.confirm',
        step: 'account_binding',
        error: 'obfuscatedExternalAccountId missing on first claim',
      });
      return c.json(
        {
          error: 'Purchase is missing the account identifier',
          error_code: 'TRANSACTION_ACCOUNT_UNVERIFIED',
        },
        403,
      );
    }
  }
  const plan = await loadPlanByKey(db, planKey);
  if (!plan) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }

  // ⚠ **막기 전에 애플에 물어 갱신 상태를 최신화한다**(코덱스 #733 8차). 애플 상태는
  //   가만두면 낡는다 — 우리가 받는 서버 알림이 없고, 같은-플랜 갱신 갈래가
  //   `cancel_at_period_end` 를 0 으로 되돌린다. 낡은 값으로 막으면 **App Store 에서 이미
  //   자동갱신을 끈 사용자가 아무것도 할 수 없다.** 확인 실패 시 확정도 재시도하도록 막는다.
  await refreshCompetingAppleRenewalState(db, c.env, userPk);

  const lastPaidAt = await googlePaymentAnchor(c.env, subscription, parsed.purchase_token);
  const result = await withWriteTransaction(db, (txDb) =>
    applyStoreEntitlement(txDb, {
      userPk,
      provider: 'google',
      // purchaseToken 은 구독 수명 동안 유지되는 안정 식별자.
      providerTransactionId: parsed.purchase_token,
      productId: parsed.product_id,
      plan,
      startsAt: new Date(),
      // ⚠ **확정 시각이 아니라 결제 시각을 앵커로 쓴다**(코덱스 #734 10차). RTDN 을
      //   놓쳤거나 사용자가 한참 뒤에 복원하면 확정이 결제보다 몇 주 뒤다 — 거기에
      //   5년을 더하면 처리방침의 최대 5년을 그만큼 넘긴다.
      lastPaidAt,
      expiresAt,
      rawPayload: JSON.stringify({
        latestOrderId: subscription.latestOrderId ?? null,
        subscriptionState: subscription.subscriptionState,
      }),
      promoCoversFree: personalPromoCoversFree(c.env),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Purchase belongs to another account', error_code: result.errorCode },
      result.status,
    );
  }

  // acknowledgement 보류 시 서버가 확인 처리 (3일 내 미확인 → Play 자동 환불).
  // 전부 실패해도 success 는 유지한다(entitlement 는 이미 커밋됨) — RTDN entitle 경로가
  // 서버측 ack 재시도로 보강한다.
  // ⚠ **알림보다 먼저 한다**(2026-09-20). 알림은 받을 사람·기기 수만큼 subrequest 를 쓰는데,
  //   그 뒤에 두면 한도(~50)가 알림 단계에서 먼저 다 떨어져 확인 처리에 닿지 못할 수 있다 —
  //   권한은 줬는데 Play 가 3일 뒤 환불한다.
  if (subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    await acknowledgeGoogleSubscription({
      baseUrl,
      productId: parsed.product_id,
      purchaseToken: parsed.purchase_token,
      accessToken,
    });
  }

  // 이 결제로 등급이 바뀐 사람에게 알린다(`planChangedUserIds`).
  // (FCM 은 트랜잭션 안에서 쏘지 않는다 — 커밋 뒤 여기서.)
  await notifyBillingStateChanged(db, c.env, result.planChangedUserIds);

  return c.json({
    success: true,
    plan_key: planKey,
    subscription: result.subscription,
  });
});

export default billingGoogle;
