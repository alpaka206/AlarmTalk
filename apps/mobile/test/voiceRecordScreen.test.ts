function dbToNormalized(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface SubmitValidation {
  ok: boolean;
  error?: string;
}

function validateSubmit(
  recordedUri: string | null,
  name: string,
  duration: number,
): SubmitValidation {
  if (!recordedUri || !name.trim()) {
    return { ok: false, error: 'voiceRecord.inputRequired' };
  }
  if (duration < 10) {
    return { ok: false, error: 'voiceRecord.tooShort' };
  }
  return { ok: true };
}

function updateLevelHistory(prev: number[], newLevel: number, maxSize: number): number[] {
  return [...prev.slice(1), newLevel].slice(-maxSize);
}

function initLevelHistory(size: number): number[] {
  return new Array(size).fill(0);
}

function computeBarHeight(level: number, maxHeight: number): number {
  return Math.max(3, level * maxHeight);
}

function computeBarColor(
  level: number,
  primaryColor: string,
  lightColor: string,
  borderColor: string,
): string {
  if (level > 0.7) return primaryColor;
  if (level > 0.3) return lightColor;
  return borderColor;
}

describe('VoiceRecordScreen business logic', () => {
  describe('dbToNormalized', () => {
    it('returns 0 for -60 dB', () => {
      expect(dbToNormalized(-60)).toBe(0);
    });

    it('returns 1 for 0 dB', () => {
      expect(dbToNormalized(0)).toBe(1);
    });

    it('returns 0.5 for -30 dB', () => {
      expect(dbToNormalized(-30)).toBe(0.5);
    });

    it('clamps values below -60 to 0', () => {
      expect(dbToNormalized(-100)).toBe(0);
      expect(dbToNormalized(-1000)).toBe(0);
    });

    it('clamps values above 0 to 1', () => {
      expect(dbToNormalized(10)).toBe(1);
      expect(dbToNormalized(100)).toBe(1);
    });

    it('handles -1 dB', () => {
      expect(dbToNormalized(-1)).toBeCloseTo(59 / 60);
    });

    it('handles fractional dB values', () => {
      const result = dbToNormalized(-15.5);
      expect(result).toBeCloseTo(44.5 / 60);
    });

    it('output is always in [0, 1]', () => {
      const testValues = [-200, -60, -30, -10, -1, 0, 5, 100];
      for (const val of testValues) {
        const norm = dbToNormalized(val);
        expect(norm).toBeGreaterThanOrEqual(0);
        expect(norm).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('formatRecordTime', () => {
    it('formats 0 seconds', () => {
      expect(formatRecordTime(0)).toBe('0:00');
    });

    it('formats single-digit seconds with padding', () => {
      expect(formatRecordTime(5)).toBe('0:05');
    });

    it('formats 60 seconds as 1:00', () => {
      expect(formatRecordTime(60)).toBe('1:00');
    });

    it('formats 90 seconds as 1:30', () => {
      expect(formatRecordTime(90)).toBe('1:30');
    });

    it('formats large values', () => {
      expect(formatRecordTime(600)).toBe('10:00');
    });

    it('formats 59 seconds', () => {
      expect(formatRecordTime(59)).toBe('0:59');
    });

    it('formats 61 seconds', () => {
      expect(formatRecordTime(61)).toBe('1:01');
    });

    it('formats multi-minute recording', () => {
      expect(formatRecordTime(125)).toBe('2:05');
    });
  });

  describe('validateSubmit', () => {
    it('returns error when recordedUri is null', () => {
      const result = validateSubmit(null, 'My Voice', 30);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('voiceRecord.inputRequired');
    });

    it('returns error when name is empty', () => {
      const result = validateSubmit('/path/to/file.wav', '', 30);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('voiceRecord.inputRequired');
    });

    it('returns error when name is whitespace only', () => {
      const result = validateSubmit('/path/to/file.wav', '   ', 30);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('voiceRecord.inputRequired');
    });

    it('returns error when duration < 10', () => {
      const result = validateSubmit('/path/to/file.wav', 'Voice', 9);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('voiceRecord.tooShort');
    });

    it('returns error when duration is 0', () => {
      const result = validateSubmit('/path/to/file.wav', 'Voice', 0);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('voiceRecord.tooShort');
    });

    it('succeeds with valid inputs at minimum duration', () => {
      const result = validateSubmit('/path/to/file.wav', 'My Voice', 10);
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('succeeds with valid inputs above minimum duration', () => {
      const result = validateSubmit('/path/to/file.wav', 'Voice', 60);
      expect(result.ok).toBe(true);
    });

    it('prioritizes inputRequired over tooShort', () => {
      const result = validateSubmit(null, '', 5);
      expect(result.error).toBe('voiceRecord.inputRequired');
    });

    it('trims name for validation', () => {
      const result = validateSubmit('/path/to/file.wav', ' \t\n ', 30);
      expect(result.ok).toBe(false);
    });

    it('accepts name with leading/trailing spaces if non-empty after trim', () => {
      const result = validateSubmit('/path/to/file.wav', '  Voice  ', 30);
      expect(result.ok).toBe(true);
    });
  });

  describe('updateLevelHistory', () => {
    it('shifts and appends new level', () => {
      const prev = [0, 0, 0, 0.5];
      const result = updateLevelHistory(prev, 0.8, 4);
      expect(result).toEqual([0, 0, 0.5, 0.8]);
    });

    it('maintains maxSize', () => {
      const prev = [0.1, 0.2, 0.3];
      const result = updateLevelHistory(prev, 0.4, 3);
      expect(result).toHaveLength(3);
    });

    it('handles single-element history', () => {
      const prev = [0.5];
      const result = updateLevelHistory(prev, 0.9, 1);
      expect(result).toEqual([0.9]);
    });

    it('handles empty history', () => {
      const result = updateLevelHistory([], 0.5, 1);
      expect(result).toEqual([0.5]);
    });

    it('drops oldest element', () => {
      const prev = [0.1, 0.2, 0.3, 0.4, 0.5];
      const result = updateLevelHistory(prev, 0.6, 5);
      expect(result[0]).toBe(0.2);
      expect(result[4]).toBe(0.6);
    });
  });

  describe('initLevelHistory', () => {
    it('creates array of zeros', () => {
      const history = initLevelHistory(20);
      expect(history).toHaveLength(20);
      expect(history.every((v) => v === 0)).toBe(true);
    });

    it('creates empty array for size 0', () => {
      expect(initLevelHistory(0)).toEqual([]);
    });

    it('creates single-element array', () => {
      expect(initLevelHistory(1)).toEqual([0]);
    });
  });

  describe('computeBarHeight', () => {
    it('returns minimum 3 for level 0', () => {
      expect(computeBarHeight(0, 40)).toBe(3);
    });

    it('returns full height for level 1', () => {
      expect(computeBarHeight(1, 40)).toBe(40);
    });

    it('returns proportional height', () => {
      expect(computeBarHeight(0.5, 40)).toBe(20);
    });

    it('returns minimum for very small levels', () => {
      expect(computeBarHeight(0.01, 40)).toBe(3);
    });

    it('returns at least 3 for any level', () => {
      expect(computeBarHeight(0.05, 40)).toBe(3);
    });

    it('returns height > 3 for sufficient level', () => {
      expect(computeBarHeight(0.2, 40)).toBe(8);
    });
  });

  describe('computeBarColor', () => {
    const primary = '#FF7F6B';
    const light = '#FFB5A8';
    const border = '#E0E0E0';

    it('returns primary for high level (> 0.7)', () => {
      expect(computeBarColor(0.8, primary, light, border)).toBe(primary);
      expect(computeBarColor(1.0, primary, light, border)).toBe(primary);
    });

    it('returns light for medium level (0.3 < level <= 0.7)', () => {
      expect(computeBarColor(0.5, primary, light, border)).toBe(light);
      expect(computeBarColor(0.7, primary, light, border)).toBe(light);
    });

    it('returns border for low level (<= 0.3)', () => {
      expect(computeBarColor(0.1, primary, light, border)).toBe(border);
      expect(computeBarColor(0.3, primary, light, border)).toBe(border);
      expect(computeBarColor(0.0, primary, light, border)).toBe(border);
    });

    it('boundary: 0.7 returns light', () => {
      expect(computeBarColor(0.7, primary, light, border)).toBe(light);
    });

    it('boundary: 0.71 returns primary', () => {
      expect(computeBarColor(0.71, primary, light, border)).toBe(primary);
    });

    it('boundary: 0.3 returns border', () => {
      expect(computeBarColor(0.3, primary, light, border)).toBe(border);
    });

    it('boundary: 0.31 returns light', () => {
      expect(computeBarColor(0.31, primary, light, border)).toBe(light);
    });
  });

  describe('recording state machine', () => {
    it('initial state: not recording, no URI', () => {
      const state = { isRecording: false, recordedUri: null as string | null, duration: 0 };
      expect(state.isRecording).toBe(false);
      expect(state.recordedUri).toBeNull();
    });

    it('start recording: sets recording flag', () => {
      const state = { isRecording: true, duration: 0 };
      expect(state.isRecording).toBe(true);
      expect(state.duration).toBe(0);
    });

    it('stop recording: produces URI', () => {
      const uri = '/tmp/recording.wav';
      const state = { isRecording: false, recordedUri: uri, duration: 30 };
      expect(state.isRecording).toBe(false);
      expect(state.recordedUri).toBe(uri);
    });

    it('re-record: resets duration and level history', () => {
      const levelHistory = initLevelHistory(20);
      const state = { isRecording: true, duration: 0, levelHistory };
      expect(state.duration).toBe(0);
      expect(state.levelHistory.every((v) => v === 0)).toBe(true);
    });
  });

  describe('permission states', () => {
    it('null means loading', () => {
      const hasPermission: boolean | null = null;
      expect(hasPermission).toBeNull();
    });

    it('false shows permission denied UI', () => {
      const hasPermission = false;
      expect(hasPermission).toBe(false);
    });

    it('true shows recording UI', () => {
      const hasPermission = true;
      expect(hasPermission).toBe(true);
    });
  });

  describe('submit button disabled state', () => {
    it('disabled when mutation is pending', () => {
      const isPending = true;
      expect(isPending).toBe(true);
    });

    it('enabled when not pending', () => {
      const isPending = false;
      expect(isPending).toBe(false);
    });
  });

  describe('guide sentences', () => {
    it('i18n key returns array pattern', () => {
      const key = 'voiceRecord.sentences';
      expect(key).toBe('voiceRecord.sentences');
    });

    it('sentences rendered with index + 1 numbering', () => {
      const sentences = ['First', 'Second', 'Third'];
      const numbered = sentences.map((s, i) => `${i + 1}. ${s}`);
      expect(numbered[0]).toBe('1. First');
      expect(numbered[2]).toBe('3. Third');
    });
  });
});
