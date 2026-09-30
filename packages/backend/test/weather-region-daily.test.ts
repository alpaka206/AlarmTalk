// 지역별 날씨 **서버 미리 계산** — `lib/weather-region-daily.ts`, `GET /tts/prerender-variant` 의 지역 경로.
// 규칙: `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
//
//  - 지역 키(또는 되짚은 옛 글자) → (지역, target_date) 행. 12시간 안의 행이면 Open-Meteo 를 부르지 않는다.
//  - 없거나 오래됐으면 **박아 둔 좌표**로 곧바로 계산해 upsert 한다(지오코딩 없음).
//  - 표가 없으면(배포 → 마이그레이션 창) 저장 없이 계산만 한다.
//  - cron 은 50곳씩 묶어 예보·대기질을 부르고 묶음마다 `db.batch` 로 적는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { WeatherRegions, type WeatherRegion } from '@alarmtalk/shared';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';

const mockDB = createMockDB();
vi.mock('../src/lib/db', () => ({ getDB: () => mockDB.client }));

import ttsRoutes from '../src/routes/tts';
import { createClient } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import {
  isWeatherRegionRefreshSlot,
  refreshWeatherRegionDaily,
  resolveRegionVariantIndex,
  regionTargetDates,
  WEATHER_REGION_BATCH_SIZE,
  WEATHER_REGION_READ_STALE_MS,
  WEATHER_REGION_REFRESH_MS,
} from '../src/lib/weather-region-daily';
import type { DbExecutor } from '../src/lib/transactions';

type FetchInit = RequestInit & { cf?: { cacheTtl?: number; cacheEverything?: boolean } };
type Kind = 'geocode' | 'forecast' | 'air';

const HOUR = 60 * 60 * 1000;
const RAIN = CLONE_WEATHER_CONDITIONS.indexOf('rain');
const NICE = CLONE_WEATHER_CONDITIONS.indexOf('nice');

function region(key: string): WeatherRegion {
  const found = WeatherRegions.byKey(key);
  if (!found) throw new Error(`목록에 없는 키: ${key}`);
  return found;
}

function kindOf(url: URL): Kind {
  if (url.hostname === 'geocoding-api.open-meteo.com') return 'geocode';
  if (url.hostname === 'air-quality-api.open-meteo.com') return 'air';
  return 'forecast';
}

