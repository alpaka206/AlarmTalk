import { describe, it, expect } from 'vitest';
import {
  loadWeatherSignalInput,
  resolvePrerenderWeatherIndex,
  type WeatherSignalInput,
} from '../src/routes/tts';
import {
  CLONE_WEATHER_CONDITIONS,
  CLONE_FORTUNE_THEMES,
  CLONE_CLIP_SEEDS,
} from '../src/lib/stock-clips';

// 클라 hasCompleteCloneBucket 가 날씨=9(조건 8 + 미해결 안내 1)·운세=5 를 하드코딩하므로(오프라인 버킷
// '완전' 판정), 백엔드 개수가 바뀌면 이 단언이 깨져 클라 상수 동기화를 강제한다.
describe('클론 매칭 버킷 개수 계약', () => {
  it('날씨 조건=8, 운세 테마=5', () => {
    expect(CLONE_WEATHER_CONDITIONS.length).toBe(8);
    expect(CLONE_FORTUNE_THEMES.length).toBe(5);
  });

  it('날씨 클립=조건+미해결안내(9), 운세 클립=테마(5) — 클라 하드코딩과 일치', () => {
    const weatherSeeds = CLONE_CLIP_SEEDS.find((s) => s.category === 'weather')?.seeds.length ?? 0;
    const fortuneSeeds = CLONE_CLIP_SEEDS.find((s) => s.category === 'fortune')?.seeds.length ?? 0;
    // 날씨는 준비창에서 인터넷이 안 되면 미해결이라 안내 클립 1개를 마지막에 더한다(클라 size-1 폴백).
    expect(weatherSeeds).toBe(CLONE_WEATHER_CONDITIONS.length + 1);
    expect(weatherSeeds).toBe(9);
    // 운세는 기기 결정적 계산이라 미해결이 없어 테마 개수 = 클립 개수.
    expect(fortuneSeeds).toBe(CLONE_FORTUNE_THEMES.length);
    expect(fortuneSeeds).toBe(5);
  });
});

const base: WeatherSignalInput = {
  code: 0,
  maxTemp: 20,
  minTemp: 12,
  rainProbability: 0,
  precipitation: 0,
  hasDust: false,
};

const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

describe('resolvePrerenderWeatherIndex (CLONE_WEATHER_CONDITIONS 순서 인덱스)', () => {
  it('눈 코드 → snow', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 73 })).toBe(idx('snow'));
  });
  it('강수확률/코드 → rain', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, rainProbability: 40 })).toBe(idx('rain'));
    expect(resolvePrerenderWeatherIndex({ ...base, code: 63 })).toBe(idx('rain'));
  });
  it('미세먼지 → dust (비/눈 없을 때)', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, hasDust: true })).toBe(idx('dust'));
  });
  it('안개 코드(45/48) → fog', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 45 })).toBe(idx('fog'));
  });
  it('고온(>=30) → heat', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, maxTemp: 32 })).toBe(idx('heat'));
  });
  it('흐림 코드(2/3) → cloud', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 3 })).toBe(idx('cloud'));
  });
  it('맑고 추운 날(최저<=0/최고<=5) → cold (nice 오재 방지)', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 0, maxTemp: 2, minTemp: -7 })).toBe(
      idx('cold'),
    );
  });
  it('맑음(기본) → nice', () => {
    expect(resolvePrerenderWeatherIndex(base)).toBe(idx('nice'));
  });
  it('우선순위: 눈>비>미세먼지 (동시 조건)', () => {
    expect(
      resolvePrerenderWeatherIndex({ ...base, code: 73, rainProbability: 90, hasDust: true }),
    ).toBe(idx('snow'));
  });
  it('반환 인덱스는 항상 0..conditions-1 범위', () => {
    const i = resolvePrerenderWeatherIndex({ ...base, code: 45 });
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(CLONE_WEATHER_CONDITIONS.length);
  });
});

// ---------------------------------------------------------------------------------------------
// GET /tts/prerender-variant 의 Open-Meteo 호출 규약 — 타임아웃 · 엣지 캐시 · 관측 로그.
//
// 앱은 날씨 테마 알람을 저장하기 전에 이 응답을 동기로 기다린다. 그래서 (1) Open-Meteo 가 멈춰도
// 5초 안에 null 로 돌아와야 하고(500 이 아니라 200 + variant_index: null — 앱은 null 이면 기존
// 값을 유지하고 뒤에서 다시 받는다), (2) 같은 도시·날짜는 엣지 캐시로 오리진에 덜 닿아야 하며,
// (3) 배포 뒤 히트율을 잴 수 있게 한 줄 로그가 남아야 한다. 셋 다 `lib/weather-fetch.ts` 가 맡는다.
// ---------------------------------------------------------------------------------------------
import { Hono } from 'hono';
import { vi, afterEach } from 'vitest';
import type { AppEnv } from '../src/types';
import ttsRoutes from '../src/routes/tts';
import {
  WEATHER_FETCH_TIMEOUT_MS,
  WEATHER_FORECAST_CACHE_TTL_SECONDS,
  WEATHER_GEOCODE_CACHE_TTL_SECONDS,
} from '../src/lib/weather-fetch';

