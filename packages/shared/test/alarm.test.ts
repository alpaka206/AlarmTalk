import { describe, expect, it } from 'vitest';
import { AlarmTargetDateSchema, MANUAL_TTS_TEXT_MAX_LENGTH, isAlarmTargetDate } from '../src/index.js';

/** 날짜 지정 알람의 `target_date` 형식(`docs/spec/alarm-lifecycle.md` §4-7). */
describe('isAlarmTargetDate', () => {
  it.each([
    ['2026-10-27', true],
    ['2028-02-29', true],
    ['2026-12-31', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-10-00', false],
    ['2026-1-5', false],
    ['20261027', false],
    ['2026-10-27T07:00', false],
    ['1999-12-31', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isAlarmTargetDate(value)).toBe(expected);
  });

  it('문자열이 아니면 거절한다', () => {
    expect(isAlarmTargetDate(null)).toBe(false);
    expect(isAlarmTargetDate(20261027)).toBe(false);
  });

  it('지난 날짜도 형식만 맞으면 받는다 — 끝난 날짜 알람도 사본으로 올라온다', () => {
    expect(isAlarmTargetDate('2020-01-01')).toBe(true);
  });
});

describe('AlarmTargetDateSchema', () => {
  it('생략·null·실제 날짜를 받고 그 밖은 거절한다', () => {
    expect(AlarmTargetDateSchema.safeParse(undefined).success).toBe(true);
    expect(AlarmTargetDateSchema.safeParse(null).success).toBe(true);
    expect(AlarmTargetDateSchema.safeParse('2026-10-27').success).toBe(true);
    expect(AlarmTargetDateSchema.safeParse('2026-02-30').success).toBe(false);
  });
});

describe('MANUAL_TTS_TEXT_MAX_LENGTH', () => {
  it('직접 입력 상한은 200자다(두 앱의 입력창과 같은 값)', () => {
    expect(MANUAL_TTS_TEXT_MAX_LENGTH).toBe(200);
  });
});
