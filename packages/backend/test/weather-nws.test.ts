// 미국 국립기상청(NWS) 어댑터 — `lib/weather-nws.ts`. 규칙: `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
//
// 픽스처는 2026-10-01 09:10~09:30Z 에 받은 원시 격자(`/gridpoints/{gridId}/{x},{y}`)에서 판정에 쓰는 층만 남긴 것이다
// (최고·최저 기온, 강수확률, 강수량, 적설, 하늘, 날씨). 값은 손대지 않았다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeatherRegions, type WeatherSource } from '@alarmtalk/shared';
import { fetchNwsDays, NWS_USER_AGENT, nwsDaysFromGrid, nwsGridUrl, parseNwsInterval } from '../src/lib/weather-nws';
import { finalizeSourceDay, fixedFetchBudget } from '../src/lib/weather-source';
import { resolvePrerenderWeatherIndex } from '../src/lib/weather-signal';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';

type NwsSource = Extract<WeatherSource, { kind: 'nws' }>;
const FIXTURES = join(__dirname, 'fixtures/weather/nws');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 픽스처를 고쳐 쓰는 테스트라 모양을 느슨하게 둔다
const grid = (key: string): any => JSON.parse(readFileSync(join(FIXTURES, `${key}-20261001.json`), 'utf8'));
const region = (key: string) => WeatherRegions.byKey(key)!;
const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

/** 10:00Z — 뉴욕 06:00 EDT(아침 슬롯), 미니애폴리스 05:00 CDT. 격자 발표(07:5xZ) 두 시간 뒤. */
const NOW = new Date('2026-10-01T10:00:00Z');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ISO 8601 구간', () => {
  it('시작/기간 → [시작, 끝)', () => {
    expect(parseNwsInterval('2026-10-01T12:00:00+00:00/PT13H')).toEqual({
      start: Date.parse('2026-10-01T12:00:00Z'),
      end: Date.parse('2026-10-02T01:00:00Z'),
    });
    expect(parseNwsInterval('2026-10-01T00:00:00+00:00/P1DT6H')!.end).toBe(Date.parse('2026-10-02T06:00:00Z'));
    expect(parseNwsInterval('nope')).toBeNull();
    expect(parseNwsInterval('2026-10-01T00:00:00+00:00/PT0H')).toBeNull();
  });
});

