import { describe, expect, it } from 'vitest';
import {
  CHEER_CONTENT_IDS,
  STOCK_CONTENT_BASELINE_SET_IDS,
  STOCK_CONTENT_LANGUAGES,
  STOCK_CONTENT_SETS,
  stockContentInfo,
  stockContentSet,
  stockThemeForCategory,
} from '../src/index.js';

/**
 * 응원·기상 인사 원본(`stock-content.json`)의 계약 — 스펙 `docs/spec/voice-and-message.md` §5-4.
 */
describe('stock-content', () => {
  const newSets = STOCK_CONTENT_SETS.filter((set) => !set.baseline);

  it('ID 는 묶음을 통틀어 겹치지 않고, 카테고리도 묶음마다 하나다', () => {
    const ids = STOCK_CONTENT_SETS.flatMap((set) => [set.id, ...set.items.map((item) => item.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = STOCK_CONTENT_SETS.map((set) => set.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it('항목 ID 는 묶음 ID 에 두 자리 순번을 붙인 것이다 — 자리(variant)와 순번이 맞물린다', () => {
    for (const set of STOCK_CONTENT_SETS) {
      set.items.forEach((item, index) => {
        expect(item.id).toBe(`${set.id}_${String(index + 1).padStart(2, '0')}`);
      });
    }
  });

  it('지시서 12.2 의 한국어 원문 그대로다', () => {
    expect(stockContentSet('cheer_v2')!.items.map((item) => item.texts.ko)).toEqual([
      '좋은 아침이에요. 오늘도 한 가지씩 시작해봐요.',
      '지금은 첫걸음만 생각해도 괜찮아요.',
      '서두르지 말고, 편한 속도로 시작해요.',
      '오늘 해야 할 일 중 하나부터 골라봐요.',
      '어제와 똑같지 않아도 괜찮아요.',
      '완벽하게 시작하지 않아도 괜찮아요.',
      '작은 일 하나를 끝내는 아침이면 충분해요.',
      '눈을 뜬 지금부터 오늘을 천천히 준비해요.',
      '오늘은 나에게 다정하게 말해봐요.',
      '준비되면 몸을 일으켜볼까요?',
      '어깨에 힘을 조금 풀고 시작해요.',
      '오늘의 속도는 내가 정해도 괜찮아요.',
      '마음에 두었던 작은 일부터 시작해봐요.',
      '새로운 아침이에요. 오늘의 첫 장을 열어봐요.',
    ]);
    expect(stockContentSet('wake_v1')!.items.map((item) => item.texts.ko)).toEqual([
      '좋은 아침이에요. 일어날 시간이 됐어요.',
      '알람 시간이 됐어요. 천천히 눈을 떠볼까요?',
      '아침이에요. 오늘 하루를 시작할 준비를 해봐요.',
    ]);
  });

  // ⚠ 옛 응원은 이미 게시된 클립의 문장이다 — 한 글자라도 바뀌면 캐시 키가 갈라져 게시 스크립트가 다시 굽는다.
  it('옛 응원 3개는 게시된 그 문장 그대로다(옛 알람 참조용)', () => {
    const legacy = stockContentSet('cheer_v1')!;
    expect(legacy.legacy).toBe(true);
    expect(legacy.baseline).toBe(true);
    expect(legacy.category).toBe('cheer');
    expect(legacy.items.map((item) => item.texts.ko[0] + item.texts.ko.length)).toEqual(['해106', '이100', '힘92']);
    expect(legacy.items[2]!.texts.en).toBe(
      "When things get hard, you don't have to pretend you're okay. Talking it through with someone you trust can make things feel lighter than you expect. So please don't try to carry everything on your own.",
    );
    expect(legacy.items[0]!.texts.ja.startsWith('やることが多いと、')).toBe(true);
  });

  it('공개 표식 없이 살아 있는 묶음은 옛 응원뿐이다', () => {
    expect([...STOCK_CONTENT_BASELINE_SET_IDS]).toEqual(['cheer_v1']);
  });

  it('새 묶음은 세 언어가 다 있고 앞뒤 공백이 없다', () => {
    for (const set of newSets) {
      for (const item of set.items) {
        for (const lang of STOCK_CONTENT_LANGUAGES) {
          const text = item.texts[lang];
          expect(text.trim(), `${item.id}/${lang}`).toBe(text);
          expect(text.length, `${item.id}/${lang}`).toBeGreaterThan(0);
        }
      }
    }
  });

  // 오너가 사용자 문구의 줄표를 AI 티로 본다. 합성되면 쉼으로 읽혀 리듬도 흔들린다.
  it('새 묶음에는 줄표가 없다', () => {
    for (const set of newSets) {
      for (const item of set.items) {
        for (const lang of STOCK_CONTENT_LANGUAGES) {
          expect(item.texts[lang], `${item.id}/${lang}`).not.toMatch(/[—–]/);
        }
      }
    }
  });

  // 날짜·요일·운세·건강 효과·돈·수익을 약속하지 않는다(지시서 12.2). 매일 아무 날에나 울려도 맞는 말이어야 한다.
  it('새 묶음은 날짜·운세·건강 효과·수익을 말하지 않는다', () => {
    const banned: Record<string, RegExp> = {
      ko: /운세|행운|운이|건강|돈|수익|부자|로또|[월화수목금토일]요일|주말|날씨|\d/,
      en: /\b(?:luck|lucky|fortune|health|healthy|money|rich|profit|lottery|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weather)\b|\d/i,
      ja: /運|健康|お金|儲|宝くじ|曜日|週末|天気|\d/,
    };
    for (const set of newSets) {
      for (const item of set.items) {
        for (const lang of STOCK_CONTENT_LANGUAGES) {
          expect(item.texts[lang], `${item.id}/${lang}`).not.toMatch(banned[lang]!);
        }
      }
    }
  });

  it('응원 새 묶음은 클론 시드를 갖고, 기상 인사는 갖지 않는다(기본 목소리 전용)', () => {
    expect(stockContentSet('cheer_v2')!.items.every((item) => !!item.clone_seed)).toBe(true);
    expect(stockContentSet('wake_v1')!.items.some((item) => item.clone_seed)).toBe(false);
  });

  it('(카테고리, 자리) → 표지', () => {
    expect(stockContentInfo('cheer', 0)).toEqual({
      contentId: 'cheer_v1_01',
      setId: 'cheer_v1',
      theme: 'cheer',
      selectable: false,
    });
    expect(stockContentInfo('cheer_v2', 13)).toEqual({
      contentId: 'cheer_v2_14',
      setId: 'cheer_v2',
      theme: 'cheer',
      selectable: true,
    });
    expect(stockContentInfo('wake', 2)?.contentId).toBe('wake_v1_03');
    expect(stockContentInfo('cheer_v2', 14)).toBeNull();
    expect(stockContentInfo('weather', 0)).toBeNull();
    expect(stockThemeForCategory('cheer_v2')).toBe('cheer');
    expect(stockThemeForCategory('weather')).toBe('weather');
  });

  it('응원 ID 목록에는 옛 응원도 든다(옛 알람의 고정 문구 검증)', () => {
    expect(CHEER_CONTENT_IDS.has('cheer_v1_02')).toBe(true);
    expect(CHEER_CONTENT_IDS.has('cheer_v2_14')).toBe(true);
    expect(CHEER_CONTENT_IDS.has('wake_v1_01')).toBe(false);
    expect(CHEER_CONTENT_IDS.size).toBe(17);
  });
});
