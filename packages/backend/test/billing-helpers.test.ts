import { describe, it, expect } from 'vitest';
import { planTypeToUserPlan, PAID_PLAN_TYPES } from '../src/routes/billing-helpers';

describe('PAID_PLAN_TYPES', () => {
  it('contains personal and family', () => {
    expect(PAID_PLAN_TYPES.has('personal')).toBe(true);
    expect(PAID_PLAN_TYPES.has('family')).toBe(true);
  });

  it('does not contain free', () => {
    expect(PAID_PLAN_TYPES.has('free')).toBe(false);
  });
});

describe('planTypeToUserPlan', () => {
  it('maps family to family', () => {
    expect(planTypeToUserPlan('family')).toBe('family');
  });

  it('maps personal to plus', () => {
    expect(planTypeToUserPlan('personal')).toBe('plus');
  });

  it('maps unknown types to free', () => {
    expect(planTypeToUserPlan('free')).toBe('free');
    expect(planTypeToUserPlan('enterprise')).toBe('free');
    expect(planTypeToUserPlan('')).toBe('free');
  });
});