describe('원시 격자 → 날짜(지역 시간대 [00, 24))', () => {
  it("뉴욕 오늘: 'chance rain_showers' 인데 PoP 7·QPF 0 → 비가 아니다. 낮 하늘 평균 69 > 50 → 흐림", () => {
    const days = nwsDaysFromGrid(grid('us-new-york'), region('us-new-york').tz, NOW);
    expect(days.get('2026-10-01')).toEqual({ code: 3, maxTemp: 24.4, minTemp: 18.3, rainProbability: 7, precipitation: 0 });
  });

  it('뉴욕 내일: PoP 44 → 비, 강수량은 겹친 비율만큼 나눠 더한다(1.19 → 1.2)', () => {
    const days = nwsDaysFromGrid(grid('us-new-york'), region('us-new-york').tz, NOW);
    expect(days.get('2026-10-02')).toEqual({ code: 61, maxTemp: 27.2, minTemp: 20.6, rainProbability: 44, precipitation: 1.2 });
    // 오늘 ~ +3 의 4일을 낸다.
    expect([...days.keys()]).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('미니애폴리스 오늘: areas fog → 안개(45). 로스앤젤레스의 patchy fog 는 안개가 아니다(결정 D2)', () => {
    expect(nwsDaysFromGrid(grid('us-minneapolis'), region('us-minneapolis').tz, NOW).get('2026-10-01')).toMatchObject({
      code: 45,
      rainProbability: 2,
      precipitation: 0,
    });
    expect(nwsDaysFromGrid(grid('us-los-angeles'), region('us-los-angeles').tz, NOW).get('2026-10-01')).toEqual({
      code: 0,
      maxTemp: 31.1,
      minTemp: 17.8,
      rainProbability: 0,
      precipitation: 0,
    });
  });

  it('앵커리지 오늘: snow_showers 가 있고 PoP 34(≥30) → 눈(71)', () => {
    expect(nwsDaysFromGrid(grid('us-anchorage'), region('us-anchorage').tz, NOW).get('2026-10-01')).toMatchObject({
      code: 71,
      maxTemp: 5.6,
      minTemp: 0,
      rainProbability: 34,
    });
  });

  it('분류 — 뉴욕 오늘 흐림(4), 로스앤젤레스 더위(6), 미니애폴리스 안개(5), 앵커리지 눈(2)', () => {
    const index = (key: string) =>
      resolvePrerenderWeatherIndex(
        finalizeSourceDay(nwsDaysFromGrid(grid(key), region(key).tz, NOW).get('2026-10-01'), {
          isToday: true,
          now: NOW,
          source: 'nws',
        })!,
      );
    expect(index('us-new-york')).toBe(idx('cloud'));
    expect(index('us-los-angeles')).toBe(idx('heat'));
    expect(index('us-minneapolis')).toBe(idx('fog'));
    expect(index('us-anchorage')).toBe(idx('snow'));
  });

  it('최고·최저는 구간 **중점**의 현지 날짜로 고른다 — 자정을 걸친 구간도', () => {
    const g = grid('us-new-york');
    // 10-02 20:00 EDT ~ 10-03 08:00 EDT(중점 10-03 02:00) → 10-03 의 최저다.
    g.properties.minTemperature.values = g.properties.minTemperature.values.filter(
      (v: { validTime: string }) => !v.validTime.startsWith('2026-10-03'),
    );
    g.properties.minTemperature.values.push({ validTime: '2026-10-03T00:00:00+00:00/PT12H', value: 5 });
    const days = nwsDaysFromGrid(g, region('us-new-york').tz, NOW);
    expect(days.get('2026-10-03')!.minTemp).toBe(5);
  });

  it('아침이 지나 오늘 최저가 격자에서 빠지면 비워 둔다 — 36시간 안의 저장 행에서만 이어받는다', () => {
    const g = grid('us-new-york');
    g.properties.minTemperature.values = g.properties.minTemperature.values.slice(1);
    const today = nwsDaysFromGrid(g, region('us-new-york').tz, NOW).get('2026-10-01');
    expect(today!.minTemp).toBeNull();
    expect(finalizeSourceDay(today, { isToday: true, now: NOW, source: 'nws' })).toBeNull();
    expect(
      finalizeSourceDay(today, {
        isToday: true,
        now: NOW,
        source: 'nws',
        stored: { tempMin: 18, tempMax: 30, computedAt: '2026-10-01T01:05:00.000Z' },
      }),
    ).toMatchObject({ minTemp: 18, maxTemp: 24.4, code: 3 });
  });

  it('강수확률이 그날을 다 덮지 못하면(구간이 빠짐) 그 날짜는 미해결 — 다른 날짜는 그대로', () => {
    const g = grid('us-new-york');
    g.properties.probabilityOfPrecipitation.values = g.properties.probabilityOfPrecipitation.values.filter(
      (v: { validTime: string }) => !v.validTime.startsWith('2026-10-02T12'),
    );
    const days = nwsDaysFromGrid(g, region('us-new-york').tz, NOW);
    expect(days.get('2026-10-02')).toMatchObject({ code: null, rainProbability: null });
    expect(finalizeSourceDay(days.get('2026-10-02'), { isToday: false, now: NOW, source: 'nws' })).toBeNull();
    expect(days.get('2026-10-03')!.code).not.toBeNull();
  });

  it('강수량(QPF)은 발표 뒤 약 72시간까지만 온다 — 지평 너머는 재지 않음(NaN), 비는 PoP 가 정한다', () => {
    // 뉴욕 격자의 QPF 는 10-04 12Z 에서 끝난다(PoP·하늘은 10-09 까지). 10-04(EDT)는 뒤쪽 16시간이 지평 너머다.
    const days = nwsDaysFromGrid(grid('us-new-york'), region('us-new-york').tz, NOW);
    const d3 = days.get('2026-10-04')!;
    expect(Number.isNaN(d3.precipitation)).toBe(true);
    expect(d3).toMatchObject({ code: 61, rainProbability: 37, maxTemp: 19.4, minTemp: 15 });
    expect(finalizeSourceDay(d3, { isToday: false, now: NOW, source: 'nws' })).not.toBeNull();
    // 지평 **안**의 빈틈은 빠짐이다 — 그 날짜는 미해결.
    const g = grid('us-new-york');
    g.properties.quantitativePrecipitation.values = g.properties.quantitativePrecipitation.values.filter(
      (v: { validTime: string }) => !v.validTime.startsWith('2026-10-02T18'),
    );
    const gap = nwsDaysFromGrid(g, region('us-new-york').tz, NOW).get('2026-10-02')!;
    expect(gap.precipitation).toBeNull();
    expect(finalizeSourceDay(gap, { isToday: false, now: NOW, source: 'nws' })).toBeNull();
  });

  it('QPF 층에 숫자 표본이 하나도 없으면(빈 values · 값이 전부 null) 지평이 없다 — 모든 날짜가 빠짐(미해결)', () => {
    // 지평을 −∞ 로 두고 '전부 지평 너머(재지 않음)' 로 읽으면 오늘·내일까지 강수량 없이 해결된다(코덱스 #846).
    const tz = region('us-new-york').tz;
    const empty = grid('us-new-york');
    empty.properties.quantitativePrecipitation.values = [];
    const allNull = grid('us-new-york');
    allNull.properties.quantitativePrecipitation.values = allNull.properties.quantitativePrecipitation.values.map(
      (v: { validTime: string }) => ({ ...v, value: null }),
    );
    for (const g of [empty, allNull]) {
      const days = nwsDaysFromGrid(g, tz, NOW);
      expect([...days.keys()]).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
      for (const [date, day] of days) {
        expect(day.precipitation).toBeNull();
        expect(day.code).toBeNull();
        expect(finalizeSourceDay(day, { isToday: date === '2026-10-01', now: NOW, source: 'nws' })).toBeNull();
      }
    }
    // 표본이 있는 층의 지평 너머는 여전히 '재지 않음' 이다(위 테스트와 같은 규칙).
    expect(Number.isNaN(nwsDaysFromGrid(grid('us-new-york'), tz, NOW).get('2026-10-04')!.precipitation)).toBe(true);
  });

  it('발표가 18시간보다 낡았으면 transient:stale_grid, 층이 없으면 transient:nws_layers', () => {
    // 뉴욕 격자의 updateTime 은 07:51:53Z — 18시간 뒤는 다음 날 01:51:53Z.
    expect(() => nwsDaysFromGrid(grid('us-new-york'), 'America/New_York', new Date('2026-10-02T01:51:00Z'))).not.toThrow();
    expect(() => nwsDaysFromGrid(grid('us-new-york'), 'America/New_York', new Date('2026-10-02T01:53:00Z'))).toThrow(
      expect.objectContaining({ failure: 'transient', reason: 'stale_grid' }),
    );
    const g = grid('us-new-york');
    delete g.properties.skyCover;
    expect(() => nwsDaysFromGrid(g, 'America/New_York', NOW)).toThrow(expect.objectContaining({ reason: 'nws_layers' }));
  });
});

describe('fetchNwsDays — 호출', () => {
  const ny = region('us-new-york');
  const source = ny.source as NwsSource;

  it('원시 격자를 User-Agent·geo+json 으로 부른다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(grid('us-new-york')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const days = await fetchNwsDays(ny, source, { now: NOW, budget: fixedFetchBudget(1) });
    expect(days.get('2026-10-02')?.code).toBe(61);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { cf?: unknown }];
    expect(url).toBe(nwsGridUrl(source).toString());
    expect(url).toBe('https://api.weather.gov/gridpoints/OKX/33,42');
    expect(init.headers).toEqual({ 'user-agent': NWS_USER_AGENT, accept: 'application/geo+json' });
    expect(NWS_USER_AGENT).toBe('AlarmTalkBackend (alarm-talk.com, support@alarm-talk.com)');
    // cron 은 엣지 캐시를 쓰지 않는다.
    expect(init.cf).toBeUndefined();
  });

  it('403 HTML(UA 차단)·404 InvalidGridpoint·400 은 설정 실패, 429·5xx 는 일시 실패', async () => {
    const run = (status: number, body: string, contentType = 'application/problem+json') => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } })),
      );
      return fetchNwsDays(ny, source, { now: NOW, budget: fixedFetchBudget(1) });
    };
    await expect(run(403, '<html>Access Denied</html>', 'text/html')).rejects.toMatchObject({
      failure: 'config',
      reason: 'http_403_html',
    });
    await expect(
      run(404, JSON.stringify({ type: 'https://api.weather.gov/problems/InvalidGridpoint', status: 404 })),
    ).rejects.toMatchObject({ failure: 'config', reason: 'invalid_gridpoint' });
    await expect(run(400, '{}')).rejects.toMatchObject({ failure: 'config', reason: 'http_400' });
    await expect(run(429, '{}')).rejects.toMatchObject({ failure: 'transient', reason: 'http_429' });
    await expect(run(503, '{}')).rejects.toMatchObject({ failure: 'transient', reason: 'http_503' });
  });
});
