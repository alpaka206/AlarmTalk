import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { generateVoucherCode, hashVoucherCode, isValidVoucherCodeFormat } from '../lib/vouchers';
import {
  cancelSubscriptionImmediate,
  findActiveSubscriptionByUserPk,
  scheduleCancelAtPeriodEnd,
  schedulePlanChangeAtPeriodEnd,
} from '../lib/billing-cancel';
import { PAID_PLAN_TYPES, planTypeToUserPlan, resolveUserPk } from './billing-helpers';

const billingMutation = new Hono<AppEnv>();

// 결제 시 발급되는 단일 voucher 의 최대 사용 인원.
//   family : (max_members - 1) — 결제자 1 + 가족 5
//   couple : 1 — 결제자 1 + 가족 1
//   personal: 1 — 선물용 1회
function plannedMaxUses(planType: string, maxMembers: number): number {
  if (planType === 'family') return Math.max(1, maxMembers - 1);
  if (planType === 'personal') return 1;
  return Math.max(1, maxMembers - 1);
}

billingMutation.post('/checkout', async (c) => {
  const db = getDB(c.env);

  const body = await c.req
    .json<{ plan_key?: unknown; gift?: unknown }>()
    .catch((): { plan_key?: unknown; gift?: unknown } => ({ plan_key: undefined, gift: undefined }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  const gift = body.gift === true;
  if (!planKey) {
    return c.json({ error: 'plan_key 는 필수입니다', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw, is_active
          FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 플랜입니다', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: '비활성화된 플랜입니다', error_code: 'PLAN_INACTIVE' }, 400);
  }
  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'free 는 기본 플랜이라 결제 대상이 아닙니다', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  // 기존 활성 구독은 새 결제 직전에 즉시 정리. 가족 owner 면 멤버까지 같이 정리됨.
  const existingActive = await findActiveSubscriptionByUserPk(db, userPk);
  if (existingActive) {
    await cancelSubscriptionImmediate(db, existingActive);
  }

  const periodDays = Number(plan.period_days) || 30;
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const maxMembers = Number(plan.max_members) || 1;

  let planGroupId: string | null = null;
  const subscriptionId = gift ? null : crypto.randomUUID();
  // family/couple 둘 다 plan_type='family' (max_members 만 다름) → group 생성.
  if (!gift && planType === 'family') {
    planGroupId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
            VALUES (?, ?, ?, ?)`,
      args: [planGroupId, userPk, String(plan.id), maxMembers],
    });
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, ?, ?, 'owner')`,
      args: [crypto.randomUUID(), planGroupId, userPk],
    });
  }

  if (!gift && subscriptionId) {
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      args: [
        subscriptionId,
        userPk,
        String(plan.id),
        planGroupId,
        startsAt.toISOString(),
        expiresAt.toISOString(),
      ],
    });

    const mirroredPlan = planTypeToUserPlan(planType);
    await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [mirroredPlan, userPk],
    });
  }

  // 단일 voucher 발급 — 한 코드를 가족 멤버 N명에게 공유 (각자 1회씩 redeem).
  const voucherId = crypto.randomUUID();
  const { code: voucherCode, hash: voucherHash } = await generateVoucherCode();
  const maxUses = gift ? 1 : plannedMaxUses(planType, maxMembers);
  await db.execute({
    sql: `INSERT INTO voucher_codes
          (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id,
           status, issued_at, expires_at, max_uses)
          VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    args: [
      voucherId,
      voucherCode,
      voucherHash,
      String(plan.id),
      userPk,
      subscriptionId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
      maxUses,
    ],
  });

  return c.json({
    success: true,
    checkout_stub: true,
    subscription: subscriptionId
      ? {
          id: subscriptionId,
          user_id: userPk,
          plan_id: String(plan.id),
          plan_group_id: planGroupId,
          status: 'active',
          starts_at: startsAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        }
      : null,
    plan: {
      id: String(plan.id),
      key: String(plan.key),
      name: String(plan.name),
      plan_type: planType,
      period_days: periodDays,
      max_members: maxMembers,
      price_krw: Number(plan.price_krw),
    },
    plan_group: planGroupId
      ? {
          id: planGroupId,
          owner_user_id: userPk,
          max_members: maxMembers,
        }
      : null,
    voucher: {
      id: voucherId,
      code: voucherCode,
      max_uses: maxUses,
      use_count: 0,
      expires_at: expiresAt.toISOString(),
    },
  });
});

billingMutation.post('/redeem', async (c) => {
  const db = getDB(c.env);

  const body = await c.req
    .json<{ code?: unknown }>()
    .catch(() => ({ code: undefined }));

  const raw = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!raw) {
    return c.json({ error: 'code 는 필수입니다', error_code: 'CODE_REQUIRED' }, 400);
  }
  if (!isValidVoucherCodeFormat(raw)) {
    return c.json({ error: '잘못된 코드 형식입니다', error_code: 'INVALID_FORMAT' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const codeHash = await hashVoucherCode(raw);
  const voucherRes = await db.execute({
    sql: `SELECT v.id, v.plan_id, v.issuer_user_id, v.status, v.expires_at, v.max_uses,
                 (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = v.id) AS use_count
          FROM voucher_codes v WHERE v.code_hash = ?`,
    args: [codeHash],
  });
  if (voucherRes.rows.length === 0) {
    return c.json({ error: '해당 코드를 찾을 수 없습니다', error_code: 'CODE_NOT_FOUND' }, 404);
  }
  const voucher = voucherRes.rows[0]!;
  const status = String(voucher.status);
  const voucherId = String(voucher.id);
  const planId = String(voucher.plan_id);
  const issuerUserId = String(voucher.issuer_user_id);
  const maxUses = Number(voucher.max_uses) || 1;
  const useCount = Number(voucher.use_count) || 0;

  if (status === 'expired') {
    return c.json({ error: '만료된 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
  }
  if (status === 'used' || useCount >= maxUses) {
    return c.json({ error: '사용 가능한 인원이 모두 찼습니다', error_code: 'CODE_ALREADY_USED' }, 409);
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

  if (issuerUserId === userPk) {
    return c.json({ error: '본인이 발급한 코드는 등록할 수 없습니다', error_code: 'SELF_ISSUED' }, 400);
  }

  // 같은 사용자가 같은 코드를 두 번 사용하지 못하도록 차단 (UNIQUE 제약과 이중 방어).
  const dupRes = await db.execute({
    sql: `SELECT id FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?`,
    args: [voucherId, userPk],
  });
  if (dupRes.rows.length > 0) {
    return c.json({ error: '이미 사용한 코드입니다', error_code: 'CODE_ALREADY_REDEEMED_BY_YOU' }, 409);
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
  const startsAt = now;
  const newExpiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);

  // 받는 사용자에게 기존 활성 구독이 있다면 즉시 정리.
  const existingActive = await findActiveSubscriptionByUserPk(db, userPk);
  if (existingActive) {
    await cancelSubscriptionImmediate(db, existingActive);
  }

  // redemption 기록 + status 갱신.
  await db.execute({
    sql: `INSERT INTO voucher_redemptions (id, voucher_id, user_id, redeemed_at)
          VALUES (?, ?, ?, ?)`,
    args: [crypto.randomUUID(), voucherId, userPk, startsAt.toISOString()],
  });
  const newUseCount = useCount + 1;
  if (newUseCount >= maxUses) {
    await db.execute({
      sql: `UPDATE voucher_codes
            SET status = 'used', used_at = ?, redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?)
            WHERE id = ?`,
      args: [startsAt.toISOString(), userPk, voucherId],
    });
  } else {
    // 첫 사용자 정보를 호환성 컬럼에 기록만 (status 는 issued 유지).
    await db.execute({
      sql: `UPDATE voucher_codes
            SET redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?),
                used_at = COALESCE(used_at, ?)
            WHERE id = ?`,
      args: [userPk, startsAt.toISOString(), voucherId],
    });
  }

  const subscriptionId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [
      subscriptionId,
      userPk,
      planId,
      startsAt.toISOString(),
      newExpiresAt.toISOString(),
    ],
  });

  const mirroredPlan = planTypeToUserPlan(planType);
  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [mirroredPlan, userPk],
  });

  return c.json({
    success: true,
    subscription: {
      id: subscriptionId,
      user_id: userPk,
      plan_id: planId,
      status: 'active',
      starts_at: startsAt.toISOString(),
      expires_at: newExpiresAt.toISOString(),
    },
    plan: {
      id: planId,
      key: String(plan.key),
      name: String(plan.name),
      plan_type: planType,
      period_days: periodDays,
      max_members: Number(plan.max_members),
      price_krw: Number(plan.price_krw),
    },
    voucher: {
      id: voucherId,
      max_uses: maxUses,
      use_count: newUseCount,
      status: newUseCount >= maxUses ? 'used' : 'issued',
    },
  });
});

billingMutation.post('/cancel', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req
    .json<{ mode?: unknown }>()
    .catch((): { mode?: unknown } => ({ mode: undefined }));
  const mode = body.mode === 'at_period_end' ? 'at_period_end' : 'immediate';

  const db = getDB(c.env);
  const active = await findActiveSubscriptionByUserPk(db, userPk);
  if (!active) {
    return c.json({ error: '활성 구독이 없습니다', error_code: 'NO_ACTIVE_SUBSCRIPTION' }, 404);
  }

  if (mode === 'at_period_end') {
    await scheduleCancelAtPeriodEnd(db, active.subscriptionId);
    return c.json({ success: true, mode, subscription_id: active.subscriptionId });
  }

  await cancelSubscriptionImmediate(db, active);
  return c.json({ success: true, mode, subscription_id: active.subscriptionId });
});

billingMutation.post('/change-plan', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req
    .json<{ plan_key?: unknown; mode?: unknown }>()
    .catch((): { plan_key?: unknown; mode?: unknown } => ({ plan_key: undefined, mode: undefined }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  const mode = body.mode === 'at_period_end' ? 'at_period_end' : 'immediate';
  if (!planKey) {
    return c.json({ error: 'plan_key 는 필수입니다', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }

  const db = getDB(c.env);
  const planRes = await db.execute({
    sql: `SELECT id, key, plan_type, is_active FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 플랜입니다', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: '비활성화된 플랜입니다', error_code: 'PLAN_INACTIVE' }, 400);
  }
  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'free 는 변경 대상이 아닙니다', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const active = await findActiveSubscriptionByUserPk(db, userPk);
  if (!active) {
    return c.json({ error: '활성 구독이 없습니다', error_code: 'NO_ACTIVE_SUBSCRIPTION' }, 404);
  }

  if (active.planId === String(plan.id)) {
    return c.json({ error: '이미 해당 플랜을 사용 중입니다', error_code: 'SAME_PLAN' }, 400);
  }

  if (mode === 'at_period_end') {
    await schedulePlanChangeAtPeriodEnd(db, active.subscriptionId, String(plan.id));
    return c.json({
      success: true,
      mode,
      subscription_id: active.subscriptionId,
      next_plan_key: planKey,
    });
  }

  // immediate: 기존 즉시 해지 → 클라이언트가 곧바로 /billing/checkout 호출하도록 신호.
  await cancelSubscriptionImmediate(db, active);
  return c.json({
    success: true,
    mode,
    requires_checkout: true,
    plan_key: planKey,
  });
});

export default billingMutation;
