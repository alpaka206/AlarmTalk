import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  cancelActiveSubscriptionsForUser,
  cancelSubscriptionImmediate,
  findActiveSubscriptionsByUserPk,
  scheduleCancelAtPeriodEnd,
  schedulePlanChangeAtPeriodEnd,
} from '../lib/billing-cancel';
import { issueVoucherCode, type IssuedVoucherCode } from '../lib/voucher-issue';
import type { DbExecutor } from '../lib/transactions';
import { withWriteTransaction } from '../lib/transactions';
import { redeemVoucherCode, VoucherRedemptionError } from '../lib/voucher-redemption';
import { PAID_PLAN_TYPES, planTypeToUserPlan, resolveUserPk } from './billing-helpers';

const billingMutation = new Hono<AppEnv>();

function plannedMaxUses(planType: string, maxMembers: number): number {
  if (planType === 'family') return Math.max(1, maxMembers - 1);
  return 1;
}

interface BillablePlan {
  id: string;
  key: string;
  name: string;
  plan_type: string;
  period_days: number;
  max_members: number;
  price_krw: number;
}

interface CreatedSubscriptionArtifacts {
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    plan_group_id: string | null;
    status: 'active';
    starts_at: string;
    expires_at: string;
  };
  plan_group: {
    id: string;
    owner_user_id: string;
    max_members: number;
  } | null;
  voucher: IssuedVoucherCode | null;
}

interface ShareableVoucherCode {
  id: string;
  code: string;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  plan_type: string;
  subscription_id: string;
  status: 'issued';
  issued_at: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
}

type FamilyShareCodeResult =
  | { voucher: ShareableVoucherCode }
  | {
      error: {
        status: 404 | 409;
        body: {
          error: string;
          error_code: string;
        };
      };
    };

interface TestCodeVoucher {
  id: string;
  code: string;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  plan_type: string;
  status: 'issued';
  issued_at: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
}

function isBillingStubEnabled(env: Partial<AppEnv['Bindings']> | undefined): boolean {
  // production 에서는 BILLING_STUB_ENABLED 값과 무관하게 항상 비활성한다.
  // (env 오설정 하나로 /checkout·/change-plan 이 무결제 유료지급 디스펜서가 되는 것 차단.)
  if (env?.ENVIRONMENT === 'production') return false;
  if (env?.BILLING_STUB_ENABLED === 'true' || env?.BILLING_STUB_ENABLED === '1') return true;
  if (env?.BILLING_STUB_ENABLED === 'false' || env?.BILLING_STUB_ENABLED === '0') return false;
  return env?.ENVIRONMENT !== 'production';
}

function checkoutDisabledResponse() {
  return {
    error: 'Checkout is disabled for this test build. Register an invite code.',
    error_code: 'CHECKOUT_DISABLED',
  };
}

function allowedTestCodeIssuerEmails(env: Partial<AppEnv['Bindings']> | undefined): Set<string> {
  // 발급자 화이트리스트는 TEST_CODE_ISSUER_EMAILS 로만 지정한다. 개인 이메일 하드코딩
  // 폴백을 두면 env 누락·계정 탈취 시 단일 계정이 무제한 무료 유료코드 발급 권한을 갖게
  // 되므로, 미설정이면 발급자 없음(fail-closed)으로 둔다.
  const raw = env?.TEST_CODE_ISSUER_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isTestCodeIssuer(env: Partial<AppEnv['Bindings']> | undefined, email: string): boolean {
  return allowedTestCodeIssuerEmails(env).has(email.trim().toLowerCase());
}

function readInteger(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function normalizeBillablePlan(row: Record<string, unknown>): BillablePlan {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    plan_type: String(row.plan_type),
    period_days: Number(row.period_days) || 30,
    max_members: Number(row.max_members) || 1,
    price_krw: Number(row.price_krw) || 0,
  };
}

function planResponse(plan: BillablePlan) {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    plan_type: plan.plan_type,
    period_days: plan.period_days,
    max_members: plan.max_members,
    price_krw: plan.price_krw,
  };
}

