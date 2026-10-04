/**
 * 날씨 원천 **수동 점검**(로컬 전용, 읽기 전용 — CI 아님). DB 를 건드리지 않는다.
 *
 * `packages/shared/src/weather-regions.json` 에 박아 둔 원천의 칸(`source`)이 지금도 맞는지, 그리고 133곳 전체를
 * 운영 어댑터 그대로 돌리면 무엇이 나오는지 본다. 규칙 전문은 `docs/spec/voice-and-message.md` 5-1
 * 「서버가 미리 계산해 둔다」 — 그 절의 「검증 방법」이 이 스크립트를 부른다.
 *
 *  1. NWS: 지역의 `lat`/`lon` 으로 `/points` 를 다시 조회해 `gridId`/`gridX`,`gridY` 와 대조한다(69곳).
 *  2. JMA: 상수 JSON(area · forecast_area · week_area · week_area05)에 office·class10·기온 지점·주간 구역이
 *     지금도 있고 서로 맞는지 본다.
 *     (KR 격자는 `packages/shared/test/weather-regions.test.ts` 가 LCC 식으로 매번 다시 계산한다.)
 *  3. 드라이런: 133곳을 어댑터(`fetchRegionSourceDays`)로 받아 나라별 성공 수, (지역, 날짜) 미해결 수(내일~+3 과
 *     오늘을 따로), 클립 자리 분포를 낸다. 자리는 운영과 같은 분류로 센다 — `dryRunVariants`
 *     (`weather-sources-dry-run.ts`, 회귀 `test/weather-sources-dry-run.test.ts`).
 *
 * 사용 (packages/backend 에서):
 *   npm run check:weather                          # 셋 다
 *   npm run check:weather -- --skip-points         # NWS /points 재조회를 건너뛴다(69번 덜 부른다)
 *   npm run check:weather -- --countries KR,JP     # 일부 나라만
 *   npm run check:weather -- --env-file .dev.vars.prod
 *
 * 기상청 키는 `--env-file`(기본 `.dev.vars.dev`)의 `KMA_SERVICE_KEY` 또는 환경 변수에서 읽는다 — **출력하지 않는다**
 * (요청 URL 에 실리므로 URL 도 출력하지 않는다). NWS 는 운영과 같은 User-Agent 로, 호출 사이에 쉰다.
 * ⚠ `node --experimental-strip-types` 로는 못 돌린다 — `check:weather` 가 esbuild 로 먼저 번들한다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WeatherRegions, type WeatherCountryCode } from '@alarmtalk/shared';
import { NWS_USER_AGENT } from '../src/lib/weather-nws.ts';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips.ts';
import { fetchRegionSourceDays, fixedFetchBudget } from '../src/lib/weather-source.ts';
import { dryRunVariants } from './weather-sources-dry-run.ts';

// ---------------------------------------------------------------- 인자·키

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SKIP_POINTS = process.argv.includes('--skip-points');
const COUNTRIES = new Set(
  (argValue('--countries') ?? 'KR,JP,US').split(',').map((c) => c.trim().toUpperCase()) as WeatherCountryCode[],
);
const ENV_FILE = resolve(process.cwd(), argValue('--env-file') ?? '.dev.vars.dev');

function readKmaKey(): string | undefined {
  if (process.env.KMA_SERVICE_KEY?.trim()) return process.env.KMA_SERVICE_KEY.trim();
  if (!existsSync(ENV_FILE)) return undefined;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^KMA_SERVICE_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1]!.trim().replace(/^['"]|['"]$/g, '') || undefined;
  }
  return undefined;
}

// 어댑터의 구조화 로그(`weather.fetch` …)는 감춘다 — 이 스크립트의 출력만 남긴다.
const out = (line = '') => process.stdout.write(`${line}\n`);
const quiet = () => {};
console.log = quiet;
console.warn = quiet;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = { accept: 'application/json' }): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const regions = WeatherRegions.all.filter((r) => COUNTRIES.has(r.country));
let problems = 0;

// ---------------------------------------------------------------- 1. NWS /points

async function checkNwsPoints(): Promise<void> {
  const us = regions.filter((r) => r.source.kind === 'nws');
  if (us.length === 0 || SKIP_POINTS) return;
  out(`== NWS /points 재조회 (${us.length}곳)`);
  for (const r of us) {
    if (r.source.kind !== 'nws') continue;
    try {
      const doc = (await getJson(`https://api.weather.gov/points/${r.lat},${r.lon}`, {
        'user-agent': NWS_USER_AGENT,
        accept: 'application/geo+json',
      })) as { properties?: { gridId?: string; gridX?: number; gridY?: number; timeZone?: string } };
      const p = doc.properties ?? {};
      const same = p.gridId === r.source.gridId && p.gridX === r.source.gridX && p.gridY === r.source.gridY;
      if (!same) {
        problems += 1;
        out(`  ✗ ${r.key}: 박아 둔 ${r.source.gridId}/${r.source.gridX},${r.source.gridY} ≠ 지금 ${p.gridId}/${p.gridX},${p.gridY}`);
      }
    } catch (err) {
      problems += 1;
      out(`  ✗ ${r.key}: /points 실패 (${(err as Error).message})`);
    }
    await sleep(400);
  }
  out(problems === 0 ? '  모두 같다' : '');
}

// ---------------------------------------------------------------- 2. JMA 상수

type AreaJson = {
  offices: Record<string, unknown>;
  class10s: Record<string, { parent?: string }>;
};

async function checkJmaConstants(): Promise<void> {
  const jp = regions.filter((r) => r.source.kind === 'jma');
  if (jp.length === 0) return;
  out(`== JMA 상수 대조 (${jp.length}곳)`);
  const base = 'https://www.jma.go.jp/bosai';
  const area = (await getJson(`${base}/common/const/area.json`)) as AreaJson;
  const forecastArea = (await getJson(`${base}/forecast/const/forecast_area.json`)) as Record<
    string,
    { class10: string; amedas: string[] }[]
  >;
  const weekArea = (await getJson(`${base}/forecast/const/week_area.json`)) as Record<
    string,
    { srf: string; week: string; amedas: string }[]
  >;
  const weekArea05 = (await getJson(`${base}/forecast/const/week_area05.json`)) as Record<string, string[]>;
  const before = problems;
  for (const r of jp) {
    if (r.source.kind !== 'jma') continue;
    const { office, class10, tempStation, week } = r.source;
    const fail = (why: string) => {
      problems += 1;
      out(`  ✗ ${r.key}: ${why}`);
    };
    if (!area.offices[office]) fail(`office ${office} 가 area.json 에 없다`);
    if (area.class10s[class10]?.parent !== office) fail(`class10 ${class10} 의 부모가 ${office} 가 아니다`);
    const fa = (forecastArea[office] ?? []).find((e) => e.class10 === class10);
    if (!fa) fail(`forecast_area[${office}] 에 ${class10} 이 없다`);
    else if (fa.amedas[0] !== tempStation) fail(`기온 지점 ${tempStation} ≠ forecast_area 의 대표 ${fa.amedas[0]}`);
    const candidates = weekArea05[class10] ?? [];
    if (candidates.join(',') !== week.map((w) => w.area).join(',')) {
      fail(`주간 구역 후보 ${week.map((w) => w.area).join(',')} ≠ week_area05 ${candidates.join(',')}`);
    }
    for (const w of week) {
      const pairs = (weekArea[office] ?? []).filter((e) => e.week === w.area);
      if (!pairs.some((e) => e.amedas === w.tempStation)) {
        fail(`주간 구역 ${w.area} 의 기온 지점 ${w.tempStation} 이 week_area 에 없다(${pairs.map((e) => e.amedas).join(',')})`);
      }
    }
  }
  out(problems === before ? '  모두 맞다' : '');
}

// ---------------------------------------------------------------- 3. 드라이런

async function dryRun(): Promise<void> {
  const key = readKmaKey();
  out(`== 드라이런 (${regions.length}곳, DB 무접촉) — KMA 키 ${key ? '있음' : '없음'}`);
  const now = new Date();
  type Stat = { ok: number; failed: string[]; variants: number[]; unresolvedLater: number; unresolvedToday: number };
  const byCountry = new Map<WeatherCountryCode, Stat>();
  for (const r of regions) {
    const stat = byCountry.get(r.country) ?? { ok: 0, failed: [], variants: [], unresolvedLater: 0, unresolvedToday: 0 };
    byCountry.set(r.country, stat);
    const outcome = await fetchRegionSourceDays(r, { now, budget: fixedFetchBudget(2), kmaServiceKey: key });
    if (!outcome.ok) {
      stat.failed.push(`${r.key}(${outcome.failure}:${outcome.reason})`);
    } else {
      stat.ok += 1;
      // 운영(cron·읽기 경로)과 같은 분류다 — 원천 종류를 넘긴다(결정 D7). 분류는 테스트가 그대로 거치는 함수에 있다.
      // 미해결은 내일~+3 과 오늘을 따로 센다 — cron 의 due 는 내일~+3 만 보고, 오늘은 저장 행의 극값을 이어받아야
      // 만들어지는 날이 있는데 이 드라이런은 DB 를 보지 않는다(합쳐 세면 JP 는 언제나 47 이라 0 인지 읽을 수 없다).
      dryRunVariants(r, outcome.days, now).forEach((variant, day) => {
        if (variant !== null) stat.variants.push(variant);
        else if (day === 0) stat.unresolvedToday += 1;
        else stat.unresolvedLater += 1;
      });
    }
    await sleep(r.source.kind === 'nws' ? 400 : 150);
  }
  for (const [country, stat] of byCountry) {
    const total = regions.filter((r) => r.country === country).length;
    const dist = CLONE_WEATHER_CONDITIONS.map((name, i) => `${name}=${stat.variants.filter((v) => v === i).length}`);
    out(
      `  ${country}: 원천 성공 ${stat.ok}/${total} · (지역, 날짜) 미해결 내일~+3 ${stat.unresolvedLater} · 오늘 ${stat.unresolvedToday}` +
        ` · 자리 ${dist.join(' ')}`,
    );
    for (const f of stat.failed) out(`    ✗ ${f}`);
    problems += stat.failed.length;
  }
  out('  (내일~+3 의 미해결은 cron 이 슬롯 내내 다시 부르는 날이다 — 0 이어야 한다.');
  out('   오늘은 이어받기 없이 센다 — KR 0500 회차 이후(오늘 TMN 이 없다)·JP(오늘 최저가 어떤 발표에도 없어 언제나 전부)·');
  out('   NWS 아침 이후는 미해결이 정상이다)');
}

await checkNwsPoints();
await checkJmaConstants();
await dryRun();
out(problems === 0 ? '\n문제 없음' : `\n문제 ${problems}건`);
process.exitCode = problems === 0 ? 0 : 1;
