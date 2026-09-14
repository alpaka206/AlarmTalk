import { describe, it, expect } from 'vitest';
import {
  coerceToPresetDays,
  isPresetQuietDays,
  isBlockedByFamilyAlarmQuietTime,
  normalizeQuietWindows,
  familyAlarmSettingsFromRow,
  validateQuietWindows,
  type FamilyAlarmSettings,
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

describe('isBlockedByFamilyAlarmQuietTime — 일회성 요일은 호출부가 계산한 발사 요일로 판정', () => {
  const weekendNight: FamilyAlarmSettings = {
    allowFamilyAlarms: true,
    quietDays: [0, 6],
    quietStart: '00:00',
    quietEnd: '08:00',
    quietWindows: [{ days: [0, 6], start: '00:00', end: '08:00' }],
  };

  it('일회성: 발사 요일(토=6)이 quiet 요일이면 차단', () => {
    expect(isBlockedByFamilyAlarmQuietTime('00:30', [], weekendNight, 6)).toBe(true);
  });

  it('일회성: 발사 요일(금=5)이 quiet 요일이 아니면 통과 — 서버 UTC 요일이 아닌 발사 요일 기준', () => {
    // UTC 금 15:30 = KST 토 00:30 케이스에서, 호출부가 수신자 시간대 발사 요일(6)을
    // 넘기면 차단되고 서버 요일(5)을 넘기면 통과 → 인자가 판정을 지배함을 확인.
    expect(isBlockedByFamilyAlarmQuietTime('00:30', [], weekendNight, 5)).toBe(false);
  });

  it('반복 알람은 repeat_days 로만 판정하고 일회성 발사 요일 인자를 무시', () => {
    expect(isBlockedByFamilyAlarmQuietTime('00:30', [3], weekendNight, 6)).toBe(false);
    expect(isBlockedByFamilyAlarmQuietTime('00:30', [0], weekendNight, 5)).toBe(true);
  });

  it('quiet 창이 비어 있으면 항상 통과', () => {
    const noWindows: FamilyAlarmSettings = { ...weekendNight, quietWindows: [] };
    expect(isBlockedByFamilyAlarmQuietTime('00:30', [], noWindows, 6)).toBe(false);
  });
});

describe('가입 직후 방해금지 시간', () => {
  // ⚠ 2026-08-08 규칙: **가입만으로 방해금지 시간이 생기지 않는다.**
  // 예전 기본값은 평일 09:00-18:30 이었다. 그래서 아무도 설정한 적 없는 시간대에 가족
  // 알람이 막혔고, 받는 사람은 자기가 막아 둔 줄 몰랐다. 되돌아가기 쉬운 규칙이라 고정한다.
  it('컬럼이 비면 창이 없다 — 기본 창을 만들어 내지 않는다', () => {
    expect(normalizeQuietWindows(undefined)).toEqual([]);
    expect(normalizeQuietWindows(null)).toEqual([]);
    expect(normalizeQuietWindows('')).toEqual([]);
    expect(normalizeQuietWindows('[]')).toEqual([]);
    expect(normalizeQuietWindows('망가진 JSON')).toEqual([]);
  });

  it('창이 없으면 어떤 시각도 막히지 않는다', () => {
    const settings = familyAlarmSettingsFromRow({
      allow_family_alarms: 1,
      family_alarm_quiet_windows: null,
    });
    expect(settings.quietWindows).toEqual([]);
    // 옛 기본 창의 한복판이던 시각도 통과해야 한다.
    expect(isBlockedByFamilyAlarmQuietTime('12:00', [1, 2, 3, 4, 5], settings, 3)).toBe(false);
    expect(isBlockedByFamilyAlarmQuietTime('09:30', [], settings, 1)).toBe(false);
  });
});