type FetchInit = RequestInit & { cf?: { cacheTtl?: number; cacheEverything?: boolean } };

const TARGET_DATE = '2026-09-23';
const CITY = 'Busan';
const CITY_LATITUDE = 35.1796;
const CITY_LONGITUDE = 129.0756;

function openMeteoJson(body: unknown, cacheStatus = 'HIT'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cf-cache-status': cacheStatus },
  });
}

/**
 * 세 엔드포인트에 정상 응답을 주는 스텁 — 비(rain) 로 분류되는 하루.
 * `failKinds` 는 타임아웃(거부), `emptyGeocode` 는 200 인데 결과 없음, `geocodeStatus` 는 비정상 상태코드.
 */
function stubOpenMeteo(options?: {
  failKinds?: Set<'geocode' | 'forecast' | 'air'>;
  emptyGeocode?: boolean;
  geocodeStatus?: number;
  /** 미세먼지 200 응답의 `hourly` 를 통째로 바꾼다(빈 계열·null 계열 등). */
  airHourly?: Record<string, unknown[]>;
}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: FetchInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const kind: 'geocode' | 'forecast' | 'air' =
      url.hostname === 'geocoding-api.open-meteo.com'
        ? 'geocode'
        : url.hostname === 'air-quality-api.open-meteo.com'
          ? 'air'
          : 'forecast';
    // 실제 fetch 와 같은 계약: 이미 abort 된 signal 이면 그 reason 으로 거부한다.
    if (init?.signal?.aborted) throw init.signal.reason;
    if (options?.failKinds?.has(kind)) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    if (kind === 'geocode') {
      if (options?.geocodeStatus) {
        return new Response('{}', { status: options.geocodeStatus });
      }
      if (options?.emptyGeocode) return openMeteoJson({ results: [] });
      return openMeteoJson({
        results: [
          {
            name: CITY,
            country: 'South Korea',
            latitude: CITY_LATITUDE,
            longitude: CITY_LONGITUDE,
          },
        ],
      });
    }
    if (kind === 'forecast') {
      return openMeteoJson({
        daily: {
          time: [TARGET_DATE],
          weather_code: [61],
          temperature_2m_max: [22],
          temperature_2m_min: [15],
          precipitation_probability_max: [80],
          precipitation_sum: [5],
        },
      });
    }
    return openMeteoJson({ hourly: options?.airHourly ?? { pm10: [10, 12], pm2_5: [5, 6] } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route('/tts', ttsRoutes);
  return app;
}

function requestVariant(app: Hono<AppEnv>, options: { targetDate?: string | null } = {}) {
  const query = new URLSearchParams({
    context: 'wake_weather',
    country: 'South Korea',
    city: CITY,
    timezone: 'Asia/Seoul',
  });
  const targetDate = options.targetDate === undefined ? TARGET_DATE : options.targetDate;
  if (targetDate) query.set('target_date', targetDate);
  return app.request(`/tts/prerender-variant?${query.toString()}`);
}

/** `logStructured` 가 console 로 내보낸 JSON 줄 가운데 `at: 'weather.fetch'` 인 것만 골라낸다. */
function structuredLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(String(line)) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry?.at === 'weather.fetch');
}

