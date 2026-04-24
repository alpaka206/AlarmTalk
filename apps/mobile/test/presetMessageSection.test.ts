/**
 * P64 — PresetMessageSection business logic tests
 */
import { PRESET_CATEGORIES, getCategoryLabel, type PresetCategory } from '../src/constants/presets';
import type { VoiceProfile } from '../src/types';

function isGenerateDisabled(voiceId: string | null, text: string | null, isPending: boolean): boolean {
  return !voiceId || !text || isPending;
}

function pickRandomMessage(categoryKey: string, t: (key: string) => string): string | null {
  const cat = PRESET_CATEGORIES.find((c) => c.key === categoryKey);
  if (!cat || cat.messageKeys.length === 0) return null;
  const key = cat.messageKeys[Math.floor(Math.random() * cat.messageKeys.length)];
  return t(key);
}

function onCategoryChange(
  newCategory: string,
  currentText: string | null,
): { category: string; text: null } {
  return { category: newCategory, text: null };
}

function filterReadyVoicesForPreset(voices: VoiceProfile[] | undefined): VoiceProfile[] {
  return voices?.filter((v) => v.status === 'ready') ?? [];
}

function hasRecentPresets(presets: string[]): boolean {
  return presets.length > 0;
}

const makeVoice = (overrides: Partial<VoiceProfile> = {}): VoiceProfile => ({
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

describe('PresetMessageSection — isGenerateDisabled', () => {
  it('returns true when voiceId is null', () => {
    expect(isGenerateDisabled(null, 'hello', false)).toBe(true);
  });

  it('returns true when text is null', () => {
    expect(isGenerateDisabled('v1', null, false)).toBe(true);
  });

  it('returns true when isPending is true', () => {
    expect(isGenerateDisabled('v1', 'hello', true)).toBe(true);
  });

  it('returns false when all conditions are met', () => {
    expect(isGenerateDisabled('v1', 'hello', false)).toBe(false);
  });

  it('returns true when all are invalid', () => {
    expect(isGenerateDisabled(null, null, true)).toBe(true);
  });

  it('returns true when voiceId is empty string (falsy)', () => {
    expect(isGenerateDisabled('', 'hello', false)).toBe(true);
  });

  it('returns true when text is empty string (falsy)', () => {
    expect(isGenerateDisabled('v1', '', false)).toBe(true);
  });
});

describe('PresetMessageSection — pickRandomMessage', () => {
  const t = (key: string) => `msg:${key}`;

  it('returns a translated message for a valid category', () => {
    const result = pickRandomMessage('morning', t);
    expect(result).toBeTruthy();
    expect(result!.startsWith('msg:preset.morning.')).toBe(true);
  });

  it('returns null for an unknown category', () => {
    expect(pickRandomMessage('nonexistent', t)).toBeNull();
  });

  it('picks from the correct category message keys', () => {
    const validKeys = ['msg:preset.cheer.0', 'msg:preset.cheer.1', 'msg:preset.cheer.2'];
    const result = pickRandomMessage('cheer', t);
    expect(validKeys).toContain(result);
  });

  it('returns a value for each existing category', () => {
    for (const cat of PRESET_CATEGORIES) {
      const result = pickRandomMessage(cat.key, t);
      expect(result).not.toBeNull();
    }
  });
});

describe('PresetMessageSection — onCategoryChange', () => {
  it('sets new category and clears text', () => {
    const result = onCategoryChange('lunch', 'old text');
    expect(result).toEqual({ category: 'lunch', text: null });
  });

  it('clears text even when it was already null', () => {
    const result = onCategoryChange('evening', null);
    expect(result).toEqual({ category: 'evening', text: null });
  });

  it('preserves the new category key', () => {
    const result = onCategoryChange('health', 'some msg');
    expect(result.category).toBe('health');
  });
});

describe('PresetMessageSection — filterReadyVoicesForPreset', () => {
  it('returns empty array for undefined', () => {
    expect(filterReadyVoicesForPreset(undefined)).toEqual([]);
  });

  it('filters only ready voices', () => {
    const voices = [
      makeVoice({ id: 'v1', status: 'ready' }),
      makeVoice({ id: 'v2', status: 'processing' }),
      makeVoice({ id: 'v3', status: 'ready' }),
    ];
    const result = filterReadyVoicesForPreset(voices);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.id)).toEqual(['v1', 'v3']);
  });

  it('returns empty when no voices are ready', () => {
    const voices = [makeVoice({ status: 'failed' })];
    expect(filterReadyVoicesForPreset(voices)).toEqual([]);
  });

  it('returns all when all are ready', () => {
    const voices = [
      makeVoice({ id: 'v1', status: 'ready' }),
      makeVoice({ id: 'v2', status: 'ready' }),
    ];
    expect(filterReadyVoicesForPreset(voices)).toHaveLength(2);
  });
});

describe('PresetMessageSection — hasRecentPresets', () => {
  it('returns false for empty array', () => {
    expect(hasRecentPresets([])).toBe(false);
  });

  it('returns true for non-empty array', () => {
    expect(hasRecentPresets(['hello'])).toBe(true);
  });

  it('returns true for multiple presets', () => {
    expect(hasRecentPresets(['a', 'b', 'c'])).toBe(true);
  });
});

describe('PresetMessageSection — PRESET_CATEGORIES integrity', () => {
  it('has 8 categories', () => {
    expect(PRESET_CATEGORIES).toHaveLength(8);
  });

  it('each category has unique key', () => {
    const keys = PRESET_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each category has emoji', () => {
    for (const cat of PRESET_CATEGORIES) {
      expect(cat.emoji.length).toBeGreaterThan(0);
    }
  });

  it('each category has i18nKey', () => {
    for (const cat of PRESET_CATEGORIES) {
      expect(cat.i18nKey).toMatch(/^library\.category/);
    }
  });

  it('each category has exactly 3 message keys', () => {
    for (const cat of PRESET_CATEGORIES) {
      expect(cat.messageKeys).toHaveLength(3);
    }
  });

  it('message keys follow preset.{category}.{index} pattern', () => {
    for (const cat of PRESET_CATEGORIES) {
      for (let i = 0; i < cat.messageKeys.length; i++) {
        expect(cat.messageKeys[i]).toBe(`preset.${cat.key}.${i}`);
      }
    }
  });

  it('getCategoryLabel uses t function', () => {
    const mockT = (key: string) => `label:${key}`;
    const cat = PRESET_CATEGORIES[0];
    expect(getCategoryLabel(cat, mockT)).toBe(`label:${cat.i18nKey}`);
  });

  it('expected category keys exist', () => {
    const expectedKeys = ['morning', 'lunch', 'afternoon', 'evening', 'night', 'cheer', 'love', 'health'];
    const actualKeys = PRESET_CATEGORIES.map((c) => c.key);
    expect(actualKeys).toEqual(expectedKeys);
  });
});
