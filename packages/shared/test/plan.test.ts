// 플랜 상수 — 유일 출처는 `src/schemas/plan.ts`. 두 앱의 손 사본은 `scripts/check-plan-constants.py` 가 대조한다.
// 남은 플랜은 무료와 개인 둘이다(커플·가족 이용권은 2026-10-20 에 없앴다).
import { describe, expect, it } from 'vitest';
import { PAID_PLAN_TYPES, PAID_USER_PLANS } from '../src/index.js';

describe('플랜 상수 — 무료와 개인만', () => {
  it('유료 등급은 개인 플랜 하나다', () => {
    expect(PAID_USER_PLANS).toEqual(['personal', 'plus']);
    expect(PAID_PLAN_TYPES).toEqual(['personal']);
  });
});
