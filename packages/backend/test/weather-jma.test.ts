// 気象庁 bosai 예보(JP) 어댑터 — `lib/weather-jma.ts`. 규칙: `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
//
// 픽스처는 2026-10-01 17:00 발표 원본 4개(東京·埼玉·滋賀·青森)다. 05시 발표는 같은 문서에서 모양만 바꿔 만든다
// (`fixtures/weather/jma/morning-bulletin.ts` — 2026-09-24~10-01 XML 1,056개로 확인한 구조: 05~10시대 발표는 날씨
// 2일, 강수확률 7칸, 기온 4칸).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeatherRegions, type WeatherSource } from '@alarmtalk/shared';
import {
  fetchJmaDays,
  JMA_WEATHER_CODES,
  jmaCodeToProxy,
  jmaDaysFromDocument,
  jmaForecastUrl,
} from '../src/lib/weather-jma';
import { finalizeSourceDay, fixedFetchBudget } from '../src/lib/weather-source';
import { toMorningBulletin } from './fixtures/weather/jma/morning-bulletin';
import { resolvePrerenderWeatherIndex } from '../src/lib/weather-signal';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';

type JmaSource = Extract<WeatherSource, { kind: 'jma' }>;
const FIXTURES = join(__dirname, 'fixtures/weather/jma');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 픽스처를 고쳐 쓰는 테스트라 모양을 느슨하게 둔다
const doc = (office: string): any => JSON.parse(readFileSync(join(FIXTURES, `${office}-20261001-1700.json`), 'utf8'));
const sourceOf = (key: string) => WeatherRegions.byKey(key)!.source as JmaSource;
const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

/** 17:30 JST — 17시 발표를 받은 직후(저녁 슬롯 전). */
const AFTER_1700 = new Date('2026-10-01T08:30:00Z');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 東京 17시 문서를 다음 날 05시 발표 모양으로 바꾼다(`fixtures/weather/jma/morning-bulletin.ts`). */
const tokyo0500 = () => toMorningBulletin(doc('130000'));

describe('날씨 코드 → 대리 코드(현행 공식 66개)', () => {
  it('66개 전부 분류된다 — 雪 → 눈, 雨 → 비, くもり → 흐림, 晴 → 맑음', () => {
    expect(Object.keys(JMA_WEATHER_CODES)).toHaveLength(66);
    for (const code of Object.keys(JMA_WEATHER_CODES)) expect(jmaCodeToProxy(code), code).not.toBeNull();
    expect(jmaCodeToProxy('100')).toBe(0);
    expect(jmaCodeToProxy('101')).toBe(0); // 晴れ時々くもり
    expect(jmaCodeToProxy('201')).toBe(3); // くもり時々晴れ
    expect(jmaCodeToProxy('202')).toBe(61);
    expect(jmaCodeToProxy('302')).toBe(61);
    expect(jmaCodeToProxy('400')).toBe(71);
    expect(jmaCodeToProxy('340')).toBe(71); // 雪か雨
  });

  it("'雨か雪' 9개는 결정 D1 — 눈(JMA 지도 색은 비)", () => {
    for (const code of ['106', '107', '118', '206', '207', '218', '304', '316', '317']) {
      expect(jmaCodeToProxy(code), code).toBe(71);
    }
  });

  it('퇴역 코드(209 霧 등)·모르는 값은 미해결(null)', () => {
    expect(jmaCodeToProxy('209')).toBeNull();
    expect(jmaCodeToProxy('130')).toBeNull();
    expect(jmaCodeToProxy('')).toBeNull();
    expect(jmaCodeToProxy(100)).toBeNull();
  });
});

