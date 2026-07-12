import type { DbExecutor } from './transactions';

// 직접 입력(사용자가 문구를 직접 타이핑) TTS 생성의 월 한도.
// 무료(free)는 애초에 직접 입력 자체가 유료 게이트(FREE_PLAN_PRESET_ONLY)로 차단되므로
// 여기 한도 맵에는 유료 플랜 key 만 둔다(누락 key = 0회).
//   - personal(개인) 30 / couple(커플) 50 / family(가족) 100.
// couple 은 plan_type='family' 이지만 plans.key 로만 구분되므로(=users.plan 은 couple↔family
// 를 못 가림) 활성 구독/그룹의 plans.key 로 정밀 판정한다.
export const MANUAL_TTS_MONTHLY_LIMITS: Record<string, number> = {
  personal: 30,
  couple: 50,
  family: 100,
};

export function manualTtsMonthlyLimit(planKey: string | null | undefined): number {
  if (!planKey) return 0;
  return MANUAL_TTS_MONTHLY_LIMITS[planKey] ?? 0;
}

// users.plan(무료/plus/family) → plans.key 근사. 활성 구독/그룹을 못 찾았을 때의 폴백용.
// 페이월(isPaidVoicePlan)은 users.plan 을 신뢰하므로, 미터링도 같은 출처로 폴백해야
// 결제 사용자가 허위로 차단되지 않는다. couple 은 users.plan 에서 family 로 접히므로
// 폴백 시 family(100)로 후하게 준다(차단보다 과지급이 나은 실패 모드, 드문 경계 케이스).
const USER_PLAN_TO_KEY: Record<string, string> = {
  plus: 'personal',
  family: 'family',
};

export function manualTtsLimitForUserPlan(userPlan: string | null | undefined): number {
  const key = userPlan ? USER_PLAN_TO_KEY[userPlan] : undefined;
  return manualTtsMonthlyLimit(key ?? null);
}

// 월 경계는 KST(UTC+9) 기준. voice_profile_change_ledger 와 동일 규약.
const KST_MONTH_SQL = "strftime('%Y-%m', 'now', '+9 hours')";

export interface ManualTtsPool {
  // 공유 풀 식별자 — couple/family 는 plan_group_id(멤버 전원 공유), personal 은 본인 PK.
  poolKey: string;
  // 판정된 플랜 key(personal/couple/family) 또는 null.
  planKey: string | null;
  limit: number;
}

/**
 * 호출자의 직접 입력 월 풀(공유 키 + 플랜 한도)을 해석한다. (미터링은 이미 페이월을 통과한
 * 유료 요청에서만 호출된다.)
 *  1) 활성 구독이 붙은 plan_group 소속(couple/family)이면 그룹 plan.key + 그룹 id 공유 풀.
 *  2) 아니면 본인 활성 구독의 plan.key + 본인 PK.
 *  3) 둘 다 못 찾으면(구독 상태 지연 등) 페이월과 같은 출처인 users.plan 으로 폴백해
 *     결제 사용자가 허위 429 를 받지 않게 한다.
 * @param ownerIds 소유권 후보 [userPk, userId]. plan_group_members / subscriptions 는 users.id(PK)
 *   를 저장하지만 라우트에 따라 google sub 를 넘기는 경우도 있어 IN 으로 둘 다 매칭한다.
 * @param fallbackPoolKey 그룹이 아닐 때 풀 키(보통 userPk).
 * @param fallbackUserPlan users.plan(폴백 한도 산정용).
 */
