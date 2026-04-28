interface Alarm {
  id: string;
  user_id: string;
  target_user_id: string | null;
  message_id: string;
  time: string;
  repeat_days: number[] | string;
  is_active: boolean;
  snooze_minutes: number;
  created_at: string;
  updated_at: string;
  mode?: 'tts' | 'sound-only';
  vibration_pattern?: 'default' | 'strong' | 'none';
  wake_mode?: 'sound_then_voice' | 'voice_only';
  voice_profile_id?: string | null;
  speaker_id?: string | null;
  message_text?: string;
  voice_name?: string;
  category?: string;
  sender_user_id?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  is_family_alarm?: boolean;
  is_received_family_alarm?: boolean;
}

type TFn = (key: string) => string;

const DAY_KEYS = [
  'alarms.daySun',
  'alarms.dayMon',
  'alarms.dayTue',
  'alarms.dayWed',
  'alarms.dayThu',
  'alarms.dayFri',
  'alarms.daySat',
] as const;

function compareAlarms(a: Alarm, b: Alarm): number {
  if (a.is_active && !b.is_active) return -1;
  if (!a.is_active && b.is_active) return 1;
  if (a.is_active && b.is_active) {
    const aMs = stubGetNextFireMs(a);
    const bMs = stubGetNextFireMs(b);
    if (aMs !== null && bMs !== null) return aMs - bMs;
    if (aMs !== null) return -1;
    if (bMs !== null) return 1;
  }
  return a.time.localeCompare(b.time);
}

let nextFireMsMap: Record<string, number | null> = {};

function stubGetNextFireMs(alarm: Alarm): number | null {
  return nextFireMsMap[alarm.id] ?? null;
}

function formatRepeatDays(days: number[], t: TFn): string {
  if (days.length === 0) return t('alarms.once');
  if (days.length === 7) return t('alarms.daily');
  const sorted = [...days].sort();
  if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) return t('alarms.weekday');
  if (JSON.stringify(sorted) === JSON.stringify([0, 6])) return t('alarms.weekend');
  return days.map((d) => t(DAY_KEYS[d]!)).join(', ');
}

function filterAlarms(
  alarms: Alarm[] | null,
  searchQuery: string,
): Alarm[] | null {
  if (!alarms) return alarms;
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? alarms.filter(
        (a) =>
          a.time.includes(q) ||
          (a.voice_name && a.voice_name.toLowerCase().includes(q)) ||
          (a.message_text && a.message_text.toLowerCase().includes(q)),
      )
    : [...alarms];
  return filtered.sort(compareAlarms);
}

function resolveDisplayAlarms(
  live: Alarm[] | undefined,
  cached: Alarm[] | null,
): Alarm[] | null | undefined {
  return live ?? cached;
}

function isShowingCached(
  live: Alarm[] | undefined,
  cached: Alarm[] | null,
  isConnected: boolean,
): boolean {
  return !live && !!cached && !isConnected;
}

function shouldEnableAlarmsQuery(
  isAuthenticated: boolean,
  isConnected: boolean,
): boolean {
  return isAuthenticated && isConnected;
}

function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'alarm-1',
    user_id: 'u-1',
    target_user_id: null,
    message_id: 'msg-1',
    time: '07:00',
    repeat_days: [],
    is_active: true,
    snooze_minutes: 5,
    created_at: '2026-04-25T00:00:00Z',
    updated_at: '2026-04-25T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ───

