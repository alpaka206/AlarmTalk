import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { getGoogleAccessToken, parseServiceAccountJson } from '../lib/google-oauth';
import {
  getPlaySubscriptionV2,
  googlePaymentAnchor,
  selectAuthoritativeLineItem,
} from '../lib/play-subscriptions';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { purchaseBelongsToUser } from '../lib/purchase-account-binding';
import { notifyPlanChanged, refreshCompetingAppleRenewalState } from '../lib/billing-cancel';
import {
  BillingStateUnavailableError,
  reconcileStoreSubscription,
} from '../lib/billing-reconciliation';
import { timingSafeEqualStr } from '../lib/timing-safe-equal';
import {
  acknowledgeGoogleSubscription,
  ANDROID_PUBLISHER_SCOPE,
  ENTITLED_STATES,
  googlePlanKeyFromProductId,
  isRecoverablePlayState,
  type SubscriptionV2Response,
} from './billing-google';

// MARK: - POST /api/billing/google/rtdn  (공개 라우트, 사용자 인증 없음)
//
// Google Play RTDN(Real-time developer notifications) 수신 엔드포인트.
// Play Console 구독 변화(갱신/취소/만료/보류/환불 등)를 Cloud Pub/Sub push 로
// 받아 서버 구독 상태를 동기화한다. (클라이언트 confirm 경로만으로는 Play 에서
// 직접 취소·환불한 경우를 잡지 못하므로 이 웹훅이 보강한다.)
//
// 보안: 사용자 인증이 없으므로 ?token=<GOOGLE_RTDN_VERIFICATION_TOKEN> 쿼리로만 허용.
//       (Play→Pub/Sub push 구독 URL 에 이 토큰을 박아둔다.)
// 권위: 알림 본문을 신뢰하지 않고 purchaseToken 으로 subscriptionsv2.get 를 재조회해
//       서버가 직접 상태를 판정한다. (confirm 라우트와 동일 전략)

interface PubSubPushEnvelope {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
}

export interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  testNotification?: { version?: string };
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
}

