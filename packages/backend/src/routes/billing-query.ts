import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk } from './billing-helpers';
import {
  findActiveSubscriptionsByUserPk,
  findStoreTransactionsForSubscriptions,
  storeCancelProviderOf,
  storeRenewalProvidersOf,
} from '../lib/billing-cancel';

const billingQuery = new Hono<AppEnv>();

billingQuery.get('/vouchers', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ vouchers: [] });
  }
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT v.id, v.code, v.plan_id, v.issuer_subscription_id, v.redeemed_by_user_id,
                 v.status, v.issued_at, v.used_at, v.expires_at, v.max_uses,
                 (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = v.id) AS use_count,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type
          FROM voucher_codes v
          JOIN plans p ON p.id = v.plan_id
          WHERE v.issuer_user_id = ?
          ORDER BY v.issued_at DESC`,
    args: [userPk],
  });

  return c.json({
    vouchers: result.rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      plan_id: String(r.plan_id),
      plan_key: String(r.plan_key),
      plan_name: String(r.plan_name),
      plan_type: String(r.plan_type),
      subscription_id: (r.issuer_subscription_id as string | null) ?? null,
      redeemed_by_user_id: (r.redeemed_by_user_id as string | null) ?? null,
      status: String(r.status),
      issued_at: String(r.issued_at),
      used_at: (r.used_at as string | null) ?? null,
      expires_at: String(r.expires_at),
      max_uses: Number(r.max_uses ?? 1),
      use_count: Number(r.use_count ?? 0),
    })),
  });
});

billingQuery.get('/subscription', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id,
                 s.status, s.starts_at, s.expires_at,
                 s.cancel_at_period_end, s.canceled_at, s.next_plan_id,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type,
                 p.period_days, p.max_members, p.price_krw,
                 np.key AS next_plan_key, np.name AS next_plan_name, np.plan_type AS next_plan_type
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN plans p ON p.id = s.plan_id
          LEFT JOIN plans np ON np.id = s.next_plan_id
          WHERE u.id = ?
            AND s.status = 'active'
            AND s.expires_at > datetime('now')
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userId],
  });

  // **지금 이 계정의 갱신을 쥔 스토어 전부.** 위 SELECT 와 달리 만료로 거르지 않고,
  // 활성 구독이 하나도 안 잡혀도 돌려준다.
  //
  // ⚠ **`subscription` 안에 넣으면 안 된다**(코덱스 #733 3차). Play 보류(`ON_HOLD`/`PAUSED`)는
  //   구독 행을 `active` 로 남기고 `users.plan` 만 회수하는데, 그 행은 `expires_at` 이 이미
  //   지나 있어 위 SELECT 에 안 걸린다 — `subscription: null` 이 된다. 신호를 그 안에 넣어
  //   두면 **보류 중인 Play 구독이 앱에서 보이지 않고**, 그 상태로 애플 결제를 열어 주면
  //   결제가 복구되는 순간 두 곳에서 청구된다.
  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userId);
  const storeTxns = await findStoreTransactionsForSubscriptions(
    db,
    activeSubscriptions.map((s) => s.subscriptionId),
  );
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

  if (result.rows.length === 0) {
    return c.json({
      subscription: null,
      plan: null,
      next_plan: null,
      store_renewal_providers: storeRenewalProviders,
    });
  }

  const r = result.rows[0]!;
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
  // 는 최신 1건만 돌려주지만, 해지는 활성 구독 중 **하나라도** 애플이면 409 로 거절한다.
  // (그 집합은 이 라우트 앞머리에서 이미 구했다 — `storeTxns`.)

  return c.json({
    store_renewal_providers: storeRenewalProviders,
    subscription: {
      // 'apple' | 'google' | null. null 은 스토어 결제가 아니라는 뜻이다
      // (dev 스텁·프로모·바우처) — 서버 로컬 해지가 된다.
      store_provider: storeCancelProviderOf(storeTxns),
      id: String(r.sub_id),
      user_id: String(r.user_id),
      plan_id: String(r.plan_id),
      plan_group_id: (r.plan_group_id as string | null) ?? null,
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
      max_members: Number(r.max_members),
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

export default billingQuery;
