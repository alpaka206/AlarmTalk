import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { logStructured } from '../lib/logger';
import {
  applePlanKeyFromProductId,
  appleStoreKitConfigFromEnv,
  type AppleStoreKitConfig,
} from '../lib/apple-storekit';
import {
  claimAppleNotification,
  decodeAppleServerNotification,
  expectedAppleEnvironment,
  finishAppleNotification,
  type VerifiedAppleNotification,
} from '../lib/apple-server-notifications';
import type { AppleJwsVerifyOptions } from '../lib/apple-jws';
import {
  BillingStateUnavailableError,
  reconcileStoreSubscription,
} from '../lib/billing-reconciliation';
import { revokeAppleRefund } from './billing-apple';

// MARK: - POST /api/billing/apple/notifications  (공개 라우트, 사용자 인증 없음)
//
// App Store Server Notifications **V2** 수신 엔드포인트. 갱신·해지 예약·결제 실패·유예 만료·만료·환불·회수 같은 애플
// 구독 변화를 크론(`processSubscriptionExpiry`)이나 앱의 재전송(`resyncEntitlements`)을 기다리지 않고 서버에 알린다.
// 크론 재조회는 그대로 둔다 — 알림이 빠져도(URL 설정·전달 실패) 크론이 결국 맞춘다.
//
// 보안: 인증이 없다. 본문(`signedPayload`)은 **애플 서명으로만** 믿는다 — x5c 체인이 Apple Root CA - G3 로
//       이어지고 ES256 서명이 맞아야 한다(`lib/apple-jws.ts`). 그 뒤 번들 ID·환경을 대조한다.
// 권위: 알림의 상태를 그대로 쓰지 않는다. 알림은 **어느 구독을 다시 볼지** 만 알려 주고, 상태는 크론과 같은 정합화
//       (`reconcileStoreSubscription`)가 애플에 다시 물어 정한다 — 순서가 뒤바뀌거나 중복돼도 결과가 같다.
//       환불·회수는 확정 라우트와 같은 회수 갈래(`revokeAppleRefund`)를 탄다.
// 기록: `notificationUUID` 로 거른다. 처리 전에 `received` 로 적고, 끝나면 `processed`·`ignored`. 처리가 실패하면
//       `failed` 로 적고 **5xx 로 답한다** — 애플이 재전송(최대 사흘)하면 다시 처리한다. 내부 재시도 큐는 두지 않는다
//       (재전송과 크론이 이미 두 겹이다).
//
// 규칙 전문: `docs/spec/billing-lifecycle.md` 「애플 서버 알림 V2」.

/** 애플 서명 본문 상한. 실제 알림은 몇 KB 다 — 거대한 문자열을 파싱·해시하지 않는다. */
const MAX_SIGNED_PAYLOAD_LENGTH = 64 * 1024;

/**
 * 상태를 바꾸지 않는 알림 — 다시 물을 것이 없다. 목록에 없는 종류(애플이 나중에 늘리는 것 포함)는 **다시 묻는다** —
 * 재조회는 몇 번을 해도 해가 없으므로, 모르는 종류를 버리는 쪽이 더 위험하다.
 */
const NO_STATE_CHANGE_TYPES = new Set([
  'TEST',
  // 환불 요청에 쓸 소비 정보를 달라는 요청 — 우리는 보내지 않는다(보내지 않아도 환불 심사는 진행된다).
  'CONSUMPTION_REQUEST',
  'REFUND_DECLINED',
  'EXTERNAL_PURCHASE_TOKEN',
]);

/** 회수 갈래로 보내는 종류 — 환불(`REFUND`)과 가족 공유 회수(`REVOKE`). */
const REVOCATION_TYPES = new Set(['REFUND', 'REVOKE']);

type ProcessResult = { status: 'processed' | 'ignored'; outcome: string; userPk: string | null };

/** 처리 실패 중 **애플의 재전송으로 풀릴 수 있는** 것. 그 밖의 예외는 그대로 5xx 다(같이 재전송된다). */
class RetryableNotificationError extends Error {}

async function processNotification(
  db: ReturnType<typeof getDB>,
  env: AppEnv['Bindings'],
  config: AppleStoreKitConfig,
  notification: VerifiedAppleNotification,
): Promise<ProcessResult> {
  if (NO_STATE_CHANGE_TYPES.has(notification.type)) {
    return {
      status: 'ignored',
      outcome: notification.type === 'TEST' ? 'test' : 'no_state_change',
      userPk: null,
    };
  }
  const transaction = notification.transaction;
  if (!transaction) return { status: 'ignored', outcome: 'no_transaction', userPk: null };
  if (!applePlanKeyFromProductId(transaction.productId)) {
    // 파는 구독이 아니다(은퇴한 선물·이용권 상품 등). 확정 라우트도 `UNKNOWN_PRODUCT` 로 끝내는 결제다.
    return { status: 'ignored', outcome: 'unknown_product', userPk: null };
  }

  // 주인은 **우리가 이미 묶어 둔 거래**로만 찾는다(확정 라우트가 `originalTransactionId` 로 적는다). 알림이 새 주인을
  // 정하지 않는다 — 계정 바인딩(`appAccountToken`) 판정은 확정 라우트 한 곳이다.
  const owner = (
    await db.execute({
      sql: `SELECT user_id, subscription_id FROM store_transactions
            WHERE provider = 'apple' AND provider_transaction_id = ? LIMIT 1`,
      args: [transaction.originalTransactionId],
    })
  ).rows[0];
  if (!owner) {
    // 첫 구매(`SUBSCRIBED`)가 앱의 확정보다 먼저 오는 것이 보통이다 — 확정이 묶는다. 탈퇴한 계정의 구독도 여기로 온다.
    logStructured('info', {
      at: 'billing.apple.notification',
      note: 'unknown_transaction',
      notificationType: notification.type,
      subtype: notification.subtype,
      originalTransactionId: transaction.originalTransactionId,
    });
    return { status: 'ignored', outcome: 'unknown_transaction', userPk: null };
  }
  const userPk = String(owner.user_id);

  if (REVOCATION_TYPES.has(notification.type)) {
    const outcome = await revokeAppleRefund(
      db,
      env,
      config,
      transaction,
      'billing.apple.notification',
    );
    if (outcome === 'unknown' || outcome === 'changed') {
      throw new RetryableNotificationError(`refund ${outcome}`);
    }
    return {
      status: 'processed',
      outcome: outcome === 'revoked' ? 'refund_revoked' : 'refund_chain_live',
      userPk,
    };
  }

  const subscriptionId = owner.subscription_id ? String(owner.subscription_id) : null;
  if (!subscriptionId) return { status: 'ignored', outcome: 'no_subscription', userPk };
  try {
    const result = await reconcileStoreSubscription(db, env, subscriptionId);
    // `not_store` = 그 구독이 이미 끝났다. 끝난 구독을 되살리는 것(재구독·환불 취소)은 앱의 확정이 한다 — 새 결제의
    // 계정 바인딩을 거쳐야 해서다.
    return result === 'applied'
      ? { status: 'processed', outcome: 'reconciled', userPk }
      : { status: 'ignored', outcome: 'no_active_subscription', userPk };
  } catch (error) {
    if (error instanceof BillingStateUnavailableError) {
      throw new RetryableNotificationError(error.message);
    }
    throw error;
  }
}