describe('17시 발표 — 실측 원본', () => {
  it('東京: 오늘은 17~24시 날씨·강수확률뿐(극값 없음), 내일은 단기, 모레부터는 주간', () => {
    const days = jmaDaysFromDocument(doc('130000'), sourceOf('jp-tokyo'), AFTER_1700);
    expect(days.get('2026-10-01')).toMatchObject({ code: 0, rainProbability: 10, maxTemp: null, minTemp: null });
    // 17시 발표의 기온은 [내일 최저, 내일 최고].
    expect(days.get('2026-10-02')).toMatchObject({ code: 61, rainProbability: 50, minTemp: 20, maxTemp: 22 });
    // 모레: 날씨는 단기(class10), 강수확률·기온은 주간(하루 단위).
    expect(days.get('2026-10-03')).toMatchObject({ code: 0, rainProbability: 20, minTemp: 17, maxTemp: 24 });
    expect(days.get('2026-10-04')).toMatchObject({ code: 3, rainProbability: 30, minTemp: 16, maxTemp: 24 });
    // 강수량 합은 気象庁 예보에 없다 — 재지 않음(NaN).
    expect(Number.isNaN(days.get('2026-10-02')!.precipitation)).toBe(true);
  });

  it('17시 발표 뒤의 오늘은 근사해도 미해결 — 최저는 내일 아침 최저로 메우지만 오늘 최고를 대신할 값이 없다', () => {
    const today = jmaDaysFromDocument(doc('130000'), sourceOf('jp-tokyo'), AFTER_1700).get('2026-10-01');
    expect(today).toMatchObject({ maxTemp: null, minTemp: null, approxMinTemp: 20 });
    expect(today).not.toHaveProperty('approxMaxTemp');
    expect(finalizeSourceDay(today, { isToday: true, now: AFTER_1700, source: 'jma' })).toBeNull();
  });

  it('埼玉: 주간 기온 지점이 현청(さいたま)이 아니라 짝지은 지점(熊谷)이다', () => {
    const days = jmaDaysFromDocument(doc('110000'), sourceOf('jp-saitama'), AFTER_1700);
    expect(days.get('2026-10-02')).toMatchObject({ code: 3, minTemp: 20, maxTemp: 23, rainProbability: 30 });
    expect(days.get('2026-10-03')).toMatchObject({ code: 0, minTemp: 16, maxTemp: 26, rainProbability: 10 });
  });

  it('주간 구역은 후보 가운데 그날 응답에 실제로 있는 첫 구역 — 青森(020000 없음 → 020010)', () => {
    const days = jmaDaysFromDocument(doc('020000'), sourceOf('jp-aomori'), AFTER_1700);
    expect(days.get('2026-10-03')).toMatchObject({ code: 3, rainProbability: 30, minTemp: 12, maxTemp: 20 });
  });

  it('滋賀: 계절에 따라 세분이 바뀌면 그 구역과 짝지은 지점을 쓴다(250000 彦根 ↔ 250010 大津)', () => {
    const shiga = sourceOf('jp-shiga');
    expect(jmaDaysFromDocument(doc('250000'), shiga, AFTER_1700).get('2026-10-03')).toMatchObject({
      minTemp: 16,
      maxTemp: 25,
    });
    // 세분된 날: 주간 구역이 250010, 지점이 大津(60216)으로 온다.
    const split = doc('250000');
    split[1].timeSeries[0].areas[0].area.code = '250010';
    split[1].timeSeries[1].areas[0].area.code = '60216';
    split[1].timeSeries[1].areas[0].tempsMin = ['', '14', '', '', '', '', ''];
    split[1].timeSeries[1].areas[0].tempsMax = ['', '28', '', '', '', '', ''];
    expect(jmaDaysFromDocument(split, shiga, AFTER_1700).get('2026-10-03')).toMatchObject({ minTemp: 14, maxTemp: 28 });
    // 후보에 없는 구역뿐이면 주간을 못 쓴다 → 모레는 미해결.
    const none = doc('250000');
    none[1].timeSeries[0].areas[0].area.code = '259999';
    const day = jmaDaysFromDocument(none, shiga, AFTER_1700).get('2026-10-03');
    expect(finalizeSourceDay(day, { isToday: false, now: AFTER_1700, source: 'jma' })).toBeNull();
  });

  it('분류: 東京 내일은 비(1), 모레는 맑음(0)', () => {
    const days = jmaDaysFromDocument(doc('130000'), sourceOf('jp-tokyo'), AFTER_1700);
    const index = (date: string) =>
      resolvePrerenderWeatherIndex(
        finalizeSourceDay(days.get(date), { isToday: false, now: AFTER_1700, source: 'jma' })!,
      );
    expect(index('2026-10-02')).toBe(idx('rain'));
    expect(index('2026-10-03')).toBe(idx('nice'));
  });
});