async function createPaidSubscriptionArtifacts(
  db: DbExecutor,
  params: {
    userPk: string;
    plan: BillablePlan;
    startsAt: Date;
  },
): Promise<CreatedSubscriptionArtifacts> {
  const startsAtIso = params.startsAt.toISOString();
  const expiresAt = new Date(
    params.startsAt.getTime() + params.plan.period_days * 24 * 60 * 60 * 1000,
  );
  const expiresAtIso = expiresAt.toISOString();
  const subscriptionId = crypto.randomUUID();
  let planGroupId: string | null = null;

  if (params.plan.plan_type === 'family') {
    planGroupId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
            VALUES (?, ?, ?, ?)`,
      args: [planGroupId, params.userPk, params.plan.id, params.plan.max_members],
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
      params.plan.id,
      planGroupId,
      startsAtIso,
      expiresAtIso,
    ],
  });

  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(params.plan.plan_type), params.userPk],
  });

  const voucher =
    params.plan.plan_type === 'family'
      ? await issueVoucherCode(db, {
          kind: 'invite',
          planId: params.plan.id,
          issuerUserId: params.userPk,
          issuerSubscriptionId: subscriptionId,
          issuedAt: startsAtIso,
          expiresAt: expiresAtIso,
          maxUses: plannedMaxUses(params.plan.plan_type, params.plan.max_members),
        })
      : null;

  return {
    subscription: {
      id: subscriptionId,
      user_id: params.userPk,
      plan_id: params.plan.id,
      plan_group_id: planGroupId,
      status: 'active',
      starts_at: startsAtIso,
      expires_at: expiresAtIso,
    },
    plan_group: planGroupId
      ? {
          id: planGroupId,
          owner_user_id: params.userPk,
          max_members: params.plan.max_members,
        }
      : null,
    voucher,
  };
}

billingMutation.post('/checkout', async (c) => {
  if (!isBillingStubEnabled(c.env)) {
    return c.json(checkoutDisabledResponse(), 409);
  }

  const db = getDB(c.env);

  const body = await c.req
    .json<{ plan_key?: unknown; gift?: unknown }>()
    .catch((): { plan_key?: unknown; gift?: unknown } => ({
      plan_key: undefined,
      gift: undefined,
    }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  const gift = body.gift === true;
  if (!planKey) {
    return c.json({ error: 'plan_key is required', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw, is_active
          FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: 'Plan is inactive', error_code: 'PLAN_INACTIVE' }, 400);
  }

  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'Free plan is not billable', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }
  if (gift && planType !== 'personal') {
    return c.json(
      { error: 'Gift checkout is only available for personal plans', error_code: 'GIFT_PERSONAL_ONLY' },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const billablePlan = normalizeBillablePlan(plan);
  const checkoutResult = await withWriteTransaction(db, async (tx) => {
    const startsAt = new Date();
    const expiresAt = new Date(
      startsAt.getTime() + billablePlan.period_days * 24 * 60 * 60 * 1000,
    );

    if (gift) {
      return {
        subscription: null,
        plan_group: null,
        voucher: await issueVoucherCode(tx, {
          kind: 'gift',
          planId: billablePlan.id,
          issuerUserId: userPk,
          issuerSubscriptionId: null,
          issuedAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          maxUses: 1,
        }),
      };
    }

    await cancelActiveSubscriptionsForUser(tx, userPk, startsAt, { deleteVoiceData: false });

    return createPaidSubscriptionArtifacts(tx, {
      userPk,
      plan: billablePlan,
      startsAt,
    });
  });

  return c.json({
    success: true,
    checkout_stub: true,
    subscription: checkoutResult.subscription,
    plan: planResponse(billablePlan),
    plan_group: checkoutResult.plan_group,
    voucher: checkoutResult.voucher,
  });
});

billingMutation.post('/test-codes', async (c) => {
  const userEmail = c.get('userEmail') || '';
  if (!isTestCodeIssuer(c.env, userEmail)) {
    return c.json({ error: 'Test code issuer access is required', error_code: 'FORBIDDEN' }, 403);
  }

  const issuerUserPk = await resolveUserPk(c);
  if (!issuerUserPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req
    .json<{ plan_key?: unknown; count?: unknown; days?: unknown }>()
    .catch((): { plan_key?: unknown; count?: unknown; days?: unknown } => ({
      plan_key: undefined,
      count: undefined,
      days: undefined,
    }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  const count = readInteger(body.count, 1);
  const days = readInteger(body.days, 30);

  if (!planKey) {
    return c.json({ error: 'plan_key is required', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }
  if (count === null || count < 1 || count > 50) {
    return c.json({ error: 'count must be between 1 and 50', error_code: 'INVALID_COUNT' }, 400);
  }
  if (days === null || days < 1 || days > 365) {
    return c.json({ error: 'days must be between 1 and 365', error_code: 'INVALID_DAYS' }, 400);
  }

  const db = getDB(c.env);
  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw, is_active
          FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }

  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: 'Plan is inactive', error_code: 'PLAN_INACTIVE' }, 400);
  }

  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'Free plan is not supported for test codes', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const billablePlan = normalizeBillablePlan(plan);
  const kind = billablePlan.plan_type === 'personal' ? 'gift' : 'invite';
  const issuedAt = new Date();
  const issuedAtIso = issuedAt.toISOString();
  const expiresAtIso = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const codes = await withWriteTransaction(db, async (tx) => {
    const issuedCodes: TestCodeVoucher[] = [];
    for (let i = 0; i < count; i++) {
      const issued = await issueVoucherCode(tx, {
        kind,
        planId: billablePlan.id,
        issuerUserId: issuerUserPk,
        issuerSubscriptionId: null,
        issuedAt: issuedAtIso,
        expiresAt: expiresAtIso,
        maxUses: 1,
      });
      issuedCodes.push({
        id: issued.id,
        code: issued.code,
        plan_id: billablePlan.id,
        plan_key: billablePlan.key,
        plan_name: billablePlan.name,
        plan_type: billablePlan.plan_type,
        status: 'issued',
        issued_at: issuedAtIso,
        expires_at: issued.expires_at,
        max_uses: issued.max_uses,
        use_count: issued.use_count,
      });
    }
    return issuedCodes;
  });

  return c.json({
    success: true,
    plan: planResponse(billablePlan),
    first_redeemer_becomes_owner: billablePlan.plan_type === 'family',
    codes,
  });
});

billingMutation.post('/redeem', async (c) => {
  const db = getDB(c.env);

  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  const raw = typeof body.code === 'string' ? body.code.trim() : '';
  if (!raw) {
    return c.json({ error: 'code is required', error_code: 'CODE_REQUIRED' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  try {
    return c.json(await redeemVoucherCode(db, { userPk, rawCode: raw }));
  } catch (error) {
    if (error instanceof VoucherRedemptionError) {
      return c.json(
        { error: error.message, error_code: error.errorCode },
        error.status as 400 | 404 | 409,
      );
    }
    throw error;
  }
});

interface FamilyOwnerContext {
  subscriptionId: string;
  planId: string;
  planKey: string;
  planName: string;
  planType: string;
  maxMembers: number;
  maxUses: number;
  expiresAt: string;
}

type FamilyOwnerLookup =
  | { ctx: FamilyOwnerContext; memberCount: number }
  | {
      error: {
        status: 404;
        body: { error: string; error_code: string };
      };
    };

/**
 * 활성 가족 플랜 소유자 구독을 찾는다(정원 가드는 호출 측 책임).
 *  - 발급(family-share)은 정원이 차면 새 코드가 무의미하므로 GROUP_FULL 로 막는다.
 *  - 재발급(regenerate)은 *정원이 찼을 때도* 유출된 코드를 끊을 수 있어야 하므로
 *    정원 가드를 적용하지 않는다. 그래서 가드를 여기서 빼고 memberCount 만 넘긴다.
 */
async function loadActiveFamilyOwnerContext(
  tx: DbExecutor,
  userPk: string,
): Promise<FamilyOwnerLookup> {
  const subscriptionRes = await tx.execute({
    sql: `SELECT s.id AS subscription_id, s.plan_id, s.expires_at,
                 pg.id AS plan_group_id, pg.max_members AS group_max_members,
                 (SELECT COUNT(*) FROM plan_group_members WHERE plan_group_id = pg.id) AS member_count,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type,
                 p.period_days, p.max_members, p.price_krw
          FROM subscriptions s
          JOIN plans p ON p.id = s.plan_id
          JOIN plan_groups pg ON pg.id = s.plan_group_id
          WHERE s.user_id = ?
            AND pg.owner_user_id = ?
            AND s.status = 'active'
            AND s.expires_at > datetime('now')
            AND p.plan_type = 'family'
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userPk, userPk],
  });

  if (subscriptionRes.rows.length === 0) {
    return {
      error: {
        status: 404,
        body: {
          error: 'Active family plan ownership is required',
          error_code: 'NO_ACTIVE_FAMILY_OWNER_SUBSCRIPTION',
        },
      },
    };
  }

  const subscription = subscriptionRes.rows[0]!;
  const planType = String(subscription.plan_type);
  const maxMembers = Number(subscription.group_max_members ?? subscription.max_members) || 6;
  const memberCount = Number(subscription.member_count ?? 0);

  return {
    ctx: {
      subscriptionId: String(subscription.subscription_id),
      planId: String(subscription.plan_id),
      planKey: String(subscription.plan_key),
      planName: String(subscription.plan_name),
      planType,
      maxMembers,
      maxUses: plannedMaxUses(planType, maxMembers),
      expiresAt: String(subscription.expires_at),
    },
    memberCount,
  };
}

