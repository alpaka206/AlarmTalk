import { describe, it, expect } from 'vitest';
import {
  STOCK_CLIP_PRESETS,
  STOCK_CLIP_PLACEHOLDER_LANGUAGES,
  STOCK_CLIP_LANGUAGES,
} from '../src/lib/stock-clips';

/**
 * 스톡 클립의 '임시 문구' 표와 실제 문구가 어긋나지 않게 한다.
 *
 * ## 왜 있는가
 *
 * 2026-09-02 에 운세·사랑을 기본(시스템) 목소리에도 열어 **유료/무료의 문구 목록 차이를
 * 없앴다.** 그런데 확정된 대사가 한국어뿐이라 en·ja 자리에 **한국어를 그대로 복사해** 두고
 * 나중에 채우기로 했다. 그 임시값은 두 방향으로 조용히 썩는다:
 *
 * 1. **잊고 출시한다.** en·ja 사용자가 한국어 오디오를 듣는다. 스톡 클립은 번역도 검증도
 *    거치지 않는 순수 패스스루라(`prepareAlarmTextWithVertex(translate:false, autoTag:false)`)
 *    합성 경로가 이걸 걸러 주지 않는다 — 막을 곳이 여기밖에 없다.
 * 2. **채워 놓고 표를 안 지운다.** 표가 "아직 임시" 라고 거짓말하고, 다음 사람이 멀쩡한
 *    대사를 임시로 알고 다시 손댄다.
 *
 * 그래서 **양방향**으로 본다. 표 = 실제, 언제나.
 */
describe('스톡 클립 임시 문구', () => {
  const otherLanguages = STOCK_CLIP_LANGUAGES.filter((language) => language !== 'ko');

  it('한국어를 복사해 둔 언어는 반드시 표에 적혀 있다', () => {
    const undeclared: string[] = [];
    for (const preset of STOCK_CLIP_PRESETS) {
      const ko = preset.texts.ko as readonly string[];
      const marked = STOCK_CLIP_PLACEHOLDER_LANGUAGES[preset.category] ?? [];
      for (const language of otherLanguages) {
        const texts = (preset.texts as Record<string, readonly string[]>)[language] ?? [];
        const same = texts.length === ko.length && texts.every((text, i) => text === ko[i]);
        if (same && !marked.includes(language)) undeclared.push(`${preset.category}.${language}`);
      }
    }
    expect(
      undeclared,
      '한국어를 그대로 복사해 둔 자리다. STOCK_CLIP_PLACEHOLDER_LANGUAGES 에 적어라 — ' +
        '적지 않으면 그 언어 사용자에게 한국어 오디오가 그대로 나간다.',
    ).toEqual([]);
  });

  it('표에 적힌 자리는 아직 정말로 한국어 복사본이다', () => {
    const stale: string[] = [];
    for (const [category, languages] of Object.entries(STOCK_CLIP_PLACEHOLDER_LANGUAGES)) {
      const preset = STOCK_CLIP_PRESETS.find((entry) => entry.category === category);
      expect(preset, `표의 '${category}' 가 STOCK_CLIP_PRESETS 에 없다`).toBeDefined();
      const ko = preset!.texts.ko as readonly string[];
      for (const language of languages) {
        expect(
          STOCK_CLIP_LANGUAGES as readonly string[],
          `표의 '${language}' 는 지원 언어가 아니다`,
        ).toContain(language);
        const texts = (preset!.texts as Record<string, readonly string[]>)[language] ?? [];
        const same = texts.length === ko.length && texts.every((text, i) => text === ko[i]);
        if (!same) stale.push(`${category}.${language}`);
      }
    }
    expect(
      stale,
      '이미 진짜 대사로 교체된 자리가 표에 "임시" 로 남아 있다. 표에서 지워라.',
    ).toEqual([]);
  });

  it('언어별 문구 수가 같다 — 인덱스가 어긋나면 다른 조건의 클립이 나간다', () => {
    for (const preset of STOCK_CLIP_PRESETS) {
      const ko = preset.texts.ko as readonly string[];
      for (const language of otherLanguages) {
        const texts = (preset.texts as Record<string, readonly string[]>)[language] ?? [];
        expect(texts.length, `${preset.category}.${language} 의 문구 수`).toBe(ko.length);
      }
    }
  });
});
