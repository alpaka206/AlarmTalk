import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  cancelActiveSubscriptionsForUser,
  cancelSubscriptionImmediate,
  clearPaidVoiceRetention,
  findActiveSubscriptionsByUserPk,
  notifyPlanChanged,
  scheduleCancelAtPeriodEnd,
  schedulePaidVoiceRetention,
  schedulePlanChangeAtPeriodEnd,
} from '../lib/billing-cancel';
import { issueVoucherCode, type IssuedVoucherCode } from '../lib/voucher-issue';
import { logStructured } from '../lib/logger';
import {
  playCancelSubscription,
  playManageUrl,
  playRevokeSubscription,
} from '../lib/play-subscriptions';
import type { DbExecutor } from '../lib/transactions';
import { withWriteTransaction } from '../lib/transactions';
import { redeemVoucherCode, VoucherRedemptionError } from '../lib/voucher-redemption';
import {
  PAID_PLAN_TYPES,
  planTypeToUserPlan,
  plannedMaxUses,
  resolveUserPk,
} from './billing-helpers';

const billingMutation = new Hono<AppEnv>();

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

  // 재구독(스텁 결제 성공) — 예약된 유료 음성 보관 삭제를 해제한다.
  await clearPaidVoiceRetention(db, params.userPk);

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

