import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';
import { computedUserPlan, type PersonalPromoState } from '../lib/personal-promo';
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

/**
 * **원시** `users.plan` 이 유료인가 — 기간 한정 개인 플랜을 **반영하지 않는다.**
 *
 * 쓰는 자리: 커플·가족 기능(공유 목소리 프리셋 갈래 `messageBelongsToCaller` ↔ 오디오
 * 라우트의 남의 목소리, 보낸 알람·가족 알람 발신자). 결제 보류(ON_HOLD/PAUSED) 그룹은
 * 소유자 `users.plan` 만 free 로 회수하고 그룹·`is_shared` 를 그대로 두므로, 여기를 계산값으로
 * 바꾸면 기간 동안 보류 그룹의 공유 목소리·가족 알람이 되살아난다.
 * 내 개인 기능은 [hasPersonalVoiceAccess] 를 쓴다. 스펙: `docs/spec/billing-lifecycle.md`
 * 「기간 한정 개인 플랜」의 계산값/원시값 표.
 */
export function isPaidVoicePlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_USER_PLANS.has(plan);
}

/**
 * **내 개인 목소리 기능**을 쓸 수 있는가 — 원시 `users.plan` 에 기간 한정 개인 플랜을
 * 반영해 판정한다(원시 free 이고 구간 안이면 개인).
 *
 * 쓰는 자리: 클론 등록·초안 승격·제자리 교체, 음성 업로드, `/tts/generate` 의 무료 제한,
 * 내 알람 저장·수정의 목소리 게이트, 오디오 라우트의 **본인 목소리** 갈래.
 * ⚠ 커플·가족 갈래에는 쓰지 말 것 — [isPaidVoicePlan] 주석.
 */
export function hasPersonalVoiceAccess(plan: unknown, promo: PersonalPromoState): boolean {
  if (typeof plan !== 'string') return false;
  return isPaidVoicePlan(computedUserPlan(plan, promo));
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
