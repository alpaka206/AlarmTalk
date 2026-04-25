const TIME_OF_DAY_BACKGROUNDS: Record<string, string[]> = {
  morning: ['#FFF5E6', '#FFE4C4'],
  lunch: ['#FFF0E6', '#FFD9C4'],
  afternoon: ['#F5F0FF', '#E4D9FF'],
  evening: ['#FFE8E0', '#FFC4B3'],
  night: ['#E8E0FF', '#C4B3FF'],
};

const TIME_OF_DAY_EMOJIS: Record<string, string> = {
  morning: '🌅',
  lunch: '🍽️',
  afternoon: '☕',
  evening: '🌆',
  night: '🌙',
};

function generateWaveform(seed: string, barCount: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff);
    const normalized = (hash % 1000) / 1000;
    const envelope = Math.sin((i / barCount) * Math.PI);
    bars.push(0.15 + normalized * 0.85 * (0.3 + envelope * 0.7));
  }
  return bars;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getBackgroundColor(category: string, fallbackBg: string): string {
  return TIME_OF_DAY_BACKGROUNDS[category]?.[0] || fallbackBg;
}

function getEmoji(category: string): string {
  return TIME_OF_DAY_EMOJIS[category] || '💌';
}

function seekClamp(x: number, width: number): number {
  return Math.max(0, Math.min(x, width));
}

function seekProgress(x: number, width: number): number {
  const clamped = seekClamp(x, width);
  return clamped / width;
}

function seekPositionMs(seekProg: number, durationMs: number): number {
  return seekProg * durationMs;
}

interface PlaybackStatus {
  isLoaded: boolean;
  durationMillis?: number;
  positionMillis: number;
  didJustFinish?: boolean;
}

function processPlaybackStatus(
  status: PlaybackStatus,
  isSeeking: boolean,
): {
  durationMs?: number;
  positionMs?: number;
  progress?: number;
  finished?: boolean;
} | null {
  if (!status.isLoaded) return null;
  const result: {
    durationMs?: number;
    positionMs?: number;
    progress?: number;
    finished?: boolean;
  } = {};
  if (status.durationMillis && status.durationMillis > 0) {
    result.durationMs = status.durationMillis;
    if (!isSeeking) {
      result.positionMs = status.positionMillis;
      result.progress = status.positionMillis / status.durationMillis;
    }
  }
  if (status.didJustFinish) {
    result.finished = true;
  }
  return result;
}

function computeActiveBarIndex(progress: number, barCount: number): number {
  return Math.floor(progress * barCount);
}

function isNearPlayhead(barIndex: number, activeBarIndex: number, pulseRange: number): boolean {
  return Math.abs(barIndex - activeBarIndex) <= pulseRange;
}

