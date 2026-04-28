import { describe, it, expect } from 'vitest';
import { computeStreak, MILESTONE_BONUS_XP } from '../src/lib/streak';

describe('computeStreak', () => {
  it('첫 기상 (lastWakeupDate=null) → 스트릭 1', () => {
    const result = computeStreak(null, '2026-04-24', 0);
    expect(result).toEqual({
      newStreak: 1,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('같은 날 중복 호출 → 스트릭 유지, isNewDay=false', () => {
    const result = computeStreak('2026-04-24', '2026-04-24', 5);
    expect(result).toEqual({
      newStreak: 5,
      isNewDay: false,
      milestoneReached: null,
    });
  });

  it('연속 기상 (gap=1) → 스트릭 +1', () => {
    const result = computeStreak('2026-04-23', '2026-04-24', 3);
    expect(result).toEqual({
      newStreak: 4,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('2일 이상 빠지면 (gap≥2) → 스트릭 리셋 1', () => {
    const result = computeStreak('2026-04-22', '2026-04-24', 10);
    expect(result).toEqual({
      newStreak: 1,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('7일 마일스톤 달성', () => {
    const result = computeStreak('2026-04-23', '2026-04-24', 6);
    expect(result).toEqual({
      newStreak: 7,
      isNewDay: true,
      milestoneReached: 7,
    });
  });

  it('30일 마일스톤 달성', () => {
    const result = computeStreak('2026-04-23', '2026-04-24', 29);
    expect(result).toEqual({
      newStreak: 30,
      isNewDay: true,
      milestoneReached: 30,
    });
  });

  it('90일 마일스톤 달성', () => {
    const result = computeStreak('2026-04-23', '2026-04-24', 89);
    expect(result).toEqual({
      newStreak: 90,
      isNewDay: true,
      milestoneReached: 90,
    });
  });

  it('비마일스톤 연속 기상 → milestoneReached=null', () => {
    const result = computeStreak('2026-04-23', '2026-04-24', 7);
    expect(result).toEqual({
      newStreak: 8,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('월 경계 연속 (3월 31일 → 4월 1일)', () => {
    const result = computeStreak('2026-03-31', '2026-04-01', 5);
    expect(result).toEqual({
      newStreak: 6,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('연도 경계 연속 (12월 31일 → 1월 1일)', () => {
    const result = computeStreak('2025-12-31', '2026-01-01', 14);
    expect(result).toEqual({
      newStreak: 15,
      isNewDay: true,
      milestoneReached: null,
    });
  });

  it('리셋 후 첫 기상에서 마일스톤 도달 불가 (항상 1)', () => {
    const result = computeStreak('2026-04-20', '2026-04-24', 50);
    expect(result.newStreak).toBe(1);
    expect(result.milestoneReached).toBeNull();
  });

  it('gap이 매우 큰 경우에도 리셋', () => {
    const result = computeStreak('2025-01-01', '2026-04-24', 100);
    expect(result.newStreak).toBe(1);
    expect(result.isNewDay).toBe(true);
  });
});

describe('MILESTONE_BONUS_XP', () => {
  it('7일 보너스 = 100 XP', () => {
    expect(MILESTONE_BONUS_XP[7]).toBe(100);
  });

  it('30일 보너스 = 500 XP', () => {
    expect(MILESTONE_BONUS_XP[30]).toBe(500);
  });

  it('90일 보너스 = 2000 XP', () => {
    expect(MILESTONE_BONUS_XP[90]).toBe(2000);
  });

  it('마일스톤 3개만 존재', () => {
    expect(Object.keys(MILESTONE_BONUS_XP)).toHaveLength(3);
  });
});
