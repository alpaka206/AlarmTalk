type AlarmMode = 'tts' | 'sound-only';
type VibrationPattern = 'default' | 'strong' | 'none';
type WakeMode = 'sound_then_voice' | 'voice_only';

interface AlarmResponse {
  id: string;
  time: string;
  repeat_days: number[] | string;
  message_id: string;
  snooze_minutes: number;
  mode: string;
  vibration_pattern?: string;
  voice_profile_id?: string | null;
  wake_mode?: string;
  is_active: boolean;
}

interface VoiceProfile {
  id: string;
  name: string;
  status: 'ready' | 'processing' | 'failed';
}

interface FamilyVoiceProfile extends VoiceProfile {
  owner_name?: string;
}

function parseRepeatDays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.filter((n): n is number => Number.isInteger(n));
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((n): n is number => Number.isInteger(n));
      }
    } catch {
      return [];
    }
  }
  return [];
}

function parseAlarmTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return { hour: h, minute: m };
}

function parseAlarmToState(alarm: AlarmResponse) {
  const { hour, minute } = parseAlarmTime(alarm.time);
  return {
    hour,
    minute,
    repeatDays: parseRepeatDays(alarm.repeat_days),
    selectedMessageId: alarm.message_id,
    snooze: alarm.snooze_minutes,
    mode: (alarm.mode === 'sound-only' ? 'sound-only' : 'tts') as AlarmMode,
    vibrationPattern: (alarm.vibration_pattern ?? 'default') as VibrationPattern,
    voiceProfileId: alarm.voice_profile_id ?? null,
    wakeMode: (alarm.wake_mode === 'voice_only' ? 'voice_only' : 'sound_then_voice') as WakeMode,
  };
}

