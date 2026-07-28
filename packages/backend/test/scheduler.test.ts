import { describe, it, expect } from 'vitest';
import {
  formatHHmm,
  localClockFor,
  shouldAlarmFire,
  selectFiringAlarms,
  type ScheduledAlarm,
} from '../src/lib/scheduler';

function makeAlarm(partial: Partial<ScheduledAlarm> = {}): ScheduledAlarm {
  return {
    id: partial.id ?? 'a1',
    user_id: partial.user_id ?? 'u1',
    time: partial.time ?? '07:00',
    repeat_days: partial.repeat_days ?? [],
    is_active: partial.is_active ?? true,
    mode: partial.mode ?? 'tts',
    voice_profile_id: partial.voice_profile_id ?? null,
    target_user_id: partial.target_user_id ?? null,
    // 기존 픽스처가 UTC 시각 기준이므로 명시. 기본값(Asia/Seoul) 동작은 별도 케이스에서 검증.
    timezone: partial.timezone !== undefined ? partial.timezone : 'UTC',
  };
}

// 2026-04-21 (화요일, UTC). Date.getUTCDay() 화요일 = 2
const tuesday0700 = new Date(Date.UTC(2026, 3, 21, 7, 0, 0));

describe('formatHHmm', () => {
  it('UTC 시/분을 2자리로 포맷한다', () => {
    expect(formatHHmm(new Date(Date.UTC(2026, 3, 21, 9, 5, 30)))).toBe('09:05');
    expect(formatHHmm(new Date(Date.UTC(2026, 3, 21, 23, 59, 0)))).toBe('23:59');
  });
});

describe('localClockFor', () => {
  it('UTC 시각을 Asia/Seoul(+9) 로컬 시계로 변환한다', () => {
    // UTC 화 22:00 = KST 수 07:00
    const clock = localClockFor(new Date(Date.UTC(2026, 3, 21, 22, 0, 0)), 'Asia/Seoul');
    expect(clock.minutesOfDay).toBe(7 * 60);
    expect(clock.dayOfWeek).toBe(3); // 수요일
  });

  it('timezone 미지정이면 Asia/Seoul 폴백', () => {
    const explicit = localClockFor(tuesday0700, 'Asia/Seoul');
    expect(localClockFor(tuesday0700, null)).toEqual(explicit);
    expect(localClockFor(tuesday0700, undefined)).toEqual(explicit);
  });

  it('잘못된 timezone 은 Asia/Seoul 폴백', () => {
    const explicit = localClockFor(tuesday0700, 'Asia/Seoul');
    expect(localClockFor(tuesday0700, 'Not/A_Zone_xx')).toEqual(explicit);
  });
});

describe('shouldAlarmFire', () => {
  it('시각 일치 + repeat_days 빈 배열이면 매일 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: [] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('윈도우(5분) 밖 시각이면 발화 안 함', () => {
    const alarm = makeAlarm({ time: '08:00' });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(false);
  });

  it('repeat_days 에 오늘 요일 포함이면 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: [1, 2, 3] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('repeat_days 에 오늘 요일 미포함이면 발화 안 함', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: [0, 6] }); // 일·토만
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(false);
  });

  it('is_active=false 면 발화 안 함', () => {
    const alarm = makeAlarm({ time: '07:00', is_active: false });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(false);
  });

  it('미래 시각(30분 뒤)은 발화 안 함', () => {
    const alarm = makeAlarm({ time: '07:30' });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(false);
  });
});