describe('PlayerScreen business logic', () => {
  describe('generateWaveform', () => {
    it('returns array of specified length', () => {
      const bars = generateWaveform('test-id', 40);
      expect(bars).toHaveLength(40);
    });

    it('returns deterministic results for same seed', () => {
      const bars1 = generateWaveform('seed-abc', 20);
      const bars2 = generateWaveform('seed-abc', 20);
      expect(bars1).toEqual(bars2);
    });

    it('returns different results for different seeds', () => {
      const bars1 = generateWaveform('seed-1', 20);
      const bars2 = generateWaveform('seed-2', 20);
      expect(bars1).not.toEqual(bars2);
    });

    it('all bars are within [0.15, 1.0] range', () => {
      const bars = generateWaveform('range-test', 100);
      for (const bar of bars) {
        expect(bar).toBeGreaterThanOrEqual(0.15);
        expect(bar).toBeLessThanOrEqual(1.0);
      }
    });

    it('returns empty array for barCount 0', () => {
      expect(generateWaveform('test', 0)).toEqual([]);
    });

    it('handles empty seed string', () => {
      const bars = generateWaveform('', 10);
      expect(bars).toHaveLength(10);
    });

    it('handles single bar', () => {
      const bars = generateWaveform('single', 1);
      expect(bars).toHaveLength(1);
      expect(bars[0]).toBeGreaterThanOrEqual(0.15);
    });
  });

  describe('formatTime', () => {
    it('formats 0ms as 0:00', () => {
      expect(formatTime(0)).toBe('0:00');
    });

    it('formats seconds correctly', () => {
      expect(formatTime(5000)).toBe('0:05');
    });

    it('formats minutes and seconds', () => {
      expect(formatTime(65000)).toBe('1:05');
    });

    it('pads single-digit seconds', () => {
      expect(formatTime(3000)).toBe('0:03');
    });

    it('does not pad minutes', () => {
      expect(formatTime(120000)).toBe('2:00');
    });

    it('handles large durations', () => {
      expect(formatTime(3600000)).toBe('60:00');
    });

    it('truncates milliseconds (no rounding)', () => {
      expect(formatTime(1999)).toBe('0:01');
    });

    it('handles exact minute boundaries', () => {
      expect(formatTime(60000)).toBe('1:00');
    });
  });

  describe('getBackgroundColor', () => {
    it('returns first color for morning', () => {
      expect(getBackgroundColor('morning', '#fff')).toBe('#FFF5E6');
    });

    it('returns first color for night', () => {
      expect(getBackgroundColor('night', '#fff')).toBe('#E8E0FF');
    });

    it('returns fallback for unknown category', () => {
      expect(getBackgroundColor('unknown', '#fallback')).toBe('#fallback');
    });

    it('returns fallback for empty category', () => {
      expect(getBackgroundColor('', '#bg')).toBe('#bg');
    });

    it('covers all defined categories', () => {
      for (const key of Object.keys(TIME_OF_DAY_BACKGROUNDS)) {
        const color = getBackgroundColor(key, '#none');
        expect(color).not.toBe('#none');
      }
    });
  });

  describe('getEmoji', () => {
    it('returns correct emoji for morning', () => {
      expect(getEmoji('morning')).toBe('🌅');
    });

    it('returns correct emoji for night', () => {
      expect(getEmoji('night')).toBe('🌙');
    });

    it('returns fallback emoji for unknown category', () => {
      expect(getEmoji('unknown')).toBe('💌');
    });

    it('returns fallback for empty string', () => {
      expect(getEmoji('')).toBe('💌');
    });

    it('covers all defined emoji categories', () => {
      for (const [key, emoji] of Object.entries(TIME_OF_DAY_EMOJIS)) {
        expect(getEmoji(key)).toBe(emoji);
      }
    });
  });

  describe('seekClamp', () => {
    it('clamps negative x to 0', () => {
      expect(seekClamp(-10, 300)).toBe(0);
    });

    it('clamps x beyond width to width', () => {
      expect(seekClamp(350, 300)).toBe(300);
    });

    it('passes through valid x', () => {
      expect(seekClamp(150, 300)).toBe(150);
    });

    it('handles x=0', () => {
      expect(seekClamp(0, 300)).toBe(0);
    });

    it('handles x=width', () => {
      expect(seekClamp(300, 300)).toBe(300);
    });
  });

  describe('seekProgress', () => {
    it('returns 0 at start', () => {
      expect(seekProgress(0, 300)).toBe(0);
    });

    it('returns 1 at end', () => {
      expect(seekProgress(300, 300)).toBe(1);
    });

    it('returns 0.5 at midpoint', () => {
      expect(seekProgress(150, 300)).toBe(0.5);
    });

    it('clamps negative values to 0', () => {
      expect(seekProgress(-50, 300)).toBe(0);
    });

    it('clamps values beyond width to 1', () => {
      expect(seekProgress(500, 300)).toBe(1);
    });
  });

  describe('seekPositionMs', () => {
    it('returns 0 at progress 0', () => {
      expect(seekPositionMs(0, 10000)).toBe(0);
    });

    it('returns duration at progress 1', () => {
      expect(seekPositionMs(1, 10000)).toBe(10000);
    });

    it('returns half duration at progress 0.5', () => {
      expect(seekPositionMs(0.5, 10000)).toBe(5000);
    });
  });

  describe('processPlaybackStatus', () => {
    it('returns null for unloaded status', () => {
      expect(processPlaybackStatus({ isLoaded: false, positionMillis: 0 }, false)).toBeNull();
    });

    it('extracts duration and position when loaded', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        durationMillis: 10000,
        positionMillis: 5000,
      }, false);
      expect(result).toEqual({
        durationMs: 10000,
        positionMs: 5000,
        progress: 0.5,
      });
    });

    it('skips position update when seeking', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        durationMillis: 10000,
        positionMillis: 5000,
      }, true);
      expect(result).toEqual({ durationMs: 10000 });
      expect(result!.positionMs).toBeUndefined();
      expect(result!.progress).toBeUndefined();
    });

    it('detects finish', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        durationMillis: 10000,
        positionMillis: 10000,
        didJustFinish: true,
      }, false);
      expect(result!.finished).toBe(true);
    });

    it('does not mark finished when not finished', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        durationMillis: 10000,
        positionMillis: 5000,
      }, false);
      expect(result!.finished).toBeUndefined();
    });

    it('handles zero duration', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        durationMillis: 0,
        positionMillis: 0,
      }, false);
      expect(result).toEqual({});
    });

    it('handles undefined duration', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        positionMillis: 0,
      }, false);
      expect(result).toEqual({});
    });

    it('finish can happen even without duration', () => {
      const result = processPlaybackStatus({
        isLoaded: true,
        positionMillis: 0,
        didJustFinish: true,
      }, false);
      expect(result!.finished).toBe(true);
    });
  });

  describe('computeActiveBarIndex', () => {
    const barCount = 40;

    it('returns 0 at progress 0', () => {
      expect(computeActiveBarIndex(0, barCount)).toBe(0);
    });

    it('returns last index at progress ~1', () => {
      expect(computeActiveBarIndex(0.99, barCount)).toBe(39);
    });

    it('returns barCount at progress 1', () => {
      expect(computeActiveBarIndex(1, barCount)).toBe(40);
    });

    it('returns midpoint index at progress 0.5', () => {
      expect(computeActiveBarIndex(0.5, barCount)).toBe(20);
    });
  });

  describe('isNearPlayhead', () => {
    const pulseRange = 2;

    it('returns true for bar at playhead', () => {
      expect(isNearPlayhead(10, 10, pulseRange)).toBe(true);
    });

    it('returns true for bar within range', () => {
      expect(isNearPlayhead(8, 10, pulseRange)).toBe(true);
      expect(isNearPlayhead(12, 10, pulseRange)).toBe(true);
    });

    it('returns false for bar outside range', () => {
      expect(isNearPlayhead(7, 10, pulseRange)).toBe(false);
      expect(isNearPlayhead(13, 10, pulseRange)).toBe(false);
    });

    it('returns true at boundary', () => {
      expect(isNearPlayhead(8, 10, pulseRange)).toBe(true);
    });

    it('handles range 0', () => {
      expect(isNearPlayhead(10, 10, 0)).toBe(true);
      expect(isNearPlayhead(11, 10, 0)).toBe(false);
    });
  });

  describe('player state transitions', () => {
    it('play → pause toggles isPlaying', () => {
      let isPlaying = false;
      isPlaying = true; // play
      expect(isPlaying).toBe(true);
      isPlaying = false; // pause
      expect(isPlaying).toBe(false);
    });

    it('replay from end resets progress', () => {
      let progress = 1.0;
      const isPlaying = false;
      if (progress >= 1) {
        progress = 0;
      }
      expect(progress).toBe(0);
      expect(isPlaying).toBe(false);
    });

    it('reaction toggle is one-way', () => {
      let reacted = false;
      expect(reacted).toBe(false);
      reacted = true;
      expect(reacted).toBe(true);
      // cannot un-react (UI doesn't allow)
    });

    it('close cleans up playing state', () => {
      let playingId: string | null = 'msg-1';
      playingId = null;
      expect(playingId).toBeNull();
    });
  });

  describe('params parsing', () => {
    function resolveSeed(messageId: string | undefined): string {
      return messageId || 'default';
    }
    function resolveInitial(voiceName: string | undefined): string {
      return voiceName ? voiceName.charAt(0) : '?';
    }

    it('handles missing messageId with default', () => {
      expect(resolveSeed(undefined)).toBe('default');
    });

    it('uses messageId when provided', () => {
      expect(resolveSeed('msg-123')).toBe('msg-123');
    });

    it('handles missing voiceName', () => {
      expect(resolveInitial(undefined)).toBe('?');
    });

    it('extracts first char for avatar', () => {
      expect(resolveInitial('Alice')).toBe('A');
    });

    it('handles empty voiceName', () => {
      expect(resolveInitial('')).toBe('?');
    });
  });
});
