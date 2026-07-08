import { describe, it, expect } from 'vitest';
import {
  coerceToPresetDays,
  isPresetQuietDays,
  validateQuietWindows,
} from '../src/lib/family-alarm-settings';

describe('coerceToPresetDays (레거시 개별 요일 → 프리셋 흡수, PR #536 P2)', () => {
  it('정확히 프리셋이면 정렬형 그대로', () => {
    expect(coerceToPresetDays([5, 4, 3, 2, 1])).toEqual([1, 2, 3, 4, 5]);
    expect(coerceToPresetDays([6, 0])).toEqual([0, 6]);
    expect(coerceToPresetDays([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('평일 일부만 → 평일 프리셋', () => {
    expect(coerceToPresetDays([1, 3, 5])).toEqual([1, 2, 3, 4, 5]);
  });

  it('주말만 → 주말 프리셋', () => {
    expect(coerceToPresetDays([6])).toEqual([0, 6]);
  });

  it('평일+주말 혼합 → 매일 프리셋', () => {
    expect(coerceToPresetDays([0, 3])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('coerce 결과는 항상 프리셋', () => {
    for (const days of [[1, 3, 5], [2], [0, 4], [6], [1, 2, 6]]) {
      expect(isPresetQuietDays(coerceToPresetDays(days))).toBe(true);
    }
  });
});

describe('validateQuietWindows (레거시 개별 요일을 거부 아닌 흡수)', () => {
  it('레거시 개별 요일 창을 400 거부하지 않고 프리셋으로 흡수해 저장한다', () => {
    const result = validateQuietWindows([{ days: [1, 3, 5], start: '22:00', end: '07:00' }]);
    expect(result).not.toBeNull();
    expect(result![0]!.days).toEqual([1, 2, 3, 4, 5]);
    expect(result![0]!.start).toBe('22:00');
  });

  it('요일 비었거나 시간 형식이 틀리면 여전히 거부(null)', () => {
    expect(validateQuietWindows([{ days: [], start: '22:00', end: '07:00' }])).toBeNull();
    expect(validateQuietWindows([{ days: [1, 2, 3, 4, 5], start: 'bad', end: '07:00' }])).toBeNull();
  });

  it('창 개수 상한(2) 초과는 거부', () => {
    const three = Array.from({ length: 3 }, () => ({ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }));
    expect(validateQuietWindows(three)).toBeNull();
  });
});