describe('shouldAlarmFire — 윈도우 매칭 (F1 수정)', () => {
  it('cron 이 5분 간격이어도 사이 분(07:02)을 놓치지 않는다', () => {
    // 07:05 실행 시 (07:00, 07:05] 윈도우 — 07:02 알람 포함.
    const cronAt0705 = new Date(Date.UTC(2026, 3, 21, 7, 5, 0));
    const alarm = makeAlarm({ time: '07:02' });
    expect(shouldAlarmFire(alarm, cronAt0705)).toBe(true);
  });

  it('직전 실행이 처리한 분(정확히 window 분 전)은 중복 발화하지 않는다', () => {
    // 07:05 실행의 윈도우는 (07:00, 07:05] — 07:00 은 07:00 실행이 이미 처리.
    const cronAt0705 = new Date(Date.UTC(2026, 3, 21, 7, 5, 0));
    const alarm = makeAlarm({ time: '07:00' });
    expect(shouldAlarmFire(alarm, cronAt0705)).toBe(false);
  });

  it('자정 래핑 — 00:02 실행이 23:59 알람을 잡는다', () => {
    const cronAt0002 = new Date(Date.UTC(2026, 3, 22, 0, 2, 0)); // 수요일 00:02 UTC
    const alarm = makeAlarm({ time: '23:59' });
    expect(shouldAlarmFire(alarm, cronAt0002)).toBe(true);
  });

  it('자정 래핑 시 요일은 발화일(어제) 기준으로 판정한다', () => {
    // 수요일 00:02 실행 → 23:59 알람의 발화일은 화요일(2).
    const cronAt0002 = new Date(Date.UTC(2026, 3, 22, 0, 2, 0));
    expect(shouldAlarmFire(makeAlarm({ time: '23:59', repeat_days: [2] }), cronAt0002)).toBe(true);
    expect(shouldAlarmFire(makeAlarm({ time: '23:59', repeat_days: [3] }), cronAt0002)).toBe(false);
  });

  it('windowMinutes 파라미터로 윈도우 폭을 바꿀 수 있다', () => {
    const cronAt0710 = new Date(Date.UTC(2026, 3, 21, 7, 10, 0));
    const alarm = makeAlarm({ time: '07:02' });
    expect(shouldAlarmFire(alarm, cronAt0710, 5)).toBe(false);
    expect(shouldAlarmFire(alarm, cronAt0710, 10)).toBe(true);
  });
});

describe('shouldAlarmFire — timezone (F1 수정)', () => {
  it('Asia/Seoul 알람은 KST 로컬 시각으로 판정한다', () => {
    // UTC 화 22:00 = KST 수 07:00 → KST 07:00 알람 발화.
    const utc2200 = new Date(Date.UTC(2026, 3, 21, 22, 0, 0));
    const alarm = makeAlarm({ time: '07:00', timezone: 'Asia/Seoul' });
    expect(shouldAlarmFire(alarm, utc2200)).toBe(true);
    // 같은 순간 UTC 알람 07:00 은 발화하지 않는다.
    expect(shouldAlarmFire(makeAlarm({ time: '07:00', timezone: 'UTC' }), utc2200)).toBe(false);
  });

  it('timezone null 이면 Asia/Seoul 기본값으로 판정한다', () => {
    const utc2200 = new Date(Date.UTC(2026, 3, 21, 22, 0, 0));
    const alarm = makeAlarm({ time: '07:00', timezone: null });
    expect(shouldAlarmFire(alarm, utc2200)).toBe(true);
  });

  it('요일 판정도 timezone 로컬 기준이다', () => {
    // UTC 화 22:00 = KST 수(3) 07:00.
    const utc2200 = new Date(Date.UTC(2026, 3, 21, 22, 0, 0));
    expect(
      shouldAlarmFire(makeAlarm({ time: '07:00', timezone: 'Asia/Seoul', repeat_days: [3] }), utc2200),
    ).toBe(true);
    expect(
      shouldAlarmFire(makeAlarm({ time: '07:00', timezone: 'Asia/Seoul', repeat_days: [2] }), utc2200),
    ).toBe(false);
  });
});