function decodeBase64ToString(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Pub/Sub push 엔벨로프에서 DeveloperNotification 을 디코드한다.
 * 형식 오류면 null (호출자는 200 ack 로 무시 — 재시도해도 의미 없음).
 */
export function parseDeveloperNotification(body: unknown): DeveloperNotification | null {
  if (!body || typeof body !== 'object') return null;
  const dataB64 = (body as PubSubPushEnvelope).message?.data;
  if (typeof dataB64 !== 'string' || dataB64.length === 0) return null;
  try {
    const json = decodeBase64ToString(dataB64);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as DeveloperNotification;
  } catch {
    return null;
  }
}

export type SubscriptionAction = 'entitle' | 'cancel_at_period_end' | 'deactivate';

/**
 * 재조회한 권위 상태(subscriptionState)와 만료시각으로 동기화 액션을 결정한다.
 *  - ACTIVE/GRACE & 만료 미래       → entitle (갱신/복구, 멱등 재적용)
 *  - CANCELED & 만료 미래            → cancel_at_period_end (자동갱신만 꺼짐, 기간까지 유지)
 *  - 그 외(EXPIRED/ON_HOLD/PAUSED/   → deactivate (즉시 권한 회수)
 *    REVOKED/CANCELED+만료지남 등)
 */
export function decideSubscriptionAction(
  state: string,
  expiryMs: number,
  nowMs: number,
): SubscriptionAction {
  const stillWithinPaidPeriod = Number.isFinite(expiryMs) && expiryMs > nowMs;
  if (ENTITLED_STATES.has(state) && stillWithinPaidPeriod) return 'entitle';
  if (state === 'SUBSCRIPTION_STATE_CANCELED' && stillWithinPaidPeriod) {
    return 'cancel_at_period_end';
  }
  return 'deactivate';
}

export { selectAuthoritativeLineItem };

const billingGoogleRtdn = new Hono<AppEnv>();

billingGoogleRtdn.post('/rtdn', async (c) => {
  const account = parseServiceAccountJson(c.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const expectedPackage = c.env.ANDROID_PACKAGE_NAME;
  const verifyToken = c.env.GOOGLE_RTDN_VERIFICATION_TOKEN;
  if (!account || !expectedPackage || !verifyToken) {
    return c.json({ error: 'RTDN is not configured', error_code: 'RTDN_UNCONFIGURED' }, 503);
  }
  // 위조 방지 — Play→Pub/Sub push URL 에 박아둔 비밀 토큰만 허용. 상수시간 비교로 타이밍 오라클 차단.
  if (!timingSafeEqualStr(c.req.query('token') ?? '', verifyToken)) {
    return c.json({ error: 'Forbidden', error_code: 'RTDN_BAD_TOKEN' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const notification = parseDeveloperNotification(body);
  if (!notification) {
    // 형식 오류 — 재시도 무의미하므로 200 ack 로 흘려보낸다.
    return c.json({ success: true, ignored: 'unparseable' });
  }
  if (notification.packageName && notification.packageName !== expectedPackage) {
    return c.json({ success: true, ignored: 'package_mismatch' });
  }
  if (notification.testNotification) {
    logStructured('info', { at: 'billing.google.rtdn', test: true });
    return c.json({ success: true, test: true });
  }

  const sub = notification.subscriptionNotification;
  if (!sub?.purchaseToken || !sub.subscriptionId) {
    // 구독 외 알림(voided/one-time 등)은 현재 미처리 — ack.
    return c.json({ success: true, ignored: 'unsupported' });
  }
  const purchaseToken = sub.purchaseToken;
  const productId = sub.subscriptionId;

  // purchaseToken → 기존 사용자/구독 매핑. confirm 전이라 매핑이 없으면 클라이언트
  // confirm 경로가 처리하므로 여기서는 ack 로 흘려보낸다.
  const db = getDB(c.env);
  const txnRes = await db.execute({
    sql: `SELECT user_id, subscription_id FROM store_transactions
          WHERE provider = 'google' AND provider_transaction_id = ?`,
    args: [purchaseToken],
  });
  // ⚠ **매핑이 없다고 바로 포기하지 말 것 — 전환(업/다운그레이드)이 여기로 온다.**
  // Play 는 교체 구매에 **새 purchaseToken** 을 발급하므로, 클라 confirm 이 오기 전에는
  // 이 표에 행이 없다. 그 토큰의 권위 응답에는 `linkedPurchaseToken`(대체된 옛 토큰)이
  // 실려 오니, 그걸로 옛 구독의 주인을 찾아 이어 붙인다. 이게 없으면 전환 알림이
  // 통째로 버려지고 **전환 반영이 클라 confirm 하나에만 매달린다** — 결제 직후 앱이
  // 죽거나 오프라인이면 서버는 그 전환을 영영 모른다(2026-08-11 확인).
  let txnRow = txnRes.rows[0] ?? null;
  let linkedFromToken: string | null = null;
  if (!txnRow) {
    // 권위 재조회는 아래에서 한 번 더 하지만, 여기서는 **주인을 찾기 위해서만** 부른다.
    // 실패해도 치명적이지 않다 — 매핑을 못 찾은 것과 같게 흘려보낸다.
    const linkedLookup = await getPlaySubscriptionV2(c.env, purchaseToken)
      .then((r) => ({
        linked: r.linkedPurchaseToken ?? null,
        obfuscatedId:
          r.externalAccountIdentifiers?.obfuscatedExternalAccountId?.trim()?.toLowerCase() ?? null,
      }))
      .catch(() => ({ linked: null as string | null, obfuscatedId: null as string | null }));
    if (linkedLookup.linked) {
      const linkedRes = await db.execute({
        sql: `SELECT user_id, subscription_id FROM store_transactions
              WHERE provider = 'google' AND provider_transaction_id = ?`,
        args: [linkedLookup.linked],
      });
      const candidate = linkedRes.rows[0] ?? null;
      // ⚠ **옛 토큰의 주인을 그냥 물려받지 말 것 — 구매-계정 바인딩을 여기서도 본다.**
      // `linkedPurchaseToken` 은 업/다운그레이드뿐 아니라 **해지했지만 아직 만료 전인
      // 구독의 재가입(re-signup)** 에도 실려 온다. 그건 **같은 구글 계정**이기만 하면
      // 되고 **같은 AlarmTalk 계정이라는 보장이 없다.** 검증 없이 물려받으면 공용 폰
      // 시나리오에서 사고가 난다: 계정 A 가 해지 → 계정 B 로 로그인해 다시 구매 →
      // RTDN 이 클라 confirm 을 앞질러 도착 → **A 에게 이용권이 붙고** `store_transactions`
      // 가 새 토큰을 A 에게 영구 바인딩한다. 뒤늦게 온 B 의 confirm 은
      // `TRANSACTION_OWNED_BY_OTHER_USER` 로 **영구히 409** 다 — 돈 낸 사람이 막히고
      // 안 낸 사람이 받는다. 게다가 A 의 기존 구독까지 새 것으로 갈아치운다.
      //
      // confirm(`billing-google.ts`)은 이 대조를 이미 하고 있었다. 같은 응답에
      // 식별자가 실려 오므로 여기서 못 할 이유가 없다 — 안 하고 있었을 뿐이다.
      if (candidate) {
        const ownerPk = String(candidate.user_id);
        if (await purchaseBelongsToUser(db, linkedLookup.obfuscatedId, ownerPk)) {
          txnRow = candidate;
          linkedFromToken = linkedLookup.linked;
        } else {
          // 흘려보낸다(ack). 클라 confirm 이 제 계정으로 바인딩하는 게 정답이다 —
          // 여기서 틀린 주인에게 붙이면 되돌릴 길이 없다.
          logStructured('warn', {
            at: 'billing.google.rtdn',
            step: 'linked_account_binding',
            error: 'linked token owner does not match purchase account',
            notificationType: sub.notificationType ?? null,
          });
        }
      }
    }
  }
  if (!txnRow) {
    logStructured('info', {
      at: 'billing.google.rtdn',
      note: 'unmapped_token',
      notificationType: sub.notificationType ?? null,
    });
    return c.json({ success: true, ignored: 'unmapped_token' });
  }
  if (linkedFromToken) {
    logStructured('info', {
      at: 'billing.google.rtdn',
      note: 'linked_token_resolved',
      notificationType: sub.notificationType ?? null,
    });
  }
  const userPk = String(txnRow.user_id);
  // 이 토큰이 마지막으로 entitle 된 서버 구독 (applyStoreEntitlement 가 기록).
  // 비활성화 계열 액션은 이 구독 한 건에만 작용해야 한다 — 아래 스테일 토큰 게이트 참고.
  const mappedSubscriptionId = (txnRow.subscription_id as string | null) ?? null;

  // 권위 재조회 — 알림 본문을 신뢰하지 않는다.
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(account, ANDROID_PUBLISHER_SCOPE);
  } catch (err) {
    logStructured('error', { at: 'billing.google.rtdn', step: 'oauth', error: String(err) });
    // 일시 장애 — non-2xx 로 두면 Pub/Sub 가 재시도한다.
    return c.json({ error: 'verification failed', error_code: 'GOOGLE_VERIFICATION_FAILED' }, 502);
  }

  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(expectedPackage)}`;
  const lookupRes = await fetch(
    `${baseUrl}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!lookupRes.ok) {
    const detail = (await lookupRes.text()).slice(0, 300);
    logStructured('warn', {
      at: 'billing.google.rtdn',
      step: 'lookup',
      status: lookupRes.status,
      detail,
    });
    if (lookupRes.status === 404 || lookupRes.status === 410) {
      // 토큰이 만료·삭제되어 더 조회 불가 — 재시도해도 동일하므로 ack.
      return c.json({ success: true, ignored: 'token_gone' });
    }
    return c.json({ error: 'verification failed', error_code: 'GOOGLE_VERIFICATION_FAILED' }, 502);
  }

  const subscription = (await lookupRes.json()) as SubscriptionV2Response;
  const state = subscription.subscriptionState ?? '';
  const lineItem = selectAuthoritativeLineItem(subscription.lineItems, productId);
  // 플랜 등급은 위조 가능한 알림 본문(sub.subscriptionId=productId)이 아니라, 권위 재조회한
  // lineItem.productId 로만 결정한다. (confirm 경로의 PRODUCT_MISMATCH 방어와 동일 — RTDN
  // 공유토큰 보유자가 저가 구독 토큰에 상위 productId 를 실어 셀프 등급상승하는 것을 차단)
  const authoritativeProductId = lineItem?.productId ?? null;
  const expiryMs = lineItem?.expiryTime ? new Date(lineItem.expiryTime).getTime() : NaN;
  const action = decideSubscriptionAction(state, expiryMs, Date.now());

  if (action === 'entitle') {
    if (!authoritativeProductId) {
      logStructured('warn', { at: 'billing.google.rtdn', note: 'no_line_item', productId });
      return c.json({ success: true, ignored: 'no_line_item' });
    }
    const planKey = googlePlanKeyFromProductId(authoritativeProductId);
    const plan = planKey ? await loadPlanByKey(db, planKey) : null;
    if (!plan) {
      logStructured('warn', {
        at: 'billing.google.rtdn',
        note: 'plan_not_found',
        productId: authoritativeProductId,
      });
      return c.json({ success: true, ignored: 'plan_not_found' });
    }
    // 막기 전에 애플 갱신 상태를 최신화한다(confirm 경로와 같은 이유 — 코덱스 #733 8차).
    await refreshCompetingAppleRenewalState(db, c.env, userPk);
    const lastPaidAt = await googlePaymentAnchor(c.env, subscription, purchaseToken);
    const entitleResult = await withWriteTransaction(db, (tx) =>
      applyStoreEntitlement(tx, {
        userPk,
        provider: 'google',
        providerTransactionId: purchaseToken,
        productId: authoritativeProductId,
        plan,
        startsAt: new Date(),
        // confirm 경로와 같은 이유 — 확정 시각이 아니라 결제 시각을 앵커로 쓴다.
        lastPaidAt,
        expiresAt: new Date(expiryMs),
        rawPayload: JSON.stringify({ via: 'rtdn', state, notificationType: sub.notificationType }),
      }),
    );
    // ⚠ **권한을 못 준 채로 구매를 확인 처리하지 않는다**(코덱스 #733 7차).
    //   `applyStoreEntitlement` 가 교차 스토어로 거절하면 **아무것도 쓰이지 않는다.**
    //   그런데 아래 `acknowledgeGoogleSubscription` 은 `ok` 를 보지 않아서, 예전에는
    //   **권한 없는 결제를 확인 처리**했다 — 확인된 구매는 Play 의 3일 자동 환불 대상에서
    //   빠지므로, 사용자는 돈만 내고 아무것도 못 받은 채 되돌릴 길까지 잃는다.
    //   확인하지 않고 두면 Play 가 3일 뒤 자동 환불한다. 그게 옳은 결말이다.
    //
    //   Pub/Sub 자체는 200 으로 받는다 — 재시도해도 결과가 같다.
    if (!entitleResult.ok) {
      logStructured('warn', {
        at: 'billing.google.rtdn',
        note: 'entitle_rejected',
        errorCode: entitleResult.errorCode,
        userPk,
      });
      return c.json({ success: true, ignored: 'entitle_rejected' });
    }
    // ⚠ 정원 축소로 그룹에서 나가게 된 멤버에게 알린다(위 confirm 경로와 같은 이유).
    if (entitleResult.planChangedUserIds.length > 0) {
      await notifyPlanChanged(db, c.env, entitleResult.planChangedUserIds);
    }
    // 권위 재조회 결과 acknowledgement 이 보류면 서버가 확인 처리한다 — 앱 미실행으로
    // confirm 이 오지 않아도 RTDN(구매/갱신 알림)이 서버측 ack 재시도 경로가 된다
    // (미확인 시 3일 후 Play 자동 환불). confirm 과 동일한 ack 헬퍼를 재사용한다.
    if (subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      await acknowledgeGoogleSubscription({
        baseUrl,
        productId: authoritativeProductId,
        purchaseToken,
        accessToken,
      });
    }
    // 멤버 기간·권한은 applyStoreEntitlement 의 동일 트랜잭션에서 이미 복구했다.
    await notifyPlanChanged(db, c.env, [userPk]);
    return c.json({ success: true, action: 'entitled' });
  }

  // --- 이하 비활성화 계열 (cancel_at_period_end / suspend / deactivate) ---
  //
  // 스테일 토큰 게이트: 재가입·플랜변경 직후에는 옛 purchaseToken 의 늦은 EXPIRED/CANCELED
  // 알림이 도착할 수 있다. 사용자 전체 구독에 작용하면 방금 결제한 신규 구독까지
  // 취소(+가족그룹 파괴+보관 예약)되므로, 이 토큰에 매핑된 구독이 "현재 이 사용자의
  // 활성 구독"일 때만 비활성화를 수행하고 아니면 로그만 남기고 정상 ack 한다.
  // (entitle 은 게이트를 타지 않는다 — 신규 구매/부활 알림은 매핑 구독이 비활성인 상태에서
  // 오는 것이 정상이고, applyStoreEntitlement 자체가 토큰 스코프로 동작한다.)
  //
  // 한계: eventTimeMillis 를 store_transactions 에 기록해 역행(순서 뒤바뀐) 이벤트를 무시하는
  // 것이 이상적이지만 스키마 변경(last_event_time)이 필요해 여기서는 하지 않는다. 이 게이트가
  // 스테일 알림의 파괴적 액션을 막고, 무시된 진짜 만료는 cron(processSubscriptionExpiry)의
  // Play 권위 재조회(reconcile)가 보정한다.
  const mappedRes = mappedSubscriptionId
    ? await db.execute({
        // `period_days` 는 결제 앵커(`googlePaymentAnchor`) 계산에 쓴다 — 빠지면 월(30)로
        // 떨어져 연간·장기 부여에서 앵커가 크게 어긋난다.
        sql: `SELECT s.plan_id, s.plan_group_id, p.plan_type, p.key AS plan_key, p.period_days
              FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'`,
        args: [mappedSubscriptionId, userPk],
      })
    : null;
  const mappedRow = mappedRes?.rows[0];
  if (!mappedSubscriptionId || !mappedRow) {
    // subscription_id 미기록(NULL) 매핑도 스코프를 특정할 수 없으므로 동일하게 무시한다
    // (entitle 경로가 항상 subscription_id 를 기록하므로 정상 흐름에선 발생하지 않는다).
    logStructured('info', {
      at: 'billing.google.rtdn',
      note: 'stale_token_ignored',
      action,
      state,
      userPk,
      subscriptionId: mappedSubscriptionId,
    });
    return c.json({ success: true, ignored: 'stale_token' });
  }
  // 취소·보류·만료도 크론/구매 전 조회와 같은 원자적 정합화 경로를 탄다.
  // 매핑 조회 이후 전환됐더라도 내부의 낙관적 스냅샷 검사가 옛 응답을 거부한다.
  try {
    await reconcileStoreSubscription(db, c.env, mappedSubscriptionId);
  } catch (error) {
    if (!(error instanceof BillingStateUnavailableError)) throw error;
    return c.json({ error: 'verification failed', error_code: 'GOOGLE_VERIFICATION_FAILED' }, 502);
  }
  return c.json({
    success: true,
    action:
      action === 'cancel_at_period_end'
        ? 'cancel_at_period_end'
        : isRecoverablePlayState(state)
          ? 'suspended'
          : 'deactivated',
  });
});

export default billingGoogleRtdn;
