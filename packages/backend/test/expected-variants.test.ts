import { describe, expect, it } from 'vitest';
import { CLONE_CLIP_SEEDS, STOCK_CLIP_PRESETS } from '../src/lib/stock-clips';

/**
 * `GET /tts/stock-clips` 의 `expected_variants` 는 **앱이 '이 세트가 완전한가' 를 판정하는
 * 기준**이다. 앱에 개수를 박지 않으려고 서버가 내려준다 — 운영이 시드를 늘리면 앱 업데이트
 * 없이 그 값이 따라와야 한다.
 *
 * ⚠ **기본 목소리와 등록(클론) 목소리는 개수가 다르다.** 하나로 합치면 한쪽이 반드시 깨진다.
 */
describe('expected_variants', () => {
  const system: Record<string, number> = {};
  for (const preset of STOCK_CLIP_PRESETS) system[preset.category] = preset.texts.ko?.length ?? 0;
  const clone: Record<string, number> = {};
  for (const group of CLONE_CLIP_SEEDS) clone[group.category] = group.seeds.length;

  it('두 목록이 실제로 다르다 — 합치면 안 되는 이유', () => {
    expect(system.medication).not.toBe(clone.medication);
  });

  it('시스템 세트는 스톡 프리셋에서 파생된다', () => {
    expect(system).toMatchObject({ weather: 9, medication: 2, greeting: 1 });
  });

  it('클론 세트는 클론 시드에서 파생된다', () => {
    expect(clone).toMatchObject({ weather: 9, fortune: 5, love: 3, medication: 3, greeting: 1 });
  });

  it('날씨는 조건 8 + 미해결 안내 1 이라 양쪽 다 9 다', () => {
    // 마지막 자리가 '인터넷이 안 돼 날씨를 못 봤어요' 안내다. 이 개수가 어긋나면
    // 클라의 미해결 폴백(size-1)이 엉뚱한 조건 클립을 가리킨다.
    expect(system.weather).toBe(9);
    expect(clone.weather).toBe(9);
  });

  it('모든 카테고리 수가 1 이상이다', () => {
    for (const [category, count] of Object.entries({ ...system, ...clone })) {
      expect(count, `${category} 가 비어 있다`).toBeGreaterThan(0);
    }
  });
});
