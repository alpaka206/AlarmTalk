// 알람 문구 오프라인 평가 CLI.
//
//   npm run eval -- --provider current --set ko
//   npm run eval -- --provider jev --set all            # 키·SDK 가 없으면 '실제 API 평가 미실행' + fixture 검사만
//   npm run eval -- --provider current --set en --fixture path/to/outputs.json --label after-prompt-v2
//
// 결과: packages/voice/.text-quality-reports/<시각>-<제공자>-<세트>[-<label>]/report.json·report.md (gitignore — 출력 원문이 들어간다).
// 키 값은 읽기만 하고 출력하지 않는다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProvider, type CurrentOutputsFixture } from './providers.ts';
import { renderMarkdown, runEvaluation } from './runner.ts';
import type { EvalSetFile, EvalSetId } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const KNOWN_FLAGS = ['--provider', '--set', '--fixture', '--label', '--out'] as const;
const SETS = ['ko', 'en', 'ja', 'all'] as const;

function parseFlags(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!(KNOWN_FLAGS as readonly string[]).includes(token)) {
      throw new Error(`모르는 인자 ${token} (가능: ${KNOWN_FLAGS.join(', ')})`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} 에 값이 없다`);
    out.set(token, value);
    i += 1;
  }
  return out;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const providerId = flags.get('--provider') ?? 'current';
  const set = (flags.get('--set') ?? 'all') as EvalSetId | 'all';
  if (!(SETS as readonly string[]).includes(set))
    throw new Error(`--set 은 ${SETS.join('|')} 중 하나`);

  const evalSet = readJson<EvalSetFile>(resolve(here, 'data/cases.json'));
  const fixturePath = resolve(
    flags.get('--fixture') ?? resolve(here, 'data/current-outputs.sample.json'),
  );
  const fixture = readJson<CurrentOutputsFixture>(fixturePath);
  const provider = createProvider(providerId, { env: process.env, fixture });

  const now = new Date();
  const report = await runEvaluation({ items: evalSet.items, set, provider, fixture, now });

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const label = flags.get('--label');
  const outDir = resolve(
    flags.get('--out') ??
      resolve(
        here,
        '../.text-quality-reports',
        `${stamp}-${providerId}-${set}${label ? `-${label}` : ''}`,
      ),
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outDir, 'report.md'), renderMarkdown(report));

  const { summary, meta } = report;
  if (meta.notice) console.log(meta.notice);
  console.log(
    `문항 ${summary.items} · 통과 ${summary.passed} · 실패 ${summary.failed} · 오류 ${summary.errored} (제공자 ${meta.effectiveProvider})`,
  );
  console.log(`보고서: ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
