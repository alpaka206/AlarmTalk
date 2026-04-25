import {
  SOURCE_LANGUAGES,
  filterTargetLanguages,
  validateDubStart,
  getDubPhase,
  shouldSaveAudio,
} from '../src/lib/dubHelpers';
import type { DubLanguage } from '../src/types';

function makeLang(overrides: Partial<DubLanguage> = {}): DubLanguage {
  return { code: 'en', name: 'English', experiment: false, ...overrides };
}

// ── SOURCE_LANGUAGES ──

describe('SOURCE_LANGUAGES', () => {
  it('has exactly 4 languages', () => {
    expect(SOURCE_LANGUAGES).toHaveLength(4);
  });

  it('contains ko, en, ja, zh', () => {
    const codes = SOURCE_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(['ko', 'en', 'ja', 'zh']);
  });

  it('all entries have non-empty name', () => {
    for (const lang of SOURCE_LANGUAGES) {
      expect(lang.name.length).toBeGreaterThan(0);
    }
  });

  it('all entries have non-empty code', () => {
    for (const lang of SOURCE_LANGUAGES) {
      expect(lang.code.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate codes', () => {
    const codes = SOURCE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ── filterTargetLanguages ──

describe('filterTargetLanguages', () => {
  const languages: DubLanguage[] = [
    makeLang({ code: 'ko', name: '한국어' }),
    makeLang({ code: 'en', name: 'English' }),
    makeLang({ code: 'ja', name: '日本語' }),
    makeLang({ code: 'zh', name: '中文' }),
  ];

  it('excludes the source language', () => {
    const result = filterTargetLanguages(languages, 'ko');
    expect(result.map((l) => l.code)).toEqual(['en', 'ja', 'zh']);
  });

  it('excludes en when source is en', () => {
    const result = filterTargetLanguages(languages, 'en');
    expect(result.map((l) => l.code)).toEqual(['ko', 'ja', 'zh']);
  });

  it('returns all when source is not in list', () => {
    const result = filterTargetLanguages(languages, 'fr');
    expect(result).toHaveLength(4);
  });

  it('returns empty array when languages is undefined', () => {
    const result = filterTargetLanguages(undefined, 'ko');
    expect(result).toEqual([]);
  });

  it('returns empty array when languages is empty', () => {
    const result = filterTargetLanguages([], 'ko');
    expect(result).toEqual([]);
  });

  it('preserves experiment flag', () => {
    const withExperiment = [
      makeLang({ code: 'ko', experiment: false }),
      makeLang({ code: 'fr', name: 'Français', experiment: true }),
    ];
    const result = filterTargetLanguages(withExperiment, 'ko');
    expect(result[0]?.experiment).toBe(true);
  });

  it('returns empty if only one language matches source', () => {
    const single = [makeLang({ code: 'ko' })];
    const result = filterTargetLanguages(single, 'ko');
    expect(result).toEqual([]);
  });
});

// ── validateDubStart ──

describe('validateDubStart', () => {
  it('returns selectLanguage when target is empty', () => {
    expect(validateDubStart('', 'ko')).toBe('selectLanguage');
  });

  it('returns sameLanguage when source equals target', () => {
    expect(validateDubStart('ko', 'ko')).toBe('sameLanguage');
  });

  it('returns null for valid different languages', () => {
    expect(validateDubStart('en', 'ko')).toBeNull();
  });

  it('returns null for ja→en', () => {
    expect(validateDubStart('en', 'ja')).toBeNull();
  });

  it('returns selectLanguage for empty target even when source is empty', () => {
    expect(validateDubStart('', '')).toBe('selectLanguage');
  });

  it('treats whitespace-only target as selectLanguage (empty string)', () => {
    expect(validateDubStart('', 'en')).toBe('selectLanguage');
  });
});

// ── getDubPhase ──

describe('getDubPhase', () => {
  it('returns idle when status is null and not pending', () => {
    expect(getDubPhase(null, false)).toBe('idle');
  });

  it('returns processing when status is processing', () => {
    expect(getDubPhase('processing', false)).toBe('processing');
  });

  it('returns processing when isPending is true', () => {
    expect(getDubPhase(null, true)).toBe('processing');
  });

  it('returns processing when both processing and pending', () => {
    expect(getDubPhase('processing', true)).toBe('processing');
  });

  it('returns ready when status is ready', () => {
    expect(getDubPhase('ready', false)).toBe('ready');
  });

  it('returns ready even when isPending is true (ready takes precedence)', () => {
    expect(getDubPhase('ready', true)).toBe('ready');
  });

  it('returns failed when status is failed', () => {
    expect(getDubPhase('failed', false)).toBe('failed');
  });

  it('returns failed even when isPending (failed takes precedence)', () => {
    expect(getDubPhase('failed', true)).toBe('failed');
  });

  it('returns idle for unknown status string', () => {
    expect(getDubPhase('unknown', false)).toBe('idle');
  });

  it('returns idle for empty string status', () => {
    expect(getDubPhase('', false)).toBe('idle');
  });
});

// ── shouldSaveAudio ──

describe('shouldSaveAudio', () => {
  it('returns true when both audio_base64 and result_message_id present', () => {
    expect(shouldSaveAudio({ audio_base64: 'base64data', result_message_id: 'msg-1' })).toBe(true);
  });

  it('returns false when audio_base64 is null', () => {
    expect(shouldSaveAudio({ audio_base64: null, result_message_id: 'msg-1' })).toBe(false);
  });

  it('returns false when result_message_id is null', () => {
    expect(shouldSaveAudio({ audio_base64: 'base64data', result_message_id: null })).toBe(false);
  });

  it('returns false when both are null', () => {
    expect(shouldSaveAudio({ audio_base64: null, result_message_id: null })).toBe(false);
  });

  it('returns false when audio_base64 is empty string', () => {
    expect(shouldSaveAudio({ audio_base64: '', result_message_id: 'msg-1' })).toBe(false);
  });

  it('returns false when result_message_id is empty string', () => {
    expect(shouldSaveAudio({ audio_base64: 'data', result_message_id: '' })).toBe(false);
  });

  it('returns false when both are undefined', () => {
    expect(shouldSaveAudio({})).toBe(false);
  });

  it('returns true for any truthy base64 content', () => {
    expect(shouldSaveAudio({ audio_base64: 'a', result_message_id: 'b' })).toBe(true);
  });
});
