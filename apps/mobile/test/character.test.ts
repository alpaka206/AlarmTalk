import {
  normalizeStage,
  stageToEmoji,
  stageToLabel,
  stageIndex,
  shouldShowStageTransition,
  listDialogues,
  pickRandomDialogue,
  pickStreakAwareDialogue,
  formatProgress,
  progressBarWidthPct,
} from '../src/lib/character';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

describe('normalizeStage', () => {
  it('returns seed for unknown values', () => {
    expect(normalizeStage(undefined)).toBe('seed');
    expect(normalizeStage(null)).toBe('seed');
    expect(normalizeStage('')).toBe('seed');
    expect(normalizeStage('invalid')).toBe('seed');
    expect(normalizeStage(42)).toBe('seed');
  });

  it('passes through valid stages', () => {
    expect(normalizeStage('seed')).toBe('seed');
    expect(normalizeStage('sprout')).toBe('sprout');
    expect(normalizeStage('tree')).toBe('tree');
    expect(normalizeStage('bloom')).toBe('bloom');
  });
});

describe('stageToEmoji / stageToLabel', () => {
  it('maps seed', () => {
    expect(stageToEmoji('seed')).toBe('🌱');
    expect(stageToLabel('seed', t)).toBe('character.stageSeed');
  });
  it('maps bloom', () => {
    expect(stageToEmoji('bloom')).toBe('🌸');
    expect(stageToLabel('bloom', t)).toBe('character.stageBloom');
  });
  it('falls back to seed for unknown', () => {
    expect(stageToEmoji('xyz')).toBe('🌱');
    expect(stageToLabel(null, t)).toBe('character.stageSeed');
  });
});

describe('stageIndex', () => {
  it('returns correct order', () => {
    expect(stageIndex('seed')).toBe(0);
    expect(stageIndex('sprout')).toBe(1);
    expect(stageIndex('tree')).toBe(2);
    expect(stageIndex('bloom')).toBe(3);
  });
  it('returns 0 for unknown (normalized to seed)', () => {
    expect(stageIndex('nope')).toBe(0);
  });
});

describe('shouldShowStageTransition', () => {
  it('returns true for different stages', () => {
    expect(shouldShowStageTransition('seed', 'sprout')).toBe(true);
  });
  it('returns false for same stage', () => {
    expect(shouldShowStageTransition('tree', 'tree')).toBe(false);
  });
  it('returns false when prev is null', () => {
    expect(shouldShowStageTransition(null, 'seed')).toBe(false);
  });
  it('returns false when next is null', () => {
    expect(shouldShowStageTransition('seed', null)).toBe(false);
  });
});

describe('listDialogues', () => {
  it('returns 7 dialogues per stage', () => {
    for (const s of ['seed', 'sprout', 'tree', 'bloom'] as const) {
      expect(listDialogues(s, t)).toHaveLength(7);
    }
  });
  it('returns i18n keys', () => {
    const keys = listDialogues('seed', t);
    expect(keys[0]).toBe('character.dlg.seed0');
    expect(keys[6]).toBe('character.dlg.seed6');
  });
});

describe('pickRandomDialogue', () => {
  it('uses deterministic rng', () => {
    const a = pickRandomDialogue('seed', t, () => 0);
    const b = pickRandomDialogue('seed', t, () => 0);
    expect(a).toBe(b);
  });
  it('different rng values give different dialogues', () => {
    const a = pickRandomDialogue('seed', t, () => 0);
    const b = pickRandomDialogue('seed', t, () => 0.75);
    expect(a).not.toBe(b);
  });
  it('clamps NaN rng to 0', () => {
    const result = pickRandomDialogue('tree', t, () => NaN);
    expect(result).toBe(listDialogues('tree', t)[0]);
  });
  it('clamps negative rng', () => {
    const result = pickRandomDialogue('bloom', t, () => -1);
    expect(result).toBe(listDialogues('bloom', t)[0]);
  });
});

describe('pickStreakAwareDialogue', () => {
  it('returns stage dialogue when streak is 0', () => {
    const result = pickStreakAwareDialogue('seed', 0, t, () => 0.1);
    expect(listDialogues('seed', t)).toContain(result);
  });
  it('can return streak dialogue when streak >= 1 and roll < 0.4', () => {
    const result = pickStreakAwareDialogue('seed', 7, t, () => 0.1);
    expect(result).toBeTruthy();
  });
  it('returns stage dialogue when roll >= 0.4', () => {
    const result = pickStreakAwareDialogue('tree', 30, t, () => 0.5);
    expect(listDialogues('tree', t)).toContain(result);
  });
  it('handles high streak values', () => {
    const result = pickStreakAwareDialogue('bloom', 100, t, () => 0.1);
    expect(result).toBeTruthy();
  });
});

describe('formatProgress', () => {
  it('formats normal progress', () => {
    expect(formatProgress({ xp_into_level: 50, level_span: 100, progress_ratio: 0.5 })).toBe('XP 50 / 100 (50%)');
  });
  it('handles null', () => {
    expect(formatProgress(null)).toBe('XP 0 / 0 (0%)');
  });
  it('handles undefined', () => {
    expect(formatProgress(undefined)).toBe('XP 0 / 0 (0%)');
  });
  it('clamps negative xp_into_level', () => {
    expect(formatProgress({ xp_into_level: -10, level_span: 100, progress_ratio: 0 })).toBe('XP 0 / 100 (0%)');
  });
});

describe('progressBarWidthPct', () => {
  it('returns percentage', () => {
    expect(progressBarWidthPct({ progress_ratio: 0.75 })).toBe(75);
  });
  it('clamps to 0-100', () => {
    expect(progressBarWidthPct({ progress_ratio: 1.5 })).toBe(100);
    expect(progressBarWidthPct({ progress_ratio: -0.5 })).toBe(0);
  });
  it('returns 0 for NaN', () => {
    expect(progressBarWidthPct({ progress_ratio: NaN } as never)).toBe(0);
  });
  it('returns 0 for null', () => {
    expect(progressBarWidthPct(null)).toBe(0);
  });
});
