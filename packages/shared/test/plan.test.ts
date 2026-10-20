// 플랜 상수 — 유일 출처는 `src/schemas/plan.ts`. 두 앱의 손 사본은 `scripts/check-plan-constants.py` 가 대조한다.
// 남은 플랜은 무료와 개인 둘이다(커플·가족 이용권은 2026-10-20 에 없앴다).
import { describe, expect, it } from 'vitest';
import {
  PAID_PLAN_TYPES,
  PAID_USER_PLANS,
  PLAN_TYPES,
  USER_PLANS,
  UserPlanSchema,
  isPaidUserPlan,
} from '../src/index.js';

describe('플랜 상수 — 무료와 개인만', () => {
  it('유료 등급은 개인 플랜 하나다', () => {
    expect(PAID_USER_PLANS).toEqual(['personal', 'plus']);
    expect(USER_PLANS).toEqual(['free', 'personal', 'plus']);
    expect(PAID_PLAN_TYPES).toEqual(['personal']);
    expect(PLAN_TYPES).toEqual(['free', 'personal']);
  });

  it('isPaidUserPlan — 개인은 유료, 무료와 옛 그룹 등급은 아니다', () => {
    expect(isPaidUserPlan('plus')).toBe(true);
    expect(isPaidUserPlan('personal')).toBe(true);
    expect(isPaidUserPlan(' Plus ')).toBe(true);
    expect(isPaidUserPlan('free')).toBe(false);
    expect(isPaidUserPlan('family')).toBe(false);
    expect(isPaidUserPlan('couple')).toBe(false);
    expect(isPaidUserPlan('')).toBe(false);
    expect(isPaidUserPlan(null)).toBe(false);
    expect(isPaidUserPlan(undefined)).toBe(false);
  });

  it('UserPlanSchema 는 옛 그룹 등급을 받지 않는다', () => {
    expect(UserPlanSchema.safeParse('plus').success).toBe(true);
    expect(UserPlanSchema.safeParse('family').success).toBe(false);
    expect(UserPlanSchema.safeParse('couple').success).toBe(false);
  });
});
