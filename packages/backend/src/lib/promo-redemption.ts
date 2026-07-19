import type { Client } from '@libsql/client';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import { cancelActiveSubscriptionsForUser, createNewSubscriptionForPlan } from './billing-cancel';

/**
 * 공용 프로모 쿠폰(관리자 발급) 사용 로직. 기존 개인 코드(invite/gift = voucher_codes,
 * voucher-redemption.ts)와 별개다. 관리자가 임의 코드 문자열을 발급하면 여러 사용자가
 * 등록 가능 유효창(valid_from~valid_until) 안에서, 총 사용 상한(max_redemptions) 내에서,
 * 사용자당 1회 사용해 특정 플랜을 duration_days 만큼 받는다.
 *
 * 보안: 유료 플랜 승격은 반드시 이 검증 경로(또는 store-billing/voucher)로만 이뤄진다.
 * 원자 claim(promo_code_redemptions 조건부 INSERT)으로 상한 초과/중복 사용/경합을 막고,
 * 전체를 트랜잭션으로 감싸 claim 이후 구독 생성이 실패하면 함께 롤백된다.
 */
export class PromoRedemptionError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PromoRedemptionError';
  }
}

export interface RedeemedPromoResult {
  success: true;
  type: 'promo';
  subscription: {
    id: string;
    plan_id: string;
    status: 'active';
    starts_at: string;
    expires_at: string;
  };
  plan: {
    id: string;
    key: string;
    name: string;
    plan_type: string;
  };
  promo: {
    id: string;
    code: string;
    duration_days: number;
  };
}

export function normalizePromoCode(raw: string): string {
  return raw.trim();
}