/** 새 invite 코드를 발급해 공유용 응답 모양으로 만든다. */
async function issueShareableVoucher(
  tx: DbExecutor,
  userPk: string,
  ctx: FamilyOwnerContext,
): Promise<ShareableVoucherCode> {
  const issuedAt = new Date().toISOString();
  const issued = await issueVoucherCode(tx, {
    kind: 'invite',
    planId: ctx.planId,
    issuerUserId: userPk,
    issuerSubscriptionId: ctx.subscriptionId,
    issuedAt,
    expiresAt: ctx.expiresAt,
    maxUses: ctx.maxUses,
  });
  return {
    id: issued.id,
    code: issued.code,
    plan_id: ctx.planId,
    plan_key: ctx.planKey,
    plan_name: ctx.planName,
    plan_type: ctx.planType,
    subscription_id: ctx.subscriptionId,
    status: 'issued',
    issued_at: issuedAt,
    expires_at: issued.expires_at,
    max_uses: issued.max_uses,
    use_count: issued.use_count,
  };
}

billingMutation.post('/vouchers/family-share', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);
  const result: FamilyShareCodeResult = await withWriteTransaction(db, async (tx) => {
    const lookup = await loadActiveFamilyOwnerContext(tx, userPk);
    if ('error' in lookup) return lookup;
    const ctx = lookup.ctx;

    // 정원이 차면 더 초대할 수 없으므로 새 코드 발급/재사용을 막는다.
    if (lookup.memberCount >= ctx.maxMembers) {
      return {
        error: {
          status: 409,
          body: {
            error: `Group is full: max ${ctx.maxMembers}`,
            error_code: 'GROUP_FULL',
          },
        },
      };
    }

    const existingRes = await tx.execute({
      sql: `SELECT v.id, v.code, v.status, v.issued_at, v.expires_at, v.max_uses,
                   (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = v.id) AS use_count
            FROM voucher_codes v
            WHERE v.issuer_user_id = ?
              AND v.issuer_subscription_id = ?
              AND v.status = 'issued'
              AND v.expires_at > datetime('now')
            ORDER BY v.issued_at DESC`,
      args: [userPk, ctx.subscriptionId],
    });

    const existing = existingRes.rows.find((row) => {
      const useCount = Number(row.use_count ?? 0);
      const rowMaxUses = Number(row.max_uses ?? 1);
      return useCount < rowMaxUses;
    });

    if (existing) {
      const voucher: ShareableVoucherCode = {
        id: String(existing.id),
        code: String(existing.code),
        plan_id: ctx.planId,
        plan_key: ctx.planKey,
        plan_name: ctx.planName,
        plan_type: ctx.planType,
        subscription_id: ctx.subscriptionId,
        status: 'issued',
        issued_at: String(existing.issued_at),
        expires_at: String(existing.expires_at),
        max_uses: Number(existing.max_uses ?? ctx.maxUses),
        use_count: Number(existing.use_count ?? 0),
      };
      return { voucher };
    }

    return { voucher: await issueShareableVoucher(tx, userPk, ctx) };
  });

  if ('error' in result) {
    return c.json(result.error.body, result.error.status);
  }

  return c.json({ success: true, voucher: result.voucher });
});

