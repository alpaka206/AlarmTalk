import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createCurrentProvider,
  createJevProvider,
  createProvider,
  currentLocalPassthrough,
  JEV_NOT_CONFIGURED,
  type CurrentOutputsFixture,
  type EvalProvider,
} from '../../text-quality/providers.ts';
import { CANDIDATE_ID_RE } from '../../text-quality/rules.ts';
import { LIVE_NOT_RUN, renderMarkdown, runEvaluation } from '../../text-quality/runner.ts';
import type { EvalItem, EvalSetFile } from '../../text-quality/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../text-quality/data');
const cases = JSON.parse(readFileSync(resolve(dataDir, 'cases.json'), 'utf8')) as EvalSetFile;
const sample = JSON.parse(
  readFileSync(resolve(dataDir, 'current-outputs.sample.json'), 'utf8'),
) as CurrentOutputsFixture;
const NOW = new Date('2026-10-26T00:00:00.000Z');

const items: EvalItem[] = [
  {
    id: 't-manual',
    set: 'ko',
    kind: 'manual',
    targetLanguage: 'ko',
    input: '  7시 30분이야, 일어나  ',
  },
  { id: 't-translate', set: 'ko', kind: 'manual', targetLanguage: 'en', input: '7시 30분이야' },
  {
    id: 't-select',
    set: 'ko',
    kind: 'selection',
    targetLanguage: 'ko',
    input: '클립 고르기',
    candidates: [
      { id: 'c1', text: '일어날 시간이에요.' },
      { id: 'c2', text: '좋은 아침이에요.' },
    ],
    recent: ['c1'],
    recentWindow: 1,
  },
  { id: 't-missing', set: 'en', kind: 'generated', targetLanguage: 'en', input: 'Seed: rain' },
];

const fixture: CurrentOutputsFixture = {
  _meta: { source: 'test fixture', capturedAt: null },
  outputs: {
    // 숫자 30 이 빠진 번역 + 고른 것이 최근 1개 안
    't-translate': { text: "It's 7. Wake up!", costUsd: 0.0002, latencyMs: 812 },
    't-select': { selectedId: 'c1' },
  },
};

describe('평가 세트(cases.json)', () => {
  it('한국어 40·영어 10·일본어 10 이다', () => {
    const count = (set: string) => cases.items.filter((i) => i.set === set).length;
    expect([count('ko'), count('en'), count('ja')]).toEqual([40, 10, 10]);
  });
  it('출발점 세트라고 적혀 있다', () => {
    expect(cases._meta.note).toContain('벤치마크가 아니다');
  });
  it('문항 id 가 겹치지 않고, 선택 문항의 후보 id 가 형식을 지킨다', () => {
    const ids = cases.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of cases.items.filter((i) => i.kind === 'selection')) {
      expect(item.candidates?.length).toBeGreaterThan(0);
      for (const c of item.candidates ?? []) expect(c.id).toMatch(CANDIDATE_ID_RE);
    }
  });
  it('견본 fixture 가 로컬 그대로 갈래가 아닌 문항을 모두 덮는다', () => {
    const needsFixture = cases.items
      .filter((i) => currentLocalPassthrough(i) == null)
      .map((i) => i.id);
    expect(Object.keys(sample.outputs).sort()).toEqual(needsFixture.sort());
  });
});

describe('current 제공자', () => {
  it('같은 언어 직접 입력·프리셋은 원문을 그대로(앞뒤 공백만 정리)', async () => {
    const out = await createCurrentProvider(null).generate(items[0]!);
    expect(out).toMatchObject({
      text: '7시 30분이야, 일어나',
      source: 'local-passthrough',
      costUsd: null,
    });
  });
  it('선택 문항은 고른 후보의 글을 출력으로 쓴다', async () => {
    const out = await createCurrentProvider(fixture).generate(items[2]!);
    expect(out).toMatchObject({ text: '일어날 시간이에요.', selectedId: 'c1', source: 'fixture' });
  });
  it('fixture 에 없는 문항은 오류로 남긴다(지어내지 않는다)', async () => {
    const out = await createCurrentProvider(fixture).generate(items[3]!);
    expect(out.text).toBeNull();
    expect(out.error).toContain('fixture');
  });
});

describe('jev·설정만 있는 후보', () => {
  it('키가 없으면 not_configured 이고, 부르면 미설정 오류를 던진다', async () => {
    const jev = createJevProvider({});
    expect(jev.status).toBe('not_configured');
    expect(jev.statusReason).toBe(JEV_NOT_CONFIGURED);
    await expect(jev.generate(items[0]!)).rejects.toThrow(JEV_NOT_CONFIGURED);
  });
  it('키가 있어도 SDK 어댑터가 없으니 not_configured — 키 값은 이유에 싣지 않는다', () => {
    const jev = createJevProvider({ JEV_API_KEY: 'secret-value' });
    expect(jev.status).toBe('not_configured');
    expect(jev.statusReason).not.toContain('secret-value');
  });
  it('qwen·chatterbox 는 설정 항목만, 모르는 이름은 거절', () => {
    const opts = { env: {}, fixture: null };
    expect(createProvider('qwen', opts).status).toBe('not_configured');
    expect(createProvider('chatterbox', opts).status).toBe('not_configured');
    expect(() => createProvider('gpt-x', opts)).toThrow('모르는 제공자');
  });
});

