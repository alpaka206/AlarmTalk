import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { isValidVoucherCodeFormat, hashVoucherCode } from '../lib/vouchers';
import { isValidInviteCodeFormat, normalizeInviteCode } from '../lib/invites';
import {
  PlanGroupCapacityError,
  resolveFamilyPlanGroupForRedeemedVoucher,
} from '../lib/plan-groups';

const codeRoutes = new Hono<AppEnv>();

function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

codeRoutes.post('/register', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));

  const raw = typeof body.code === 'string' ? body.code.trim() : '';
  if (!raw) {
    return c.json({ error: 'code 는 필수입니다', error_code: 'CODE_REQUIRED' }, 400);
  }

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [userId],
  });
  if (userRes.rows.length === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }
  const userPk = String(userRes.rows[0]!.id);

  const upper = raw.toUpperCase();

  // ── Voucher code: VA-XXXX-XXXX-XXXX ──
  if (isValidVoucherCodeFormat(upper)) {
    const codeHash = await hashVoucherCode(upper);
    const voucherRes = await db.execute({
      sql: `SELECT id, plan_id, issuer_user_id, issuer_subscription_id, status, expires_at
            FROM voucher_codes WHERE code_hash = ?`,
      args: [codeHash],
    });
    if (voucherRes.rows.length === 0) {
      return c.json({ error: '해당 코드를 찾을 수 없습니다', error_code: 'CODE_NOT_FOUND' }, 404);
    }
    const voucher = voucherRes.rows[0]!;
    const status = String(voucher.status);
    const voucherId = String(voucher.id);
    const planId = String(voucher.plan_id);

    if (status === 'used') {
      return c.json({ error: '이미 사용된 코드입니다', error_code: 'CODE_ALREADY_USED' }, 409);
    }
    if (status === 'expired') {
      return c.json({ error: '만료된 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
    }

    const now = new Date();
    const expiresAt = new Date(String(voucher.expires_at));
    if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
      await db.execute({
        sql: `UPDATE voucher_codes SET status = 'expired' WHERE id = ?`,
        args: [voucherId],
      });
      return c.json({ error: '만료된 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
    }

    if (String(voucher.issuer_user_id) === userPk) {
      return c.json(
        { error: '본인이 발급한 코드는 등록할 수 없습니다', error_code: 'SELF_ISSUED' },
        400,
      );
    }

    const planRes = await db.execute({
      sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw
            FROM plans WHERE id = ?`,
      args: [planId],
    });
    if (planRes.rows.length === 0) {
      return c.json({ error: '연결된 플랜을 찾을 수 없습니다', error_code: 'PLAN_NOT_FOUND' }, 404);
    }
    const plan = planRes.rows[0]!;
    const planType = String(plan.plan_type);
    const periodDays = Number(plan.period_days) || 30;
    const maxMembers = Number(plan.max_members) || 1;
    const startsAt = now;
    const newExpiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);

    let planGroupId: string | null = null;
    try {
      planGroupId = await resolveFamilyPlanGroupForRedeemedVoucher(db, {
        userPk,
        planId,
        planType,
        maxMembers,
        issuerSubscriptionId: (voucher.issuer_subscription_id as string | null) ?? null,
        issuerUserId: String(voucher.issuer_user_id),
      });
    } catch (error) {
      if (error instanceof PlanGroupCapacityError) {
        return c.json(
          { error: `정원 초과 (최대 ${error.maxMembers}명)`, error_code: 'GROUP_FULL' },
          409,
        );
      }
      throw error;
    }

    const subscriptionId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      args: [
        subscriptionId,
        userPk,
        planId,
        planGroupId,
        startsAt.toISOString(),
        newExpiresAt.toISOString(),
      ],
    });

    await db.execute({
      sql: `UPDATE voucher_codes
            SET status = 'used', redeemed_by_user_id = ?, used_at = ?
            WHERE id = ? AND status = 'issued'`,
      args: [userPk, startsAt.toISOString(), voucherId],
    });

    const mirroredPlan = planTypeToUserPlan(planType);
    await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [mirroredPlan, userPk],
    });

    return c.json({
      success: true,
      type: 'voucher' as const,
      subscription: {
        id: subscriptionId,
        plan_id: planId,
        plan_group_id: planGroupId,
        status: 'active',
        starts_at: startsAt.toISOString(),
        expires_at: newExpiresAt.toISOString(),
      },
      plan: {
        key: String(plan.key),
        name: String(plan.name),
        plan_type: planType,
        period_days: periodDays,
      },
    });
  }

  // ── Family invite code: INV-XXXX-XXXX-XXXX (legacy INV-123456/123456 accepted) ──
  const inviteCode = normalizeInviteCode(raw);
  if (isValidInviteCodeFormat(inviteCode)) {
    const inviteRes = await db.execute({
      sql: `SELECT id, plan_group_id, inviter_user_id, status, expires_at
            FROM plan_group_invites WHERE code = ?`,
      args: [inviteCode],
    });
    if (inviteRes.rows.length === 0) {
      return c.json(
        { error: '해당 초대 코드를 찾을 수 없습니다', error_code: 'CODE_NOT_FOUND' },
        404,
      );
    }
    const invite = inviteRes.rows[0]!;
    const inviteId = String(invite.id);
    const planGroupId = String(invite.plan_group_id);
    const status = String(invite.status);

    if (status === 'used') {
      return c.json({ error: '이미 사용된 초대 코드입니다', error_code: 'CODE_ALREADY_USED' }, 409);
    }
    if (status === 'revoked') {
      return c.json({ error: '취소된 초대 코드입니다', error_code: 'CODE_REVOKED' }, 409);
    }
    if (status === 'expired') {
      return c.json({ error: '만료된 초대 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
    }

    const now = new Date();
    const expiresAt = new Date(String(invite.expires_at));
    if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
      await db.execute({
        sql: `UPDATE plan_group_invites SET status = 'expired' WHERE id = ?`,
        args: [inviteId],
      });
      return c.json({ error: '만료된 초대 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
    }

    if (String(invite.inviter_user_id) === userPk) {
      return c.json(
        { error: '본인이 발급한 초대는 수락할 수 없습니다', error_code: 'SELF_ISSUED' },
        400,
      );
    }

    const memberRes = await db.execute({
      sql: `SELECT id FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
      args: [planGroupId, userPk],
    });
    if (memberRes.rows.length > 0) {
      return c.json({ error: '이미 해당 그룹 멤버입니다', error_code: 'ALREADY_MEMBER' }, 409);
    }

    const groupRes = await db.execute({
      sql: `SELECT max_members FROM plan_groups WHERE id = ?`,
      args: [planGroupId],
    });
    if (groupRes.rows.length === 0) {
      return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
    }
    const maxMembers = Number(groupRes.rows[0]!.max_members) || 6;
    const countRes = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM plan_group_members WHERE plan_group_id = ?`,
      args: [planGroupId],
    });
    const memberCount = Number(countRes.rows[0]!.c) || 0;
    if (memberCount >= maxMembers) {
      return c.json({ error: `정원 초과 (최대 ${maxMembers}명)`, error_code: 'GROUP_FULL' }, 409);
    }

    const memberId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, ?, ?, 'member')`,
      args: [memberId, planGroupId, userPk],
    });

    await db.execute({
      sql: `UPDATE plan_group_invites
            SET status = 'used', used_by_user_id = ?, used_at = ?
            WHERE id = ? AND status = 'pending'`,
      args: [userPk, now.toISOString(), inviteId],
    });

    return c.json({
      success: true,
      type: 'invite' as const,
      membership: {
        id: memberId,
        plan_group_id: planGroupId,
        role: 'member',
      },
    });
  }

  return c.json({ error: '인식할 수 없는 코드 형식입니다', error_code: 'INVALID_FORMAT' }, 400);
});

export default codeRoutes;