// 공유 코드 재발급: 기존 코드를 무효화(expired)하고 새 코드를 발급한다.
// 유출이 의심될 때 사용자가 직접 코드를 끊고 새로 만들 수 있게 한다.
// 정원이 꽉 차도(유출 의심 시점이 보통 이때다) 허용해야 하므로 GROUP_FULL 가드를 두지 않는다.
billingMutation.post('/vouchers/family-share/regenerate', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);
  const result: FamilyShareCodeResult = await withWriteTransaction(db, async (tx) => {
    const lookup = await loadActiveFamilyOwnerContext(tx, userPk);
    if ('error' in lookup) return lookup;
    const ctx = lookup.ctx;

    // 같은 구독에 묶인 기존 코드를 issued·used 모두 만료 처리한다.
    // used 만 빼면, 멤버 이탈 시 releaseInviteUseForMember 가 used→issued 로 되돌려
    // 유출된 코드가 다시 사용 가능해질 수 있다(expired 는 되돌리지 않음).
    // 이미 합류한 멤버의 구독 자체는 별도 행이라 영향 없다.
    await tx.execute({
      sql: `UPDATE voucher_codes
            SET status = 'expired'
            WHERE issuer_user_id = ?
              AND issuer_subscription_id = ?
              AND status IN ('issued', 'used')`,
      args: [userPk, ctx.subscriptionId],
    });

    return { voucher: await issueShareableVoucher(tx, userPk, ctx) };
  });

  if ('error' in result) {
    return c.json(result.error.body, result.error.status);
  }

  return c.json({ success: true, voucher: result.voucher });
});