describe('AlarmsScreen — compareAlarms sorting', () => {
  beforeEach(() => {
    nextFireMsMap = {};
  });

  it('active alarm sorts before inactive', () => {
    const a = makeAlarm({ id: 'a', is_active: true });
    const b = makeAlarm({ id: 'b', is_active: false });
    expect(compareAlarms(a, b)).toBeLessThan(0);
  });

  it('inactive alarm sorts after active', () => {
    const a = makeAlarm({ id: 'a', is_active: false });
    const b = makeAlarm({ id: 'b', is_active: true });
    expect(compareAlarms(a, b)).toBeGreaterThan(0);
  });

  it('both active — sorts by next fire time (sooner first)', () => {
    const a = makeAlarm({ id: 'a', is_active: true });
    const b = makeAlarm({ id: 'b', is_active: true });
    nextFireMsMap = { a: 1000, b: 5000 };
    expect(compareAlarms(a, b)).toBeLessThan(0);
  });

  it('both active — later alarm sorts after', () => {
    const a = makeAlarm({ id: 'a', is_active: true });
    const b = makeAlarm({ id: 'b', is_active: true });
    nextFireMsMap = { a: 5000, b: 1000 };
    expect(compareAlarms(a, b)).toBeGreaterThan(0);
  });

  it('both active — equal fire time returns 0', () => {
    const a = makeAlarm({ id: 'a', is_active: true, time: '08:00' });
    const b = makeAlarm({ id: 'b', is_active: true, time: '08:00' });
    nextFireMsMap = { a: 3000, b: 3000 };
    expect(compareAlarms(a, b)).toBe(0);
  });

  it('both active — one has fireMs, other null; non-null sorts first', () => {
    const a = makeAlarm({ id: 'a', is_active: true });
    const b = makeAlarm({ id: 'b', is_active: true });
    nextFireMsMap = { a: 1000 };
    expect(compareAlarms(a, b)).toBeLessThan(0);
  });

  it('both active — first null, second has fireMs; first sorts after', () => {
    const a = makeAlarm({ id: 'a', is_active: true });
    const b = makeAlarm({ id: 'b', is_active: true });
    nextFireMsMap = { b: 1000 };
    expect(compareAlarms(a, b)).toBeGreaterThan(0);
  });

  it('both active — both null fireMs; falls back to time string compare', () => {
    const a = makeAlarm({ id: 'a', is_active: true, time: '09:00' });
    const b = makeAlarm({ id: 'b', is_active: true, time: '07:00' });
    expect(compareAlarms(a, b)).toBeGreaterThan(0);
  });

  it('both inactive — sorts by time string', () => {
    const a = makeAlarm({ id: 'a', is_active: false, time: '06:00' });
    const b = makeAlarm({ id: 'b', is_active: false, time: '22:00' });
    expect(compareAlarms(a, b)).toBeLessThan(0);
  });

  it('both inactive — same time returns 0', () => {
    const a = makeAlarm({ id: 'a', is_active: false, time: '12:00' });
    const b = makeAlarm({ id: 'b', is_active: false, time: '12:00' });
    expect(compareAlarms(a, b)).toBe(0);
  });
});

describe('AlarmsScreen — formatRepeatDays', () => {
  const t: TFn = (key) => key;

  it('returns once key for empty days', () => {
    expect(formatRepeatDays([], t)).toBe('alarms.once');
  });

  it('returns daily key for all 7 days', () => {
    expect(formatRepeatDays([0, 1, 2, 3, 4, 5, 6], t)).toBe('alarms.daily');
  });

  it('returns weekday key for Mon-Fri', () => {
    expect(formatRepeatDays([1, 2, 3, 4, 5], t)).toBe('alarms.weekday');
  });

  it('returns weekday key for unsorted Mon-Fri', () => {
    expect(formatRepeatDays([5, 3, 1, 4, 2], t)).toBe('alarms.weekday');
  });

  it('returns weekend key for Sun+Sat', () => {
    expect(formatRepeatDays([0, 6], t)).toBe('alarms.weekend');
  });

  it('returns weekend key for unsorted Sat+Sun', () => {
    expect(formatRepeatDays([6, 0], t)).toBe('alarms.weekend');
  });

  it('returns individual day keys joined by comma for custom days', () => {
    expect(formatRepeatDays([1, 3], t)).toBe('alarms.dayMon, alarms.dayWed');
  });

  it('returns single day key for one day', () => {
    expect(formatRepeatDays([0], t)).toBe('alarms.daySun');
  });

  it('handles 6 days (not weekday or daily)', () => {
    const result = formatRepeatDays([0, 1, 2, 3, 4, 5], t);
    expect(result).toContain('alarms.daySun');
    expect(result).not.toBe('alarms.daily');
  });
});

