import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { getGoogleAccessToken, parseServiceAccountJson } from '../lib/google-oauth';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { cancelActiveSubscriptionsForUser } from '../lib/billing-cancel';
import {
  ANDROID_PUBLISHER_SCOPE,
  ENTITLED_STATES,
  googlePlanKeyFromProductId,
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

// RTDN 알림 본문(subscriptionId)은 위조 가능하므로, 등급 결정에 쓸 lineItem 은 재조회한
// subscription.lineItems(Google 권위 응답)에서 고른다. 알림 productId 와 일치하는 항목이 있으면
// 그것, 없으면 첫 항목 — 어느 쪽이든 productId 는 위조 본문이 아니라 권위 응답에서 온다.
// (저가 구독 토큰에 상위 productId 를 실어 셀프 등급상승하는 것을 차단)
export function selectAuthoritativeLineItem<T extends { productId?: string }>(
  lineItems: T[] | undefined,
  notifiedProductId: string,
): T | undefined {
  return lineItems?.find((item) => item.productId === notifiedProductId) ?? lineItems?.[0];
}

const billingGoogleRtdn = new Hono<AppEnv>();

billingGoogleRtdn.post('/rtdn', async (c) => {
  const account = parseServiceAccountJson(c.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const expectedPackage = c.env.ANDROID_PACKAGE_NAME;
  const verifyToken = c.env.GOOGLE_RTDN_VERIFICATION_TOKEN;
  if (!account || !expectedPackage || !verifyToken) {
    return c.json({ error: 'RTDN is not configured', error_code: 'RTDN_UNCONFIGURED' }, 503);
  }
  // 위조 방지 — Play→Pub/Sub push URL 에 박아둔 비밀 토큰만 허용.
  if (c.req.query('token') !== verifyToken) {
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
    sql: `SELECT user_id FROM store_transactions
          WHERE provider = 'google' AND provider_transaction_id = ?`,
    args: [purchaseToken],
  });
  if (txnRes.rows.length === 0) {
    logStructured('info', {
      at: 'billing.google.rtdn',
      note: 'unmapped_token',
      notificationType: sub.notificationType ?? null,
    });
    return c.json({ success: true, ignored: 'unmapped_token' });
  }
  const userPk = String(txnRes.rows[0]!.user_id);

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
    await withWriteTransaction(db, (tx) =>
      applyStoreEntitlement(tx, {
        userPk,
        provider: 'google',
        providerTransactionId: purchaseToken,
        productId: authoritativeProductId,
        plan,
        startsAt: new Date(),
        expiresAt: new Date(expiryMs),
        rawPayload: JSON.stringify({ via: 'rtdn', state, notificationType: sub.notificationType }),
      }),
    );
    logStructured('info', { at: 'billing.google.rtdn', action: 'entitle', state, userPk });
    return c.json({ success: true, action: 'entitled' });
  }

  if (action === 'cancel_at_period_end') {
    // 자동갱신만 꺼졌고 기간까지는 유효 — 활성 유지하되 예약취소 플래그만 세운다.
    // 권위 조회로 얻은 만료시각으로 expires_at 도 함께 갱신한다. 갱신(RENEWED)
    // 알림을 놓쳤거나 순서가 뒤바뀌어 DB 만료가 과거값으로 남아 있으면,
    // processSubscriptionExpiry 가 기간이 남았는데도 즉시 해지해버리기 때문이다.
    // (decideSubscriptionAction 이 cancel_at_period_end 를 반환하는 조건상 expiryMs 는 유한값이다.)
    const periodEndIso = new Date(expiryMs).toISOString();
    await db.execute({
      sql: `UPDATE subscriptions
            SET cancel_at_period_end = 1,
                expires_at = ?,
                canceled_at = COALESCE(canceled_at, datetime('now')),
                updated_at = datetime('now')
            WHERE user_id = ? AND status = 'active'`,
      args: [periodEndIso, userPk],
    });
    // 구독 만료를 권위값으로 밀 때 같은 구독에 묶인 공유 코드 만료도 함께 동기화한다.
    // (store-billing 갱신 경로와 동일 규칙) issued·used 모두 연장, expired 는 제외.
    // 누락하면 만료가 미뤄진 구독에 옛 만료의 코드가 남아 redemption 이 만료로 거부된다.
    await db.execute({
      sql: `UPDATE voucher_codes
            SET expires_at = ?
            WHERE issuer_user_id = ?
              AND status IN ('issued', 'used')
              AND issuer_subscription_id IN (
                SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active'
              )`,
      args: [periodEndIso, userPk, userPk],
    });
    logStructured('info', { at: 'billing.google.rtdn', action: 'cancel_at_period_end', userPk });
    return c.json({ success: true, action: 'cancel_at_period_end' });
  }

  // ON_HOLD/PAUSED 는 결제 복구로 되살아날 수 있는 일시 상태다. 이때
  // cancelActiveSubscriptionsForUser 를 호출하면 소유자의 가족 그룹 멤버가
  // 전원 삭제·강등되고(cancelSubscriptionImmediate 의 owner 분기), 이후 복구
  // (entitle)는 소유자 구독만 되살려 그룹이 깨진 채로 남는다. 따라서 회복형
  // 상태에서는 그룹·멤버 구조를 보존하고 소유자 권한만 보수적으로 회수한다
  // (결제가 복구되면 entitle 가 users.plan 을 원복). 진짜 종료 상태
  // (EXPIRED/REVOKED/CANCELED+만료지남)에서만 그룹 정리를 포함한 완전 취소를 한다.
  const isRecoverable =
    state === 'SUBSCRIPTION_STATE_ON_HOLD' || state === 'SUBSCRIPTION_STATE_PAUSED';
  if (isRecoverable) {
    await db.execute({
      sql: `UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?`,
      args: [userPk],
    });
    logStructured('info', { at: 'billing.google.rtdn', action: 'suspend', state, userPk });
    return c.json({ success: true, action: 'suspended' });
  }

  // deactivate — 즉시 권한 회수(가족 그룹/바우처 정리 포함). 음성 데이터는 보존한다.
  await withWriteTransaction(db, (tx) =>
    cancelActiveSubscriptionsForUser(tx, userPk, new Date(), { deleteVoiceData: false }),
  );
  logStructured('info', { at: 'billing.google.rtdn', action: 'deactivate', state, userPk });
  return c.json({ success: true, action: 'deactivated' });
});

export default billingGoogleRtdn;