describe('runEvaluation (fixture 모드)', () => {
  it('규칙별 통과·실패와 불일치를 보고서에 싣는다', async () => {
    const report = await runEvaluation({
      items,
      set: 'all',
      provider: createCurrentProvider(fixture),
      fixture,
      now: NOW,
    });
    expect(report.meta).toMatchObject({
      generatedAt: '2026-10-26T00:00:00.000Z',
      requestedProvider: 'current',
      effectiveProvider: 'current',
      liveEvaluation: false,
      fixtureSource: 'test fixture',
    });
    expect(report.meta.notice).toContain(LIVE_NOT_RUN);
    expect(report.summary).toMatchObject({ items: 4, passed: 1, failed: 2, errored: 1 });
    expect(report.summary.ruleFailures).toMatchObject({ numbers_preserved: 1, recent_excluded: 1 });

    const translate = report.items.find((i) => i.id === 't-translate')!;
    expect(translate).toMatchObject({ pass: false, costUsd: 0.0002, latencyMs: 812 });
    // 재지 않은 값은 null 로 남는다
    expect(report.items.find((i) => i.id === 't-manual')).toMatchObject({
      costUsd: null,
      latencyMs: null,
    });

    const md = renderMarkdown(report);
    expect(md).toContain(`**${LIVE_NOT_RUN}`);
    expect(md).toContain('| t-translate | numbers_preserved | 빠진 숫자 30 |');
    expect(md).toContain('| t-select | recent_excluded |');
    expect(md).toContain('비용(USD) | 시간(ms) | 오류');

    // 표 칸은 역슬래시를 먼저 겹친 뒤 `|` 를 막는다 — `\|` 가 그대로 남으면 칸이 갈린다.
    const tricky = { ...report, items: [{ ...translate, id: 'a\\|b' }] };
    expect(renderMarkdown(tricky)).toContain('a\\\\\\|b');
  });

  it('세트로 거른다', async () => {
    const report = await runEvaluation({
      items,
      set: 'en',
      provider: createCurrentProvider(fixture),
      fixture,
      now: NOW,
    });
    expect(report.items.map((i) => i.id)).toEqual(['t-missing']);
  });

  it('jev 가 미설정이면 부르지 않고 fixture 검사로 물러나며 그 사실을 적는다', async () => {
    let called = false;
    const jev: EvalProvider = {
      ...createJevProvider({}),
      async generate() {
        called = true;
        throw new Error('불리면 안 된다');
      },
    };
    const report = await runEvaluation({ items, set: 'ko', provider: jev, fixture, now: NOW });
    expect(called).toBe(false);
    expect(report.meta).toMatchObject({
      requestedProvider: 'jev',
      effectiveProvider: 'current (fixture 대체)',
      liveEvaluation: false,
    });
    expect(report.meta.notice).toBe(
      `${LIVE_NOT_RUN} — jev: ${JEV_NOT_CONFIGURED}. fixture 기반 규칙 검사만 실행했다.`,
    );
    expect(renderMarkdown(report)).toContain('실제 API 평가: 미실행');
  });

  it('제공자가 던지면 그 문항만 오류로 남기고 계속한다', async () => {
    const flaky: EvalProvider = {
      id: 'flaky',
      live: true,
      status: 'ready',
      statusReason: null,
      async generate(item) {
        if (item.id === 't-manual') throw new Error('timeout');
        return {
          text: '좋은 아침이에요.',
          selectedId: 'c2',
          costUsd: 0.001,
          latencyMs: 100,
          error: null,
          source: 'flaky',
        };
      },
    };
    const report = await runEvaluation({
      items,
      set: 'all',
      provider: flaky,
      fixture: null,
      now: NOW,
    });
    expect(report.meta.liveEvaluation).toBe(true);
    expect(report.meta.notice).toBeNull();
    expect(report.items.find((i) => i.id === 't-manual')).toMatchObject({
      error: 'timeout',
      pass: false,
    });
    expect(report.summary.errored).toBe(1);
  });

  it('마크다운 칸의 | 와 줄바꿈을 이스케이프한다', async () => {
    const pipe: EvalProvider = {
      ...createCurrentProvider(null),
      async generate() {
        return {
          text: 'a | b\nc',
          selectedId: null,
          costUsd: null,
          latencyMs: null,
          error: null,
          source: 'x',
        };
      },
    };
    const report = await runEvaluation({
      items: [items[3]!],
      set: 'all',
      provider: pipe,
      fixture: null,
      now: NOW,
    });
    expect(renderMarkdown(report)).toContain('a \\| b c');
  });

  it('동봉한 세트 전체를 견본 fixture 로 끝까지 돈다', async () => {
    const report = await runEvaluation({
      items: cases.items,
      set: 'all',
      provider: createCurrentProvider(sample),
      fixture: sample,
      now: NOW,
    });
    expect(report.summary.items).toBe(60);
    expect(report.summary.errored).toBe(0);
    // 견본은 손으로 쓴 것이라 전부 통과하게 썼다 — 규칙을 바꿔 이게 깨지면 규칙이 견본을 잘못 읽는지 먼저 본다.
    const failures = report.items
      .filter((i) => !i.pass)
      .map((i) => ({ id: i.id, rules: i.rules.filter((r) => r.status === 'fail') }));
    expect(failures).toEqual([]);
  });
});
