import type { Client } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import { planTypeToUserPlan } from '../routes/billing-helpers';

export interface ActiveSubscription {
  subscriptionId: string;
  userPk: string;
  planId: string;
  planType: string;
  planGroupId: string | null;
}

export async function findActiveSubscriptionByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription | null> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  return subscriptions[0] ?? null;
}

export async function findActiveSubscriptionsByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription[]> {
  const res = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ? AND s.status = 'active'
          ORDER BY s.starts_at DESC`,
    args: [userPk],
  });
  return res.rows.map((r) => ({
    subscriptionId: String(r.sub_id),
    userPk: String(r.user_id),
    planId: String(r.plan_id),
    planType: String(r.plan_type),
    planGroupId: (r.plan_group_id as string | null) ?? null,
  }));
}

export async function downgradeUserToFree(db: DbExecutor, userPk: string): Promise<void> {
  await db.execute({
    sql: `UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?`,
    args: [userPk],
  });
  await db.execute({
    sql: `UPDATE voice_profiles SET is_shared = 0 WHERE user_id = ? AND is_shared = 1`,
    args: [userPk],
  });
}

async function expireUnusedVouchersFor(db: DbExecutor, subscriptionId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE voucher_codes SET status = 'expired'
          WHERE issuer_subscription_id = ? AND status = 'issued'`,
    args: [subscriptionId],
  });
}

function plannedMaxUses(planType: string, maxMembers: number): number {
  if (planType === 'family') return Math.max(1, maxMembers - 1);
  return 1;
}

async function cancelOneSubscriptionRow(
  db: DbExecutor,
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
  db: DbExecutor,
  subscription: ActiveSubscription,
  now: Date = new Date(),
): Promise<void> {
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, subscription.userPk, now);

  if (!subscription.planGroupId) return;

  const groupRes = await db.execute({
    sql: `SELECT owner_user_id FROM plan_groups WHERE id = ?`,
    args: [subscription.planGroupId],
  });
  const ownerUserId =
    groupRes.rows.length > 0 ? String(groupRes.rows[0]!.owner_user_id) : null;

  if (ownerUserId !== subscription.userPk) {
    await db.execute({
      sql: `DELETE FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
      args: [subscription.planGroupId, subscription.userPk],
    });
    return;
  }

  const memberRes = await db.execute({
    sql: `SELECT user_id, role FROM plan_group_members WHERE plan_group_id = ?`,
    args: [subscription.planGroupId],
  });
  for (const row of memberRes.rows) {
    const memberUserId = String(row.user_id);
    if (memberUserId === subscription.userPk) continue;

    const memberSubRes = await db.execute({
      sql: `SELECT id FROM subscriptions
            WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
      args: [memberUserId, subscription.planGroupId],
    });
    for (const subRow of memberSubRes.rows) {
      await cancelOneSubscriptionRow(db, String(subRow.id), memberUserId, now);
    }
    await downgradeUserToFree(db, memberUserId);
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE plan_group_id = ?`,
    args: [subscription.planGroupId],
  });
}

export async function cancelActiveSubscriptionsForUser(
  db: DbExecutor,
  userPk: string,
  now: Date = new Date(),
): Promise<ActiveSubscription[]> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  for (const subscription of subscriptions) {
    await cancelSubscriptionImmediate(db, subscription, now);
  }
  return subscriptions;
}

export async function leavePlanGroupMember(
  db: DbExecutor,
  params: {
    userPk: string;
    planGroupId: string;
    membershipId: string;
    now?: Date;
  },
): Promise<void> {
  const now = params.now ?? new Date();

  const subscriptionRes = await db.execute({
    sql: `SELECT id FROM subscriptions
          WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
    args: [params.userPk, params.planGroupId],
  });

  for (const row of subscriptionRes.rows) {
    await cancelOneSubscriptionRow(db, String(row.id), params.userPk, now);
  }
  if (subscriptionRes.rows.length === 0) {
    await downgradeUserToFree(db, params.userPk);
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE id = ?`,
    args: [params.membershipId],
  });
}

export async function scheduleCancelAtPeriodEnd(
  db: DbExecutor,
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
  db: DbExecutor,
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

async function createNewSubscriptionForPlan(
  db: DbExecutor,
  params: {
    userPk: string;
    planId: string;
    planType: string;
    periodDays: number;
    maxMembers: number;
    now: Date;
  },
): Promise<void> {
  const startsAt = params.now;
  const expiresAt = new Date(startsAt.getTime() + params.periodDays * 24 * 60 * 60 * 1000);
  const subscriptionId = crypto.randomUUID();
  let planGroupId: string | null = null;

  if (params.planType === 'family') {
    planGroupId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
            VALUES (?, ?, ?, ?)`,
      args: [planGroupId, params.userPk, params.planId, params.maxMembers],
    });
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, ?, ?, 'owner')`,
      args: [crypto.randomUUID(), planGroupId, params.userPk],
    });
  }

  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      subscriptionId,
      params.userPk,
      params.planId,
      planGroupId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
    ],
  });

  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(params.planType), params.userPk],
  });

  if (params.planType === 'family') {
    await issueVoucherCode(db, {
      kind: 'invite',
      planId: params.planId,
      issuerUserId: params.userPk,
      issuerSubscriptionId: subscriptionId,
      issuedAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maxUses: plannedMaxUses(params.planType, params.maxMembers),
    });
  }
}

export async function processSubscriptionExpiry(db: Client, now: Date = new Date()): Promise<void> {
  const dueRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, s.next_plan_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active'
            AND s.cancel_at_period_end = 1
            AND s.expires_at <= ?`,
    args: [now.toISOString()],
  });
  for (const r of dueRes.rows) {
    const active = {
      subscriptionId: String(r.sub_id),
      userPk: String(r.user_id),
      planId: String(r.plan_id),
      planType: String(r.plan_type),
      planGroupId: (r.plan_group_id as string | null) ?? null,
    };
    const nextPlanId = (r.next_plan_id as string | null) ?? null;

    await withWriteTransaction(db, async (tx) => {
      await cancelSubscriptionImmediate(tx, active, now);

      if (!nextPlanId) return;
      const nextPlanRes = await tx.execute({
        sql: `SELECT id, plan_type, period_days, max_members
              FROM plans WHERE id = ? AND is_active = 1`,
        args: [nextPlanId],
      });
      if (nextPlanRes.rows.length === 0) return;

      const nextPlan = nextPlanRes.rows[0]!;
      await createNewSubscriptionForPlan(tx, {
        userPk: active.userPk,
        planId: String(nextPlan.id),
        planType: String(nextPlan.plan_type),
        periodDays: Number(nextPlan.period_days) || 30,
        maxMembers: Number(nextPlan.max_members) || 1,
        now,
      });
    });
  }

  const expiredRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND s.expires_at <= ? AND s.cancel_at_period_end = 0`,
    args: [now.toISOString()],
  });
  for (const r of expiredRes.rows) {
    await withWriteTransaction(db, async (tx) => {
      await cancelSubscriptionImmediate(
        tx,
        {
          subscriptionId: String(r.sub_id),
          userPk: String(r.user_id),
          planId: String(r.plan_id),
          planType: String(r.plan_type),
          planGroupId: (r.plan_group_id as string | null) ?? null,
        },
        now,
      );
    });
  }
}

export { planTypeToUserPlan };