function quickSetDays(type: 'daily' | 'weekday' | 'weekend'): number[] {
  if (type === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (type === 'weekday') return [1, 2, 3, 4, 5];
  return [0, 6];
}

function toggleDay(prev: number[], day: number): number[] {
  return prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
}

function computeSoundOnlyInvalid(mode: AlarmMode, voiceProfileId: string | null): boolean {
  return mode === 'sound-only' && !voiceProfileId;
}

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function computeAmPm(hour: number): 'am' | 'pm' {
  return hour < 12 ? 'am' : 'pm';
}

function buildSubmitPayload(
  state: ReturnType<typeof parseAlarmToState>,
) {
  const time = formatTime(state.hour, state.minute);
  return {
    message_id: state.selectedMessageId,
    time,
    repeat_days: state.repeatDays,
    snooze_minutes: state.snooze,
    mode: state.mode,
    vibration_pattern: state.vibrationPattern,
    voice_profile_id: state.voiceProfileId,
    wake_mode: state.mode === 'tts' ? state.wakeMode : ('sound_then_voice' as WakeMode),
  };
}

function filterReadyVoices<T extends { status: string }>(voices: T[]): T[] {
  return voices.filter((v) => v.status === 'ready');
}

function isSubmitDisabled(
  selectedMessageId: string | null,
  soundOnlyInvalid: boolean,
  isPending: boolean,
): boolean {
  return !selectedMessageId || soundOnlyInvalid || isPending;
}

// ---------- Tests ----------

describe('alarmEditScreen — parseAlarmTime', () => {
  test('parses "07:00"', () => {
    expect(parseAlarmTime('07:00')).toEqual({ hour: 7, minute: 0 });
  });
  test('parses "23:59"', () => {
    expect(parseAlarmTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });
  test('parses "00:00"', () => {
    expect(parseAlarmTime('00:00')).toEqual({ hour: 0, minute: 0 });
  });
  test('parses "12:30"', () => {
    expect(parseAlarmTime('12:30')).toEqual({ hour: 12, minute: 30 });
  });
});

describe('alarmEditScreen — parseAlarmToState', () => {
  const base: AlarmResponse = {
    id: 'a1',
    time: '08:30',
    repeat_days: [1, 2, 3],
    message_id: 'msg1',
    snooze_minutes: 10,
    mode: 'tts',
    vibration_pattern: 'strong',
    voice_profile_id: 'vp1',
    wake_mode: 'voice_only',
    is_active: true,
  };

  test('parses all fields correctly', () => {
    const s = parseAlarmToState(base);
    expect(s.hour).toBe(8);
    expect(s.minute).toBe(30);
    expect(s.repeatDays).toEqual([1, 2, 3]);
    expect(s.selectedMessageId).toBe('msg1');
    expect(s.snooze).toBe(10);
    expect(s.mode).toBe('tts');
    expect(s.vibrationPattern).toBe('strong');
    expect(s.voiceProfileId).toBe('vp1');
    expect(s.wakeMode).toBe('voice_only');
  });

  test('defaults mode to tts for unknown values', () => {
    const s = parseAlarmToState({ ...base, mode: 'unknown' });
    expect(s.mode).toBe('tts');
  });

  test('defaults mode to sound-only when specified', () => {
    const s = parseAlarmToState({ ...base, mode: 'sound-only' });
    expect(s.mode).toBe('sound-only');
  });

  test('defaults vibrationPattern to "default" when undefined', () => {
    const s = parseAlarmToState({ ...base, vibration_pattern: undefined });
    expect(s.vibrationPattern).toBe('default');
  });

  test('defaults voiceProfileId to null when null', () => {
    const s = parseAlarmToState({ ...base, voice_profile_id: null });
    expect(s.voiceProfileId).toBeNull();
  });

  test('defaults wakeMode to sound_then_voice when not voice_only', () => {
    const s = parseAlarmToState({ ...base, wake_mode: 'sound_then_voice' });
    expect(s.wakeMode).toBe('sound_then_voice');
  });

  test('defaults wakeMode to sound_then_voice for unknown', () => {
    const s = parseAlarmToState({ ...base, wake_mode: undefined });
    expect(s.wakeMode).toBe('sound_then_voice');
  });

  test('parses repeat_days from JSON string', () => {
    const s = parseAlarmToState({ ...base, repeat_days: '[0,6]' });
    expect(s.repeatDays).toEqual([0, 6]);
  });

  test('parses repeat_days empty array', () => {
    const s = parseAlarmToState({ ...base, repeat_days: [] });
    expect(s.repeatDays).toEqual([]);
  });
});

describe('alarmEditScreen — quickSetDays', () => {
  test('daily returns all 7 days', () => {
    expect(quickSetDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  test('weekday returns Mon-Fri', () => {
    expect(quickSetDays('weekday')).toEqual([1, 2, 3, 4, 5]);
  });
  test('weekend returns Sun+Sat', () => {
    expect(quickSetDays('weekend')).toEqual([0, 6]);
  });
});

describe('alarmEditScreen — toggleDay', () => {
  test('adds a day not in list', () => {
    expect(toggleDay([1, 2], 3)).toEqual([1, 2, 3]);
  });
  test('removes a day in list', () => {
    expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3]);
  });
  test('adds to empty list', () => {
    expect(toggleDay([], 5)).toEqual([5]);
  });
  test('removes last day', () => {
    expect(toggleDay([4], 4)).toEqual([]);
  });
  test('does not mutate original', () => {
    const orig = [0, 1];
    toggleDay(orig, 2);
    expect(orig).toEqual([0, 1]);
  });
});

describe('alarmEditScreen — computeSoundOnlyInvalid', () => {
  test('true when sound-only and no voiceProfileId', () => {
    expect(computeSoundOnlyInvalid('sound-only', null)).toBe(true);
  });
  test('false when sound-only and voiceProfileId exists', () => {
    expect(computeSoundOnlyInvalid('sound-only', 'vp1')).toBe(false);
  });
  test('false when tts mode regardless of voiceProfileId', () => {
    expect(computeSoundOnlyInvalid('tts', null)).toBe(false);
  });
  test('false when tts mode with voiceProfileId', () => {
    expect(computeSoundOnlyInvalid('tts', 'vp1')).toBe(false);
  });
  test('true when sound-only and empty string voiceProfileId', () => {
    expect(computeSoundOnlyInvalid('sound-only', '')).toBe(true);
  });
});

describe('alarmEditScreen — formatTime', () => {
  test('pads single digit hour', () => {
    expect(formatTime(7, 0)).toBe('07:00');
  });
  test('pads single digit minute', () => {
    expect(formatTime(12, 5)).toBe('12:05');
  });
  test('no padding needed', () => {
    expect(formatTime(23, 59)).toBe('23:59');
  });
  test('midnight', () => {
    expect(formatTime(0, 0)).toBe('00:00');
  });
});

describe('alarmEditScreen — computeAmPm', () => {
  test('am for hour 0', () => {
    expect(computeAmPm(0)).toBe('am');
  });
  test('am for hour 11', () => {
    expect(computeAmPm(11)).toBe('am');
  });
  test('pm for hour 12', () => {
    expect(computeAmPm(12)).toBe('pm');
  });
  test('pm for hour 23', () => {
    expect(computeAmPm(23)).toBe('pm');
  });
});

describe('alarmEditScreen — buildSubmitPayload', () => {
  const state = {
    hour: 8,
    minute: 30,
    repeatDays: [1, 2, 3, 4, 5],
    selectedMessageId: 'msg1',
    snooze: 10,
    mode: 'tts' as AlarmMode,
    vibrationPattern: 'strong' as VibrationPattern,
    voiceProfileId: 'vp1',
    wakeMode: 'voice_only' as WakeMode,
  };

  test('builds correct payload for tts mode', () => {
    const p = buildSubmitPayload(state);
    expect(p.time).toBe('08:30');
    expect(p.message_id).toBe('msg1');
    expect(p.repeat_days).toEqual([1, 2, 3, 4, 5]);
    expect(p.snooze_minutes).toBe(10);
    expect(p.mode).toBe('tts');
    expect(p.vibration_pattern).toBe('strong');
    expect(p.voice_profile_id).toBe('vp1');
    expect(p.wake_mode).toBe('voice_only');
  });

  test('forces wake_mode to sound_then_voice in sound-only mode', () => {
    const p = buildSubmitPayload({ ...state, mode: 'sound-only' });
    expect(p.wake_mode).toBe('sound_then_voice');
  });

  test('preserves wake_mode in tts mode', () => {
    const p = buildSubmitPayload({ ...state, mode: 'tts', wakeMode: 'sound_then_voice' });
    expect(p.wake_mode).toBe('sound_then_voice');
  });
});

describe('alarmEditScreen — filterReadyVoices', () => {
  const voices: VoiceProfile[] = [
    { id: '1', name: 'Voice A', status: 'ready' },
    { id: '2', name: 'Voice B', status: 'processing' },
    { id: '3', name: 'Voice C', status: 'ready' },
    { id: '4', name: 'Voice D', status: 'failed' },
  ];

  test('filters to only ready voices', () => {
    const result = filterReadyVoices(voices);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.id)).toEqual(['1', '3']);
  });

  test('returns empty for no ready voices', () => {
    expect(filterReadyVoices([{ id: '1', name: 'X', status: 'processing' }])).toEqual([]);
  });

  test('returns empty for empty input', () => {
    expect(filterReadyVoices([])).toEqual([]);
  });

  test('works with FamilyVoiceProfile', () => {
    const fvp: FamilyVoiceProfile[] = [
      { id: '1', name: 'A', status: 'ready', owner_name: 'Mom' },
      { id: '2', name: 'B', status: 'failed', owner_name: 'Dad' },
    ];
    const result = filterReadyVoices(fvp);
    expect(result).toHaveLength(1);
    expect(result[0]!.owner_name).toBe('Mom');
  });
});

describe('alarmEditScreen — isSubmitDisabled', () => {
  test('disabled when no message selected', () => {
    expect(isSubmitDisabled(null, false, false)).toBe(true);
  });
  test('disabled when soundOnlyInvalid', () => {
    expect(isSubmitDisabled('msg1', true, false)).toBe(true);
  });
  test('disabled when isPending', () => {
    expect(isSubmitDisabled('msg1', false, true)).toBe(true);
  });
  test('enabled when all conditions met', () => {
    expect(isSubmitDisabled('msg1', false, false)).toBe(false);
  });
  test('disabled when all flags are bad', () => {
    expect(isSubmitDisabled(null, true, true)).toBe(true);
  });
});

describe('alarmEditScreen — full state roundtrip', () => {
  test('alarm → state → submit preserves semantics', () => {
    const alarm: AlarmResponse = {
      id: 'a1',
      time: '14:45',
      repeat_days: [0, 6],
      message_id: 'msg-weekend',
      snooze_minutes: 15,
      mode: 'tts',
      vibration_pattern: 'none',
      voice_profile_id: null,
      wake_mode: 'sound_then_voice',
      is_active: true,
    };

    const state = parseAlarmToState(alarm);
    const payload = buildSubmitPayload(state);

    expect(payload.time).toBe('14:45');
    expect(payload.repeat_days).toEqual([0, 6]);
    expect(payload.message_id).toBe('msg-weekend');
    expect(payload.snooze_minutes).toBe(15);
    expect(payload.mode).toBe('tts');
    expect(payload.vibration_pattern).toBe('none');
    expect(payload.voice_profile_id).toBeNull();
    expect(payload.wake_mode).toBe('sound_then_voice');
  });

  test('sound-only alarm roundtrip', () => {
    const alarm: AlarmResponse = {
      id: 'a2',
      time: '06:00',
      repeat_days: [1, 2, 3, 4, 5],
      message_id: 'msg-work',
      snooze_minutes: 5,
      mode: 'sound-only',
      vibration_pattern: 'strong',
      voice_profile_id: 'vp-mom',
      wake_mode: 'voice_only',
      is_active: true,
    };

    const state = parseAlarmToState(alarm);
    expect(state.mode).toBe('sound-only');

    const payload = buildSubmitPayload(state);
    expect(payload.wake_mode).toBe('sound_then_voice');
    expect(payload.voice_profile_id).toBe('vp-mom');
  });
});
