import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { generateVoucherCode, hashVoucherCode, isValidVoucherCodeFormat } from '../lib/vouchers';

const billing = new Hono<AppEnv>();

const PAID_PLAN_TYPES = new Set(['personal', 'family']);

function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

/**
 * POST /billing/checkout — 스텁 결제 엔드포인트.
 * TODO: integrate real PG (TossPayments / Iamport) — currently stub 이며 결제 성공 여부를 항상 true 로 가정한다.
 */
billing.post('/checkout', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{ plan_key?: unknown }>()
    .catch(() => ({ plan_key: undefined }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
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
  const plan = planRes.rows[0];
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: '비활성화된 플랜입니다', error_code: 'PLAN_INACTIVE' }, 400);
  }
  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'free 는 기본 플랜이라 결제 대상이 아닙니다', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [userId],
  });
  if (userRes.rows.length === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }
  const userPk = String(userRes.rows[0].id);

  const subscriptionId = crypto.randomUUID();
  const periodDays = Number(plan.period_days) || 30;
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const maxMembers = Number(plan.max_members) || 1;

  // 가족 플랜은 그룹 + owner 멤버를 선행 생성하고 subscription 에 plan_group_id 연결 (#31)
  let planGroupId: string | null = null;
  if (planType === 'family') {
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

  // 1회용 이용권 코드 자동 발급 (#28)
  const voucherId = crypto.randomUUID();
  const { code: voucherCode, hash: voucherHash } = await generateVoucherCode();
  await db.execute({
    sql: `INSERT INTO voucher_codes
          (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id, status, issued_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
    args: [
      voucherId,
      voucherCode,
      voucherHash,
      String(plan.id),
      userPk,
      subscriptionId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
    ],
  });

  return c.json({
    success: true,
    checkout_stub: true,
    subscription: {
      id: subscriptionId,
      user_id: userPk,
      plan_id: String(plan.id),
      plan_group_id: planGroupId,
      status: 'active',
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
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
      expires_at: expiresAt.toISOString(),
    },
  });
});

/** GET /billing/vouchers — 내가 발급한 이용권 코드 목록 (발급자에게만 평문 노출) */
billing.get('/vouchers', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [userId],
  });
  if (userRes.rows.length === 0) {
    return c.json({ vouchers: [] });
  }
  const userPk = String(userRes.rows[0].id);

  const result = await db.execute({
    sql: `SELECT v.id, v.code, v.plan_id, v.issuer_subscription_id, v.redeemed_by_user_id,
                 v.status, v.issued_at, v.used_at, v.expires_at,
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
    })),
  });
});

/** GET /billing/subscription — 현재 사용자 활성 구독(+plan JOIN) 반환 */
billing.get('/subscription', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id,
                 s.status, s.starts_at, s.expires_at,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type,
                 p.period_days, p.max_members, p.price_krw
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN plans p ON p.id = s.plan_id
          WHERE u.google_id = ?
            AND s.status = 'active'
            AND s.expires_at > datetime('now')
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userId],
  });

  if (result.rows.length === 0) {
    return c.json({ subscription: null, plan: null });
  }

  const r = result.rows[0];
  return c.json({
    subscription: {
      id: String(r.sub_id),
      user_id: String(r.user_id),
      plan_id: String(r.plan_id),
      plan_group_id: (r.plan_group_id as string | null) ?? null,
      status: String(r.status),
      starts_at: String(r.starts_at),
      expires_at: String(r.expires_at),
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
  });
});

/**
 * POST /billing/redeem — 이용권 코드 등록.
 * 평문 코드를 해시로 변환해 voucher_codes 에서 lookup → 상태/만료/자기발급 검증 후
 * status=used 로 전이하고 등록자에게 새 subscription 을 발행한다.
 */
billing.post('/redeem', async (c) => {
  const userId = c.get('userId');
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

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [userId],
  });
  if (userRes.rows.length === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }
  const userPk = String(userRes.rows[0].id);

  const codeHash = await hashVoucherCode(raw);
  const voucherRes = await db.execute({
    sql: `SELECT id, code_hash, plan_id, issuer_user_id, status, expires_at
          FROM voucher_codes WHERE code_hash = ?`,
    args: [codeHash],
  });
  if (voucherRes.rows.length === 0) {
    return c.json({ error: '해당 코드를 찾을 수 없습니다', error_code: 'CODE_NOT_FOUND' }, 404);
  }
  const voucher = voucherRes.rows[0];
  const status = String(voucher.status);
  const voucherId = String(voucher.id);
  const planId = String(voucher.plan_id);
  const issuerUserId = String(voucher.issuer_user_id);

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

  if (issuerUserId === userPk) {
    return c.json({ error: '본인이 발급한 코드는 등록할 수 없습니다', error_code: 'SELF_ISSUED' }, 400);
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw
          FROM plans WHERE id = ?`,
    args: [planId],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: '연결된 플랜을 찾을 수 없습니다', error_code: 'PLAN_NOT_FOUND' }, 404);
  }
  const plan = planRes.rows[0];
  const planType = String(plan.plan_type);
  const periodDays = Number(plan.period_days) || 30;
  const startsAt = now;
  const newExpiresAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);

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
      status: 'used',
    },
  });
});

export default billing;
