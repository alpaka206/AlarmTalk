import type { Client } from '@libsql/client';
import { hashVoucherCode, isValidVoucherCodeFormat } from './vouchers';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import {
  cancelActiveSubscriptionsForUser,
} from './billing-cancel';
import {
  PlanGroupCapacityError,
  resolveFamilyPlanGroupForRedeemedVoucher,
} from './plan-groups';
import { planTypeToUserPlan } from '../routes/billing-helpers';

export class VoucherRedemptionError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'VoucherRedemptionError';
  }
}

export interface RedeemedVoucherResult {
  success: true;
  type: 'voucher';
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    plan_group_id: string | null;
    status: 'active';
    starts_at: string;
    expires_at: string;
  };
  plan: {
    id: string;
    key: string;
    name: string;
    plan_type: string;
    period_days: number;
    max_members: number;
    price_krw: number;
  };
  voucher: {
    id: string;
    max_uses: number;
    use_count: number;
    status: 'issued' | 'used';
  };
}

function codePrefix(code: string): 'INV' | 'GIFT' {
  return code.startsWith('GIFT-') ? 'GIFT' : 'INV';
}

async function claimVoucherUse(
  db: DbExecutor,
  params: {
    voucherId: string;
    userPk: string;
    redeemedAt: string;
  },
): Promise<void> {
  const result = await db.execute({
    sql: `INSERT INTO voucher_redemptions (id, voucher_id, user_id, redeemed_at)
          SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM voucher_codes v
            WHERE v.id = ?
              AND v.status = 'issued'
              AND (
                SELECT COUNT(*) FROM voucher_redemptions
                WHERE voucher_id = v.id
              ) < COALESCE(v.max_uses, 1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM voucher_redemptions
            WHERE voucher_id = ? AND user_id = ?
          )`,
    args: [
      crypto.randomUUID(),
      params.voucherId,
      params.userPk,
      params.redeemedAt,
      params.voucherId,
      params.voucherId,
      params.userPk,
    ],
  });

  if (result.rowsAffected === 0) {
    throw new VoucherRedemptionError(409, 'CODE_ALREADY_USED', 'Code is no longer redeemable');
  }
}

async function assertIssuerGroupHasCapacity(
  db: DbExecutor,
  params: {
    issuerSubscriptionId: string | null;
    issuerUserId: string;
    fallbackMaxMembers: number;
  },
): Promise<void> {
  if (!params.issuerSubscriptionId) return;

  const capacityRes = await db.execute({
    sql: `SELECT pg.max_members, COUNT(m.id) AS member_count
          FROM subscriptions s
          JOIN plan_groups pg ON pg.id = s.plan_group_id
          LEFT JOIN plan_group_members m ON m.plan_group_id = pg.id
          WHERE s.id = ? AND s.user_id = ?
          GROUP BY pg.id, pg.max_members
          LIMIT 1`,
    args: [params.issuerSubscriptionId, params.issuerUserId],
  });
  if (capacityRes.rows.length === 0) return;

  const row = capacityRes.rows[0]!;
  const maxMembers = Number(row.max_members) || params.fallbackMaxMembers;
  const memberCount = Number(row.member_count) || 0;
  if (memberCount >= maxMembers) {
    throw new VoucherRedemptionError(409, 'GROUP_FULL', `Group is full: max ${maxMembers}`);
  }
}

type VoucherRedemptionTxResult =
  | RedeemedVoucherResult
  | { error: VoucherRedemptionError };