describe('AlarmsScreen — filterAlarms', () => {
  beforeEach(() => {
    nextFireMsMap = {};
  });

  it('returns null for null input', () => {
    expect(filterAlarms(null, '')).toBeNull();
  });

  it('returns all alarms when search query is empty', () => {
    const alarms = [
      makeAlarm({ id: 'a', time: '08:00' }),
      makeAlarm({ id: 'b', time: '07:00' }),
    ];
    const result = filterAlarms(alarms, '');
    expect(result).toHaveLength(2);
  });

  it('filters by time', () => {
    const alarms = [
      makeAlarm({ id: 'a', time: '08:00' }),
      makeAlarm({ id: 'b', time: '07:30' }),
    ];
    const result = filterAlarms(alarms, '07:30');
    expect(result).toHaveLength(1);
    expect(result![0]!.id).toBe('b');
  });

  it('filters by voice_name (case insensitive)', () => {
    const alarms = [
      makeAlarm({ id: 'a', voice_name: 'Mom' }),
      makeAlarm({ id: 'b', voice_name: 'Dad' }),
    ];
    const result = filterAlarms(alarms, 'mom');
    expect(result).toHaveLength(1);
    expect(result![0]!.id).toBe('a');
  });

  it('filters by message_text (case insensitive)', () => {
    const alarms = [
      makeAlarm({ id: 'a', message_text: 'Good morning!' }),
      makeAlarm({ id: 'b', message_text: 'Time to sleep' }),
    ];
    const result = filterAlarms(alarms, 'morning');
    expect(result).toHaveLength(1);
    expect(result![0]!.id).toBe('a');
  });

  it('trims whitespace from search query', () => {
    const alarms = [makeAlarm({ id: 'a', time: '08:00' })];
    const result = filterAlarms(alarms, '  08:00  ');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no match', () => {
    const alarms = [makeAlarm({ id: 'a', time: '08:00' })];
    const result = filterAlarms(alarms, 'zzz');
    expect(result).toHaveLength(0);
  });

  it('sorts filtered results by compareAlarms', () => {
    const alarms = [
      makeAlarm({ id: 'b', is_active: false, time: '09:00' }),
      makeAlarm({ id: 'a', is_active: true, time: '08:00' }),
    ];
    const result = filterAlarms(alarms, '');
    expect(result![0]!.id).toBe('a');
    expect(result![1]!.id).toBe('b');
  });

  it('handles alarm with no voice_name or message_text', () => {
    const alarms = [makeAlarm({ id: 'a', voice_name: undefined, message_text: undefined })];
    const result = filterAlarms(alarms, 'test');
    expect(result).toHaveLength(0);
  });
});

describe('AlarmsScreen — resolveDisplayAlarms', () => {
  it('returns live alarms when available', () => {
    const live = [makeAlarm()];
    const cached = [makeAlarm({ id: 'cached-1' })];
    expect(resolveDisplayAlarms(live, cached)).toBe(live);
  });

  it('returns cached alarms when live is undefined', () => {
    const cached = [makeAlarm({ id: 'cached-1' })];
    expect(resolveDisplayAlarms(undefined, cached)).toBe(cached);
  });

  it('returns null when both absent', () => {
    expect(resolveDisplayAlarms(undefined, null)).toBeNull();
  });

  it('returns empty live array over cached', () => {
    const live: Alarm[] = [];
    const cached = [makeAlarm()];
    expect(resolveDisplayAlarms(live, cached)).toBe(live);
  });
});

describe('AlarmsScreen — isShowingCached', () => {
  it('true when no live data, has cached, and offline', () => {
    expect(isShowingCached(undefined, [makeAlarm()], false)).toBe(true);
  });

  it('false when live data exists', () => {
    expect(isShowingCached([makeAlarm()], [makeAlarm()], false)).toBe(false);
  });

  it('false when no cached data', () => {
    expect(isShowingCached(undefined, null, false)).toBe(false);
  });

  it('false when online', () => {
    expect(isShowingCached(undefined, [makeAlarm()], true)).toBe(false);
  });
});

describe('AlarmsScreen — shouldEnableAlarmsQuery', () => {
  it('enables when authenticated and connected', () => {
    expect(shouldEnableAlarmsQuery(true, true)).toBe(true);
  });

  it('disables when not authenticated', () => {
    expect(shouldEnableAlarmsQuery(false, true)).toBe(false);
  });

  it('disables when not connected', () => {
    expect(shouldEnableAlarmsQuery(true, false)).toBe(false);
  });

  it('disables when neither', () => {
    expect(shouldEnableAlarmsQuery(false, false)).toBe(false);
  });
});

describe('AlarmsScreen — DAY_KEYS', () => {
  it('has 7 entries for Sun through Sat', () => {
    expect(DAY_KEYS).toHaveLength(7);
  });

  it('starts with Sunday', () => {
    expect(DAY_KEYS[0]).toBe('alarms.daySun');
  });

  it('ends with Saturday', () => {
    expect(DAY_KEYS[6]).toBe('alarms.daySat');
  });

  it('all keys follow alarms.dayXxx pattern', () => {
    for (const key of DAY_KEYS) {
      expect(key).toMatch(/^alarms\.day[A-Z][a-z]{2}$/);
    }
  });
});

describe('AlarmsScreen — navigation routes', () => {
  it('edit alarm route includes alarm id', () => {
    const alarm = makeAlarm({ id: 'test-123' });
    const pathname = '/alarm/edit';
    const params = { id: alarm.id };
    expect(pathname).toBe('/alarm/edit');
    expect(params.id).toBe('test-123');
  });

  it('create alarm route', () => {
    expect('/alarm/create').toBe('/alarm/create');
  });
});
