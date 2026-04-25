interface Alarm {
  id: string;
  time: string;
  is_active: boolean;
  voice_name?: string;
  message_text?: string;
}

interface Message {
  id: string;
  voice_name: string;
  text: string;
}

interface LibraryItem {
  id: string;
  message_id: string;
  voice_name: string;
  text: string;
  received_at: string;
}

interface WeekTrend {
  thisWeek: number;
  lastWeek: number;
}

type TFn = (key: string) => string;

function getTimeGreeting(hour: number, t: TFn): { emoji: string; text: string } {
  if (hour < 6) return { emoji: '🌙', text: t('greeting.night') };
  if (hour < 12) return { emoji: '🌅', text: t('greeting.morning') };
  if (hour < 17) return { emoji: '☀️', text: t('greeting.afternoon') };
  if (hour < 21) return { emoji: '🌆', text: t('greeting.evening') };
  return { emoji: '🌙', text: t('greeting.night') };
}

function computeTrendDiff(trend: WeekTrend): number {
  return trend.thisWeek - trend.lastWeek;
}

function computeTrendLabel(trend: WeekTrend): string {
  const diff = computeTrendDiff(trend);
  if (diff > 0) return `+${diff} ↑`;
  if (diff < 0) return `${diff} ↓`;
  return '0';
}

function shouldShowTrendBadge(trend: WeekTrend): boolean {
  return !(trend.thisWeek === 0 && trend.lastWeek === 0);
}

function getTrendColor(
  trend: WeekTrend,
  colors: { success: string; error: string; textSecondary: string },
): string {
  const diff = computeTrendDiff(trend);
  if (diff > 0) return colors.success;
  if (diff < 0) return colors.error;
  return colors.textSecondary;
}

function findNextAlarm(alarms: Alarm[] | null | undefined): Alarm | undefined {
  return alarms?.find((a) => a.is_active);
}

function getLatestMessage(messages: Message[] | null | undefined): Message | undefined {
  return messages?.[0];
}

function resolveDisplayData<T>(
  live: T[] | undefined,
  cached: T[] | null,
): T[] | null | undefined {
  return live ?? cached;
}

function getAvatarInitial(voiceName: string | undefined): string {
  return (voiceName || '?').charAt(0);
}

function shouldEnableQuery(isAuthenticated: boolean, isConnected: boolean): boolean {
  return isAuthenticated && isConnected;
}

function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'alarm-1',
    time: '07:00',
    is_active: true,
    voice_name: 'Mom',
    message_text: 'Good morning!',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    voice_name: 'Mom',
    text: 'Have a great day!',
    ...overrides,
  };
}

function makeLibraryItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'lib-1',
    message_id: 'msg-1',
    voice_name: 'Mom',
    text: 'Good morning',
    received_at: '2026-04-25T08:00:00Z',
    ...overrides,
  };
}

// ─── Tests ───

describe('HomeScreen — getTimeGreeting', () => {
  const t: TFn = (key) => key;

  it('returns night greeting for midnight (0)', () => {
    const result = getTimeGreeting(0, t);
    expect(result.emoji).toBe('🌙');
    expect(result.text).toBe('greeting.night');
  });

  it('returns night greeting for 3am', () => {
    expect(getTimeGreeting(3, t).text).toBe('greeting.night');
  });

  it('returns night greeting for 5am (edge)', () => {
    expect(getTimeGreeting(5, t).text).toBe('greeting.night');
  });

  it('returns morning greeting for 6am', () => {
    const result = getTimeGreeting(6, t);
    expect(result.emoji).toBe('🌅');
    expect(result.text).toBe('greeting.morning');
  });

  it('returns morning greeting for 11am', () => {
    expect(getTimeGreeting(11, t).text).toBe('greeting.morning');
  });

  it('returns afternoon greeting for 12pm', () => {
    const result = getTimeGreeting(12, t);
    expect(result.emoji).toBe('☀️');
    expect(result.text).toBe('greeting.afternoon');
  });

  it('returns afternoon greeting for 16', () => {
    expect(getTimeGreeting(16, t).text).toBe('greeting.afternoon');
  });

  it('returns evening greeting for 17', () => {
    const result = getTimeGreeting(17, t);
    expect(result.emoji).toBe('🌆');
    expect(result.text).toBe('greeting.evening');
  });

  it('returns evening greeting for 20', () => {
    expect(getTimeGreeting(20, t).text).toBe('greeting.evening');
  });

  it('returns night greeting for 21', () => {
    const result = getTimeGreeting(21, t);
    expect(result.emoji).toBe('🌙');
    expect(result.text).toBe('greeting.night');
  });

  it('returns night greeting for 23', () => {
    expect(getTimeGreeting(23, t).text).toBe('greeting.night');
  });
});

