import type { Client } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import { deletePaidVoiceDataForUser } from './paid-voice-cleanup';
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

type CancelCleanupOptions = {
  deleteVoiceData?: boolean;
};

async function resolveUserLoginId(db: DbExecutor, userPk: string): Promise<string | null> {
  const res = await db.execute({
    sql: `SELECT google_id FROM users WHERE id = ? LIMIT 1`,
    args: [userPk],
  });
  return res.rows.length > 0 ? ((res.rows[0]!.google_id as string | null) ?? null) : null;
}

export async function downgradeUserToFree(
  db: DbExecutor,
  userPk: string,
  options: CancelCleanupOptions = {},
): Promise<void> {
  await db.execute({
    sql: `UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?`,
    args: [userPk],
  });
  if (options.deleteVoiceData === true) {
    await deletePaidVoiceDataForUser(db, userPk, await resolveUserLoginId(db, userPk));
    return;
  }
  // voice_profiles.user_id·alarms.user_id 는 로그인 id(google_id)로 저장되므로 PK(userPk)와
  // 로그인 id 를 모두 매칭한다(deletePaidVoiceDataForUser 와 동일 — 한쪽만 쓰면 일반 케이스를
  // 놓쳐 un-share·강등이 누락되고 취소된 목소리가 좀비로 계속 울린다).
  const loginId = await resolveUserLoginId(db, userPk);
  const ownerIds = Array.from(new Set([userPk, loginId].filter((x): x is string => Boolean(x))));
  const ph = ownerIds.map(() => '?').join(',');
  await db.execute({
    sql: `UPDATE voice_profiles SET is_shared = 0 WHERE user_id IN (${ph}) AND is_shared = 1`,
    args: ownerIds,
  });
  // 공유가 해제되면(강등/RTDN 비활성) 그 목소리를 참조하던 '타인 소유' 알람은 접근권을 잃으므로
  // sound-only 로 강등한다 — 취소된 목소리가 좀비로 계속 울리지 않도록. (클라는 재동기화 시 반영)
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only',
              wake_mode = 'sound_then_voice',
              message_id = NULL,
              voice_profile_id = NULL,
              speaker_id = NULL,
              raw_audio_url = NULL,
              raw_audio_duration_ms = NULL
          WHERE user_id NOT IN (${ph})
            AND (
              voice_profile_id IN (
                SELECT id FROM voice_profiles WHERE user_id IN (${ph})
              )
              OR message_id IN (
                SELECT id FROM messages
                WHERE voice_profile_id IN (
                  SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                )
              )
            )`,
    args: [...ownerIds, ...ownerIds, ...ownerIds],
  });
}

async function expireUnusedVouchersFor(db: DbExecutor, subscriptionId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE voucher_codes SET status = 'expired'
          WHERE issuer_subscription_id = ? AND status = 'issued'`,
    args: [subscriptionId],
  });
}

async function releaseInviteUseForMember(
  db: DbExecutor,
  userPk: string,
  planGroupId: string,
): Promise<void> {
  const redemptionRes = await db.execute({
    sql: `SELECT vr.id AS redemption_id, vr.voucher_id
          FROM voucher_redemptions vr
          JOIN voucher_codes v ON v.id = vr.voucher_id
          JOIN subscriptions s ON s.id = v.issuer_subscription_id
          WHERE vr.user_id = ? AND s.plan_group_id = ?`,
    args: [userPk, planGroupId],
  });

  for (const row of redemptionRes.rows) {
    const redemptionId = String(row.redemption_id);
    const voucherId = String(row.voucher_id);

    await db.execute({
      sql: `DELETE FROM voucher_redemptions WHERE id = ?`,
      args: [redemptionId],
    });

    await db.execute({
      sql: `UPDATE voucher_codes
            SET status = 'issued',
                used_at = NULL
            WHERE id = ?
              AND status = 'used'
              AND (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = ?) < COALESCE(max_uses, 1)`,
      args: [voucherId, voucherId],
    });
  }
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
  options: CancelCleanupOptions = {},
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
  await downgradeUserToFree(db, userPk, options);
  await expireUnusedVouchersFor(db, subscriptionId);
}

export async function cancelSubscriptionImmediate(
  db: DbExecutor,
  subscription: ActiveSubscription,
  now: Date = new Date(),
  options: CancelCleanupOptions = { deleteVoiceData: true },
): Promise<void> {
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, subscription.userPk, now, options);

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
    await releaseInviteUseForMember(db, subscription.userPk, subscription.planGroupId);
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
    // 멤버 강등에는 소유자의 삭제 옵션(options)을 전파하지 않는다. 취소를 개시하지
    // 않은 멤버의 알람·음성·메시지가 하드 삭제되는 것을 막기 위해 데이터는 보존한다
    // (RTDN deactivate 경로와 동일하게 deleteVoiceData:false). 하드 삭제는 취소를
    // 실제로 개시한 소유자 본인(line 149)에게만 국한한다.
    await downgradeUserToFree(db, memberUserId, { deleteVoiceData: false });
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
  options: CancelCleanupOptions = { deleteVoiceData: true },
): Promise<ActiveSubscription[]> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  for (const subscription of subscriptions) {
    await cancelSubscriptionImmediate(db, subscription, now, options);
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

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE id = ?`,
    args: [params.membershipId],
  });

  for (const row of subscriptionRes.rows) {
    await cancelOneSubscriptionRow(
      db,
      String(row.id),
      params.userPk,
      now,
      { deleteVoiceData: true },
    );
  }
  if (subscriptionRes.rows.length === 0) {
    await downgradeUserToFree(db, params.userPk, { deleteVoiceData: true });
  }

  await releaseInviteUseForMember(db, params.userPk, params.planGroupId);
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

export async function createNewSubscriptionForPlan(
  db: DbExecutor,
  params: {
    userPk: string;
    planId: string;
    planType: string;
    periodDays: number;
    maxMembers: number;
    now: Date;
  },
): Promise<string> {
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

  return subscriptionId;
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
      await cancelSubscriptionImmediate(
        tx,
        active,
        now,
        { deleteVoiceData: !nextPlanId },
      );

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
        { deleteVoiceData: true },
      );
    });
  }
}

export { planTypeToUserPlan };
