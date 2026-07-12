import type { DbExecutor } from './transactions';

// 직접 입력(사용자가 문구를 직접 타이핑) TTS 생성의 월 한도.
// 무료(free)는 애초에 직접 입력 자체가 유료 게이트(FREE_PLAN_PRESET_ONLY)로 차단되므로
// 여기 한도 맵에는 유료 플랜 key 만 둔다(누락 key = 0회).
//   - personal(개인) 30 / couple(커플) 50 / family(가족) 100.
// couple 은 plan_type='family' 이지만 plans.key 로만 구분되므로(=users.plan 은 couple↔family
// 를 못 가림) 반드시 활성 구독의 plans.key 로 판정한다.
export const MANUAL_TTS_MONTHLY_LIMITS: Record<string, number> = {
  personal: 30,
  couple: 50,
  family: 100,
};

export function manualTtsMonthlyLimit(planKey: string | null | undefined): number {
  if (!planKey) return 0;
  return MANUAL_TTS_MONTHLY_LIMITS[planKey] ?? 0;
}

// 월 경계는 KST(UTC+9) 기준. voice_profile_change_ledger 와 동일 규약.
const KST_MONTH_SQL = "strftime('%Y-%m', 'now', '+9 hours')";

export interface ManualTtsPool {
  // 공유 풀 식별자 — couple/family 는 plan_group_id(멤버 전원 공유), personal 은 본인 PK.
  poolKey: string;
  // 활성 유료 플랜 key(personal/couple/family) 또는 null(무료/미구독).
  planKey: string | null;
  limit: number;
}

/**
 * 호출자의 직접 입력 월 풀(공유 키 + 플랜 한도)을 해석한다.
 *  1) plan_group 소속(couple/family: 소유자·멤버 전원)이면 그룹 plan.key + 그룹 id 를 풀 키로.
 *  2) 아니면(personal) 본인 활성 구독의 plan.key + 본인 PK 를 풀 키로.
 * @param ownerIds 소유권 후보 [userPk, userId]. plan_group_members / subscriptions 는 users.id(PK)
 *   를 저장하지만 라우트에 따라 google sub 를 넘기는 경우도 있어 IN 으로 둘 다 매칭한다.
 * @param fallbackPoolKey personal/미구독일 때 풀 키(보통 userPk).
 */
export async function resolveManualTtsPool(
  db: DbExecutor,
  ownerIds: string[],
  fallbackPoolKey: string,
): Promise<ManualTtsPool> {
  const ph = ownerIds.map(() => '?').join(',');

  // 1) 공유 그룹(couple/family). 멤버는 자기 구독이 없을 수 있어 그룹 plan 을 봐야 한다.
  const group = await db.execute({
    sql: `SELECT pg.id AS group_id, p.key AS plan_key
          FROM plan_group_members m
          JOIN plan_groups pg ON pg.id = m.plan_group_id
          JOIN plans p ON p.id = pg.plan_id
          WHERE m.user_id IN (${ph})
          LIMIT 1`,
    args: ownerIds,
  });
  if (group.rows.length > 0) {
    const row = group.rows[0]!;
    const planKey = row.plan_key == null ? null : String(row.plan_key);
    return {
      poolKey: String(row.group_id),
      planKey,
      limit: manualTtsMonthlyLimit(planKey),
    };
  }

  // 2) 개인 구독(personal). 만료/비활성 제외.
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
  const planKey = sub.rows.length > 0 && sub.rows[0]!.plan_key != null
    ? String(sub.rows[0]!.plan_key)
    : null;
  return {
    poolKey: fallbackPoolKey,
    planKey,
    limit: manualTtsMonthlyLimit(planKey),
  };
}

export interface ManualTtsReservation {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
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
    return { ok: false, used: 0, limit, remaining: 0 };
  }
  const res = await db.execute({
    sql: `INSERT INTO manual_tts_usage (pool_key, usage_month, used_count, updated_at)
          VALUES (?, ${KST_MONTH_SQL}, 1, datetime('now'))
          ON CONFLICT(pool_key, usage_month) DO UPDATE SET
            used_count = used_count + 1,
            updated_at = datetime('now')
          WHERE manual_tts_usage.used_count < ?
          RETURNING used_count`,
    args: [poolKey, limit],
  });
  if (res.rows.length === 0) {
    return { ok: false, used: limit, limit, remaining: 0 };
  }
  const used = Number(res.rows[0]!.used_count ?? limit);
  return { ok: true, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * 이번 달 풀의 사용량을 읽는다(증가 없음). 조회 엔드포인트(남은 횟수 표시)용.
 */
export async function readManualTtsUsage(db: DbExecutor, poolKey: string): Promise<number> {
  const res = await db.execute({
    sql: `SELECT used_count FROM manual_tts_usage
          WHERE pool_key = ? AND usage_month = ${KST_MONTH_SQL}`,
    args: [poolKey],
  });
  return res.rows.length > 0 ? Number(res.rows[0]!.used_count ?? 0) : 0;
}

/**
 * 예약 후 생성이 실패했을 때 카운터를 1 되돌린다(환불). 0 밑으로는 내려가지 않는다.
 */
export async function refundManualTtsQuota(db: DbExecutor, poolKey: string): Promise<void> {
  await db.execute({
    sql: `UPDATE manual_tts_usage
          SET used_count = used_count - 1, updated_at = datetime('now')
          WHERE pool_key = ? AND usage_month = ${KST_MONTH_SQL} AND used_count > 0`,
    args: [poolKey],
  });
}
