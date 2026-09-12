import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk } from './billing-helpers';
import {
  findActiveSubscriptionsByUserPk,
  findStoreTransactionsForSubscriptions,
  refreshCompetingAppleRenewalState,
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

  const readCurrentSubscription = () =>
    db.execute({
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

  let result = await readCurrentSubscription();

  // **지금 이 계정의 갱신을 쥔 스토어 전부.** 위 SELECT 와 달리 만료로 거르지 않고,
  // 활성 구독이 하나도 안 잡혀도 돌려준다.
  //
  // ⚠ **`subscription` 안에 넣으면 안 된다**(코덱스 #733 3차). Play 보류(`ON_HOLD`/`PAUSED`)는
  //   구독 행을 `active` 로 남기고 `users.plan` 만 회수하는데, 그 행은 `expires_at` 이 이미
  //   지나 있어 위 SELECT 에 안 걸린다 — `subscription: null` 이 된다. 신호를 그 안에 넣어
  //   두면 **보류 중인 Play 구독이 앱에서 보이지 않고**, 그 상태로 애플 결제를 열어 주면
  //   결제가 복구되는 순간 두 곳에서 청구된다.
  let activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userId);
  let storeTxns = await findStoreTransactionsForSubscriptions(
    db,
    activeSubscriptions.map((s) => s.subscriptionId),
  );

  // ⚠ **애플이 갱신 주인으로 잡히면 그 값을 애플에 다시 물어 확인한다**(코덱스 #734).
  //   두 앱이 결제 직전 **이 응답으로** 막을지 정하는데, 애플 상태는 가만두면 낡는다 —
  //   우리가 받는 App Store 서버 알림이 없고 같은-플랜 갱신 갈래가 `cancel_at_period_end`
  //   를 0 으로 되돌린다. 낡은 값으로 막으면 **App Store 에서 이미 자동갱신을 끈 사용자가
  //   기간이 끝날 때까지 스토어를 못 옮긴다** — 우리 안내를 따라도 달라지지 않는다.
  //   (확정 라우트도 같은 것을 하지만, 거기까지 가면 이미 청구된 뒤다.)
  //
  // ⚠ **결제 직전 조회에서만 한다 — 기본은 끈다**(코덱스 #734 10차). 이 라우트는 앱 시작
  //   갱신·`PlanChangeSyncWorker`·`StockClipPrefetchWorker` 도 쓴다. 거기에 애플 서버
  //   호출을 끼우면 **애플이 느릴 때 DB 에 이미 있는 답까지 같이 늦어지고**, 그 사이
  //   울림 게이트가 낡은 로컬 값으로 돈다. 애플 상태가 낡아서 생기는 문제는 **결제를
  //   막는 순간에만** 해가 되므로, 그때만 켠다.
  //
  //   ⚠ 그리고 **애플이 걸릴 때만** 부른다 — 대부분의 계정에는 애플 결제가 없다.
  const refreshStoreState = c.req.query('refresh_store') === '1';

  // ⚠ **낡은 `users.plan` 도 이때 정리한다**(코덱스 #734 11차). 만료가 갓 지났는데 만료
  //   크론(5분)이 아직 안 돌았으면, 이 라우트는 `subscription: null` 을 주는데 `users.plan`
  //   은 **여전히 유료**다. 앱이 그 뒤 `/auth/me` 를 불러도 그건 저장된 값을 그대로 돌려줄
  //   뿐이라, **null 구독 옆에 유료 plan 이 함께 저장된다** — 그 상태로 오프라인 재시작하면
  //   `resolvePaidVoiceAccess` 가 계속 유료로 답해 울림·목소리 게이트가 열린다.
  //
  //   판정은 **만료를 본 활성 구독이 하나라도 있는가** 하나다. 프로모·바우처·그룹 멤버도
  //   전부 구독 행을 갖는다(보류는 행을 남기되 만료가 지나 있어 0으로 센다 — `users.plan`
  //   을 free 로 내리는 것이 그쪽 정책과도 같다).
  //
  //   ⚠ **결제 직전(`refresh_store=1`)에만 한다.** 일상 조회에 쓰기를 끼우지 않는다.
  if (refreshStoreState) {
    const entitledRes = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM subscriptions
            WHERE user_id = ? AND status = 'active' AND datetime(expires_at) > datetime('now')`,
      args: [userId],
    });
    if (Number(entitledRes.rows[0]?.n ?? 0) === 0) {
      await db.execute({
        sql: `UPDATE users SET plan = 'free', updated_at = datetime('now')
              WHERE id = ? AND plan <> 'free'`,
        args: [userId],
      });
    }
  }

  if (refreshStoreState && storeTxns.some((txn) => txn.provider === 'apple')) {
    const changed = await refreshCompetingAppleRenewalState(db, c.env, userId);
    if (changed) {
      activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userId);
      storeTxns = await findStoreTransactionsForSubscriptions(
        db,
        activeSubscriptions.map((s) => s.subscriptionId),
      );
      // ⚠ **돌려줄 구독 행도 다시 읽는다**(코덱스 #734 2차). 방금 고친 것이
      //   `cancel_at_period_end` 인데 위 SELECT 는 그 전에 돌았다 — 그대로 두면
      //   `store_renewal_providers` 는 새 상태이고 `subscription.cancel_at_period_end` 는
      //   옛 상태인 응답이 나가, 앱의 이용권 화면이 **해지 예약을 반대로** 보여 준다.
      result = await readCurrentSubscription();
    }
  }
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
