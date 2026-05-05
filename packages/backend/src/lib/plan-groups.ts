import { getDB } from './db';

type DB = ReturnType<typeof getDB>;

export class PlanGroupCapacityError extends Error {
  constructor(readonly maxMembers: number) {
    super(`Plan group is full: max ${maxMembers}`);
    this.name = 'PlanGroupCapacityError';
  }
}

async function ensurePlanGroupMember(
  db: DB,
  planGroupId: string,
  userPk: string,
  maxMembers: number,
  role: 'owner' | 'member',
): Promise<void> {
  const existingMemberRes = await db.execute({
    sql: `SELECT id FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
    args: [planGroupId, userPk],
  });
  if (existingMemberRes.rows.length > 0) return;

  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  const memberCount = Number(countRes.rows[0]?.c) || 0;
  if (memberCount >= maxMembers) {
    throw new PlanGroupCapacityError(maxMembers);
  }

  await db.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
          VALUES (?, ?, ?, ?)`,
    args: [crypto.randomUUID(), planGroupId, userPk, role],
  });
}

export async function createOwnedPlanGroupForFamilyPlan(
  db: DB,
  userPk: string,
  planId: string,
  maxMembers: number,
): Promise<string> {
  const planGroupId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
          VALUES (?, ?, ?, ?)`,
    args: [planGroupId, userPk, planId, maxMembers],
  });
  await db.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
          VALUES (?, ?, ?, 'owner')`,
    args: [crypto.randomUUID(), planGroupId, userPk],
  });
  return planGroupId;
}

export async function resolveFamilyPlanGroupForRedeemedVoucher(
  db: DB,
  params: {
    userPk: string;
    planId: string;
    planType: string;
    maxMembers: number;
    issuerSubscriptionId?: string | null;
    issuerUserId?: string | null;
  },
): Promise<string | null> {
  if (params.planType !== 'family') return null;

  const issuerSubscriptionId = params.issuerSubscriptionId?.trim() || null;
  const issuerUserId = params.issuerUserId?.trim() || null;
  if (issuerSubscriptionId && issuerUserId) {
    const issuerGroupRes = await db.execute({
      sql: `SELECT pg.id, pg.max_members
            FROM subscriptions s
            JOIN plan_groups pg ON pg.id = s.plan_group_id
            WHERE s.id = ? AND s.user_id = ?
            LIMIT 1`,
      args: [issuerSubscriptionId, issuerUserId],
    });

    if (issuerGroupRes.rows.length > 0) {
      const group = issuerGroupRes.rows[0]!;
      const planGroupId = String(group.id);
      const maxMembers = Number(group.max_members) || params.maxMembers;
      await ensurePlanGroupMember(db, planGroupId, params.userPk, maxMembers, 'member');
      return planGroupId;
    }
  }

  return createOwnedPlanGroupForFamilyPlan(
    db,
    params.userPk,
    params.planId,
    params.maxMembers,
  );
}

export async function repairFamilyPlanGroupForUser(
  db: DB,
  userPk: string,
): Promise<string | null> {
  const subscriptionRes = await db.execute({
    sql: `SELECT s.id AS subscription_id, s.plan_id, p.plan_type, p.max_members,
                 v.issuer_subscription_id, v.issuer_user_id
          FROM subscriptions s
          JOIN plans p ON p.id = s.plan_id
          LEFT JOIN voucher_codes v
            ON v.redeemed_by_user_id = s.user_id
           AND v.plan_id = s.plan_id
           AND v.status = 'used'
          WHERE s.user_id = ?
            AND s.status = 'active'
            AND p.plan_type = 'family'
            AND (s.plan_group_id IS NULL OR s.plan_group_id = '')
          ORDER BY COALESCE(v.used_at, s.starts_at) DESC
          LIMIT 1`,
    args: [userPk],
  });
  if (subscriptionRes.rows.length === 0) return null;

  const subscription = subscriptionRes.rows[0]!;
  const planGroupId = await resolveFamilyPlanGroupForRedeemedVoucher(db, {
    userPk,
    planId: String(subscription.plan_id),
    planType: String(subscription.plan_type),
    maxMembers: Number(subscription.max_members) || 6,
    issuerSubscriptionId: (subscription.issuer_subscription_id as string | null) ?? null,
    issuerUserId: (subscription.issuer_user_id as string | null) ?? null,
  });

  if (!planGroupId) return null;

  await db.execute({
    sql: `UPDATE subscriptions SET plan_group_id = ? WHERE id = ?`,
    args: [planGroupId, String(subscription.subscription_id)],
  });

  return planGroupId;
}