function datesBetween(start: string | null, end: string | null): string[] {
  if (!start || !end) return [];
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Open-Meteo 스텁 — 위치 목록(쉼표)을 받아 위치 수만큼 응답한다(하나면 객체, 여럿이면 배열 — 실제와 같다).
 * 기본값은 비(rain)로 분류되는 날. `failKinds` 는 타임아웃, `failCall` 은 그 번째 호출(1부터)만 500.
 */
function stubOpenMeteo(options?: {
  failKinds?: Set<Kind>;
  failForecastCall?: number;
  /** 대기질 응답에서 이 위치 번호(0부터)의 계열을 전부 null 로. */
  airNullAt?: Set<number>;
  /** 예보 응답의 위치 수를 하나 줄인다(개수 불일치). */
  dropForecastLocation?: boolean;
  clear?: boolean;
}) {
  let forecastCalls = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: FetchInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const kind = kindOf(url);
    if (init?.signal?.aborted) throw init.signal.reason;
    if (options?.failKinds?.has(kind)) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    if (kind === 'forecast') {
      forecastCalls += 1;
      if (options?.failForecastCall === forecastCalls) return new Response('{}', { status: 500 });
    }
    const count = (url.searchParams.get('latitude') ?? '').split(',').length;
    const dates = datesBetween(url.searchParams.get('start_date'), url.searchParams.get('end_date'));
    const locations = Array.from({ length: count }, (_, i) =>
      kind === 'forecast'
        ? {
            daily: {
              time: dates,
              weather_code: dates.map(() => (options?.clear ? 0 : 61)),
              temperature_2m_max: dates.map(() => 22),
              temperature_2m_min: dates.map(() => 15),
              precipitation_probability_max: dates.map(() => (options?.clear ? 0 : 80)),
              precipitation_sum: dates.map(() => (options?.clear ? 0 : 5)),
            },
          }
        : {
            hourly: {
              time: dates.flatMap((d) => [`${d}T00:00`, `${d}T12:00`]),
              pm10: dates.flatMap(() => (options?.airNullAt?.has(i) ? [null, null] : [10, 12])),
              pm2_5: dates.flatMap(() => (options?.airNullAt?.has(i) ? [null, null] : [5, 6])),
            },
          },
    );
    if (kind === 'forecast' && options?.dropForecastLocation) locations.pop();
    const body = locations.length === 1 ? locations[0] : locations;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cf-cache-status': 'MISS' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsOf(fetchMock: ReturnType<typeof stubOpenMeteo>): { kind: Kind; url: URL; init: FetchInit }[] {
  return fetchMock.mock.calls.map(([input, init]) => {
    const url = new URL(String(input));
    return { kind: kindOf(url), url, init: (init ?? {}) as FetchInit };
  });
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route('/tts', ttsRoutes);
  return app;
}

function requestVariant(query: Record<string, string>) {
  const params = new URLSearchParams({ context: 'wake_weather', ...query });
  return buildApp().request(`/tts/prerender-variant?${params.toString()}`);
}

const selectCalls = () => mockDB.calls.filter((c) => c.sql.includes('SELECT variant_index, computed_at'));
const upsertCalls = () => mockDB.calls.filter((c) => c.sql.includes('INSERT INTO weather_region_daily'));

beforeEach(() => {
  mockDB.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /tts/prerender-variant — 목록 지역 경로', () => {
  it('12시간 안에 계산한 행이 있으면 그 값을 준다 — Open-Meteo 를 부르지 않는다', async () => {
    const fetchMock = stubOpenMeteo();
    mockDB.pushResultFor('FROM weather_region_daily', [
      { variant_index: 4, computed_at: new Date(Date.now() - HOUR).toISOString() },
    ]);

    const res = await requestVariant({ region: 'kr-busan', target_date: '2026-10-01' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: 4 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selectCalls()).toHaveLength(1);
    expect(selectCalls()[0]!.args).toEqual(['kr-busan', '2026-10-01']);
    expect(upsertCalls()).toHaveLength(0);
  });

  it('행이 12시간보다 오래됐으면 박아 둔 좌표로 곧바로 계산해 upsert 한다(지오코딩 없음)', async () => {
    const busan = region('kr-busan');
    const targetDate = WeatherRegions.localDate(busan);
    const fetchMock = stubOpenMeteo();
    mockDB.pushResultFor('FROM weather_region_daily', [
      { variant_index: 4, computed_at: new Date(Date.now() - WEATHER_REGION_READ_STALE_MS - HOUR).toISOString() },
    ]);

    const res = await requestVariant({ region: 'kr-busan', target_date: targetDate, timezone: 'America/New_York' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: RAIN });
    const calls = callsOf(fetchMock);
    expect(calls.map((c) => c.kind).sort()).toEqual(['air', 'forecast']);
    for (const { url } of calls) {
      expect(url.searchParams.get('latitude')).toBe(String(busan.lat));
      expect(url.searchParams.get('longitude')).toBe(String(busan.lon));
      // 지역 시간대 — 클라가 보낸 시간대(뉴욕)가 아니다. target_date 는 지역 달력의 날짜다.
      expect(url.searchParams.get('timezone')).toBe('Asia/Seoul');
      expect(url.searchParams.get('start_date')).toBe(targetDate);
      expect(url.searchParams.get('end_date')).toBe(targetDate);
    }
    const [upsert] = upsertCalls();
    expect(upsert!.sql).toContain('ON CONFLICT(region_key, target_date) DO UPDATE');
    expect(upsert!.args.slice(0, 9)).toEqual(['kr-busan', targetDate, RAIN, 61, 22, 15, 80, 5, 'ok']);
    expect(Date.parse(String(upsert!.args[9]))).toBeGreaterThan(Date.now() - 60_000);
  });

  it('행이 없으면 계산해 적는다 — target_date 를 안 주면 지역의 오늘이다', async () => {
    const ny = region('us-new-york');
    stubOpenMeteo();

    const res = await requestVariant({ region: 'us-new-york' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: RAIN });
    expect(selectCalls()[0]!.args).toEqual(['us-new-york', WeatherRegions.localDate(ny)]);
    expect(upsertCalls()).toHaveLength(1);
    expect(upsertCalls()[0]!.args[1]).toBe(WeatherRegions.localDate(ny));
  });

  it('표가 없으면(배포 → 마이그레이션 창) 저장하지 않고 계산한 값만 준다', async () => {
    stubOpenMeteo();
    mockDB.pushErrorFor(
      'FROM weather_region_daily',
      new Error('SQLITE_ERROR: no such table: weather_region_daily'),
    );

    const res = await requestVariant({ region: 'kr-seoul', target_date: WeatherRegions.localDate(region('kr-seoul')) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: RAIN });
    expect(upsertCalls()).toHaveLength(0);
  });

  it('저장이 실패해도 계산한 값은 준다 — 표는 캐시일 뿐이다', async () => {
    stubOpenMeteo({ clear: true });
    mockDB.pushErrorFor('INSERT INTO weather_region_daily', new Error('SQLITE_BUSY'));

    const res = await requestVariant({ region: 'jp-tokyo', target_date: WeatherRegions.localDate(region('jp-tokyo')) });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: NICE });
  });

  it('한 조각이라도 못 받으면 null 이고 적지 않는다(반쪽 값 금지)', async () => {
    for (const failKinds of [new Set<Kind>(['forecast']), new Set<Kind>(['air'])]) {
      mockDB.reset();
      stubOpenMeteo({ failKinds });
      const res = await requestVariant({ region: 'kr-jeju', target_date: WeatherRegions.localDate(region('kr-jeju')) });
      expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
      expect(upsertCalls()).toHaveLength(0);
    }
  });

  it('지역의 어제~16일 뒤 밖의 날짜는 계산만 하고 적지 않는다', async () => {
    stubOpenMeteo();
    const res = await requestVariant({ region: 'kr-seoul', target_date: '2020-01-01' });
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: RAIN });
    expect(upsertCalls()).toHaveLength(0);
  });

  it('모르는 region 이면 옛 글자를 되짚는다 — 수원 → 경기(kr-gyeonggi)', async () => {
    const fetchMock = stubOpenMeteo();
    mockDB.pushResultFor('FROM weather_region_daily', [
      { variant_index: 2, computed_at: new Date().toISOString() },
    ]);

    const res = await requestVariant({ region: 'xx-nowhere', country: '대한민국', city: '수원', target_date: '2026-10-01' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: 2 });
    expect(selectCalls()[0]!.args).toEqual(['kr-gyeonggi', '2026-10-01']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('region 없이 옛 글자만 와도 목록으로 간다 — 大韓民国 + 東京 → jp-tokyo, 대한민국 + 부산 → kr-busan(지오코딩 없음)', async () => {
    for (const [country, city, key] of [
      ['大韓民国', '東京', 'jp-tokyo'],
      ['대한민국', '부산', 'kr-busan'],
      ['South Korea', 'Seoul', 'kr-seoul'],
    ] as const) {
      mockDB.reset();
      const fetchMock = stubOpenMeteo();
      const target = region(key);
      const res = await requestVariant({ country, city, target_date: WeatherRegions.localDate(target), timezone: 'Asia/Seoul' });
      expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: RAIN });
      expect(selectCalls()[0]!.args[0]).toBe(key);
      const calls = callsOf(fetchMock);
      expect(calls.map((c) => c.kind)).not.toContain('geocode');
      expect(calls.find((c) => c.kind === 'forecast')!.url.searchParams.get('latitude')).toBe(String(target.lat));
      expect(calls.find((c) => c.kind === 'forecast')!.url.searchParams.get('timezone')).toBe(target.tz);
    }
  });
});