export async function resolveManualTtsPool(
  db: DbExecutor,
  ownerIds: string[],
  fallbackPoolKey: string,
  fallbackUserPlan: string | null | undefined,
): Promise<ManualTtsPool> {
  const ph = ownerIds.map(() => '?').join(',');

  // 1) 공유 그룹(couple/family) — 그룹에 활성·미만료 구독이 붙어 있어야 유효.
  //    ORDER BY 로 다중 그룹 소속 시에도 결정적으로 한 풀을 고른다.
  const group = await db.execute({
    sql: `SELECT pg.id AS group_id, p.key AS plan_key
          FROM plan_group_members m
          JOIN plan_groups pg ON pg.id = m.plan_group_id
          JOIN plans p ON p.id = pg.plan_id
          JOIN subscriptions s ON s.plan_group_id = pg.id
            AND s.status = 'active'
            AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
          WHERE m.user_id IN (${ph})
          ORDER BY pg.id
          LIMIT 1`,
    args: ownerIds,
  });
  if (group.rows.length > 0 && group.rows[0]!.plan_key != null) {
    const planKey = String(group.rows[0]!.plan_key);
    return {
      poolKey: String(group.rows[0]!.group_id),
      planKey,
      limit: manualTtsMonthlyLimit(planKey),
    };
  }

  // 2) 개인 활성 구독.
  const sub = await db.execute({
    sql: `SELECT p.key AS plan_key
          FROM subscriptions s
          JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id IN (${ph})
            AND s.status = 'active'
            AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
          ORDER BY s.expires_at DESC
          LIMIT 1`,
    args: ownerIds,
  });
  if (sub.rows.length > 0 && sub.rows[0]!.plan_key != null) {
    const planKey = String(sub.rows[0]!.plan_key);
    return {
      poolKey: fallbackPoolKey,
      planKey,
      limit: manualTtsMonthlyLimit(planKey),
    };
  }

  // 3) 폴백 — 페이월(users.plan)은 통과했는데 구독/그룹을 못 찾은 경우(상태 지연 등).
  const fallbackKey = fallbackUserPlan ? USER_PLAN_TO_KEY[fallbackUserPlan] ?? null : null;
  return {
    poolKey: fallbackPoolKey,
    planKey: fallbackKey,
    limit: manualTtsMonthlyLimit(fallbackKey),
  };
}

export interface ManualTtsReservation {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  // 예약이 증가시킨 월(YYYY-MM, KST). 실패 시 환불을 정확한 월에 하기 위해 되돌려준다.
  month: string | null;
}

/**
 * 이번 달 직접 입력 카운터를 원자적으로 1 증가시킨다(한도 초과면 증가하지 않음).
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE used_count < limit RETURNING 으로
 * 조회+증가+한도판정을 단일 왕복에 처리한다(경합 안전).
 *  - 첫 사용(무충돌): used_count=1 삽입 → ok.
 *  - 재사용 & 여유: used_count+1 → ok.
 *  - 재사용 & 한도도달: WHERE 불성립 → 변경 0행 → RETURNING 없음 → ok=false.
 * 캐시 히트는 호출 전에 걸러야 한다(히트는 소비 없음).
 */
export async function reserveManualTtsQuota(
  db: DbExecutor,
  poolKey: string,
  limit: number,
): Promise<ManualTtsReservation> {
  if (limit <= 0) {
    return { ok: false, used: 0, limit, remaining: 0, month: null };
  }
  const res = await db.execute({
    sql: `INSERT INTO manual_tts_usage (pool_key, usage_month, used_count, updated_at)
          VALUES (?, ${KST_MONTH_SQL}, 1, datetime('now'))
          ON CONFLICT(pool_key, usage_month) DO UPDATE SET
            used_count = used_count + 1,
            updated_at = datetime('now')
          WHERE manual_tts_usage.used_count < ?
          RETURNING used_count, usage_month`,
    args: [poolKey, limit],
  });
  if (res.rows.length === 0) {
    return { ok: false, used: limit, limit, remaining: 0, month: null };
  }
  const used = Number(res.rows[0]!.used_count ?? limit);
  const month = res.rows[0]!.usage_month == null ? null : String(res.rows[0]!.usage_month);
  return { ok: true, used, limit, remaining: Math.max(0, limit - used), month };
}

/**
 * 예약 후 생성이 실패했을 때 카운터를 1 되돌린다(환불). 예약이 증가시킨 바로 그 월을
 * 인자로 받아, 월 경계를 넘겨 실패해도 정확한 행을 되돌린다. 0 밑으론 안 내려간다.
 */
export async function refundManualTtsQuota(
  db: DbExecutor,
  poolKey: string,
  usageMonth: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE manual_tts_usage
          SET used_count = used_count - 1, updated_at = datetime('now')
          WHERE pool_key = ? AND usage_month = ? AND used_count > 0`,
    args: [poolKey, usageMonth],
  });
}
