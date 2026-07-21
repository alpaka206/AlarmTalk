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

/**
 * 웰컴 그룹 이름과 그 그룹으로 시드되는 코드 이름(마이그레이션 #72/#73과 동일).
 * 웰컴 판정은 항상 '그룹 컬럼 OR 이름' 결합으로 본다 — 컬럼이 없는 창(#72 이전)과
 * 백필 전 갭(#72~#73)에서 사전 존재 동명 코드가 규칙을 우회하지 못하게 한다.
 */
const WELCOME_GROUP_NAME = 'welcome';
const WELCOME_GROUP_CODES: readonly string[] = [
  'WELCOME_PERSONAL',
  'WELCOME_COUPLE',
  'WELCOME_FAMILY',
];

async function redeemPromoInTransaction(
  db: DbExecutor,
  params: { userPk: string; rawCode: string; now?: Date },
): Promise<RedeemedPromoResult> {
  const code = normalizePromoCode(params.rawCode);
  if (!code) {
    throw new PromoRedemptionError(400, 'CODE_REQUIRED', 'code is required');
  }

  // 코드 매칭은 대소문자 무시(발급 시 UNIQUE 도 NOCASE).
  // deploy-backend.yml 이 배포 '후' 마이그레이션을 돌리므로, redemption_group(#72) 컬럼이
  // 아직 없는 창에서도 리딤이 500 나지 않게 레거시 스키마로 폴백한다(Codex #574 P1).
  // 폴백 중에는 컬럼 기반 그룹 게이트 대신 아래의 '이름 기반' 웰컴 게이트가 대신 선다
  // (Codex #575 — 마이그레이션 전에 발급돼 있던 WELCOME_* 동명 코드까지 커버).
  let promoRes;
  let legacySchema = false;
  try {
    promoRes = await db.execute({
      sql: `SELECT id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions,
                   is_active, redemption_group
            FROM promo_codes WHERE code = ? COLLATE NOCASE`,
      args: [code],
    });
  } catch (err) {
    // SELECT 는 "no such column", INSERT 는 "has no column named" — admin.ts 와 동일 판별.
    if (!/no such column|has no column named/i.test(String(err))) throw err;
    legacySchema = true;
    promoRes = await db.execute({
      sql: `SELECT id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions,
                   is_active
            FROM promo_codes WHERE code = ? COLLATE NOCASE`,
      args: [code],
    });
  }
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
  //
  // 웰컴 판정은 항상 '그룹 컬럼 OR 이름' 결합으로 본다 — 마이그레이션 수명주기의 세 구간
  // (① #72 이전: 컬럼 없음 → 이름만, ② #72~#73 사이: 사전 존재 동명 코드의 group 이 아직
  // NULL → 이름이 보완, ③ #73 이후: 컬럼이 정답, 이름은 동치) 모두에서 웰컴 1회 규칙이
  // 끊기지 않는다(Codex #574~#575 배포 창 계열 지적의 최종 형태).
  const redemptionGroup = (promo.redemption_group as string | null | undefined) ?? null;
  const isWelcomeCode =
    redemptionGroup === WELCOME_GROUP_NAME ||
    WELCOME_GROUP_CODES.includes(String(promo.code).toUpperCase());
  let groupCond: { sql: string; args: string[] } | null = null;
  if (isWelcomeCode) {
    groupCond = legacySchema
      ? { sql: `UPPER(pg.code) IN (?, ?, ?)`, args: [...WELCOME_GROUP_CODES] }
      : {
          sql: `(pg.redemption_group = ? OR UPPER(pg.code) IN (?, ?, ?))`,
          args: [WELCOME_GROUP_NAME, ...WELCOME_GROUP_CODES],
        };
  } else if (redemptionGroup) {
    groupCond = { sql: `pg.redemption_group = ?`, args: [redemptionGroup] };
  }
  if (groupCond) {
    const groupDupRes = await db.execute({
      sql: `SELECT 1 FROM promo_code_redemptions r
            JOIN promo_codes pg ON pg.id = r.promo_code_id
            WHERE r.user_id = ? AND ${groupCond.sql}
            LIMIT 1`,
      args: [params.userPk, ...groupCond.args],
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

  // 유료 이용 중 쿠폰 등록 금지: 활성 유료 구독(본인 결제·가족 멤버 구독 포함)이 있으면 거절한다.
  // 쿠폰이 기존 구독을 취소·대체해 남은 유료 기간을 날리는 사고를 막고, 스토어 결제 구독의 경우
  // 서버가 취소해도 Play 자동갱신이 살아 있어 다음 결제 때 RTDN 으로 되살아나는 이중 상태도 막는다.
  // 판정은 /billing/subscription 과 동일하게 expires_at 미래까지 요구한다 — 기간이 지났지만
  // 5분 만료 cron 이 아직 status 를 못 바꾼 행이 '활성'으로 잡혀, 무료로 보이는 사용자의 쿠폰이
  // 거절되는 창을 없앤다(Codex #611 P2).
  const activePaidRes = await db.execute({
    sql: `SELECT 1 FROM subscriptions s
          JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ?
            AND s.status = 'active'
            AND datetime(s.expires_at) > datetime('now')
            AND p.plan_type IN ('personal', 'family')
          LIMIT 1`,
    args: [params.userPk],
  });
  if (activePaidRes.rows.length > 0) {
    throw new PromoRedemptionError(
      409,
      'ACTIVE_SUBSCRIPTION_EXISTS',
      'You already have an active subscription. Cancel it before redeeming a promo code.',
    );
  }

  // 원자 claim: 활성·유효창·총 상한·사용자당 1회·(그룹 코드면) 그룹당 1회 를 한 문장으로
  // gate 한다. SQLite/libSQL 단일 라이터에서 동시 사용 중 상한 초과가 발생하지 않는다.
  // 그룹 절은 위 사전 검사와 동일한 groupCond(웰컴=컬럼 OR 이름 결합)를 그대로 쓴다 —
  // 조건 없는 일반 코드는 절 자체가 빠져 배포 창에서 컬럼을 참조하지 않는다.
  const redemptionId = crypto.randomUUID();
  const groupClause = groupCond
    ? `AND NOT EXISTS (
         SELECT 1 FROM promo_code_redemptions r
         JOIN promo_codes pg ON pg.id = r.promo_code_id
         WHERE r.user_id = ? AND ${groupCond.sql}
       )`
    : '';
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
          ${groupClause}`,
    args: [
      redemptionId,
      promoId,
      params.userPk,
      now.toISOString(),
      promoId,
      promoId,
      params.userPk,
      ...(groupCond ? [params.userPk, ...groupCond.args] : []),
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