describe('selectFiringAlarms', () => {
  it('여러 알람 중 해당 시각·요일에 맞는 것만 추린다', () => {
    const alarms: ScheduledAlarm[] = [
      makeAlarm({ id: 'a', time: '07:00', repeat_days: [2] }), // 화요일 매칭
      makeAlarm({ id: 'b', time: '07:00', is_active: false }), // 비활성
      makeAlarm({ id: 'c', time: '08:00' }), // 시각 미일치
      makeAlarm({ id: 'd', time: '07:00', repeat_days: [] }), // 매일
      makeAlarm({ id: 'e', time: '07:00', repeat_days: [0, 6] }), // 주말만
    ];
    const fired = selectFiringAlarms(alarms, tuesday0700);
    expect(fired.map((x) => x.id).sort()).toEqual(['a', 'd']);
  });

  it('빈 배열이면 빈 결과', () => {
    expect(selectFiringAlarms([], tuesday0700)).toEqual([]);
  });

  it('모든 알람이 발화 조건에 해당하면 전부 반환', () => {
    const alarms = [
      makeAlarm({ id: 'x', time: '07:00', repeat_days: [] }),
      makeAlarm({ id: 'y', time: '07:00', repeat_days: [2] }),
    ];
    const fired = selectFiringAlarms(alarms, tuesday0700);
    expect(fired).toHaveLength(2);
  });

  it('어떤 알람도 발화 조건에 해당하지 않으면 빈 배열', () => {
    const alarms = [
      makeAlarm({ id: 'a', time: '08:00' }),
      makeAlarm({ id: 'b', time: '07:00', is_active: false }),
      makeAlarm({ id: 'c', time: '07:00', repeat_days: [0, 6] }),
    ];
    expect(selectFiringAlarms(alarms, tuesday0700)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — formatHHmm                                            */
/* ------------------------------------------------------------------ */
describe('formatHHmm — edge cases', () => {
  it('자정 00:00', () => {
    expect(formatHHmm(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe('00:00');
  });

  it('정오 12:00', () => {
    expect(formatHHmm(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))).toBe('12:00');
  });

  it('한 자릿수 시/분 모두 제로패딩', () => {
    expect(formatHHmm(new Date(Date.UTC(2026, 0, 1, 1, 5, 0)))).toBe('01:05');
  });

  it('최대 시각 23:59', () => {
    expect(formatHHmm(new Date(Date.UTC(2026, 0, 1, 23, 59, 59)))).toBe('23:59');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — shouldAlarmFire                                       */
/* ------------------------------------------------------------------ */
describe('shouldAlarmFire — edge cases', () => {
  it('repeat_days가 비배열이면 빈 배열로 폴백 → 매일 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: 'invalid' as unknown as number[] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('repeat_days에 7개 요일 모두 포함 → 항상 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: [0, 1, 2, 3, 4, 5, 6] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('repeat_days에 중복 요일 → 정상 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: [2, 2, 2] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('자정 00:00 알람 발화', () => {
    const midnight = new Date(Date.UTC(2026, 3, 21, 0, 0, 0));
    const alarm = makeAlarm({ time: '00:00', repeat_days: [] });
    expect(shouldAlarmFire(alarm, midnight)).toBe(true);
  });

  it('일요일(0) 알람 — 일요일 시각에 발화', () => {
    const sunday0700 = new Date(Date.UTC(2026, 3, 19, 7, 0, 0)); // 2026-04-19 일요일
    const alarm = makeAlarm({ time: '07:00', repeat_days: [0] });
    expect(shouldAlarmFire(alarm, sunday0700)).toBe(true);
  });

  it('토요일(6) 알람 — 토요일 시각에 발화', () => {
    const saturday0700 = new Date(Date.UTC(2026, 3, 25, 7, 0, 0)); // 2026-04-25 토요일
    const alarm = makeAlarm({ time: '07:00', repeat_days: [6] });
    expect(shouldAlarmFire(alarm, saturday0700)).toBe(true);
  });

  it('repeat_days null → 비배열 → 폴백 빈 배열 → 매일 발화', () => {
    const alarm = makeAlarm({ time: '07:00', repeat_days: null as unknown as number[] });
    expect(shouldAlarmFire(alarm, tuesday0700)).toBe(true);
  });

  it('time 형식이 잘못되면 발화 안 함', () => {
    expect(shouldAlarmFire(makeAlarm({ time: '7시' }), tuesday0700)).toBe(false);
    expect(shouldAlarmFire(makeAlarm({ time: '25:00' }), tuesday0700)).toBe(false);
  });
});