describe('refreshWeatherRegionDaily — cron 미리 계산', () => {
  const NOW = new Date('2026-09-30T03:00:00.000Z');
  const db = () => mockDB.client as unknown as DbExecutor;
  const batchSizesOf = (calls: ReturnType<typeof callsOf>, kind: Kind) =>
    calls.filter((c) => c.kind === kind).map((c) => c.url.searchParams.get('latitude')!.split(',').length);

  it('비어 있으면 모든 지역을 50곳씩 묶어 부르고, 묶음마다 한 번에 적는다', async () => {
    const fetchMock = stubOpenMeteo();
    const total = WeatherRegions.all.length;

    const result = await refreshWeatherRegionDaily(db(), NOW);

    const calls = callsOf(fetchMock);
    const expectedSizes = [50, 50, total - 100];
    expect(WEATHER_REGION_BATCH_SIZE).toBe(50);
    expect(batchSizesOf(calls, 'forecast')).toEqual(expectedSizes);
    expect(batchSizesOf(calls, 'air')).toEqual(expectedSizes);
    expect(calls.some((c) => c.kind === 'geocode')).toBe(false);
    for (const { url, init } of calls) {
      const n = url.searchParams.get('latitude')!.split(',').length;
      expect(n).toBeLessThanOrEqual(50);
      expect(url.searchParams.get('longitude')!.split(',')).toHaveLength(n);
      // 위치마다 자기 시간대.
      expect(url.searchParams.get('timezone')!.split(',')).toHaveLength(n);
      expect(url.searchParams.get('start_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 새 예보가 목적이라 엣지 캐시를 걸지 않는다. 타임아웃은 건다.
      expect(init.cf).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    // 첫 묶음의 좌표·시간대 순서가 목록 순서다.
    const firstForecast = calls.find((c) => c.kind === 'forecast')!.url;
    expect(firstForecast.searchParams.get('latitude')!.split(',')[0]).toBe(String(WeatherRegions.all[0]!.lat));
    expect(firstForecast.searchParams.get('timezone')!.split(',')[0]).toBe(WeatherRegions.all[0]!.tz);

    expect(result).toEqual({ due: total, chunks: 3, failedChunks: 0, stored: total * 3, missingTable: false });
    const upserts = upsertCalls();
    expect(upserts).toHaveLength(total * 3);
    for (const call of upserts) {
      expect(call.sql).toContain('ON CONFLICT(region_key, target_date) DO UPDATE');
      expect(call.args[2]).toBe(RAIN);
    }
    // 지역마다 자기 시간대의 오늘·내일·모레.
    const ny = region('us-new-york');
    expect(
      upserts.filter((c) => c.args[0] === 'us-new-york').map((c) => c.args[1]),
    ).toEqual(regionTargetDates(ny, NOW));
    expect(regionTargetDates(ny, NOW)[0]).toBe('2026-09-29'); // 03:00Z = 뉴욕 전날 23:00
    expect(regionTargetDates(region('kr-seoul'), NOW)[0]).toBe('2026-09-30');
    // 지난 행 정리는 첫 쓰기에 한 번.
    const prunes = mockDB.calls.filter((c) => c.sql.includes('DELETE FROM weather_region_daily'));
    expect(prunes).toHaveLength(1);
    expect(prunes[0]!.args).toEqual(['2026-09-27']);
  });

  it('3시간 안에 계산한 지역은 건너뛴다 — 모두 새것이면 아무것도 부르지 않는다', async () => {
    const fetchMock = stubOpenMeteo();
    mockDB.pushResultFor(
      'SELECT region_key, target_date FROM weather_region_daily',
      WeatherRegions.all.flatMap((r) =>
        regionTargetDates(r, NOW).map((d) => ({ region_key: r.key, target_date: d })),
      ),
    );

    const result = await refreshWeatherRegionDaily(db(), NOW);

    expect(result).toEqual({ due: 0, chunks: 0, failedChunks: 0, stored: 0, missingTable: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsertCalls()).toHaveLength(0);
    const select = mockDB.calls.find((c) => c.sql.includes('SELECT region_key, target_date'))!;
    expect(select.args[0]).toBe(new Date(NOW.getTime() - WEATHER_REGION_REFRESH_MS).toISOString());
  });

  it('한 지역만 날짜가 빠졌으면 그 지역 하나만 — 위치 하나면 응답이 객체여도 읽는다', async () => {
    const fetchMock = stubOpenMeteo();
    const osaka = region('jp-osaka');
    mockDB.pushResultFor(
      'SELECT region_key, target_date FROM weather_region_daily',
      WeatherRegions.all.flatMap((r) =>
        regionTargetDates(r, NOW)
          .filter((d, i) => !(r.key === osaka.key && i === 2))
          .map((d) => ({ region_key: r.key, target_date: d })),
      ),
    );

    const result = await refreshWeatherRegionDaily(db(), NOW);

    expect(result.due).toBe(1);
    expect(batchSizesOf(callsOf(fetchMock), 'forecast')).toEqual([1]);
    expect(upsertCalls().map((c) => [c.args[0], c.args[1]])).toEqual(
      regionTargetDates(osaka, NOW).map((d) => [osaka.key, d]),
    );
  });

  it('한 묶음이 실패하면 그 묶음만 건너뛴다 — 다음 시간에 다시 온다', async () => {
    stubOpenMeteo({ failForecastCall: 2 });
    const total = WeatherRegions.all.length;

    const result = await refreshWeatherRegionDaily(db(), NOW);

    expect(result.failedChunks).toBe(1);
    expect(result.stored).toBe((total - 50) * 3);
  });

  it('응답의 위치 수가 요청과 다르면 그 묶음을 믿지 않는다', async () => {
    stubOpenMeteo({ dropForecastLocation: true });
    const result = await refreshWeatherRegionDaily(db(), NOW, { regions: WeatherRegions.byCountry('KR') });
    expect(result).toMatchObject({ due: 17, chunks: 1, failedChunks: 1, stored: 0 });
    expect(upsertCalls()).toHaveLength(0);
  });

  it('미세먼지 표본이 없는 지역은 적지 않는다(반쪽 값 금지)', async () => {
    stubOpenMeteo({ airNullAt: new Set([0]) });
    const kr = WeatherRegions.byCountry('KR');
    const result = await refreshWeatherRegionDaily(db(), NOW, { regions: kr });
    expect(result.stored).toBe((kr.length - 1) * 3);
    expect(upsertCalls().some((c) => c.args[0] === kr[0]!.key)).toBe(false);
  });

  it('표가 없으면(마이그레이션 전) 조용히 건너뛴다 — Open-Meteo 도 부르지 않는다', async () => {
    const fetchMock = stubOpenMeteo();
    mockDB.pushErrorFor('SELECT region_key, target_date', new Error('SQLITE_ERROR: no such table: weather_region_daily'));

    const result = await refreshWeatherRegionDaily(db(), NOW);

    expect(result.missingTable).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('다른 DB 오류는 던진다 — cron 이 Sentry 로 올린다', async () => {
    stubOpenMeteo();
    mockDB.pushErrorFor('SELECT region_key, target_date', new Error('SQLITE_IOERR'));
    await expect(refreshWeatherRegionDaily(db(), NOW)).rejects.toThrow('SQLITE_IOERR');
  });

  it('매시 첫 5분 틱에만 들여다본다', () => {
    expect(isWeatherRegionRefreshSlot(new Date('2026-09-30T03:00:00Z'))).toBe(true);
    expect(isWeatherRegionRefreshSlot(new Date('2026-09-30T03:04:59Z'))).toBe(true);
    expect(isWeatherRegionRefreshSlot(new Date('2026-09-30T03:05:00Z'))).toBe(false);
    expect(isWeatherRegionRefreshSlot(new Date('2026-09-30T03:55:00Z'))).toBe(false);
  });
});

// 목(mock) DB 는 SQL 을 실행하지 않는다 — 마이그레이션 #123 의 DDL 과 upsert(ON CONFLICT)를 **실제
// libSQL** 에 돌려 문법·키·갱신을 확인한다.
describe('weather_region_daily — 실제 libSQL', () => {
  it('cron 이 적고, 다시 돌면 갱신하고, 읽기 경로가 그 행을 쓴다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    const kr = WeatherRegions.byCountry('KR');
    const now = new Date();

    stubOpenMeteo();
    const first = await refreshWeatherRegionDaily(db as unknown as DbExecutor, now, { regions: kr });
    expect(first.stored).toBe(kr.length * 3);
    const count = await db.execute('SELECT COUNT(*) AS n FROM weather_region_daily');
    expect(Number(count.rows[0]!.n)).toBe(kr.length * 3);

    // 3시간 뒤: 다시 계산해 **같은 키를 덮는다**(행 수는 그대로, 값은 새것).
    vi.unstubAllGlobals();
    stubOpenMeteo({ clear: true });
    const later = new Date(now.getTime() + WEATHER_REGION_REFRESH_MS + 60_000);
    const second = await refreshWeatherRegionDaily(db as unknown as DbExecutor, later, { regions: kr });
    expect(second.due).toBe(kr.length);
    const rows = await db.execute({
      sql: `SELECT variant_index, weather_code, dust_level, computed_at FROM weather_region_daily
            WHERE region_key = ? AND target_date = ?`,
      args: ['kr-seoul', regionTargetDates(region('kr-seoul'), later)[0]!],
    });
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0]!.variant_index)).toBe(NICE);
    expect(Number(rows.rows[0]!.weather_code)).toBe(0);
    expect(rows.rows[0]!.dust_level).toBe('ok');
    expect(rows.rows[0]!.computed_at).toBe(later.toISOString());

    // 읽기 경로: 방금 적은 행이면 Open-Meteo 를 부르지 않는다.
    vi.unstubAllGlobals();
    const fetchMock = stubOpenMeteo();
    const index = await resolveRegionVariantIndex(
      () => db as unknown as DbExecutor,
      region('kr-seoul'),
      regionTargetDates(region('kr-seoul'), later)[0],
      { now: later },
    );
    expect(index).toBe(NICE);
    expect(fetchMock).not.toHaveBeenCalled();
    db.close();
  });

  it('마이그레이션 전(표 없음)에도 읽기 경로는 계산한 값을 준다', async () => {
    const db = createClient({ url: ':memory:' });
    stubOpenMeteo();
    const seoul = region('kr-seoul');
    const index = await resolveRegionVariantIndex(
      () => db as unknown as DbExecutor,
      seoul,
      WeatherRegions.localDate(seoul),
    );
    expect(index).toBe(RAIN);
    const cron = await refreshWeatherRegionDaily(db as unknown as DbExecutor, new Date(), { regions: [seoul] });
    expect(cron.missingTable).toBe(true);
    db.close();
  });
});
