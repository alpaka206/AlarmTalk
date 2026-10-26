// 평가 러너 — 문항마다 제공자를 부르고 규칙을 돌려 보고서(JSON·마크다운)를 만든다.
// 파일·환경 변수·시계는 CLI(`cli.ts`)가 넘긴다 — 여기는 그 값만으로 결과가 정해진다.

import {
  createCurrentProvider,
  type CurrentOutputsFixture,
  type EvalProvider,
} from './providers.ts';
import { runRules } from './rules.ts';
import type { EvalItem, EvalSetId, RuleId, RuleResult } from './types.ts';

export const LIVE_NOT_RUN = '실제 API 평가 미실행';

export type ItemReport = {
  id: string;
  set: EvalSetId;
  kind: EvalItem['kind'];
  targetLanguage: string;
  input: string;
  output: string | null;
  selectedId: string | null;
  source: string;
  pass: boolean;
  rules: RuleResult[];
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
};

export type EvalReport = {
  meta: {
    generatedAt: string;
    set: EvalSetId | 'all';
    requestedProvider: string;
    effectiveProvider: string;
    liveEvaluation: boolean;
    /** 실제 API 를 부르지 않았으면 그 사실과 이유. 불렀으면 null. */
    notice: string | null;
    fixtureSource: string | null;
  };
  summary: {
    items: number;
    passed: number;
    failed: number;
    errored: number;
    ruleFailures: Partial<Record<RuleId, number>>;
  };
  items: ItemReport[];
};

export function selectItems(items: EvalItem[], set: EvalSetId | 'all'): EvalItem[] {
  return set === 'all' ? items : items.filter((item) => item.set === set);
}

export async function runEvaluation(args: {
  items: EvalItem[];
  set: EvalSetId | 'all';
  provider: EvalProvider;
  fixture: CurrentOutputsFixture | null;
  now: Date;
}): Promise<EvalReport> {
  const requested = args.provider;
  // 실제 API 제공자가 준비되지 않았으면 부르지 않고 fixture 검사로 물러난다.
  const fallback = requested.status !== 'ready';
  const provider = fallback ? createCurrentProvider(args.fixture) : requested;
  const notice = fallback
    ? `${LIVE_NOT_RUN} — ${requested.id}: ${requested.statusReason ?? '미설정'}. fixture 기반 규칙 검사만 실행했다.`
    : provider.live
      ? null
      : `${LIVE_NOT_RUN} — ${provider.id} 는 fixture·로컬 출력만 읽는다.`;

  const reports: ItemReport[] = [];
  for (const item of selectItems(args.items, args.set)) {
    let output;
    try {
      output = await provider.generate(item);
    } catch (err) {
      output = {
        text: null,
        selectedId: null,
        costUsd: null,
        latencyMs: null,
        error: err instanceof Error ? err.message : String(err),
        source: provider.id,
      };
    }
    const rules = runRules(item, output);
    reports.push({
      id: item.id,
      set: item.set,
      kind: item.kind,
      targetLanguage: item.targetLanguage,
      input: item.input,
      output: output.text,
      selectedId: output.selectedId,
      source: output.source,
      pass: output.error == null && rules.every((r) => r.status !== 'fail'),
      rules,
      costUsd: output.costUsd,
      latencyMs: output.latencyMs,
      error: output.error,
    });
  }

  const ruleFailures: Partial<Record<RuleId, number>> = {};
  for (const r of reports.flatMap((i) => i.rules)) {
    if (r.status === 'fail') ruleFailures[r.rule] = (ruleFailures[r.rule] ?? 0) + 1;
  }
  const errored = reports.filter((r) => r.error != null).length;
  const passed = reports.filter((r) => r.pass).length;

  return {
    meta: {
      generatedAt: args.now.toISOString(),
      set: args.set,
      requestedProvider: requested.id,
      effectiveProvider: fallback ? `${provider.id} (fixture 대체)` : provider.id,
      liveEvaluation: !fallback && provider.live,
      notice,
      fixtureSource: args.fixture?._meta.source ?? null,
    },
    summary: {
      items: reports.length,
      passed,
      failed: reports.length - passed - errored,
      errored,
      ruleFailures,
    },
    items: reports,
  };
}

// ---------------------------------------------------------------- 마크다운

const cell = (value: string | number | null | undefined): string =>
  value == null || value === '' ? '—' : String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(report: EvalReport): string {
  const { meta, summary } = report;
  const lines: string[] = [];
  lines.push(`# 알람 문구 평가 보고서`, '');
  if (meta.notice) lines.push(`> **${meta.notice}**`, '');
  lines.push(
    `- 생성: ${meta.generatedAt}`,
    `- 세트: ${meta.set}`,
    `- 요청 제공자: ${meta.requestedProvider} / 실제로 돈 제공자: ${meta.effectiveProvider}`,
    `- 실제 API 평가: ${meta.liveEvaluation ? '실행' : '미실행'}`,
    `- fixture 출처: ${meta.fixtureSource ?? '없음'}`,
    '',
    `## 요약`,
    '',
    `| 문항 | 통과 | 실패 | 오류 |`,
    `| --- | --- | --- | --- |`,
    `| ${summary.items} | ${summary.passed} | ${summary.failed} | ${summary.errored} |`,
    '',
  );
  const failures = Object.entries(summary.ruleFailures);
  if (failures.length > 0) {
    lines.push(`| 규칙 | 실패 수 |`, `| --- | --- |`);
    for (const [rule, count] of failures) lines.push(`| ${rule} | ${count} |`);
    lines.push('');
  }

  lines.push(
    `## 문항별`,
    '',
    `| id | 종류 | 언어 | 결과 | 실패 규칙 | 출력 | 고른 id | 비용(USD) | 시간(ms) | 오류 |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  );
  for (const item of report.items) {
    const failed = item.rules.filter((r) => r.status === 'fail').map((r) => r.rule);
    lines.push(
      `| ${cell(item.id)} | ${item.kind} | ${item.set}→${item.targetLanguage} | ${item.error ? 'ERROR' : item.pass ? 'PASS' : 'FAIL'} | ${cell(failed.join(', '))} | ${cell(item.output)} | ${cell(item.selectedId)} | ${cell(item.costUsd)} | ${cell(item.latencyMs)} | ${cell(item.error)} |`,
    );
  }
  lines.push('');

  lines.push(`## 불일치`, '');
  const mismatches = report.items.flatMap((item) =>
    item.rules
      .filter((r) => r.status === 'fail')
      .map((r) => ({ id: item.id, rule: r.rule, detail: r.detail })),
  );
  if (mismatches.length === 0) {
    lines.push('없음', '');
  } else {
    lines.push(`| id | 규칙 | 내용 |`, `| --- | --- | --- |`);
    for (const m of mismatches) lines.push(`| ${cell(m.id)} | ${m.rule} | ${cell(m.detail)} |`);
    lines.push('');
  }
  return lines.join('\n');
}