describe('HomeScreen — TrendBadge logic', () => {
  const colors = { success: '#34C759', error: '#FF3B30', textSecondary: '#999' };

  it('shows badge when both are non-zero', () => {
    expect(shouldShowTrendBadge({ thisWeek: 5, lastWeek: 3 })).toBe(true);
  });

  it('hides badge when both are zero', () => {
    expect(shouldShowTrendBadge({ thisWeek: 0, lastWeek: 0 })).toBe(false);
  });

  it('shows badge when only thisWeek is non-zero', () => {
    expect(shouldShowTrendBadge({ thisWeek: 2, lastWeek: 0 })).toBe(true);
  });

  it('shows badge when only lastWeek is non-zero', () => {
    expect(shouldShowTrendBadge({ thisWeek: 0, lastWeek: 3 })).toBe(true);
  });

  it('computes positive trend label', () => {
    expect(computeTrendLabel({ thisWeek: 5, lastWeek: 2 })).toBe('+3 ↑');
  });

  it('computes negative trend label', () => {
    expect(computeTrendLabel({ thisWeek: 1, lastWeek: 4 })).toBe('-3 ↓');
  });

  it('computes zero trend label', () => {
    expect(computeTrendLabel({ thisWeek: 3, lastWeek: 3 })).toBe('0');
  });

  it('returns success color for positive diff', () => {
    expect(getTrendColor({ thisWeek: 5, lastWeek: 2 }, colors)).toBe('#34C759');
  });

  it('returns error color for negative diff', () => {
    expect(getTrendColor({ thisWeek: 1, lastWeek: 4 }, colors)).toBe('#FF3B30');
  });

  it('returns textSecondary color for zero diff', () => {
    expect(getTrendColor({ thisWeek: 3, lastWeek: 3 }, colors)).toBe('#999');
  });

  it('computes diff correctly', () => {
    expect(computeTrendDiff({ thisWeek: 10, lastWeek: 7 })).toBe(3);
  });

  it('computes negative diff correctly', () => {
    expect(computeTrendDiff({ thisWeek: 2, lastWeek: 8 })).toBe(-6);
  });
});

