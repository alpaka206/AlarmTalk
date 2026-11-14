/**
 * **관리자 기간 지급의 SQL 조각** — `lib/plan-grants.ts` 와 결제 판정(`lib/billing-cancel.ts`)이 함께 쓴다.
 * 둘이 서로를 import 하지 않게 조각만 여기 따로 둔다(이 파일은 아무것도 import 하지 않는다).
 *
 * 인자로 받는 식(`userPkExpr`·`alias`)은 **개발자 고정 조각만** 넣는다(`?`·`u.id`·`users` 등) — 사용자 값을 넣지
 * 않는다(CLAUDE.md 「SQL은 항상 ?-바인딩」).
 *
 * 시각은 ISO 8601(`…Z`)로 적고 `julianday` 로 비교한다 — 문자열 비교는 `datetime('now')` 의 공백 형식과 섞이면
 * 어긋난다.
 */

/** 지금 유효한(회수되지 않았고 `[starts_at, ends_at)` 안인) 지급이 있는가. */
export function activePlanGrantExistsSql(userPkExpr: string): string {
  return `EXISTS (SELECT 1 FROM plan_grants g
    WHERE g.user_id = ${userPkExpr} AND g.revoked_at IS NULL
      AND julianday(g.starts_at) <= julianday('now') AND julianday('now') < julianday(g.ends_at))`;
}

/**
 * 원시 `plan` 에 지급을 반영한 값 — 원시가 정확히 `'free'` 이고 유효한 지급이 있으면 `'plus'`, 그 밖에는 원시
 * 그대로다(`null`·유료는 손대지 않는다). 기간 한정 개인 플랜(`computedUserPlan`)은 이 값 위에 얹는다.
 *
 * ⚠ **읽기 전용**이다 — 표시와 내 개인 기능 게이트. `users.plan` 에 쓰는 경로는 언제나 원시 `plan` 을 본다.
 */
export function planWithGrantSql(alias: string): string {
  return `CASE WHEN ${alias}.plan = 'free' AND ${activePlanGrantExistsSql(`${alias}.id`)} THEN 'plus' ELSE ${alias}.plan END`;
}