billingMutation.post('/cancel', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req
    .json<{ mode?: unknown }>()
    .catch((): { mode?: unknown } => ({ mode: undefined }));
  const mode = body.mode === 'at_period_end' ? 'at_period_end' : 'immediate';

  const db = getDB(c.env);
  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const active = activeSubscriptions[0] ?? null;
  if (!active) {
    return c.json(
      { error: 'No active subscription', error_code: 'NO_ACTIVE_SUBSCRIPTION' },
      404,
    );
  }

  if (mode === 'at_period_end') {
    await withWriteTransaction(db, async (tx) => {
      for (const subscription of activeSubscriptions) {
        await scheduleCancelAtPeriodEnd(tx, subscription.subscriptionId);
      }
    });
    return c.json({ success: true, mode, subscription_id: active.subscriptionId });
  }

  await withWriteTransaction(db, (tx) =>
    cancelActiveSubscriptionsForUser(tx, userPk, undefined, { deleteVoiceData: true }),
  );
  return c.json({ success: true, mode, subscription_id: active.subscriptionId });
});

billingMutation.post('/change-plan', async (c) => {
  if (!isBillingStubEnabled(c.env)) {
    return c.json(checkoutDisabledResponse(), 409);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req
    .json<{ plan_key?: unknown; mode?: unknown }>()
    .catch((): { plan_key?: unknown; mode?: unknown } => ({
      plan_key: undefined,
      mode: undefined,
    }));

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  const mode = body.mode === 'at_period_end' ? 'at_period_end' : 'immediate';
  if (!planKey) {
    return c.json({ error: 'plan_key is required', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }

  const db = getDB(c.env);
  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw, is_active
          FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: 'Plan is inactive', error_code: 'PLAN_INACTIVE' }, 400);
  }
  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'Free plan is not billable', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const active = activeSubscriptions[0] ?? null;
  if (!active) {
    return c.json(
      { error: 'No active subscription', error_code: 'NO_ACTIVE_SUBSCRIPTION' },
      404,
    );
  }

  if (activeSubscriptions.every((subscription) => subscription.planId === String(plan.id))) {
    return c.json({ error: 'Already on this plan', error_code: 'SAME_PLAN' }, 400);
  }

  if (mode === 'at_period_end') {
    await withWriteTransaction(db, async (tx) => {
      for (const subscription of activeSubscriptions) {
        await schedulePlanChangeAtPeriodEnd(tx, subscription.subscriptionId, String(plan.id));
      }
    });
    return c.json({
      success: true,
      mode,
      subscription_id: active.subscriptionId,
      next_plan_key: planKey,
    });
  }

  const billablePlan = normalizeBillablePlan(plan);
  const changeResult = await withWriteTransaction(db, async (tx) => {
    const startsAt = new Date();
    const freshActive = await findActiveSubscriptionsByUserPk(tx, userPk);
    if (freshActive.length === 0) {
      throw new Error('No active subscription during immediate plan change');
    }
    if (freshActive.every((subscription) => subscription.planId === billablePlan.id)) {
      return { subscription_id: freshActive[0]!.subscriptionId, plan_group: null, voucher: null };
    }

    for (const subscription of freshActive) {
      await cancelSubscriptionImmediate(tx, subscription, startsAt, { deleteVoiceData: false });
    }
    const created = await createPaidSubscriptionArtifacts(tx, {
      userPk,
      plan: billablePlan,
      startsAt,
    });
    return {
      subscription_id: created.subscription.id,
      plan_group: created.plan_group,
      voucher: created.voucher,
    };
  });

  return c.json({
    success: true,
    mode,
    requires_checkout: false,
    subscription_id: changeResult.subscription_id,
    plan_key: billablePlan.key,
    plan_group: changeResult.plan_group,
    voucher: changeResult.voucher,
  });
});

export default billingMutation;
