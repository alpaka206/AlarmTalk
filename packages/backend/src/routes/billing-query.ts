import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { loadPlanGrantAnswer } from '../lib/plan-grants';
import {
  findActiveSubscriptionsByUserPk,
  findStoreTransactionsForSubscriptions,
  storeCancelProviderOf,
  storeRenewalProvidersOf,
  repairOrphanedPaidPlan,
  notifyBillingStateChanged,
  strongestPaidSubscription,
} from '../lib/billing-cancel';

import {
  reconcileBillingPreflight,
  BillingStateUnavailableError,
} from '../lib/billing-reconciliation';
import { withReadTransaction, withWriteTransaction } from '../lib/transactions';
import { jsonError } from '../lib/api-error';
import { computedUserPlan, loadPersonalPromoField, resolvePersonalPromo } from '../lib/personal-promo';

const billingQuery = new Hono<AppEnv>();

// 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다. 초대 코드는 없앴다(커플·가족 이용권 폐지).
// 옛 앱 둘은 이 목록을 구독 조회와 **함께** 받아(한쪽이 실패하면 구독 답까지 버린다) 빈 배열로 답한다.
// DB 를 읽지 않는다.
billingQuery.get('/vouchers', (c) => c.json({ vouchers: [] }));

billingQuery.get('/subscription', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  // 기간 한정 개인 플랜 — 이 요청의 시각으로 한 번 푼다(`docs/spec/billing-lifecycle.md`).
  const promo = resolvePersonalPromo(c.env);

  const refreshStoreState = c.req.query('refresh_store') === '1';
  if (refreshStoreState) {
    try {
      await reconcileBillingPreflight(db, c.env, userId);
    } catch (error) {
      if (!(error instanceof BillingStateUnavailableError)) throw error;
      return jsonError(
        c,
        503,
        'INTERNAL_ERROR',
        'Subscription verification is temporarily unavailable',
      );
    }
    // 스토어 구독을 모두 처리한 뒤, 활성 근거 자체가 사라진 계정만 정리한다.
    // 복구 조건은 원시 plan 이다 — 프로모는 DB 에 쓰지 않으므로 여기 닿지 않는다. 보관 기한만
    // 프로모를 반영한다(기간 중 복구된 계정에 거짓 삭제 예고를 걸지 않게).
    const repaired = await withWriteTransaction(db, (tx) =>
      repairOrphanedPaidPlan(tx, userId, promo.now, promo.active),
    );
    await notifyBillingStateChanged(db, c.env, repaired);
  }

  return withReadTransaction(db, async (tx) => {
    const result = await tx.execute({
      sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id,
                   s.status, s.starts_at, s.expires_at, s.entitlement_state,
                   s.cancel_at_period_end, s.canceled_at, s.next_plan_id,
                   p.key AS plan_key, p.name AS plan_name, p.plan_type,
                   p.period_days, p.price_krw,
                   np.key AS next_plan_key, np.name AS next_plan_name, np.plan_type AS next_plan_type
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            JOIN plans p ON p.id = s.plan_id
            LEFT JOIN plans np ON np.id = s.next_plan_id
            WHERE u.id = ?
              AND s.status = 'active'
              AND datetime(s.expires_at) > datetime('now')
            ORDER BY s.starts_at DESC`,
      args: [userId],
    });

    const activeSubscriptions = await findActiveSubscriptionsByUserPk(tx, userId);
    const storeTxns = await findStoreTransactionsForSubscriptions(
      tx,
      activeSubscriptions.map((s) => s.subscriptionId),
    );
    // plan 과 구독은 한 DB 스냅샷이다. 앱도 한 번의 권한 쓰기로 저장한다.
    // ⚠ **`user_plan` 은 계산값이다**(기간 한정 개인 플랜). `subscription` 은 원시 구독 행이라
    //   프로모 사용자는 `null` 그대로다 — **가짜 구독 객체를 만들지 않는다**(구버전 앱에 해지
    //   버튼이 뜨고 `/billing/cancel` 은 404 를 낸다). 원시 plan 은 `refresh_store=1` 이거나
    //   프로모가 켜져 있을 때만 읽는다 — 평상시 조회에 DB 왕복을 더하지 않는다.
    // 등급과 관리자 지급의 끝은 한 순간·한 문장으로 계산한다(`loadPlanGrantAnswer` — 따로 읽으면 그 사이 지급이 끝났을 때
    // 기한 없는 plus 가 나간다). 지급 끝(`plan_grant`)은 언제나 싣는다 — 앱의 오프라인 기한이다.
    const grantAnswer = await loadPlanGrantAnswer(tx, userId, null, promo.now);
    const rawPlan = grantAnswer.plan;
    const userPlan = refreshStoreState ? (computedUserPlan(rawPlan, promo) ?? 'free') : undefined;
    // 결제 보류 계정(원시 free + `active` 행)도 값이 있다 — `deletes_voices_at_end` 만 false 다.
    const personalPromo = await loadPersonalPromoField(tx, userId, rawPlan, promo);
    const planGrant = grantAnswer.planGrant;
    // ⚠ **해지 예약된 구독은 갱신 주인이 아니다**(코덱스 #733 6차). `cancel_at_period_end = 1`
    //   은 "아직 유료지만 다음 갱신은 없다" 는 뜻이라, 그걸 세면 **안내대로 Play 에서 해지한
    //   사용자가 남은 기간 내내 애플로 못 산다** — 우리가 하라고 한 일을 했는데 막힌다.
    //   (해지 판정 `store_provider` 는 반대다. 예약해지든 아니든 서버는 애플 구독을 못 끊으므로
    //   거기서는 활성 구독 전부를 본다.)
    //   조회는 한 번이고, 거르는 것은 메모리에서 한다.
    const renewingSubscriptionIds = new Set(
      activeSubscriptions.filter((sub) => !sub.cancelAtPeriodEnd).map((sub) => sub.subscriptionId),
    );
    const storeRenewalProviders = storeRenewalProvidersOf(
      storeTxns.filter((txn) => renewingSubscriptionIds.has(txn.subscriptionId)),
    );

    // 등급 재계산과 같은 선택 함수를 쓴다. 보류·미확인 행은 표시용 유료 근거가 아니다.
    const r = strongestPaidSubscription(
      result.rows.map((row) => ({
        row,
        planType: String(row.plan_type),
        entitlementState: String(row.entitlement_state),
      })),
    )?.row;
    if (!r) {
      return c.json({
        user_plan: userPlan,
        personal_promo: personalPromo,
        plan_grant: planGrant,
        subscription: null,
        plan: null,
        next_plan: null,
        store_renewal_providers: storeRenewalProviders,
      });
    }

    const nextPlanId = (r.next_plan_id as string | null) ?? null;

    // **해지가 어느 스토어를 거쳐야 하는지 앱에 알려 준다**(코덱스 #732 P1).
    //
    // ⚠ 앱이 이걸 **로컬 스토어 상태로 흉내 내면 안 된다.** iOS 는 `purchasedProductIDs`
    // 에 구독이 하나라도 있으면 애플로 보고 애플 관리 시트를 열었는데, 아이폰에서 산 옛
    // 구독의 entitlement 가 기기에 남은 채 지금은 Play 구독을 쓰는 사용자가 있다 —
    // 그 경우 `/billing/cancel` 을 **아예 부르지 않아** 사용자는 해지했다고 믿는데 Play
    // 구독이 계속 갱신된다.
    //
    // 판정 범위는 해지 라우트와 **같은 집합**(그 사용자의 활성 구독 전부)이다. 위 SELECT
    // 에서 표시할 권한을 고르지만, 해지는 활성 구독 중 **하나라도** 애플이면 409 로 거절한다.
    // (그 집합은 이 라우트 앞머리에서 이미 구했다 — `storeTxns`.)

    return c.json({
      user_plan: userPlan,
      personal_promo: personalPromo,
      plan_grant: planGrant,
      store_renewal_providers: storeRenewalProviders,
      subscription: {
        // 'apple' | 'google' | null. null 은 스토어 결제가 아니라는 뜻이다
        // (dev 스텁·프로모) — 서버 로컬 해지가 된다.
        store_provider: storeCancelProviderOf(storeTxns),
        id: String(r.sub_id),
        user_id: String(r.user_id),
        plan_id: String(r.plan_id),
        status: String(r.status),
        starts_at: String(r.starts_at),
        expires_at: String(r.expires_at),
        cancel_at_period_end: Number(r.cancel_at_period_end ?? 0) === 1,
        canceled_at: (r.canceled_at as string | null) ?? null,
        next_plan_id: nextPlanId,
      },
      plan: {
        id: String(r.plan_id),
        key: String(r.plan_key),
        name: String(r.plan_name),
        plan_type: String(r.plan_type),
        period_days: Number(r.period_days),
        // 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다. 정원 칸은 DB 에서 없앴지만 옛 iOS 의
        // `BillingPlan` 디코더가 이 키를 필수로 읽는다(빠지면 구독 답 전체가 실패한다).
        max_members: 1,
        price_krw: Number(r.price_krw),
      },
      next_plan: nextPlanId
        ? {
            id: nextPlanId,
            key: String(r.next_plan_key),
            name: String(r.next_plan_name),
            plan_type: String(r.next_plan_type),
          }
        : null,
    });
  });
});

export default billingQuery;