describe('GET /tts/prerender-variant — Open-Meteo 타임아웃', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('세 fetch 모두 타임아웃이면 500 이 아니라 200 + variant_index: null 로 돌아온다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 실제 5초를 기다리지 않는다 — `AbortSignal.timeout` 이 **이미 abort 된** signal 을 돌려주게
    // 해서, 라우트가 그 signal 을 fetch 에 실어 보내는지와 거부가 null 로 귀결되는지만 본다.
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() =>
        AbortSignal.abort(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        ),
      );
    const fetchMock = stubOpenMeteo();

    const res = await requestVariant(buildApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    // 상한은 한 곳의 상수(5초)이고, 세 fetch 가 각각 새 signal 을 받는다.
    expect(WEATHER_FETCH_TIMEOUT_MS).toBe(5_000);
    expect(timeoutSpy).toHaveBeenCalledWith(WEATHER_FETCH_TIMEOUT_MS);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as FetchInit).signal).toBeInstanceOf(AbortSignal);
    }
    // 지오코딩을 못 받았으면 거기서 끝이다 — 서울 좌표로 예보를 이어 받지 않는다(아래 "지오코딩만" 참조).
    const kinds = fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
    expect(kinds).toEqual(['geocoding-api.open-meteo.com']);
    // 실패도 한 줄 남는다 — timedOut=true, 사용자 값 없음.
    const failed = structuredLines(warnSpy);
    expect(failed.map((entry) => [entry.kind, entry.timedOut, entry.status])).toEqual([
      ['geocode', true, null],
    ]);
  });

  // ⚠ 아래 셋이 이 라우트의 핵심 계약이다(코덱스 #788 P2). 사전렌더 인덱스는 클라가 '해결된 사실' 로
  //   저장하고 발사 24시간 창 안에서 다시 받지 않는다(Android `weatherVariantNeedsRefresh`). 그래서
  //   지오코딩이 서울로 폴백한 값을 내보내면 부산 알람이 서울 날씨를 읽고, 먼지를 '없음' 으로 굳히면
  //   먼지 나쁜 날 산책을 권한다 — 한 조각이라도 못 받았으면 null 이어야 클라가 다시 받는다.
  it('지오코딩만 타임아웃이면 서울로 폴백하지 않고 null — 예보를 부르지도 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = stubOpenMeteo({ failKinds: new Set(['geocode']) });

    const res = await requestVariant(buildApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    const kinds = fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
    expect(kinds).toEqual(['geocoding-api.open-meteo.com']);
  });

  it('지오코딩이 비정상 응답(429)이거나 결과가 없어도 null — 서울 예보로 대신하지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const options of [{ geocodeStatus: 429 }, { emptyGeocode: true }]) {
      const fetchMock = stubOpenMeteo(options);
      const res = await requestVariant(buildApp());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
      const kinds = fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
      expect(kinds).toEqual(['geocoding-api.open-meteo.com']);
    }
  });

  it('미세먼지 200 인데 계열이 비었거나 전부 null 이어도 null — 받은 것이 아니다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const airHourly of [
      { pm10: [], pm2_5: [] },
      { pm10: [null, null], pm2_5: [null, null] },
      // 한 계열만 있어도 판정하지 않는다 — 요청한 두 계열이 다 있어야 '받았다' 다.
      { pm10: [10, 12] },
      { pm10: [10, 12], pm2_5: [null] },
    ]) {
      stubOpenMeteo({ airHourly });
      const res = await requestVariant(buildApp());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    }
    // 정상 표본이면 그대로 분류한다(비 → rain; 먼지만 나쁜 날 → dust).
    stubOpenMeteo({ airHourly: { pm10: [90], pm2_5: [10] } });
    expect(await (await requestVariant(buildApp())).json()).toEqual({
      context: 'wake_weather',
      variant_index: idx('rain'),
    });
  });

  it('미세먼지만 타임아웃이어도 null — 먼지 없음으로 굳혀 저장되게 두지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubOpenMeteo({ failKinds: new Set(['air']) });

    const res = await requestVariant(buildApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
  });
});

describe('loadWeatherSignalInput — 라이브 생성(fallback)은 폴백을 유지한다', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const liveArgs = { country: 'South Korea', city: CITY, targetDate: TARGET_DATE, timezone: 'Asia/Seoul' };

  it('지오코딩 타임아웃 → 서울 좌표로 예보를 이어 받는다(문장을 비우지 않는다)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = stubOpenMeteo({ failKinds: new Set(['geocode']) });

    const input = await loadWeatherSignalInput(liveArgs, 'fallback');

    expect(input).not.toBeNull();
    expect(input?.code).toBe(61);
    const forecastUrl = fetchMock.mock.calls
      .map(([raw]) => new URL(String(raw)))
      .find((url) => url.hostname === 'api.open-meteo.com');
    expect(forecastUrl?.searchParams.get('latitude')).toBe('37.5665');
    expect(forecastUrl?.searchParams.get('longitude')).toBe('126.978');
  });

  it('미세먼지 타임아웃 → 먼지 없음으로 이어 간다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubOpenMeteo({ failKinds: new Set(['air']) });

    const input = await loadWeatherSignalInput(liveArgs, 'fallback');

    expect(input).not.toBeNull();
    expect(input?.hasDust).toBe(false);
  });

  it('같은 입력을 unresolved 로 부르면 둘 다 null 이다 — 정책만 다르고 조회는 같다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubOpenMeteo({ failKinds: new Set(['geocode']) });
    expect(await loadWeatherSignalInput(liveArgs, 'unresolved')).toBeNull();
    vi.unstubAllGlobals();
    stubOpenMeteo({ failKinds: new Set(['air']) });
    expect(await loadWeatherSignalInput(liveArgs, 'unresolved')).toBeNull();
  });
});