// MARK: - POST /billing/cancel
//
// 구독 해지. mode=at_period_end(기간종료 해지) | immediate(즉시 해지·비례 환불).
// 스토어(Google Play) 결제 구독이면 **Play 성공을 확인하기 전에는 로컬 DB·음성
// 데이터를 절대 변경하지 않는다** — Play 호출 실패 시 502 + manage_url 로 스토어
// 직접 관리 화면을 안내한다.
// 어느 경로든 즉시 해지 시 유료 음성은 하드삭제 대신 30일 보관 유예를 건다.
billingMutation.post('/cancel', async (c) => {
  const body = await c.req
    .json<{ mode?: unknown }>()
    .catch((): { mode?: unknown } => ({ mode: undefined }));
  // mode 화이트리스트: 누락/오타가 조용히 immediate(= Play revoke + 비례 환불)로
  // 떨어지면 의도치 않은 환불·즉시 권한 상실이 생기므로 두 값 외에는 400 으로 거절한다.
  // (Android 클라는 항상 명시적으로 "at_period_end" | "immediate" 를 보낸다.)
  const mode = body.mode;
  if (mode !== 'at_period_end' && mode !== 'immediate') {
    return c.json(
      {
        error: 'mode must be "at_period_end" or "immediate"',
        error_code: 'INVALID_CANCEL_MODE',
      },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);
  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const active = activeSubscriptions[0] ?? null;
  if (!active) {
    return c.json(
      { error: 'No active subscription', error_code: 'NO_ACTIVE_SUBSCRIPTION' },
      404,
    );
  }

  // 활성 구독들이 어느 스토어 결제에 묶여 있는지 확인. 없으면 dev 스텁/프로모/바우처
  // 구독이므로 서버 로컬 해지만 수행한다. 다중 활성 구독이 각각 다른 Play 토큰에 묶인
  // 엣지 케이스까지 전부 조회한다 — 첫 구독 토큰만 취소하면 나머지 토큰이 계속 과금된다.
  // (IN 플레이스홀더는 개발자 고정 조각 — 값은 전부 ?-바인딩.)
  const subIds = activeSubscriptions.map((s) => s.subscriptionId);
  const inPh = subIds.map(() => '?').join(', ');
  const txnRes = await db.execute({
    sql: `SELECT provider, provider_transaction_id, product_id
          FROM store_transactions WHERE subscription_id IN (${inPh})`,
    args: subIds,
  });
  const storeTxns = txnRes.rows.map((row) => ({
    provider: String(row.provider),
    purchaseToken: String(row.provider_transaction_id),
    productId: String(row.product_id),
  }));

  // 같은 토큰이 여러 구독 행에 걸쳐 있어도 Play 호출은 토큰당 한 번만 한다.
  const googleTxns = new Map<string, { purchaseToken: string; productId: string }>();
  for (const txn of storeTxns) {
    if (txn.provider === 'google') googleTxns.set(txn.purchaseToken, txn);
  }

  const now = new Date();

  if (mode === 'at_period_end') {
    // Play 자동갱신 해제가 먼저다. 모든 토큰이 성공해야만 DB 를 바꾼다 — 하나라도
    // 실패하면 502 + DB 무변경. 로컬만 예약취소 상태가 되면 Play 는 다음 결제일에
    // 그대로 과금해 상태가 갈라진다. 이미 성공한 토큰이 있어도 안전하다:
    // play-subscriptions.ts 의 수렴 처리(이미 취소된 토큰 재시도는 성공 간주) 덕에
    // 사용자가 재시도하면 성공분은 그대로 성공으로 수렴해 전체가 완결된다.
    for (const txn of googleTxns.values()) {
      try {
        await playCancelSubscription(c.env, txn.purchaseToken);
      } catch (err) {
        logStructured('error', { at: 'billing.cancel.play_cancel', error: String(err) });
        return c.json(
          {
            error: 'Failed to cancel the Google Play subscription',
            error_code: 'PLAY_CANCEL_FAILED',
            manage_url: playManageUrl(txn.productId, c.env.ANDROID_PACKAGE_NAME),
          },
          502,
        );
      }
    }
    await withWriteTransaction(db, async (tx) => {
      for (const subscription of activeSubscriptions) {
        await scheduleCancelAtPeriodEnd(tx, subscription.subscriptionId);
      }
    });
    return c.json({ success: true, mode, subscription_id: active.subscriptionId });
  }

  // immediate — google 결제면 모든 토큰의 Play revoke(비례 환불) 성공을 먼저 확인한다.
  // 실패 시 DB 무변경은 at_period_end 와 동일 — 성공분은 수렴 처리로 재시도가 안전하다.
  for (const txn of googleTxns.values()) {
    try {
      await playRevokeSubscription(c.env, txn.purchaseToken);
    } catch (err) {
      logStructured('error', { at: 'billing.cancel.play_revoke', error: String(err) });
      return c.json(
        {
          error: 'Failed to revoke the Google Play subscription',
          error_code: 'PLAY_REVOKE_FAILED',
          manage_url: playManageUrl(txn.productId, c.env.ANDROID_PACKAGE_NAME),
        },
        502,
      );
    }
  }

  const cancelAffected = new Set<string>();
  const voiceRetentionUntil = await withWriteTransaction(db, async (tx) => {
    // 트랜잭션 안에서 '사용자 전체 활성 구독'을 다시 조회해 취소하지 않는다 — Play
    // 호출 동안 새 결제 confirm 으로 생긴 활성 구독은 위 revoke 대상이 아니었으므로
    // Play 에선 그대로 유지된다. DB 만 취소하면 상태가 갈라지므로, Play 성공을 확인한
    // 스냅샷(activeSubscriptions)의 구독만 취소하고 새 구독은 건드리지 않는다.
    // (plan 재정렬은 cancelSubscriptionImmediate 내부에서 남은 활성 구독 기준으로 처리)
    for (const subscription of activeSubscriptions) {
      const ids = await cancelSubscriptionImmediate(tx, subscription, now, { deleteVoiceData: false });
      for (const id of ids) cancelAffected.add(id);
    }
    // 즉시 해지여도 음성은 30일 보관 — '지금 삭제'는 /voice-data/delete-now 로 분리.
    // (그 사이 새 유료 구독이 생겼어도 sweep 이 삭제 전 활성 유료 구독을 재확인한다.)
    return schedulePaidVoiceRetention(tx, userPk, now);
  });
  // 가족 소유자 즉시 해지 시 함께 강등되는 멤버에게 plan_changed 푸시(당사자 포함, 커밋 후).
  await notifyPlanChanged(db, c.env, Array.from(cancelAffected));
  return c.json({
    success: true,
    mode,
    subscription_id: active.subscriptionId,
    voice_retention_until: voiceRetentionUntil,
  });
});

// 정책 변경: 무료 전환 시 유료 음성 데이터를 삭제하지 않고 보존·잠금하므로,
// 사용자 즉시 삭제(POST /billing/voice-data/delete-now)는 제거했다. 데이터는 다시 유료가 되면
// 그대로 복구된다. (명시적 개별 삭제는 DELETE /voice/:id, 계정 삭제는 회원 탈퇴 경로.)

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
      return { subscription_id: freshActive[0]!.subscriptionId, plan_group: null, voucher: null, affected: [] as string[] };
    }

    const affected = new Set<string>();
    for (const subscription of freshActive) {
      const ids = await cancelSubscriptionImmediate(tx, subscription, startsAt, { deleteVoiceData: false });
      for (const id of ids) affected.add(id);
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
      affected: Array.from(affected),
    };
  });
  // 가족 소유자가 개인/다른 플랜으로 즉시 전환하면 소유 그룹이 해체돼 멤버가 강등된다 → plan_changed 푸시.
  await notifyPlanChanged(db, c.env, changeResult.affected);

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