/**
 * 라우트를 만든다. `verifyOptions` 는 **테스트만** 넘긴다(자체 루트로 바꿔 끼우는 자리) — 운영은 기본값(Apple Root
 * CA - G3)이다.
 */
export function createBillingAppleNotificationsRoutes(verifyOptions: AppleJwsVerifyOptions = {}) {
  const routes = new Hono<AppEnv>();

  routes.post('/notifications', async (c) => {
    // 재조회에 App Store Server API 자격이 필요하다 — 없으면 처리할 수 없으니 재전송을 받으려고 503 으로 둔다.
    const config = appleStoreKitConfigFromEnv(c.env);
    if (!config) {
      return jsonError(
        c,
        503,
        'APPLE_BILLING_UNCONFIGURED',
        'Apple billing is not configured on the server',
      );
    }

    const body = (await c.req.json().catch(() => null)) as { signedPayload?: unknown } | null;
    const signedPayload = body?.signedPayload;
    if (
      typeof signedPayload !== 'string' ||
      signedPayload.length === 0 ||
      signedPayload.length > MAX_SIGNED_PAYLOAD_LENGTH
    ) {
      return jsonError(c, 400, 'APPLE_NOTIFICATION_INVALID', 'signedPayload is required');
    }

    const environment = expectedAppleEnvironment(c.env.ENVIRONMENT);
    const decoded = await decodeAppleServerNotification(
      signedPayload,
      { bundleId: config.bundleId, environment },
      verifyOptions,
    );
    if (!decoded.ok) {
      logStructured('warn', {
        at: 'billing.apple.notification',
        step: 'verify',
        reason: decoded.reason,
        detail: decoded.detail,
        expectedEnvironment: environment,
      });
      if (decoded.reason === 'bundle_mismatch') {
        return jsonError(
          c,
          400,
          'APPLE_NOTIFICATION_BUNDLE_MISMATCH',
          'Notification is for another app',
        );
      }
      if (decoded.reason === 'environment_mismatch') {
        return jsonError(
          c,
          400,
          'APPLE_NOTIFICATION_ENVIRONMENT_MISMATCH',
          'Notification is for another App Store environment',
        );
      }
      return jsonError(
        c,
        400,
        'APPLE_NOTIFICATION_INVALID',
        'Notification signature could not be verified',
      );
    }
    const notification = decoded.notification;
    const db = getDB(c.env);

    // ⚠ **응답 전에 적는다.** 적기 전에 200 을 주면, 그 뒤 실패를 애플도 우리도 모른다.
    if (!(await claimAppleNotification(db, notification))) {
      return c.json({ success: true, duplicate: true });
    }

    let result: ProcessResult;
    try {
      result = await processNotification(db, c.env, config, notification);
    } catch (error) {
      const retryable = error instanceof RetryableNotificationError;
      logStructured('error', {
        at: 'billing.apple.notification',
        step: 'process',
        notificationType: notification.type,
        subtype: notification.subtype,
        retryable,
        error: String(error),
      });
      try {
        await finishAppleNotification(db, notification.uuid, {
          status: 'failed',
          outcome: 'error',
          userPk: null,
          error: String(error),
        });
      } catch (markError) {
        // 실패 표시마저 못 적었다 — 행은 `received` 로 남고, 재전송이 와도 다시 처리한다(같은 결과).
        logStructured('error', {
          at: 'billing.apple.notification',
          step: 'mark_failed',
          error: String(markError),
        });
      }
      return jsonError(
        c,
        retryable ? 502 : 500,
        'APPLE_NOTIFICATION_PROCESSING_FAILED',
        'Notification was recorded but could not be processed',
      );
    }

    await finishAppleNotification(db, notification.uuid, result);
    logStructured('info', {
      at: 'billing.apple.notification',
      notificationType: notification.type,
      subtype: notification.subtype,
      status: result.status,
      outcome: result.outcome,
      userPk: result.userPk,
    });
    return c.json({ success: true, status: result.status, outcome: result.outcome });
  });

  return routes;
}

export default createBillingAppleNotificationsRoutes();
