import { describe, it, expect } from 'vitest';
import type { Client } from '@libsql/client/web';
import {
  STOCK_CLIP_PRESETS,
  STOCK_CLIP_LANGUAGES,
  STOCK_GREETING_CATEGORY,
  findMissingStockTargets,
  type PrerenderVoice,
} from '../src/lib/stock-clips';

// ---------- STOCK_CLIP_PRESETS 리터럴 불변식 ----------

describe('STOCK_CLIP_PRESETS (확정 리터럴)', () => {
  it('모든 카테고리가 3개 언어를 갖고, 언어별 variant 수가 같다', () => {
    for (const preset of STOCK_CLIP_PRESETS) {
      const texts = preset.texts as Record<string, readonly string[]>;
      expect(Object.keys(texts).sort()).toEqual([...STOCK_CLIP_LANGUAGES].sort());
      const counts = new Set(Object.values(texts).map((list) => list.length));
      expect(counts.size).toBe(1);
    }
  });

  it('weather 는 9개(조건 8 + 마지막 폴백), medication 2개, greeting 1개', () => {
    const byCategory = new Map(STOCK_CLIP_PRESETS.map((p) => [p.category, p.texts.ko.length]));
    expect(byCategory.get('weather')).toBe(9);
    expect(byCategory.get('medication')).toBe(2);
    expect(byCategory.get(STOCK_GREETING_CATEGORY)).toBe(1);
    // 마지막 weather variant = '날씨 미확인' 폴백 규약
    const weather = STOCK_CLIP_PRESETS.find((p) => p.category === 'weather')!;
    // ⚠ **낱말이 아니라 뜻으로 본다.** 예전에는 '인터넷' 을 찾았는데, 대사를 다시 쓰면서
    //   '날씨 정보를 불러오지 못했어요' 로 바뀌어 멀쩡한 폴백을 실패로 읽었다.
    //   고정할 것은 **마지막 자리가 '날씨를 못 알려 준다' 는 안내**라는 계약이다.
    expect(weather.texts.ko[8]).toMatch(/못했|못 봤|확인/);
    expect(weather.texts.en[8].toLowerCase()).toMatch(/couldn't load|couldn't tell/);
    expect(weather.texts.ja[8]).toMatch(/取得できません|お伝えできません/);
  });

  it('모든 문구가 딜리버리 태그로 시작한다(자동 태깅 미사용 전제)', () => {
    for (const preset of STOCK_CLIP_PRESETS) {
      for (const list of Object.values(preset.texts as Record<string, readonly string[]>)) {
        for (const text of list) {
          expect(text).toMatch(/^\[[a-z][a-z -]{1,32}\]/i);
        }
      }
    }
  });
});

// ---------- findMissingStockTargets: 시스템 보이스 매트릭스 ----------

function stubDb(rows: Record<string, unknown>[] = []): Client {
  return { execute: async () => ({ rows }) } as unknown as Client;
}

function systemVoice(id: string, eleven: string): PrerenderVoice {
  return {
    id,
    name: `voice-${id}`,
    elevenlabsVoiceId: eleven,
    ownerUserId: '70000000-0000-4000-9000-000000000001',
    categories: STOCK_CLIP_PRESETS.map((p) => p.category),
  };
}

describe('findMissingStockTargets (시스템 리터럴)', () => {
  // ⚠ **개수를 손으로 적지 않는다.** 카테고리는 늘어난다(2026-09-02 에 운세·사랑을 더했다).
  //   숫자를 박아 두면 카테고리를 추가할 때마다 이 테스트가 "기능이 깨졌다" 처럼 빨개져,
  //   실제로 검증하려던 **(문구 × 언어) 매트릭스가 빠짐없이 나오는가**는 가려진다.
  const KO_TEXT_COUNT = STOCK_CLIP_PRESETS.reduce((sum, p) => sum + p.texts.ko.length, 0);
  const TARGETS_PER_VOICE = KO_TEXT_COUNT * 3; // ko·en·ja

  it('보이스당 (문구 × 3언어) 타깃을 만들고, baseText 는 해당 언어 리터럴이다', async () => {
    const voice = systemVoice('vp-1', 'eleven-a');
    const targets = await findMissingStockTargets(stubDb(), [voice]);
    expect(targets).toHaveLength(TARGETS_PER_VOICE);

    const langs = new Set(targets.map((t) => t.language));
    expect([...langs].sort()).toEqual(['en', 'ja', 'ko']);

    const enWeather0 = targets.find(
      (t) => t.category === 'weather' && t.language === 'en' && t.variantIndex === 0,
    )!;
    expect(enWeather0.baseText).toBe(
      STOCK_CLIP_PRESETS.find((p) => p.category === 'weather')!.texts.en[0],
    );
    expect(enWeather0.toneAdapt).toBe(false);
  });

  it('greeting 은 3개 언어 모두 생성되고, 보이스가 달라도 같은 문구다(음색 비교용 통일)', async () => {
    const a = await findMissingStockTargets(stubDb(), [systemVoice('vp-1', 'eleven-a')]);
    const b = await findMissingStockTargets(stubDb(), [systemVoice('vp-2', 'eleven-b')]);
    const greetingsA = a.filter((t) => t.category === STOCK_GREETING_CATEGORY);
    const greetingsB = b.filter((t) => t.category === STOCK_GREETING_CATEGORY);
    expect(greetingsA).toHaveLength(3);
    expect(greetingsA.map((t) => t.baseText).sort()).toEqual(
      greetingsB.map((t) => t.baseText).sort(),
    );
  });

  it('이미 존재하는 (voice|category|language|variant) 조합은 건너뛴다', async () => {
    const voice = systemVoice('vp-1', 'eleven-a');
    const db = stubDb([
      { voice_profile_id: 'vp-1', category: 'weather', language: 'ko', variant: 0 },
    ]);
    const targets = await findMissingStockTargets(db, [voice]);
    expect(targets).toHaveLength(TARGETS_PER_VOICE - 1);
    expect(
      targets.some(
        (t) => t.category === 'weather' && t.language === 'ko' && t.variantIndex === 0,
      ),
    ).toBe(false);
  });
});
