// 선다운로드 개수는 **코드에서 유도된다** — 스펙에 손으로 적힌 숫자는 조용히 낡는다.
// 2026-09-08 감사에서 `voice-and-message.md` 가 `love 3` 이라고 적고 있었다. 그 id 는
// `cheer` 로 바뀐 지 오래인데 **개수는 맞고 이름만 틀려서** 아무도 못 알아챘다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { STOCK_CLIP_PRESETS, STOCK_GREETING_CATEGORY, stockCategoryReleased } from '../src/lib/stock-clips';
import { STOCK_CONTENT_BASELINE_SET_IDS } from '@alarmtalk/shared';

const SPEC = readFileSync(join(__dirname, '../../../docs/spec/voice-and-message.md'), 'utf-8');

describe('스펙의 선다운로드 개수는 코드에서 유도된다', () => {
  it('카테고리별 개수·합계·목소리 수가 스펙과 같다', () => {
    const alarmPresets = STOCK_CLIP_PRESETS.filter((p) => p.category !== STOCK_GREETING_CATEGORY);
    // 공개 표식 없이 살아 있는 것(지금 받는 것)과, 새 묶음이 공개된 뒤 더해지는 것(스펙 §5-4)을 따로 센다.
    const baseline = alarmPresets.filter((p) => stockCategoryReleased(p.category, STOCK_CONTENT_BASELINE_SET_IDS));
    const added = alarmPresets.filter((p) => !baseline.includes(p));
    const sum = baseline.reduce((acc, p) => acc + p.texts.ko.length, 0);
    const sumAfterRelease = alarmPresets.reduce((acc, p) => acc + p.texts.ko.length, 0);

    const lines = SPEC.split('\n');
    const at = lines.findIndex((line) => line.includes('받는 대상(기본 목소리)'));
    expect(at, '스펙에서 선다운로드 대상 문단을 못 찾았다').toBeGreaterThan(-1);
    // 굵게 표시(`**`)는 지우고 본다 — 강조가 붙고 떨어지는 것으로 실패하면 안 된다.
    const block = lines.slice(at, at + 6).join('\n').replace(/\*/g, '');

    for (const preset of [...baseline, ...added]) {
      expect(block, `${preset.category} 개수가 스펙과 다르다`).toContain(
        `${preset.category} ${preset.texts.ko.length}`,
      );
    }
    expect(block).toContain(`4 × ${sum}`);
    expect(block).toContain(`${4 * sum}개`);
    expect(block).toContain(`4 × ${sumAfterRelease}`);
    expect(block).toContain(`${4 * sumAfterRelease}개`);
    // 옛 id 를 **개수 줄에** 다시 적으면 잡는다 — 개수만 맞으면 사람 눈에는 안 보인다.
    // ⚠ 문단 전체를 금지하지 말 것: 바로 아래 줄이 "옛 이름이 love 다 — 되돌리지 말 것"
    //   이라고 **경고하려고** 그 이름을 부른다. 그것까지 막으면 경고를 지우게 된다.
    const countsLine = block.split('\n').find((line) => line.includes('weather ')) ?? '';
    expect(countsLine, '개수 줄을 못 찾았다').not.toBe('');
    expect(countsLine).not.toMatch(/love/);
  });
});