describe('05시 발표 — 합성본(17시 원본의 모양만 바꿈)', () => {
  const MORNING = new Date('2026-10-01T21:10:00Z'); // 06:10 JST

  it('기온 4칸 = [오늘 최고, 오늘 최고(24h), 내일 최저, 내일 최고] · 오늘 최저는 없다', () => {
    const days = jmaDaysFromDocument(tokyo0500(), sourceOf('jp-tokyo'), MORNING);
    expect(days.get('2026-10-02')).toMatchObject({ code: 61, rainProbability: 50, maxTemp: 22, minTemp: null });
    expect(days.get('2026-10-03')).toMatchObject({ code: 0, rainProbability: 20, minTemp: 17, maxTemp: 24 });
    // 05시 발표는 날씨가 2일뿐 — 모레(10-04) 날씨는 주간 코드다.
    expect(days.get('2026-10-04')).toMatchObject({ code: 3, rainProbability: 30, minTemp: 16, maxTemp: 24 });
  });

  it('05시 발표에는 오늘 최저가 없다 — 36시간 안의 저장 행이 먼저, 없으면 내일 아침 최저(17)를 근사값으로(자정 ~ 05시 발표 전은 weather-sources-dry-run)', () => {
    const today = jmaDaysFromDocument(tokyo0500(), sourceOf('jp-tokyo'), MORNING).get('2026-10-02');
    // 원천의 최저 칸은 비워 둔다 — 근사값은 따로 둔다(오늘 밤이 이어지는 내일 0~9시 최저).
    expect(today).toMatchObject({ minTemp: null, approxMinTemp: 17, maxTemp: 22 });
    // 회귀(전환 당일 — 표가 비었다): 예전에는 null 이라 읽기 경로가 하루 내내 '못 봤어요' 였다.
    expect(finalizeSourceDay(today, { isToday: true, now: MORNING, source: 'jma' })).toMatchObject({
      code: 61,
      minTemp: 17,
      maxTemp: 22,
      rainProbability: 50,
      approximated: true,
    });
    // 저장 행이 있으면 그것이 근사값을 이긴다.
    const stored = { tempMin: 20, tempMax: 22, computedAt: '2026-10-01T12:05:00.000Z' };
    const inherited = finalizeSourceDay(today, { isToday: true, stored, now: MORNING, source: 'jma' });
    expect(inherited).toMatchObject({ code: 61, minTemp: 20, maxTemp: 22, rainProbability: 50 });
    expect(inherited).not.toHaveProperty('approximated');
    // 오늘이 아니면 근사값을 쓰지 않는다.
    expect(finalizeSourceDay(today, { isToday: false, now: MORNING, source: 'jma' })).toBeNull();
  });

  it.each([6, 12, 18])('발표 당일의 %i시 timeDefines가 통째로 빠져도 부분 최댓값을 쓰지 않는다', (hour) => {
    const d = tokyo0500();
    const series = d[0].timeSeries[1];
    const index = series.timeDefines.findIndex((time: string) => time === `2026-10-02T${String(hour).padStart(2, '0')}:00:00+09:00`);
    series.timeDefines.splice(index, 1);
    for (const area of series.areas) area.pops.splice(index, 1);
    const today = jmaDaysFromDocument(d, sourceOf('jp-tokyo'), MORNING).get('2026-10-02');
    expect(today!.rainProbability).toBeNull();
    expect(finalizeSourceDay(today, {
      isToday: true, source: 'jma', now: MORNING,
      stored: { tempMin: 20, tempMax: 22, computedAt: '2026-10-01T12:05:00.000Z' },
    })).toBeNull();
  });

  it('11시 발표는 12·18시 칸을 모두 요구하고 이미 지난 06시 칸은 요구하지 않는다', () => {
    const d = tokyo0500();
    d[0].reportDatetime = '2026-10-02T11:00:00+09:00';
    const series = d[0].timeSeries[1];
    series.timeDefines.shift();
    for (const area of series.areas) area.pops.shift();
    const now = new Date('2026-10-02T02:10:00Z');
    expect(jmaDaysFromDocument(d, sourceOf('jp-tokyo'), now).get('2026-10-02')!.rainProbability).toBe(30);
    series.timeDefines.shift();
    for (const area of series.areas) area.pops.shift();
    expect(jmaDaysFromDocument(d, sourceOf('jp-tokyo'), now).get('2026-10-02')!.rainProbability).toBeNull();
  });

  it('기온 칸의 날짜가 인덱스 규칙과 어긋나면 쓰지 않는다(추측 금지)', () => {
    const d = tokyo0500();
    d[0].timeSeries[2].timeDefines[2] = '2026-10-04T00:00:00+09:00';
    const days = jmaDaysFromDocument(d, sourceOf('jp-tokyo'), MORNING);
    expect(days.get('2026-10-02')!.maxTemp).toBeNull();
    // 주간이 내일(10-03) 기온을 가지고 있으면 그것으로 채운다 — 공식 주간 예보다.
    expect(days.get('2026-10-03')).toMatchObject({ minTemp: 17, maxTemp: 24 });
  });
});

