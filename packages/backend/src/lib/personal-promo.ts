import {
  isPersonalPromoActive,
  PERSONAL_PROMO,
  personalPromoNoticeFrom,
  userPlanWithPromo,
  type PersonalPromo,
  type PersonalPromoWindow,
} from '@alarmtalk/shared';
import type { Env } from '../types';
import type { DbExecutor } from './transactions';

/**
 * **기간 한정 개인 플랜 — 서버 쪽 계산층.** 규칙 전문: `docs/spec/billing-lifecycle.md`
 * 「기간 한정 개인 플랜」.
 *
 * 원시 `users.plan` 은 **건드리지 않는다.** 읽을 때만 "원시 free 이고 구간 안이면 plus" 로
 * 계산한다. 경계 판정은 shared 의 `isPersonalPromoActive`·`userPlanWithPromo` 가 유일 출처이고,
 * 여기서는 그 구간을 워커 바인딩에서 푼다.
 *
 * - 시작: `PERSONAL_PROMO_STARTS_AT` — 운영 스위치. 없거나 못 읽으면 **꺼짐**.
 * - 끝: shared 상수. dev·테스트만 `PERSONAL_PROMO_ENDS_AT` 로 덮어쓸 수 있다(리허설).
 */
type PromoEnv = Partial<
  Pick<Env, 'PERSONAL_PROMO_STARTS_AT' | 'PERSONAL_PROMO_ENDS_AT' | 'ENVIRONMENT'>
>;

/**
 * 시간대를 **반드시** 가진 ISO 8601 만 받는다. `Date.parse` 는 `2026-10-05` 를 UTC 자정으로,
 * `2026-10-05T00:00` 을 **워커의 지역 시간**으로 읽는다 — 운영 스위치가 9시간 어긋나는 걸
 * 조용히 받아 주지 않게, 모양이 맞지 않으면 못 읽은 것으로 본다(→ 꺼짐).
 */
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseInstant(raw: string | undefined): Date | null | 'invalid' {
  const value = raw?.trim();
  if (!value) return null;
  if (!ISO_WITH_ZONE.test(value)) return 'invalid';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : 'invalid';
}

/**
 * 워커 바인딩에서 프로모 구간을 푼다. **`null` = 꺼짐**(fail-closed):
 * 시작이 없음·빈 값·해석 불가, 리허설 끝이 해석 불가, 또는 시작이 끝보다 늦지 않음.
 *
 * ⚠ `ENVIRONMENT = production` 이면 `PERSONAL_PROMO_ENDS_AT` 을 **읽지 않는다.** 제품의 끝은
 * shared 상수 하나다 — 운영에 리허설 값이 남아 조기 종료·연장되는 사고를 여기서 막는다.
 */
export function resolvePersonalPromoWindow(env: PromoEnv | undefined): PersonalPromoWindow | null {
  const startsAt = parseInstant(env?.PERSONAL_PROMO_STARTS_AT);
  if (!startsAt || startsAt === 'invalid') return null;
  let endsAt = new Date(PERSONAL_PROMO.endsAt);
  if (env?.ENVIRONMENT !== 'production') {
    const override = parseInstant(env?.PERSONAL_PROMO_ENDS_AT);
    // 리허설 값을 **일부러 넣었는데** 못 읽었으면 상수로 조용히 돌아가지 않는다 — 리허설이
    // 엉뚱한 날짜로 돌아간 줄 모른다. 꺼 두고 드러낸다.
    if (override === 'invalid') return null;
    if (override) endsAt = override;
  }
  if (startsAt.getTime() >= endsAt.getTime()) return null;
  return { startsAt, endsAt };
}

/**
 * **종료 전환·종료 스윕 전용 크론**(1분) — `wrangler.toml` 의 두 환경과 `index.ts` 의 분기가 이
 * 문자열을 본다(`test/personal-promo-end.test.ts` 가 셋을 대조한다). 여기 두는 이유: 크론 분기는
 * 매 실행 도는데, 구현(`lib/personal-promo-end.ts`)은 그 분기에 들어섰을 때만 불러오려고.
 */
export const PERSONAL_PROMO_END_CRON = '* * * * *';

/** 요청·크론 실행마다 **한 번** 풀어 판정 자리들에 넘기는 값. */
export interface PersonalPromoState {
  window: PersonalPromoWindow | null;
  now: Date;
  /** 이 시각에 원시 free 를 개인으로 읽는가. */
  active: boolean;
}

