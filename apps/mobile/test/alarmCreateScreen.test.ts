/**
 * alarmCreateScreen.test.ts — business logic extracted from app/alarm/create.tsx and edit.tsx
 */

// ---- quickSetDays (create.tsx:184-188, edit.tsx:169-173) ----
function quickSetDays(type: 'daily' | 'weekday' | 'weekend'): number[] {
  if (type === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (type === 'weekday') return [1, 2, 3, 4, 5];
  return [0, 6];
}

// ---- toggleDay (create.tsx:152-154, edit.tsx:129-131) ----
function toggleDay(prev: number[], day: number): number[] {
  return prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
}

// ---- soundOnlyInvalid (create.tsx:182, edit.tsx:167) ----
type AlarmMode = 'tts' | 'sound-only';
function soundOnlyInvalid(mode: AlarmMode, voiceProfileId: string | null): boolean {
  return mode === 'sound-only' && !voiceProfileId;
}

// ---- AM/PM (create.tsx:245, edit.tsx:191) ----
function amPm(hour: number): 'AM' | 'PM' {
  return hour < 12 ? 'AM' : 'PM';
}

// ---- Time string formatting (create.tsx:163) ----
function formatTimeString(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

// ---- Hour increment/decrement (create.tsx:251, 260) ----
function hourUp(h: number): number { return (h + 1) % 24; }
function hourDown(h: number): number { return (h - 1 + 24) % 24; }

// ---- Minute increment/decrement by 5 (create.tsx:273, 282) ----
function minuteUp(m: number): number { return (m + 5) % 60; }
function minuteDown(m: number): number { return (m - 5 + 60) % 60; }

// ---- readyVoices filter (create.tsx:86) ----
interface VoiceLike { id: string; status: string; name: string }
function filterReadyVoices<T extends VoiceLike>(voices: T[] | undefined): T[] {
  return voices?.filter((v) => v.status === 'ready') ?? [];
}

// ---- Disabled state (create.tsx:565) ----
function isSubmitDisabled(
  selectedMessageId: string | null,
  soundOnlyInv: boolean,
  isPending: boolean,
): boolean {
  return !selectedMessageId || soundOnlyInv || isPending;
}

// ---- Friend ID extraction (create.tsx:212) ----
function extractFriendId(
  friend: { user_a: string; user_b: string },
  userId: string,
): string {
  return friend.user_a === userId ? friend.user_b : friend.user_a;
}

// ---- Cached message match (create.tsx:119-121) ----
interface MessageLike { id: string; voice_profile_id: string; text: string }
function findCachedMessage(
  messages: MessageLike[],
  voiceId: string,
  text: string,
): MessageLike | undefined {
  return messages.find(
    (m) => m.voice_profile_id === voiceId && m.text === text,
  );
}

// ======== TESTS ========

describe('quickSetDays', () => {
  it('daily returns all 7 days', () => {
    expect(quickSetDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('weekday returns Mon-Fri', () => {
    expect(quickSetDays('weekday')).toEqual([1, 2, 3, 4, 5]);
  });

  it('weekend returns Sun and Sat', () => {
    expect(quickSetDays('weekend')).toEqual([0, 6]);
  });

  it('daily has 7 elements', () => {
    expect(quickSetDays('daily')).toHaveLength(7);
  });

  it('weekday has 5 elements', () => {
    expect(quickSetDays('weekday')).toHaveLength(5);
  });

  it('weekend has 2 elements', () => {
    expect(quickSetDays('weekend')).toHaveLength(2);
  });
});

describe('toggleDay', () => {
  it('adds day when not present', () => {
    expect(toggleDay([], 3)).toEqual([3]);
  });

  it('removes day when present', () => {
    expect(toggleDay([1, 3, 5], 3)).toEqual([1, 5]);
  });

  it('does not mutate input', () => {
    const input = [1, 2, 3];
    toggleDay(input, 2);
    expect(input).toEqual([1, 2, 3]);
  });

  it('handles duplicate toggle (add then remove)', () => {
    const r1 = toggleDay([], 4);
    const r2 = toggleDay(r1, 4);
    expect(r2).toEqual([]);
  });

  it('adds to end', () => {
    expect(toggleDay([0, 1], 6)).toEqual([0, 1, 6]);
  });

  it('removes first occurrence', () => {
    expect(toggleDay([0, 3, 6], 0)).toEqual([3, 6]);
  });

  it('toggle all 7 days on', () => {
    let days: number[] = [];
    for (let i = 0; i < 7; i++) days = toggleDay(days, i);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('soundOnlyInvalid', () => {
  it('true when sound-only mode without voice', () => {
    expect(soundOnlyInvalid('sound-only', null)).toBe(true);
  });

  it('false when sound-only mode with voice', () => {
    expect(soundOnlyInvalid('sound-only', 'voice-123')).toBe(false);
  });

  it('false when tts mode without voice', () => {
    expect(soundOnlyInvalid('tts', null)).toBe(false);
  });

  it('false when tts mode with voice', () => {
    expect(soundOnlyInvalid('tts', 'voice-123')).toBe(false);
  });

  it('true when sound-only mode with empty string voice', () => {
    expect(soundOnlyInvalid('sound-only', '')).toBe(true);
  });
});

describe('amPm', () => {
  it('AM for hour 0 (midnight)', () => {
    expect(amPm(0)).toBe('AM');
  });

  it('AM for hour 11', () => {
    expect(amPm(11)).toBe('AM');
  });

  it('PM for hour 12 (noon)', () => {
    expect(amPm(12)).toBe('PM');
  });

  it('PM for hour 23', () => {
    expect(amPm(23)).toBe('PM');
  });

  it('AM for hour 6', () => {
    expect(amPm(6)).toBe('AM');
  });

  it('PM for hour 18', () => {
    expect(amPm(18)).toBe('PM');
  });
});

describe('formatTimeString', () => {
  it('pads single digit hour', () => {
    expect(formatTimeString(7, 0)).toBe('07:00');
  });

  it('pads single digit minute', () => {
    expect(formatTimeString(12, 5)).toBe('12:05');
  });

  it('handles midnight', () => {
    expect(formatTimeString(0, 0)).toBe('00:00');
  });

  it('handles 23:59', () => {
    expect(formatTimeString(23, 59)).toBe('23:59');
  });

  it('double digit both', () => {
    expect(formatTimeString(14, 30)).toBe('14:30');
  });
});

describe('hourUp / hourDown', () => {
  it('hourUp from 0 to 1', () => {
    expect(hourUp(0)).toBe(1);
  });

  it('hourUp wraps from 23 to 0', () => {
    expect(hourUp(23)).toBe(0);
  });

  it('hourDown from 1 to 0', () => {
    expect(hourDown(1)).toBe(0);
  });

  it('hourDown wraps from 0 to 23', () => {
    expect(hourDown(0)).toBe(23);
  });

  it('hourUp from 12 to 13', () => {
    expect(hourUp(12)).toBe(13);
  });

  it('hourDown from 12 to 11', () => {
    expect(hourDown(12)).toBe(11);
  });
});

describe('minuteUp / minuteDown', () => {
  it('minuteUp from 0 to 5', () => {
    expect(minuteUp(0)).toBe(5);
  });

  it('minuteUp wraps from 55 to 0', () => {
    expect(minuteUp(55)).toBe(0);
  });

  it('minuteDown from 5 to 0', () => {
    expect(minuteDown(5)).toBe(0);
  });

  it('minuteDown wraps from 0 to 55', () => {
    expect(minuteDown(0)).toBe(55);
  });

  it('minuteUp from 30 to 35', () => {
    expect(minuteUp(30)).toBe(35);
  });

  it('minuteDown from 30 to 25', () => {
    expect(minuteDown(30)).toBe(25);
  });
});

describe('filterReadyVoices', () => {
  it('returns only ready voices', () => {
    const voices = [
      { id: '1', status: 'ready', name: 'A' },
      { id: '2', status: 'processing', name: 'B' },
      { id: '3', status: 'ready', name: 'C' },
    ];
    const result = filterReadyVoices(voices);
    expect(result).toHaveLength(2);
    expect(result.every(v => v.status === 'ready')).toBe(true);
  });

  it('returns empty for undefined', () => {
    expect(filterReadyVoices(undefined)).toEqual([]);
  });

  it('returns empty when no ready voices', () => {
    const voices = [
      { id: '1', status: 'processing', name: 'A' },
      { id: '2', status: 'failed', name: 'B' },
    ];
    expect(filterReadyVoices(voices)).toEqual([]);
  });

  it('returns all when all ready', () => {
    const voices = [
      { id: '1', status: 'ready', name: 'A' },
      { id: '2', status: 'ready', name: 'B' },
    ];
    expect(filterReadyVoices(voices)).toHaveLength(2);
  });

  it('returns empty for empty array', () => {
    expect(filterReadyVoices([])).toEqual([]);
  });
});

describe('isSubmitDisabled', () => {
  it('disabled when no message selected', () => {
    expect(isSubmitDisabled(null, false, false)).toBe(true);
  });

  it('disabled when sound-only invalid', () => {
    expect(isSubmitDisabled('msg-1', true, false)).toBe(true);
  });

  it('disabled when mutation pending', () => {
    expect(isSubmitDisabled('msg-1', false, true)).toBe(true);
  });

  it('enabled when all conditions met', () => {
    expect(isSubmitDisabled('msg-1', false, false)).toBe(false);
  });

  it('disabled when multiple conditions fail', () => {
    expect(isSubmitDisabled(null, true, true)).toBe(true);
  });
});

describe('extractFriendId', () => {
  it('returns user_b when user is user_a', () => {
    expect(extractFriendId({ user_a: 'me', user_b: 'friend' }, 'me')).toBe('friend');
  });

  it('returns user_a when user is user_b', () => {
    expect(extractFriendId({ user_a: 'friend', user_b: 'me' }, 'me')).toBe('friend');
  });

  it('returns user_a when userId matches neither (user_a !== userId)', () => {
    expect(extractFriendId({ user_a: 'a', user_b: 'b' }, 'c')).toBe('a');
  });
});

describe('findCachedMessage', () => {
  const messages: MessageLike[] = [
    { id: '1', voice_profile_id: 'v1', text: 'hello' },
    { id: '2', voice_profile_id: 'v2', text: 'world' },
    { id: '3', voice_profile_id: 'v1', text: 'world' },
  ];

  it('finds exact match', () => {
    expect(findCachedMessage(messages, 'v1', 'hello')?.id).toBe('1');
  });

  it('returns undefined for no match', () => {
    expect(findCachedMessage(messages, 'v1', 'missing')).toBeUndefined();
  });

  it('matches voice AND text, not just voice', () => {
    expect(findCachedMessage(messages, 'v1', 'world')?.id).toBe('3');
  });

  it('returns undefined for empty messages', () => {
    expect(findCachedMessage([], 'v1', 'hello')).toBeUndefined();
  });

  it('returns first match when duplicates exist', () => {
    const dupes = [
      { id: 'a', voice_profile_id: 'v1', text: 'same' },
      { id: 'b', voice_profile_id: 'v1', text: 'same' },
    ];
    expect(findCachedMessage(dupes, 'v1', 'same')?.id).toBe('a');
  });

  it('text comparison is case-sensitive', () => {
    expect(findCachedMessage(messages, 'v1', 'Hello')).toBeUndefined();
  });
});
