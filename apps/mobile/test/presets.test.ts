import { PRESET_CATEGORIES, getCategoryLabel, DAYS_OF_WEEK } from '../src/constants/presets';

describe('PRESET_CATEGORIES', () => {
  it('8개의 카테고리가 정의되어 있다', () => {
    expect(PRESET_CATEGORIES).toHaveLength(8);
  });

  it('모든 카테고리에 key, emoji, i18nKey, messages가 있다', () => {
    for (const cat of PRESET_CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.emoji).toBeTruthy();
      expect(cat.i18nKey).toBeTruthy();
      expect(cat.messages.length).toBeGreaterThan(0);
    }
  });

  it('모든 카테고리 key가 고유하다', () => {
    const keys = PRESET_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('모든 메시지가 빈 문자열이 아니다', () => {
    for (const cat of PRESET_CATEGORIES) {
      for (const msg of cat.messages) {
        expect(msg.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('예상 카테고리 순서를 포함한다', () => {
    const keys = PRESET_CATEGORIES.map((c) => c.key);
    expect(keys).toEqual([
      'morning',
      'lunch',
      'afternoon',
      'evening',
      'night',
      'cheer',
      'love',
      'health',
    ]);
  });

  it('i18nKey는 library. 접두어로 시작한다', () => {
    for (const cat of PRESET_CATEGORIES) {
      expect(cat.i18nKey).toMatch(/^library\./);
    }
  });
});

describe('getCategoryLabel', () => {
  it('i18nKey를 t 함수로 번역한 결과를 반환한다', () => {
    const mockT = (key: string) => `translated:${key}`;
    const cat = PRESET_CATEGORIES[0];
    expect(getCategoryLabel(cat, mockT)).toBe(`translated:${cat.i18nKey}`);
  });

  it('모든 카테고리에 대해 동작한다', () => {
    const mockT = (key: string) => key.toUpperCase();
    for (const cat of PRESET_CATEGORIES) {
      expect(getCategoryLabel(cat, mockT)).toBe(cat.i18nKey.toUpperCase());
    }
  });
});

describe('DAYS_OF_WEEK', () => {
  it('7일이다', () => {
    expect(DAYS_OF_WEEK).toHaveLength(7);
  });

  it('일요일부터 시작한다', () => {
    expect(DAYS_OF_WEEK[0]).toBe('일');
    expect(DAYS_OF_WEEK[6]).toBe('토');
  });
});