export function resolvePersonalPromo(
  env: PromoEnv | undefined,
  now: Date = new Date(),
): PersonalPromoState {
  const window = resolvePersonalPromoWindow(env);
  return { window, now, active: isPersonalPromoActive(window, now) };
}

/**
 * **보관 판정**(`hasActivePaidEntitlement`·`retentionSyncStatements` 등)에 넘기는 불리언 —
 * "지금 프로모가 원시 free 를 개인으로 덮는가". 결제 경로는 env 를 끝까지 들고 가지 않으므로
 * 호출부 가장자리에서 이걸로 풀어 넘긴다.
 */
export function personalPromoCoversFree(
  env: PromoEnv | undefined,
  now: Date = new Date(),
): boolean {
  return resolvePersonalPromo(env, now).active;
}

/**
 * 응답에 싣는 **계산된** `plan`. 원시 free 이고 구간 안이면 `plus`, 그 밖에는 원시 그대로다.
 * ⚠ `users.plan` 에 **쓰는** 경로에는 쓰지 말 것 — 쓰기는 언제나 원시값이다.
 */
export function computedUserPlan<P extends string | null | undefined>(
  rawPlan: P,
  promo: PersonalPromoState,
): P | typeof PERSONAL_PROMO.userPlan {
  return userPlanWithPromo(rawPlan, promo.window, promo.now);
}

/** 초 단위 UTC ISO(`…T15:00:00Z`) — 두 앱의 파서가 소수 초 없이도 읽게. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * **`status = 'active'` 구독 행이 있는가** — SQL 조각(`userPkExpr` 는 개발자 고정 식별자만).
 *
 * 종료 전환 대상(`PROMO_END_TARGET`)과 응답의 `deletes_voices_at_end` 가 **같은 조건**을 봐야
 * 한다 — 둘이 갈라지면 앱은 "목소리는 3일 보관 후 삭제돼요" 라고 말했는데 서버는 지우지 않거나,
 * 반대로 말없이 지운다. 만료 시각은 보지 않는다: 결제 보류(ON_HOLD·PAUSED)는 행을 `active`
 * 로 남긴 채 `users.plan` 만 회수하고, 보류는 회복형이라 보관을 걸지 않는다.
 */
export function activeSubscriptionRowExistsSql(userPkExpr: string): string {
  return `EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = ${userPkExpr} AND s.status = 'active')`;
}

/**
 * API 의 `personal_promo` 조각. **원시 plan 이 free 이고 구간 안일 때만** 값이 있다 —
 * 결제자·꺼짐·끝난 뒤에는 `null`.
 *
 * 결제 보류 계정(원시 free + `active` 구독 행)에도 값이 **있다** — 앱은 이 값의 존재로 "원시
 * plan 이 free 다" 를 알고, 남은 구독 행으로 커플·가족 등급을 올리지 않는다(보류 규칙). 대신
 * `deletes_voices_at_end` 가 `false` 라 종료 안내가 삭제를 말하지 않는다.
 */
export function personalPromoField(
  rawPlan: string | null | undefined,
  promo: PersonalPromoState,
  standing: {
    /** `status = 'active'` 구독 행이 있는가 — [activeSubscriptionRowExistsSql] 과 같은 조건. */
    hasActiveSubscriptionRow: boolean;
  },
): PersonalPromo | null {
  if (rawPlan !== 'free' || !promo.active || !promo.window) return null;
  return {
    ends_at: isoSeconds(promo.window.endsAt),
    notice_from: isoSeconds(personalPromoNoticeFrom(promo.window.endsAt)),
    deletes_voices_at_end: !standing.hasActiveSubscriptionRow,
  };
}

/**
 * [personalPromoField] 를 DB 에서 구독 행 여부를 읽어 채운다. **원시 free 이고 구간 안일 때만**
 * 한 번 읽는다 — 결제자·평상시 응답에는 DB 왕복을 더하지 않는다.
 */
export async function loadPersonalPromoField(
  db: Pick<DbExecutor, 'execute'>,
  userPk: string,
  rawPlan: string | null | undefined,
  promo: PersonalPromoState,
): Promise<PersonalPromo | null> {
  if (rawPlan !== 'free' || !promo.active || !promo.window) return null;
  const res = await db.execute({
    sql: `SELECT ${activeSubscriptionRowExistsSql('?')} AS has_row`,
    args: [userPk],
  });
  return personalPromoField(rawPlan, promo, {
    hasActiveSubscriptionRow: Number(res.rows[0]?.has_row ?? 0) === 1,
  });
}
