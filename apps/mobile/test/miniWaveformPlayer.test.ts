const BAR_COUNT = 24;

interface PlaybackState {
  isPlaying: boolean;
  progress: number;
  positionMs: number;
  durationMs: number;
  hasSound: boolean;
}

function computeProgress(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return positionMs / durationMs;
}

function handleStatusUpdate(
  state: PlaybackState,
  statusPosition: number,
  statusDuration: number,
  didFinish: boolean,
): PlaybackState {
  const next = { ...state };
  if (statusDuration > 0) {
    next.durationMs = statusDuration;
    next.positionMs = statusPosition;
    next.progress = statusPosition / statusDuration;
  }
  if (didFinish) {
    next.isPlaying = false;
    next.progress = 1;
  }
  return next;
}

type ToggleAction =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'replay' }
  | { type: 'play_new' }
  | { type: 'no_cache' };

function determineToggleAction(
  hasSound: boolean,
  isPlaying: boolean,
  progress: number,
  isCached: boolean,
): ToggleAction {
  if (hasSound) {
    if (isPlaying) return { type: 'pause' };
    if (progress >= 1) return { type: 'replay' };
    return { type: 'resume' };
  }
  if (!isCached) return { type: 'no_cache' };
  return { type: 'play_new' };
}

function getBarColor(
  barIndex: number,
  barCount: number,
  progress: number,
  primaryColor: string,
  lightColor: string,
): string {
  return barIndex / barCount < progress ? primaryColor : lightColor;
}

function getAccessibilityLabel(
  isPlaying: boolean,
  t: (key: string) => string,
): string {
  return isPlaying ? t('player.a11yPause') : t('player.a11yPlay');
}

function formatTimeDisplay(
  positionMs: number,
  durationMs: number,
  formatTime: (ms: number) => string,
): string {
  const pos = formatTime(positionMs);
  return durationMs > 0 ? `${pos} / ${formatTime(durationMs)}` : pos;
}

describe('MiniWaveformPlayer — progress calculation', () => {
  it('returns 0 when duration is 0', () => {
    expect(computeProgress(500, 0)).toBe(0);
  });

  it('returns 0 when duration is negative', () => {
    expect(computeProgress(500, -1)).toBe(0);
  });

  it('computes correct midpoint progress', () => {
    expect(computeProgress(5000, 10000)).toBe(0.5);
  });

  it('computes correct start progress', () => {
    expect(computeProgress(0, 10000)).toBe(0);
  });

  it('computes correct end progress', () => {
    expect(computeProgress(10000, 10000)).toBe(1);
  });

  it('handles fractional values', () => {
    expect(computeProgress(3333, 10000)).toBeCloseTo(0.3333, 4);
  });
});

describe('MiniWaveformPlayer — playback status update', () => {
  const baseState: PlaybackState = {
    isPlaying: true,
    progress: 0,
    positionMs: 0,
    durationMs: 0,
    hasSound: true,
  };

  it('updates position and duration', () => {
    const result = handleStatusUpdate(baseState, 5000, 10000, false);
    expect(result.positionMs).toBe(5000);
    expect(result.durationMs).toBe(10000);
    expect(result.progress).toBe(0.5);
  });

  it('sets isPlaying=false on finish', () => {
    const result = handleStatusUpdate(baseState, 10000, 10000, true);
    expect(result.isPlaying).toBe(false);
    expect(result.progress).toBe(1);
  });

  it('ignores zero duration', () => {
    const state = { ...baseState, progress: 0.3, positionMs: 3000, durationMs: 10000 };
    const result = handleStatusUpdate(state, 0, 0, false);
    expect(result.progress).toBe(0.3);
    expect(result.positionMs).toBe(3000);
  });

  it('does not mutate original state', () => {
    const original = { ...baseState };
    handleStatusUpdate(original, 5000, 10000, false);
    expect(original.positionMs).toBe(0);
    expect(original.progress).toBe(0);
  });
});

describe('MiniWaveformPlayer — toggle action determination', () => {
  it('pauses when playing', () => {
    expect(determineToggleAction(true, true, 0.5, true)).toEqual({ type: 'pause' });
  });

  it('resumes when paused mid-playback', () => {
    expect(determineToggleAction(true, false, 0.5, true)).toEqual({ type: 'resume' });
  });

  it('replays when finished', () => {
    expect(determineToggleAction(true, false, 1, true)).toEqual({ type: 'replay' });
  });

  it('plays new when no sound and cached', () => {
    expect(determineToggleAction(false, false, 0, true)).toEqual({ type: 'play_new' });
  });

  it('returns no_cache when not cached', () => {
    expect(determineToggleAction(false, false, 0, false)).toEqual({ type: 'no_cache' });
  });

  it('replays at exactly progress=1', () => {
    expect(determineToggleAction(true, false, 1.0, true)).toEqual({ type: 'replay' });
  });

  it('resumes at progress just below 1', () => {
    expect(determineToggleAction(true, false, 0.99, true)).toEqual({ type: 'resume' });
  });
});

describe('MiniWaveformPlayer — bar color', () => {
  it('uses primary color when bar is before progress point', () => {
    expect(getBarColor(5, BAR_COUNT, 0.5, '#FF7F6B', '#FFCDC6')).toBe('#FF7F6B');
  });

  it('uses light color when bar is after progress point', () => {
    expect(getBarColor(20, BAR_COUNT, 0.5, '#FF7F6B', '#FFCDC6')).toBe('#FFCDC6');
  });

  it('all bars are light at progress=0', () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      expect(getBarColor(i, BAR_COUNT, 0, '#FF7F6B', '#FFCDC6')).toBe('#FFCDC6');
    }
  });

  it('all bars are primary at progress=1', () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      expect(getBarColor(i, BAR_COUNT, 1, '#FF7F6B', '#FFCDC6')).toBe('#FF7F6B');
    }
  });
});

describe('MiniWaveformPlayer — accessibility', () => {
  const t = (key: string) => key;

  it('returns pause label when playing', () => {
    expect(getAccessibilityLabel(true, t)).toBe('player.a11yPause');
  });

  it('returns play label when not playing', () => {
    expect(getAccessibilityLabel(false, t)).toBe('player.a11yPlay');
  });
});

describe('MiniWaveformPlayer — time display', () => {
  const fmt = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  it('shows position only when no duration', () => {
    expect(formatTimeDisplay(5000, 0, fmt)).toBe('0:05');
  });

  it('shows position / duration when duration > 0', () => {
    expect(formatTimeDisplay(65000, 180000, fmt)).toBe('1:05 / 3:00');
  });

  it('shows 0:00 for zero position and zero duration', () => {
    expect(formatTimeDisplay(0, 0, fmt)).toBe('0:00');
  });

  it('handles exact minute boundaries', () => {
    expect(formatTimeDisplay(60000, 120000, fmt)).toBe('1:00 / 2:00');
  });
});