async function redeemVoucherCodeInTransaction(
  db: DbExecutor,
  params: {
    userPk: string;
    rawCode: string;
    now?: Date;
  },
): Promise<VoucherRedemptionTxResult> {
  const code = params.rawCode.trim().toUpperCase();
  if (!code) {
    throw new VoucherRedemptionError(400, 'CODE_REQUIRED', 'code is required');
  }
  if (!isValidVoucherCodeFormat(code)) {
    throw new VoucherRedemptionError(400, 'INVALID_FORMAT', 'Invalid code format');
  }

  const codeHash = await hashVoucherCode(code);
  const voucherRes = await db.execute({
    sql: `SELECT v.id, v.plan_id, v.issuer_user_id, v.issuer_subscription_id,
                 v.status, v.expires_at, v.max_uses,
                 (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = v.id) AS use_count
          FROM voucher_codes v
          WHERE v.code_hash = ?`,
    args: [codeHash],
  });
  if (voucherRes.rows.length === 0) {
    throw new VoucherRedemptionError(404, 'CODE_NOT_FOUND', 'Code not found');
  }

  const voucher = voucherRes.rows[0]!;
  const voucherId = String(voucher.id);
  const planId = String(voucher.plan_id);
  const issuerUserId = String(voucher.issuer_user_id);
  const issuerSubscriptionId = (voucher.issuer_subscription_id as string | null) ?? null;
  const status = String(voucher.status);
  const maxUses = Number(voucher.max_uses) || 1;
  const useCount = Number(voucher.use_count) || 0;

  if (status === 'expired') {
    throw new VoucherRedemptionError(409, 'CODE_EXPIRED', 'Code is expired');
  }
  if (status === 'used' || useCount >= maxUses) {
    throw new VoucherRedemptionError(409, 'CODE_ALREADY_USED', 'Code is already used');
  }

  const now = params.now ?? new Date();
  const startsAt = now;
  const expiresAt = new Date(String(voucher.expires_at));
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    await db.execute({
      sql: `UPDATE voucher_codes SET status = 'expired' WHERE id = ?`,
      args: [voucherId],
    });
    return { error: new VoucherRedemptionError(409, 'CODE_EXPIRED', 'Code is expired') };
  }

  if (issuerUserId === params.userPk) {
    throw new VoucherRedemptionError(400, 'SELF_ISSUED', 'Cannot redeem your own code');
  }

  const duplicateRes = await db.execute({
    sql: `SELECT id FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?`,
    args: [voucherId, params.userPk],
  });
  if (duplicateRes.rows.length > 0) {
    throw new VoucherRedemptionError(
      409,
      'CODE_ALREADY_REDEEMED_BY_YOU',
      'Code already redeemed by this user',
    );
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw
          FROM plans WHERE id = ?`,
    args: [planId],
  });
  if (planRes.rows.length === 0) {
    throw new VoucherRedemptionError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  }

  const plan = planRes.rows[0]!;
  const prefix = codePrefix(code);
  const planType = String(plan.plan_type);
  const planKey = String(plan.key);
  const periodDays = Number(plan.period_days) || 30;
  const maxMembers = Number(plan.max_members) || 1;
  const priceKrw = Number(plan.price_krw) || 0;

  if (prefix === 'GIFT' && planType !== 'personal') {
    throw new VoucherRedemptionError(400, 'INVALID_GIFT_PLAN', 'Gift codes are personal plans only');
  }
  if (prefix === 'INV' && planType !== 'family') {
    throw new VoucherRedemptionError(400, 'INVALID_INVITE_PLAN', 'Invite codes are family or couple plans only');
  }

  if (prefix === 'INV') {
    await assertIssuerGroupHasCapacity(db, {
      issuerSubscriptionId,
      issuerUserId,
      fallbackMaxMembers: maxMembers,
    });
  }

  await claimVoucherUse(db, {
    voucherId,
    userPk: params.userPk,
    redeemedAt: startsAt.toISOString(),
  });

  await cancelActiveSubscriptionsForUser(db, params.userPk, startsAt, { deleteVoiceData: false });

  const planGroupId = await (async () => {
    try {
      return await resolveFamilyPlanGroupForRedeemedVoucher(db, {
        userPk: params.userPk,
        planId,
        planType,
        maxMembers,
        issuerSubscriptionId,
        issuerUserId,
      });
    } catch (error) {
      if (error instanceof PlanGroupCapacityError) {
        throw new VoucherRedemptionError(409, 'GROUP_FULL', `Group is full: max ${error.maxMembers}`);
      }
      throw error;
    }
  })();

  const subscriptionId = crypto.randomUUID();
  const newExpiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      subscriptionId,
      params.userPk,
      planId,
      planGroupId,
      startsAt.toISOString(),
      newExpiresAt.toISOString(),
    ],
  });

  const useCountRes = await db.execute({
    sql: `SELECT COUNT(*) AS use_count FROM voucher_redemptions WHERE voucher_id = ?`,
    args: [voucherId],
  });
  const newUseCount = Number(useCountRes.rows[0]?.use_count) || useCount + 1;
  if (newUseCount >= maxUses) {
    await db.execute({
      sql: `UPDATE voucher_codes
            SET status = 'used',
                used_at = ?,
                redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?)
            WHERE id = ?`,
      args: [startsAt.toISOString(), params.userPk, voucherId],
    });
  } else {
    await db.execute({
      sql: `UPDATE voucher_codes
            SET used_at = COALESCE(used_at, ?),
                redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?)
            WHERE id = ?`,
      args: [startsAt.toISOString(), params.userPk, voucherId],
    });
  }

  const mirroredPlan = planTypeToUserPlan(planType);
  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [mirroredPlan, params.userPk],
  });

  return {
    success: true,
    type: 'voucher',
    subscription: {
      id: subscriptionId,
      user_id: params.userPk,
      plan_id: planId,
      plan_group_id: planGroupId,
      status: 'active',
      starts_at: startsAt.toISOString(),
      expires_at: newExpiresAt.toISOString(),
    },
    plan: {
      id: planId,
      key: planKey,
      name: String(plan.name),
      plan_type: planType,
      period_days: periodDays,
      max_members: maxMembers,
      price_krw: priceKrw,
    },
    voucher: {
      id: voucherId,
      max_uses: maxUses,
      use_count: newUseCount,
      status: newUseCount >= maxUses ? 'used' : 'issued',
    },
  };
}

export async function redeemVoucherCode(
  db: Client,
  params: {
    userPk: string;
    rawCode: string;
    now?: Date;
  },
): Promise<RedeemedVoucherResult> {
  const result = await withWriteTransaction(db, (tx) =>
    redeemVoucherCodeInTransaction(tx, params),
  );
  if ('error' in result) throw result.error;
  return result;
}