async function redeemPromoInTransaction(
  db: DbExecutor,
  params: { userPk: string; rawCode: string; now?: Date },
): Promise<RedeemedPromoResult> {
  const code = normalizePromoCode(params.rawCode);
  if (!code) {
    throw new PromoRedemptionError(400, 'CODE_REQUIRED', 'code is required');
  }

  // 코드 매칭은 대소문자 무시(발급 시 UNIQUE 도 NOCASE).
  const promoRes = await db.execute({
    sql: `SELECT id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions,
                 is_active, redemption_group
          FROM promo_codes WHERE code = ? COLLATE NOCASE`,
    args: [code],
  });
  if (promoRes.rows.length === 0) {
    throw new PromoRedemptionError(404, 'CODE_NOT_FOUND', 'Promo code not found');
  }
  const promo = promoRes.rows[0]!;
  const promoId = String(promo.id);
  const planId = String(promo.plan_id);
  const durationDays = Number(promo.duration_days) || 0;
  const isActive = Number(promo.is_active) === 1;

  if (!isActive) {
    throw new PromoRedemptionError(409, 'CODE_INACTIVE', 'Promo code is not active');
  }
  if (durationDays <= 0) {
    throw new PromoRedemptionError(409, 'CODE_MISCONFIGURED', 'Promo code is misconfigured');
  }

  const now = params.now ?? new Date();

  // 등록 가능 유효창 검사(사용자 친화 에러 목적). 최종 판정은 아래 원자 claim 이 담당한다.
  const windowRes = await db.execute({
    sql: `SELECT 1 FROM promo_codes
          WHERE id = ?
            AND (valid_from IS NULL OR datetime(valid_from) <= datetime('now'))
            AND (valid_until IS NULL OR datetime(valid_until) > datetime('now'))
          LIMIT 1`,
    args: [promoId],
  });
  if (windowRes.rows.length === 0) {
    throw new PromoRedemptionError(409, 'CODE_NOT_IN_WINDOW', 'Promo code is not currently redeemable');
  }

  const dupRes = await db.execute({
    sql: `SELECT 1 FROM promo_code_redemptions WHERE promo_code_id = ? AND user_id = ? LIMIT 1`,
    args: [promoId, params.userPk],
  });
  if (dupRes.rows.length > 0) {
    throw new PromoRedemptionError(
      409,
      'CODE_ALREADY_REDEEMED_BY_YOU',
      'You already redeemed this code',
    );
  }

  // 리딤 그룹(예: 웰컴 3종) 규칙: 같은 group 의 어떤 코드든 이미 사용한 계정은 다른 코드도
  // 사용할 수 없다 — 개인/커플/가족 웰컴을 갈아타며 무한 연장하는 것을 막는다. 여기는
  // 사용자 친화 에러 목적의 사전 검사이고, 최종 판정은 아래 원자 claim 이 담당한다.
  const redemptionGroup = (promo.redemption_group as string | null) ?? null;
  if (redemptionGroup) {
    const groupDupRes = await db.execute({
      sql: `SELECT 1 FROM promo_code_redemptions r
            JOIN promo_codes pg ON pg.id = r.promo_code_id
            WHERE r.user_id = ? AND pg.redemption_group = ?
            LIMIT 1`,
      args: [params.userPk, redemptionGroup],
    });
    if (groupDupRes.rows.length > 0) {
      throw new PromoRedemptionError(
        409,
        'CODE_GROUP_ALREADY_REDEEMED',
        'You already redeemed a code from this promotion',
      );
    }
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, max_members FROM plans WHERE id = ? AND is_active = 1`,
    args: [planId],
  });
  if (planRes.rows.length === 0) {
    throw new PromoRedemptionError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  }
  const plan = planRes.rows[0]!;
  const planType = String(plan.plan_type);
  const maxMembers = Number(plan.max_members) || 1;

  // OWNS_ACTIVE_GROUP 가드(voucher 와 동일): 코드 사용은 기존 구독을 취소하는데, redeemer 가
  // 다른 멤버가 있는 가족 그룹의 소유자면 그 취소가 그룹을 해체하고 멤버 구독까지 강등시킨다.
  const ownedGroupRes = await db.execute({
    sql: `SELECT COUNT(*) AS other_members
          FROM plan_group_members m
          JOIN plan_groups pg ON pg.id = m.plan_group_id
          WHERE pg.owner_user_id = ? AND m.user_id != ?`,
    args: [params.userPk, params.userPk],
  });
  if ((Number(ownedGroupRes.rows[0]?.other_members) || 0) > 0) {
    throw new PromoRedemptionError(
      409,
      'OWNS_ACTIVE_GROUP',
      'You own a family group with other members. Transfer ownership or remove members before redeeming a code.',
    );
  }

  // 원자 claim: 활성·유효창·총 상한·사용자당 1회·그룹당 1회 를 한 문장으로 gate 한다.
  // SQLite/libSQL 단일 라이터에서 동시 사용 중 상한 초과가 발생하지 않는다.
  const redemptionId = crypto.randomUUID();
  const claim = await db.execute({
    sql: `INSERT INTO promo_code_redemptions (id, promo_code_id, user_id, redeemed_at)
          SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM promo_codes p
            WHERE p.id = ?
              AND p.is_active = 1
              AND (p.valid_from IS NULL OR datetime(p.valid_from) <= datetime('now'))
              AND (p.valid_until IS NULL OR datetime(p.valid_until) > datetime('now'))
              AND (
                p.max_redemptions IS NULL OR
                (SELECT COUNT(*) FROM promo_code_redemptions WHERE promo_code_id = p.id) < p.max_redemptions
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM promo_code_redemptions WHERE promo_code_id = ? AND user_id = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM promo_code_redemptions r
            JOIN promo_codes pg ON pg.id = r.promo_code_id
            WHERE r.user_id = ?
              AND pg.redemption_group IS NOT NULL
              AND pg.redemption_group = (SELECT redemption_group FROM promo_codes WHERE id = ?)
          )`,
    args: [
      redemptionId,
      promoId,
      params.userPk,
      now.toISOString(),
      promoId,
      promoId,
      params.userPk,
      params.userPk,
      promoId,
    ],
  });
  if ((claim.rowsAffected ?? 0) === 0) {
    throw new PromoRedemptionError(409, 'CODE_EXHAUSTED', 'Promo code is no longer redeemable');
  }

  // 기존 활성 구독 정리(음성 데이터 보존) 후 새 구독 생성(가족이면 그룹/초대 포함).
  await cancelActiveSubscriptionsForUser(db, params.userPk, now, { deleteVoiceData: false });
  const subscriptionId = await createNewSubscriptionForPlan(db, {
    userPk: params.userPk,
    planId,
    planType,
    periodDays: durationDays,
    maxMembers,
    now,
  });

  await db.execute({
    sql: `UPDATE promo_code_redemptions SET subscription_id = ? WHERE id = ?`,
    args: [subscriptionId, redemptionId],
  });
  await db.execute({
    sql: `UPDATE promo_codes SET updated_at = datetime('now') WHERE id = ?`,
    args: [promoId],
  });

  const startsAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    success: true,
    type: 'promo',
    subscription: {
      id: subscriptionId,
      plan_id: planId,
      status: 'active',
      starts_at: startsAt,
      expires_at: expiresAt,
    },
    plan: {
      id: planId,
      key: String(plan.key),
      name: String(plan.name),
      plan_type: planType,
    },
    promo: {
      id: promoId,
      code: String(promo.code),
      duration_days: durationDays,
    },
  };
}

export async function redeemPromoCode(
  db: Client,
  params: { userPk: string; rawCode: string; now?: Date },
): Promise<RedeemedPromoResult> {
  return withWriteTransaction(db, (tx) => redeemPromoInTransaction(tx, params));
}