describe('GET /tts/prerender-variant — Open-Meteo 엣지 캐시·관측 로그', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('세 fetch 에 cf.cacheTtl·cacheEverything 과 signal 이 실린다(지오코딩 7일, 예보·미세먼지 6시간)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubOpenMeteo();

    const res = await requestVariant(buildApp());
    expect(res.status).toBe(200);

    const byHost = new Map<string, FetchInit>();
    for (const [input, init] of fetchMock.mock.calls) {
      byHost.set(new URL(String(input)).hostname, init as FetchInit);
    }
    expect([...byHost.keys()].sort()).toEqual(
      [
        'air-quality-api.open-meteo.com',
        'api.open-meteo.com',
        'geocoding-api.open-meteo.com',
      ].sort(),
    );
    expect(byHost.get('geocoding-api.open-meteo.com')?.cf).toEqual({
      cacheTtl: WEATHER_GEOCODE_CACHE_TTL_SECONDS,
      cacheEverything: true,
    });
    expect(byHost.get('api.open-meteo.com')?.cf).toEqual({
      cacheTtl: WEATHER_FORECAST_CACHE_TTL_SECONDS,
      cacheEverything: true,
    });
    expect(byHost.get('air-quality-api.open-meteo.com')?.cf).toEqual({
      cacheTtl: WEATHER_FORECAST_CACHE_TTL_SECONDS,
      cacheEverything: true,
    });
    for (const init of byHost.values()) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    // TTL 의 근거: 좌표는 안 바뀌니 7일, 예보는 앱의 "발사 24시간 이내" 창보다 촘촘해야 한다.
    expect(WEATHER_GEOCODE_CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(WEATHER_FORECAST_CACHE_TTL_SECONDS).toBe(6 * 60 * 60);
    expect(WEATHER_FORECAST_CACHE_TTL_SECONDS).toBeLessThan(24 * 60 * 60);
  });

  it('날짜 없는 호출(forecast_days=1)은 예보·미세먼지를 캐시하지 않는다 — 자정을 넘긴 어제 예보가 오늘로 나간다', async () => {
    // 캐시 키는 URL 이다. `start_date=end_date=` 가 없는 URL 은 "오늘" 을 담지 않아, 23:50 에
    // 채워진 응답이 TTL 동안 다음날 새벽에도 HIT 로 나간다. 지오코딩은 날짜와 무관하니 그대로 캐시한다.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubOpenMeteo();

    const res = await requestVariant(buildApp(), { targetDate: null });
    expect(res.status).toBe(200);

    const byHost = new Map<string, { url: URL; init: FetchInit }>();
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      byHost.set(url.hostname, { url, init: init as FetchInit });
    }
    const forecast = byHost.get('api.open-meteo.com');
    const air = byHost.get('air-quality-api.open-meteo.com');
    expect(forecast?.url.searchParams.get('forecast_days')).toBe('1');
    expect(forecast?.url.searchParams.get('start_date')).toBeNull();
    expect(forecast?.init.cf).toBeUndefined();
    expect(air?.init.cf).toBeUndefined();
    expect(byHost.get('geocoding-api.open-meteo.com')?.init.cf).toEqual({
      cacheTtl: WEATHER_GEOCODE_CACHE_TTL_SECONDS,
      cacheEverything: true,
    });
    // 타임아웃은 캐시 여부와 무관하게 걸린다.
    for (const { init } of byHost.values()) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('호출마다 at=weather.fetch 한 줄 — kind·status·cacheStatus·ms·timedOut, 도시명·좌표는 없다', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stubOpenMeteo();

    await requestVariant(buildApp());

    const lines = structuredLines(logSpy);
    expect(lines.map((entry) => entry.kind)).toEqual(['geocode', 'forecast', 'air']);
    for (const entry of lines) {
      expect(entry.status).toBe(200);
      expect(entry.cacheStatus).toBe('HIT');
      expect(typeof entry.ms).toBe('number');
      expect(entry.timedOut).toBe(false);
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(CITY);
      expect(serialized).not.toContain(String(CITY_LATITUDE));
      expect(serialized).not.toContain(String(CITY_LONGITUDE));
    }
  });

  it('정상 응답 경로는 그대로다 — 좌표·날짜·타임존이 URL 에 실리고 비(rain) 인덱스가 나온다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubOpenMeteo();

    const res = await requestVariant(buildApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: idx('rain') });
    const forecastCall = fetchMock.mock.calls.find(
      ([input]) => new URL(String(input)).hostname === 'api.open-meteo.com',
    );
    const forecastUrl = new URL(String(forecastCall?.[0]));
    expect(forecastUrl.searchParams.get('latitude')).toBe(String(CITY_LATITUDE));
    expect(forecastUrl.searchParams.get('longitude')).toBe(String(CITY_LONGITUDE));
    expect(forecastUrl.searchParams.get('start_date')).toBe(TARGET_DATE);
    expect(forecastUrl.searchParams.get('end_date')).toBe(TARGET_DATE);
    expect(forecastUrl.searchParams.get('timezone')).toBe('Asia/Seoul');
  });
});
