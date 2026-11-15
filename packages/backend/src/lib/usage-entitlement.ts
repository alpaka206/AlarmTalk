/**
 * **사용 기록의 권한 출처** — `docs/spec/usage-events.md` §7.2.
 *
 * 앱이 아니라 서버가 **기록을 받는 순간** 계정 상태로 하나를 고른다. 한 사람이 여러 권한을 겹쳐 가져도 기록 한 건에는
 * 값이 하나라, 출처별 사람 수를 더해도 같은 사람이 두 번 세지지 않는다(지시서 10.2 "겹친 사용자 수를 중복 집계하지
 * 않는다"). 우선순위는 `paid` > `trial` > `admin` > `promo` > `free` — 실제 결제를 가장 먼저 본다.
 *
 * ⚠ **`trial` 은 아직 찍히지 않는다.** 서버의 구독 행에는 스토어 무료 체험 구간을 가르는 표식이 없다(스토어 무료
 *   체험 작업이 그 표식을 넣는다). 그 전까지 체험 중인 구독은 `paid` 로 섞인다 — 체험과 결제의 구분은 앱이 스토어에서
 *   읽어 보내는 `store_purchase_verified` 의 `store_offer` 로 본다(관리자 「결제」 칸). 표식이 생기면 아래
 *   [ENTITLEMENT_SOURCE_SQL] 의 `paid` 갈래 앞에 `trial` 갈래 하나를 더한다.
 *
 * ⚠ 며칠 밀려 올라온 배치는 그 사이 바뀐 권한을 모른다 — 값은 '받은 시각의 권한' 이다.
 */
import type { EntitlementSource } from '@alarmtalk/shared';
import { activePlanGrantExistsSql } from './plan-grant-sql';
import { resolvePersonalPromo } from './personal-promo';
import type { DbExecutor } from './transactions';
import type { Env } from '../types';

/**
 * 결제 보류(ON_HOLD·PAUSED — 행은 `active` 인데 `entitlement_state` 가 막힘)는 결제 권한이 아니다. 그 사람은 원시 plan 도
 * free 로 돌아가 있어 아래에서 promo/free 로 간다.
 */
const ENTITLEMENT_SOURCE_SQL = `SELECT u.plan AS raw_plan,
    EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
      AND COALESCE(s.entitlement_state, 'entitled') = 'entitled') AS has_subscription,
    ${activePlanGrantExistsSql('u.id')} AS has_grant
  FROM users u WHERE u.id = ?`;

export function entitlementSourceFrom(input: {
  rawPlan: string | null | undefined;
  hasSubscription: boolean;
  hasGrant: boolean;
  promoActive: boolean;
}): EntitlementSource {
  if (input.hasSubscription) return 'paid';
  if (input.hasGrant) return 'admin';
  // 원시가 유료인데 권한 있는 구독 행이 없는 옛 계정도 결제로 본다(원시 plan 은 스토어 흐름만 올린다).
  if (input.rawPlan && input.rawPlan !== 'free') return 'paid';
  if (input.promoActive) return 'promo';
  return 'free';
}

export async function loadEntitlementSource(
  db: Pick<DbExecutor, 'execute'>,
  env: Partial<Pick<Env, 'PERSONAL_PROMO_STARTS_AT' | 'PERSONAL_PROMO_ENDS_AT' | 'ENVIRONMENT'>> | undefined,
  userPk: string,
  now: Date = new Date(),
): Promise<EntitlementSource> {
  const res = await db.execute({ sql: ENTITLEMENT_SOURCE_SQL, args: [userPk] });
  const row = (res.rows[0] ?? {}) as Record<string, unknown>;
  return entitlementSourceFrom({
    rawPlan: row.raw_plan == null ? null : String(row.raw_plan),
    hasSubscription: Number(row.has_subscription ?? 0) === 1,
    hasGrant: Number(row.has_grant ?? 0) === 1,
    promoActive: resolvePersonalPromo(env, now).active,
  });
}
