import type { VoiceProfile, Message } from '../src/types';

const MAX_VOICE_PROFILES = 2;

function isLimitReached(profiles: VoiceProfile[] | null | undefined, cached: VoiceProfile[] | null): boolean {
  const display = profiles ?? cached;
  const count = display?.length ?? 0;
  return count >= MAX_VOICE_PROFILES;
}

function getDisplayProfiles(
  profiles: VoiceProfile[] | undefined,
  cached: VoiceProfile[] | null,
): VoiceProfile[] | null | undefined {
  return profiles ?? cached;
}

function getStatusBadge(status: string): { labelKey: string; colorKey: string } {
  switch (status) {
    case 'ready':
      return { labelKey: 'voices.statusReady', colorKey: 'success' };
    case 'processing':
      return { labelKey: 'voices.statusProcessing', colorKey: 'warning' };
    case 'failed':
      return { labelKey: 'voices.statusFailed', colorKey: 'error' };
    default:
      return { labelKey: status, colorKey: 'textTertiary' };
  }
}

function toggleDay(prev: number[], day: number): number[] {
  return prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
}

function quickSetDays(type: 'daily' | 'weekday' | 'weekend'): number[] {
  if (type === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (type === 'weekday') return [1, 2, 3, 4, 5];
  return [0, 6];
}

function isSoundOnlyInvalid(mode: string, voiceProfileId: string | null): boolean {
  return mode === 'sound-only' && !voiceProfileId;
}

function shouldShowWakeMode(mode: string): boolean {
  return mode === 'tts';
}

function getAmPm(hour: number): 'AM' | 'PM' {
  return hour < 12 ? 'AM' : 'PM';
}

function findCachedMessage(
  messages: Message[] | undefined,
  voiceProfileId: string,
  text: string,
): Message | undefined {
  return messages?.find((m) => m.voice_profile_id === voiceProfileId && m.text === text);
}

function computeUnreadCount(notes: Array<{ read_at: string | null }> | undefined): number {
  return notes?.filter((n) => !n.read_at).length ?? 0;
}

function shouldMarkRead(note: { read_at: string | null }): boolean {
  return !note.read_at;
}

function getComposeScreenState(
  isAuthenticated: boolean,
  plan: string,
): 'login_required' | 'family_only' | 'full' {
  if (!isAuthenticated) return 'login_required';
  if (plan !== 'family') return 'family_only';
  return 'full';
}

function isFamilyPlan(plan: string): boolean {
  return plan === 'family';
}

function filterReadyVoices(voices: VoiceProfile[] | undefined): VoiceProfile[] {
  return voices?.filter((v) => v.status === 'ready') ?? [];
}

// --- Tests ---

const makeProfile = (overrides: Partial<VoiceProfile> = {}): VoiceProfile => ({
  id: 'v1',
  user_id: 'u1',
  name: 'Test Voice',
  perso_voice_id: null,
  elevenlabs_voice_id: null,
  avatar_url: null,
  status: 'ready',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  user_id: 'u1',
  voice_profile_id: 'v1',
  text: 'Good morning!',
  audio_url: null,
  category: 'morning',
  is_preset: false,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('Voice profile management logic', () => {
  describe('isLimitReached', () => {
    it('returns false when no profiles exist', () => {
      expect(isLimitReached(undefined, null)).toBe(false);
    });

    it('returns false when profile count is below limit', () => {
      expect(isLimitReached([makeProfile()], null)).toBe(false);
    });

    it('returns true when profile count equals limit', () => {
      const two = [makeProfile({ id: 'v1' }), makeProfile({ id: 'v2' })];
      expect(isLimitReached(two, null)).toBe(true);
    });

    it('returns true when profile count exceeds limit', () => {
      const three = [makeProfile({ id: 'v1' }), makeProfile({ id: 'v2' }), makeProfile({ id: 'v3' })];
      expect(isLimitReached(three, null)).toBe(true);
    });

    it('uses cached profiles when server profiles are undefined', () => {
      const cached = [makeProfile({ id: 'v1' }), makeProfile({ id: 'v2' })];
      expect(isLimitReached(undefined, cached)).toBe(true);
    });

    it('prefers server profiles over cached when both exist', () => {
      const server = [makeProfile({ id: 'v1' })];
      const cached = [makeProfile({ id: 'v1' }), makeProfile({ id: 'v2' })];
      expect(isLimitReached(server, cached)).toBe(false);
    });
  });

  describe('getDisplayProfiles', () => {
    it('returns server profiles when available', () => {
      const server = [makeProfile()];
      expect(getDisplayProfiles(server, null)).toBe(server);
    });

    it('returns cached profiles when server is undefined', () => {
      const cached = [makeProfile()];
      expect(getDisplayProfiles(undefined, cached)).toBe(cached);
    });

    it('returns null when both are undefined/null', () => {
      expect(getDisplayProfiles(undefined, null)).toBeNull();
    });

    it('prefers server even when empty over non-empty cache', () => {
      const server: VoiceProfile[] = [];
      const cached = [makeProfile()];
      expect(getDisplayProfiles(server, cached)).toBe(server);
    });
  });

  describe('getStatusBadge', () => {
    it('maps ready status correctly', () => {
      expect(getStatusBadge('ready')).toEqual({ labelKey: 'voices.statusReady', colorKey: 'success' });
    });

    it('maps processing status correctly', () => {
      expect(getStatusBadge('processing')).toEqual({ labelKey: 'voices.statusProcessing', colorKey: 'warning' });
    });

    it('maps failed status correctly', () => {
      expect(getStatusBadge('failed')).toEqual({ labelKey: 'voices.statusFailed', colorKey: 'error' });
    });

    it('returns raw status for unknown values', () => {
      expect(getStatusBadge('uploading')).toEqual({ labelKey: 'uploading', colorKey: 'textTertiary' });
    });
  });

  describe('isFamilyPlan', () => {
    it('returns true for family plan', () => {
      expect(isFamilyPlan('family')).toBe(true);
    });

    it('returns false for free plan', () => {
      expect(isFamilyPlan('free')).toBe(false);
    });

    it('returns false for personal plan', () => {
      expect(isFamilyPlan('personal')).toBe(false);
    });
  });

  describe('filterReadyVoices', () => {
    it('returns empty array for undefined input', () => {
      expect(filterReadyVoices(undefined)).toEqual([]);
    });

    it('filters only ready voices', () => {
      const voices = [
        makeProfile({ id: 'v1', status: 'ready' }),
        makeProfile({ id: 'v2', status: 'processing' }),
        makeProfile({ id: 'v3', status: 'failed' }),
        makeProfile({ id: 'v4', status: 'ready' }),
      ];
      const result = filterReadyVoices(voices);
      expect(result).toHaveLength(2);
      expect(result.map((v) => v.id)).toEqual(['v1', 'v4']);
    });

    it('returns empty array when no voices are ready', () => {
      const voices = [makeProfile({ status: 'processing' }), makeProfile({ id: 'v2', status: 'failed' })];
      expect(filterReadyVoices(voices)).toEqual([]);
    });
  });
});

describe('Alarm create interaction logic', () => {
  describe('toggleDay', () => {
    it('adds a day not in the list', () => {
      expect(toggleDay([], 1)).toEqual([1]);
    });

    it('removes a day already in the list', () => {
      expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3]);
    });

    it('handles toggling all days', () => {
      let days: number[] = [];
      for (let i = 0; i < 7; i++) days = toggleDay(days, i);
      expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('removes the only day', () => {
      expect(toggleDay([3], 3)).toEqual([]);
    });

    it('preserves order when adding', () => {
      expect(toggleDay([0, 5], 3)).toEqual([0, 5, 3]);
    });
  });

  describe('quickSetDays', () => {
    it('sets all 7 days for daily', () => {
      expect(quickSetDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('sets Mon-Fri for weekday', () => {
      expect(quickSetDays('weekday')).toEqual([1, 2, 3, 4, 5]);
    });

    it('sets Sat+Sun for weekend', () => {
      expect(quickSetDays('weekend')).toEqual([0, 6]);
    });
  });

  describe('isSoundOnlyInvalid', () => {
    it('returns true when sound-only mode has no voice profile', () => {
      expect(isSoundOnlyInvalid('sound-only', null)).toBe(true);
    });

    it('returns false when sound-only mode has a voice profile', () => {
      expect(isSoundOnlyInvalid('sound-only', 'v1')).toBe(false);
    });

    it('returns false for tts mode regardless of voice profile', () => {
      expect(isSoundOnlyInvalid('tts', null)).toBe(false);
    });
  });

  describe('shouldShowWakeMode', () => {
    it('returns true for tts mode', () => {
      expect(shouldShowWakeMode('tts')).toBe(true);
    });

    it('returns false for sound-only mode', () => {
      expect(shouldShowWakeMode('sound-only')).toBe(false);
    });
  });

  describe('getAmPm', () => {
    it('returns AM for midnight', () => {
      expect(getAmPm(0)).toBe('AM');
    });

    it('returns AM for 11', () => {
      expect(getAmPm(11)).toBe('AM');
    });

    it('returns PM for noon', () => {
      expect(getAmPm(12)).toBe('PM');
    });

    it('returns PM for 23', () => {
      expect(getAmPm(23)).toBe('PM');
    });
  });

  describe('findCachedMessage', () => {
    const messages = [
      makeMessage({ id: 'm1', voice_profile_id: 'v1', text: 'Hello' }),
      makeMessage({ id: 'm2', voice_profile_id: 'v1', text: 'Goodbye' }),
      makeMessage({ id: 'm3', voice_profile_id: 'v2', text: 'Hello' }),
    ];

    it('finds exact match by voice_profile_id and text', () => {
      const result = findCachedMessage(messages, 'v1', 'Hello');
      expect(result?.id).toBe('m1');
    });

    it('returns undefined when text does not match', () => {
      expect(findCachedMessage(messages, 'v1', 'Missing')).toBeUndefined();
    });

    it('returns undefined when voice_profile_id does not match', () => {
      expect(findCachedMessage(messages, 'v99', 'Hello')).toBeUndefined();
    });

    it('returns undefined when messages is undefined', () => {
      expect(findCachedMessage(undefined, 'v1', 'Hello')).toBeUndefined();
    });

    it('distinguishes same text with different voices', () => {
      const result = findCachedMessage(messages, 'v2', 'Hello');
      expect(result?.id).toBe('m3');
    });
  });
});

describe('Compose screen gating logic', () => {
  describe('getComposeScreenState', () => {
    it('returns login_required when not authenticated', () => {
      expect(getComposeScreenState(false, 'free')).toBe('login_required');
    });

    it('returns family_only for free plan', () => {
      expect(getComposeScreenState(true, 'free')).toBe('family_only');
    });

    it('returns family_only for personal plan', () => {
      expect(getComposeScreenState(true, 'personal')).toBe('family_only');
    });

    it('returns full for family plan', () => {
      expect(getComposeScreenState(true, 'family')).toBe('full');
    });

    it('prioritizes auth check over plan check', () => {
      expect(getComposeScreenState(false, 'family')).toBe('login_required');
    });
  });

  describe('computeUnreadCount', () => {
    it('returns 0 for undefined notes', () => {
      expect(computeUnreadCount(undefined)).toBe(0);
    });

    it('returns 0 when all notes are read', () => {
      const notes = [
        { read_at: '2026-01-01T00:00:00Z' },
        { read_at: '2026-01-02T00:00:00Z' },
      ];
      expect(computeUnreadCount(notes)).toBe(0);
    });

    it('counts unread notes correctly', () => {
      const notes = [
        { read_at: null },
        { read_at: '2026-01-01T00:00:00Z' },
        { read_at: null },
      ];
      expect(computeUnreadCount(notes)).toBe(2);
    });

    it('returns total for all unread', () => {
      const notes = [{ read_at: null }, { read_at: null }, { read_at: null }];
      expect(computeUnreadCount(notes)).toBe(3);
    });

    it('returns 0 for empty array', () => {
      expect(computeUnreadCount([])).toBe(0);
    });
  });

  describe('shouldMarkRead', () => {
    it('returns true when note has no read_at', () => {
      expect(shouldMarkRead({ read_at: null })).toBe(true);
    });

    it('returns false when note has read_at', () => {
      expect(shouldMarkRead({ read_at: '2026-01-01T00:00:00Z' })).toBe(false);
    });
  });
});
