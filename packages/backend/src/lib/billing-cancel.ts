// 구독 해지/만료 정리 공통 로직.
//
// 즉시 해지 (cancelSubscriptionImmediate)
//   - subscription.status = 'cancelled'
//   - users.plan = 'free'
//   - 가족 owner 면 plan_group 의 모든 멤버 subscription 도 동일 처리
//   - 미사용 voucher 는 status='expired' 로 회수
//   - voice_profiles 는 보존하되 is_shared=0 으로 가족 노출만 차단
//
// 결제일까지 사용 후 해지 (scheduleCancelAtPeriodEnd)
//   - subscription.cancel_at_period_end = 1
//   - cron 이 expires_at 도달 시 cancelSubscriptionImmediate 호출

import type { Client } from '@libsql/client';
import { planTypeToUserPlan } from '../routes/billing-helpers';

interface ActiveSubscription {
  subscriptionId: string;
  userPk: string;
  planId: string;
  planType: string;
  planGroupId: string | null;
}

export async function findActiveSubscriptionByUserPk(
  db: Client,
  userPk: string,
): Promise<ActiveSubscription | null> {
  const res = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ? AND s.status = 'active'
          ORDER BY s.starts_at DESC LIMIT 1`,
    args: [userPk],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0]!;
  return {
    subscriptionId: String(r.sub_id),
    userPk: String(r.user_id),
    planId: String(r.plan_id),
    planType: String(r.plan_type),
    planGroupId: (r.plan_group_id as string | null) ?? null,
  };
}

async function downgradeUserToFree(db: Client, userPk: string): Promise<void> {
  await db.execute({
    sql: `UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?`,
    args: [userPk],
  });
  // 가족 공유 음성 프로필 노출만 차단 (보존, 재결제 시 재공유 가능).
  await db.execute({
    sql: `UPDATE voice_profiles SET is_shared = 0 WHERE user_id = ? AND is_shared = 1`,
    args: [userPk],
  });
}

async function expireUnusedVouchersFor(db: Client, subscriptionId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE voucher_codes SET status = 'expired'
          WHERE issuer_subscription_id = ? AND status = 'issued'`,
    args: [subscriptionId],
  });
}

async function cancelOneSubscriptionRow(
  db: Client,
  subscriptionId: string,
  userPk: string,
  now: Date,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET status = 'cancelled',
              canceled_at = ?,
              expires_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'active'`,
    args: [now.toISOString(), now.toISOString(), subscriptionId],
  });
  await downgradeUserToFree(db, userPk);
  await expireUnusedVouchersFor(db, subscriptionId);
}

export async function cancelSubscriptionImmediate(
  db: Client,
  subscription: ActiveSubscription,
  now: Date = new Date(),
): Promise<void> {
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, subscription.userPk, now);

  // 가족(또는 커플) 그룹 owner 인 경우 멤버들도 같이 정리.
  if (subscription.planGroupId) {
    const memberRes = await db.execute({
      sql: `SELECT user_id, role FROM plan_group_members WHERE plan_group_id = ?`,
      args: [subscription.planGroupId],
    });
    for (const row of memberRes.rows) {
      const memberUserId = String(row.user_id);
      if (memberUserId === subscription.userPk) continue;

      // 멤버의 활성 가족 구독이 이 그룹에 묶여 있으면 cancel.
      const memberSubRes = await db.execute({
        sql: `SELECT id FROM subscriptions
              WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
        args: [memberUserId, subscription.planGroupId],
      });
      for (const subRow of memberSubRes.rows) {
        await cancelOneSubscriptionRow(db, String(subRow.id), memberUserId, now);
      }
      // 그룹 멤버였지만 별도 구독이 없는(편입만 된) 경우에도 plan 다운그레이드.
      await downgradeUserToFree(db, memberUserId);
    }
    // 그룹 자체는 row 보존하되 멤버 정리. 새 결제 시 새 그룹 생성됨.
    await db.execute({
      sql: `DELETE FROM plan_group_members WHERE plan_group_id = ? AND role <> 'owner'`,
      args: [subscription.planGroupId],
    });
  }
}

export async function scheduleCancelAtPeriodEnd(
  db: Client,
  subscriptionId: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET cancel_at_period_end = 1, next_plan_id = NULL, updated_at = datetime('now')
          WHERE id = ?`,
    args: [subscriptionId],
  });
}

export async function schedulePlanChangeAtPeriodEnd(
  db: Client,
  subscriptionId: string,
  nextPlanId: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET cancel_at_period_end = 1, next_plan_id = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [nextPlanId, subscriptionId],
  });
}

/**
 * Cron 호출 — 만료 시점에 도달한 구독을 처리.
 *  1) cancel_at_period_end = 1 인 만료 구독 → 즉시 해지 (가족/voucher 포함)
 *  2) status='active' & expires_at <= now → 'expired' 로 표시 + users.plan='free'
 *
 * next_plan_id 자동 전환은 결제 시스템이 결제 stub 단계라 본 단계에서는 처리하지 않는다.
 */
export async function processSubscriptionExpiry(db: Client, now: Date = new Date()): Promise<void> {
  const dueRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active'
            AND s.cancel_at_period_end = 1
            AND s.expires_at <= ?`,
    args: [now.toISOString()],
  });
  for (const r of dueRes.rows) {
    await cancelSubscriptionImmediate(
      db,
      {
        subscriptionId: String(r.sub_id),
        userPk: String(r.user_id),
        planId: String(r.plan_id),
        planType: String(r.plan_type),
        planGroupId: (r.plan_group_id as string | null) ?? null,
      },
      now,
    );
  }

  // 일반 만료 — 자연 만료된 active 를 expired 로 표시하고 사용자 plan 도 free 로.
  const expiredRes = await db.execute({
    sql: `SELECT id, user_id FROM subscriptions
          WHERE status = 'active' AND expires_at <= ? AND cancel_at_period_end = 0`,
    args: [now.toISOString()],
  });
  for (const r of expiredRes.rows) {
    await db.execute({
      sql: `UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?`,
      args: [String(r.id)],
    });
    await downgradeUserToFree(db, String(r.user_id));
  }
}

// planTypeToUserPlan 재export — 호출처에서 같이 쓰기 좋게.
export { planTypeToUserPlan };
