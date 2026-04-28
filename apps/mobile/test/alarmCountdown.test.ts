import { getNextFireMs, formatCountdown, getNearestFireMs } from '../src/lib/alarmCountdown';
import type { Alarm } from '../src/types';

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts) return `${key}:${JSON.stringify(opts)}`;
  return key;
}) as (key: string, opts?: Record<string, unknown>) => string;

function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'a1',
    user_id: 'u1',
    target_user_id: null,
    message_id: 'm1',
    time: '08:00',
    repeat_days: [],
    is_active: true,
    snooze_minutes: 5,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getNextFireMs', () => {
  it('inactive alarm returns null', () => {
    const alarm = makeAlarm({ is_active: false });
    expect(getNextFireMs(alarm)).toBeNull();
  });

  it('one-time alarm in the future returns positive ms', () => {
    const now = new Date();
    const futureHour = (now.getHours() + 2) % 24;
    const time = `${String(futureHour).padStart(2, '0')}:00`;
    const alarm = makeAlarm({ time, repeat_days: [] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
  });

  it('one-time alarm already passed today fires tomorrow', () => {
    const now = new Date();
    const pastHour = now.getHours() - 1;
    if (pastHour < 0) return;
    const time = `${String(pastHour).padStart(2, '0')}:00`;
    const alarm = makeAlarm({ time, repeat_days: [] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    const hours = ms! / (1000 * 60 * 60);
    expect(hours).toBeGreaterThan(20);
    expect(hours).toBeLessThanOrEqual(25);
  });

  it('repeating alarm on today dow returns today if not yet passed', () => {
    const now = new Date();
    const futureHour = (now.getHours() + 3) % 24;
    const time = `${String(futureHour).padStart(2, '0')}:00`;
    const todayDow = now.getDay();
    const alarm = makeAlarm({ time, repeat_days: [todayDow] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    expect(ms!).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('repeating alarm not matching today skips to next matching day', () => {
    const now = new Date();
    const todayDow = now.getDay();
    const tomorrowDow = (todayDow + 1) % 7;
    const alarm = makeAlarm({ time: '12:00', repeat_days: [tomorrowDow] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    const hours = ms! / (1000 * 60 * 60);
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(48 * 1);
  });

  it('repeat_days as JSON string is parsed correctly', () => {
    const now = new Date();
    const futureHour = (now.getHours() + 2) % 24;
    const time = `${String(futureHour).padStart(2, '0')}:00`;
    const todayDow = now.getDay();
    const alarm = makeAlarm({ time, repeat_days: JSON.stringify([todayDow]) });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
  });

  it('every-day repeat always returns a valid result', () => {
    const now = new Date();
    const futureHour = (now.getHours() + 1) % 24;
    const time = `${String(futureHour).padStart(2, '0')}:00`;
    const alarm = makeAlarm({ time, repeat_days: [0, 1, 2, 3, 4, 5, 6] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
    expect(ms!).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('weekday-only alarm on weekend skips to Monday', () => {
    const now = new Date();
    const isSaturday = now.getDay() === 6;
    const isSunday = now.getDay() === 0;
    if (!isSaturday && !isSunday) return;
    const alarm = makeAlarm({ time: '08:00', repeat_days: [1, 2, 3, 4, 5] });
    const ms = getNextFireMs(alarm);
    expect(ms).not.toBeNull();
  });
});

describe('formatCountdown', () => {
  it('minutes only (under 1 hour)', () => {
    const ms = 45 * 60 * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownMinutes');
    expect(result).toContain('"minutes":45');
  });

  it('zero minutes', () => {
    const ms = 30 * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownMinutes');
    expect(result).toContain('"minutes":0');
  });

  it('hours and minutes (under 24 hours)', () => {
    const ms = (3 * 3600 + 15 * 60) * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownHoursMinutes');
    expect(result).toContain('"hours":3');
    expect(result).toContain('"minutes":15');
  });

  it('exactly 1 hour', () => {
    const ms = 3600 * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownHoursMinutes');
    expect(result).toContain('"hours":1');
  });

  it('days and hours (24+ hours)', () => {
    const ms = (26 * 3600) * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownDaysHours');
    expect(result).toContain('"days":1');
    expect(result).toContain('"hours":2');
  });

  it('exactly 24 hours', () => {
    const ms = 24 * 3600 * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('alarms.countdownDaysHours');
    expect(result).toContain('"days":1');
    expect(result).toContain('"hours":0');
  });

  it('multiple days', () => {
    const ms = (72 * 3600 + 5 * 3600) * 1000;
    const result = formatCountdown(ms, t);
    expect(result).toContain('"days":3');
    expect(result).toContain('"hours":5');
  });
});

describe('getNearestFireMs', () => {
  it('empty array returns null', () => {
    expect(getNearestFireMs([])).toBeNull();
  });

  it('all inactive returns null', () => {
    const alarms = [
      makeAlarm({ id: 'a1', is_active: false }),
      makeAlarm({ id: 'a2', is_active: false }),
    ];
    expect(getNearestFireMs(alarms)).toBeNull();
  });

  it('returns the smallest positive ms among active alarms', () => {
    const now = new Date();
    const h1 = (now.getHours() + 1) % 24;
    const h2 = (now.getHours() + 3) % 24;
    const alarms = [
      makeAlarm({ id: 'a1', time: `${String(h2).padStart(2, '0')}:00` }),
      makeAlarm({ id: 'a2', time: `${String(h1).padStart(2, '0')}:00` }),
    ];
    const nearest = getNearestFireMs(alarms);
    expect(nearest).not.toBeNull();
    const individual = getNextFireMs(alarms[1]!);
    expect(Math.abs(nearest! - individual!)).toBeLessThanOrEqual(50);
  });

  it('skips inactive alarms when finding nearest', () => {
    const now = new Date();
    const h1 = (now.getHours() + 1) % 24;
    const h2 = (now.getHours() + 5) % 24;
    const alarms = [
      makeAlarm({ id: 'a1', time: `${String(h1).padStart(2, '0')}:00`, is_active: false }),
      makeAlarm({ id: 'a2', time: `${String(h2).padStart(2, '0')}:00`, is_active: true }),
    ];
    const nearest = getNearestFireMs(alarms);
    const expected = getNextFireMs(alarms[1]!);
    expect(Math.abs(nearest! - expected!)).toBeLessThanOrEqual(50);
  });

  it('single active alarm returns its fire ms', () => {
    const now = new Date();
    const h = (now.getHours() + 2) % 24;
    const alarm = makeAlarm({ time: `${String(h).padStart(2, '0')}:30` });
    const nearest = getNearestFireMs([alarm]);
    const expected = getNextFireMs(alarm);
    expect(Math.abs(nearest! - expected!)).toBeLessThanOrEqual(50);
  });
});