describe('신선도 — 200 이어도 발표가 낡았으면 못 받은 것이다', () => {
  it('단기 13시간·주간 20시간을 넘으면 transient:stale_report', () => {
    const source = sourceOf('jp-tokyo');
    expect(() => jmaDaysFromDocument(doc('130000'), source, new Date('2026-10-01T21:00:00Z'))).not.toThrow(); // 13h
    expect(() => jmaDaysFromDocument(doc('130000'), source, new Date('2026-10-01T21:01:00Z'))).toThrow(
      expect.objectContaining({ failure: 'transient', reason: 'stale_report' }),
    );
    const staleWeek = doc('130000');
    staleWeek[1].reportDatetime = '2026-09-30T11:00:00+09:00';
    expect(() => jmaDaysFromDocument(staleWeek, source, AFTER_1700)).toThrow(
      expect.objectContaining({ reason: 'stale_report' }),
    );
  });

  it('모양이 틀리면 transient:jma_unparsable', () => {
    expect(() => jmaDaysFromDocument({}, sourceOf('jp-tokyo'), AFTER_1700)).toThrow(
      expect.objectContaining({ failure: 'transient', reason: 'jma_unparsable' }),
    );
  });
});

describe('fetchJmaDays — 호출', () => {
  it('office JSON 을 부르고 날짜를 돌려준다 — 즉석 계산이면 엣지 캐시를 건다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(doc('130000')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const region = WeatherRegions.byKey('jp-tokyo')!;
    const days = await fetchJmaDays(region, sourceOf('jp-tokyo'), {
      now: AFTER_1700,
      budget: fixedFetchBudget(1),
      cacheTtlSeconds: 600,
    });
    expect(days.get('2026-10-02')?.code).toBe(61);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { cf?: unknown }];
    expect(url).toBe(jmaForecastUrl('130000').toString());
    expect(url).toBe('https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json');
    expect(init.cf).toEqual({ cacheTtl: 600, cacheEverything: true });
  });

  it('404 는 설정 실패, 5xx 는 일시 실패, 예산이 없으면 부르지 않는다', async () => {
    const region = WeatherRegions.byKey('jp-tokyo')!;
    const run = async (status: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status })));
      return fetchJmaDays(region, sourceOf('jp-tokyo'), { now: AFTER_1700, budget: fixedFetchBudget(1) });
    };
    // 404 는 그 office 의 JSON 이 없다는 것 — 그 지역의 칸만 틀렸다(2026-10-05 실측: 없는 office 는 404 HTML).
    await expect(run(404)).rejects.toMatchObject({ failure: 'config', reason: 'http_404', scope: 'region' });
    // 그 밖의 4xx 는 원천 전체다.
    await expect(run(403)).rejects.toMatchObject({ failure: 'config', reason: 'http_403', scope: 'source' });
    await expect(run(503)).rejects.toMatchObject({ failure: 'transient', reason: 'http_503' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchJmaDays(region, sourceOf('jp-tokyo'), { now: AFTER_1700, budget: fixedFetchBudget(0) }),
    ).rejects.toMatchObject({ failure: 'budget' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
