import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';
import {
  PAID_PLAN_TYPES as SHARED_PAID_PLAN_TYPES,
  PAID_USER_PLANS as SHARED_PAID_USER_PLANS,
} from '@alarmtalk/shared';

// ⚠ **원본은 `@alarmtalk/shared` 다**(2026-09-02). 같은 목록이 네 벌로 갈라져 있던 것을
// 공용 계약 패키지로 올렸다 — 여기는 기존 호출부를 위한 Set 어댑터일 뿐이다.
export const PAID_PLAN_TYPES = new Set<string>(SHARED_PAID_PLAN_TYPES);
const PAID_USER_PLANS = new Set<string>(SHARED_PAID_USER_PLANS);

/**
 * **그룹형 플랜인가** — 여러 명이 함께 쓰고 초대 코드를 발급하는 종류.
 *
 * ⚠ **`plan_type === 'family'` 를 "가족 상품" 으로 읽지 말 것.** 축이 셋이고 뜻이 다르다:
 *
 * | 컬럼 | 값 | 뜻 |
 * | --- | --- | --- |
 * | `plans.key` | personal / **couple** / family | 상품(가격·표시 이름) |
 * | `plans.plan_type` | personal / **family** | **행동 분류 — 그룹을 갖는가** |
 * | `plans.max_members` | 1 / **2** / 5 | 정원 |
 *
 * 커플은 `key='couple'` 인데 `plan_type='family'` 다 — **정원 2명짜리 그룹**이라는 뜻이지
 * 가족 상품이라는 뜻이 아니다. 그래서 그룹 생성·초대·해체·정원 계산이 커플에도 그대로
 * 적용된다(한 곳만 고치면 둘 다 고쳐진다).
 *
 * ⚠ **커플을 별도 `plan_type` 으로 빼지 말 것.** 이 판정을 쓰는 자리가 8곳인데, 나누면
 * 전부 `['family','couple'].includes(...)` 가 되고 **한 곳만 빠뜨려도 커플에서 조용히
 * 깨진다** — 이 저장소에서 반복된 사고가 정확히 그 모양이다.
 * 값 이름이 헷갈릴 뿐이라 읽는 쪽을 이 함수로 통일한다(값은 그대로 둔다 — SQLite 는
 * CHECK 제약을 ALTER 로 못 바꿔서 `plans` 테이블을 통째로 재작성해야 하는데,
 * `subscriptions`·`plan_groups` 등 4곳이 FK 로 물고 있다).
 */
export function isGroupPlanType(planType: string): boolean {
  return planType === 'family';
}

export function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  // ⚠ 커플도 여기서 'family' 가 된다(그룹형이라서). 화면에 보이는 이름은 `plans.key` 를
  //    읽어야 한다 — `users.plan` 은 **권한 등급**이지 상품 이름이 아니다.
  if (isGroupPlanType(planType)) return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

export function plannedMaxUses(planType: string, maxMembers: number): number {
  // 그룹형이면 정원에서 소유자를 뺀 만큼 초대 코드를 쓸 수 있다(커플이면 1장).
  if (isGroupPlanType(planType)) return Math.max(1, maxMembers - 1);
  return 1;
}

export function isPaidVoicePlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_USER_PLANS.has(plan);
}

export async function resolveUserPk(c: Context<AppEnv>): Promise<string | null> {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [userId],
  });
  if (res.rows.length === 0) return null;
  return String(res.rows[0]!.id);
}