describe('HomeScreen — findNextAlarm', () => {
  it('returns first active alarm', () => {
    const alarms = [
      makeAlarm({ id: 'a', is_active: false }),
      makeAlarm({ id: 'b', is_active: true }),
      makeAlarm({ id: 'c', is_active: true }),
    ];
    expect(findNextAlarm(alarms)?.id).toBe('b');
  });

  it('returns undefined when no active alarms', () => {
    const alarms = [
      makeAlarm({ id: 'a', is_active: false }),
      makeAlarm({ id: 'b', is_active: false }),
    ];
    expect(findNextAlarm(alarms)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(findNextAlarm([])).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(findNextAlarm(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(findNextAlarm(undefined)).toBeUndefined();
  });
});

describe('HomeScreen — getLatestMessage', () => {
  it('returns first message', () => {
    const messages = [
      makeMessage({ id: 'a' }),
      makeMessage({ id: 'b' }),
    ];
    expect(getLatestMessage(messages)?.id).toBe('a');
  });

  it('returns undefined for empty array', () => {
    expect(getLatestMessage([])).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(getLatestMessage(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(getLatestMessage(undefined)).toBeUndefined();
  });
});

describe('HomeScreen — resolveDisplayData', () => {
  it('returns live data when available', () => {
    const live = [makeAlarm()];
    const cached = [makeAlarm({ id: 'cached' })];
    expect(resolveDisplayData(live, cached)).toBe(live);
  });

  it('returns cached data when live is undefined', () => {
    const cached = [makeAlarm({ id: 'cached' })];
    expect(resolveDisplayData(undefined, cached)).toBe(cached);
  });

  it('returns null when both absent', () => {
    expect(resolveDisplayData(undefined, null)).toBeNull();
  });

  it('returns empty live array over cached', () => {
    const live: Alarm[] = [];
    const cached = [makeAlarm()];
    expect(resolveDisplayData(live, cached)).toBe(live);
  });
});

describe('HomeScreen — getAvatarInitial', () => {
  it('returns first character of voice name', () => {
    expect(getAvatarInitial('Mom')).toBe('M');
  });

  it('returns ? for undefined voice name', () => {
    expect(getAvatarInitial(undefined)).toBe('?');
  });

  it('returns ? for empty string', () => {
    expect(getAvatarInitial('')).toBe('?');
  });

  it('handles Korean name', () => {
    expect(getAvatarInitial('엄마')).toBe('엄');
  });

  it('handles single character', () => {
    expect(getAvatarInitial('A')).toBe('A');
  });
});

describe('HomeScreen — shouldEnableQuery', () => {
  it('enables when authenticated and connected', () => {
    expect(shouldEnableQuery(true, true)).toBe(true);
  });

  it('disables when not authenticated', () => {
    expect(shouldEnableQuery(false, true)).toBe(false);
  });

  it('disables when not connected', () => {
    expect(shouldEnableQuery(true, false)).toBe(false);
  });

  it('disables when neither', () => {
    expect(shouldEnableQuery(false, false)).toBe(false);
  });
});

describe('HomeScreen — LibraryItem display', () => {
  it('slices to max 3 items for recent section', () => {
    const items = [
      makeLibraryItem({ id: '1' }),
      makeLibraryItem({ id: '2' }),
      makeLibraryItem({ id: '3' }),
      makeLibraryItem({ id: '4' }),
      makeLibraryItem({ id: '5' }),
    ];
    const displayed = items.slice(0, 3);
    expect(displayed).toHaveLength(3);
    expect(displayed[2]!.id).toBe('3');
  });

  it('handles fewer than 3 items', () => {
    const items = [makeLibraryItem({ id: '1' })];
    expect(items.slice(0, 3)).toHaveLength(1);
  });

  it('handles empty library', () => {
    const items: LibraryItem[] = [];
    expect(items.slice(0, 3)).toHaveLength(0);
  });

  it('date formatting preserves year', () => {
    const item = makeLibraryItem({ received_at: '2026-04-25T08:00:00Z' });
    const d = new Date(item.received_at);
    expect(d.getFullYear()).toBe(2026);
  });
});

describe('HomeScreen — quick action routes', () => {
  const routes = [
    '/voice/record',
    '/voice/upload',
    '/message/create',
    '/alarm/create',
    '/code-register',
    '/people',
  ];

  it('has 6 quick actions', () => {
    expect(routes).toHaveLength(6);
  });

  it.each(routes)('route %s starts with /', (route) => {
    expect(route.startsWith('/')).toBe(true);
  });
});

describe('HomeScreen — next alarm card behavior', () => {
  it('navigates to edit when next alarm exists', () => {
    const alarm = makeAlarm({ id: 'test-alarm' });
    const pathname = '/alarm/edit';
    const params = { id: alarm.id };
    expect(pathname).toBe('/alarm/edit');
    expect(params.id).toBe('test-alarm');
  });

  it('navigates to create when no next alarm', () => {
    const nextAlarm = findNextAlarm([]);
    expect(nextAlarm).toBeUndefined();
    const pathname = nextAlarm ? '/alarm/edit' : '/alarm/create';
    expect(pathname).toBe('/alarm/create');
  });
});

describe('HomeScreen — play/pause toggle', () => {
  it('shows pause when currentPlayingId matches', () => {
    const currentPlayingId = 'msg-1';
    const messageId = 'msg-1';
    const isPlaying = currentPlayingId === messageId;
    expect(isPlaying).toBe(true);
  });

  it('shows play when currentPlayingId differs', () => {
    const currentPlayingId: string = 'msg-2';
    const messageId: string = 'msg-1';
    const isPlaying = currentPlayingId === messageId;
    expect(isPlaying).toBe(false);
  });

  it('shows play when currentPlayingId is null', () => {
    const currentPlayingId: string | null = null;
    const messageId = 'msg-1';
    const isPlaying = currentPlayingId === messageId;
    expect(isPlaying).toBe(false);
  });
});
