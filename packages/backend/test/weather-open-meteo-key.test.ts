// Open-Meteo **상업 키(선택)** — `lib/weather-fetch.ts` 의 `openMeteoRequestUrl` 한 곳이 호스트를 고른다.
//
//  - 키가 없으면(미설정·빈 값·공백) 예전과 **똑같다** — 무료 호스트, `apikey` 없음.
//  - 키가 있으면 세 호출(예보·대기질·지오코딩)이 `customer-` 호스트로 가고 `apikey` 가 붙는다 —
//    읽기 경로(`GET /tts/prerender-variant`)·옛 글자 지오코딩·cron 미리 계산 모두.
//  - 키는 **로그에 남지 않는다** — `weather.fetch` 줄은 URL 을 싣지 않고 `commercial` 만 남긴다.
// 운영 절차: `docs/ops/environments.md` 「Open-Meteo 상업 키」.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { WeatherRegions } from '@alarmtalk/shared';
import type { AppEnv, Env } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();
vi.mock('../src/lib/db', () => ({ getDB: () => mockDB.client }));

import ttsRoutes from '../src/routes/tts';
import {
  fetchOpenMeteo,
  openMeteoApiKey,
  openMeteoRequestUrl,
  redactOpenMeteoUrl,
} from '../src/lib/weather-fetch';
import { refreshWeatherRegionDaily } from '../src/lib/weather-region-daily';
import type { DbExecutor } from '../src/lib/transactions';

const { selectWorkerSecrets, WORKER_SECRET_KEYS } = await import('../scripts/worker-secret-keys');

const KEY = 'om-test-key-3f9c1a';
const FREE_HOSTS = ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'geocoding-api.open-meteo.com'];
const COMMERCIAL_HOSTS = [
  'customer-api.open-meteo.com',
  'customer-air-quality-api.open-meteo.com',
  'customer-geocoding-api.open-meteo.com',
];

/** 호스트에서 `customer-` 를 떼고 종류를 가른다. */
function kindOf(url: URL): 'geocode' | 'forecast' | 'air' {
  const host = url.hostname.replace(/^customer-/, '');
  if (host === 'geocoding-api.open-meteo.com') return 'geocode';
  if (host === 'air-quality-api.open-meteo.com') return 'air';
  return 'forecast';
}

function datesBetween(start: string | null, end: string | null): string[] {
  if (!start || !end) return ['2026-10-01'];
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** 무료·상업 어느 호스트든 같은 모양으로 답하는 스텁(위치 여럿이면 배열). */
function stubOpenMeteo() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const kind = kindOf(url);
    if (kind === 'geocode') {
      return new Response(
        JSON.stringify({
          results: [
            { name: '런던', country: '영국', country_code: 'GB', feature_code: 'PPLC', population: 8_961_989, latitude: 51.5, longitude: -0.12 },
          ],
        }),
        { status: 200 },
      );
    }
    const count = (url.searchParams.get('latitude') ?? '').split(',').length;
    const dates = datesBetween(url.searchParams.get('start_date'), url.searchParams.get('end_date'));
    const one =
      kind === 'forecast'
        ? {
            daily: {
              time: dates,
              weather_code: dates.map(() => 0),
              temperature_2m_max: dates.map(() => 22),
              temperature_2m_min: dates.map(() => 15),
              precipitation_probability_max: dates.map(() => 0),
              precipitation_sum: dates.map(() => 0),
            },
          }
        : {
            hourly: {
              time: dates.flatMap((d) => [`${d}T00:00`, `${d}T12:00`]),
              pm10: dates.flatMap(() => [10, 12]),
              pm2_5: dates.flatMap(() => [5, 6]),
            },
          };
    const body = count === 1 ? one : Array.from({ length: count }, () => one);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cf-cache-status': 'MISS' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urlsOf = (fetchMock: ReturnType<typeof stubOpenMeteo>) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input)));

/** console.log/warn/error 로 나간 모든 줄. */
function captureLogs(): () => string {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'warn').mockImplementation(push);
  vi.spyOn(console, 'error').mockImplementation(push);
  return () => lines.join('\n');
}

function requestVariant(query: Record<string, string>, env: Partial<Env>) {
  const app = new Hono<AppEnv>();
  app.route('/tts', ttsRoutes);
  const params = new URLSearchParams({ context: 'wake_weather', target_date: '2026-10-01', ...query });
  return app.request(`/tts/prerender-variant?${params.toString()}`, undefined, env);
}

beforeEach(() => {
  mockDB.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openMeteoApiKey / openMeteoRequestUrl', () => {
  it('미설정·빈 값·공백이면 키가 없다 — 앞뒤 공백은 벗긴다', () => {
    expect(openMeteoApiKey(undefined)).toBeUndefined();
    expect(openMeteoApiKey({})).toBeUndefined();
    expect(openMeteoApiKey({ OPEN_METEO_API_KEY: '' })).toBeUndefined();
    expect(openMeteoApiKey({ OPEN_METEO_API_KEY: '   ' })).toBeUndefined();
    expect(openMeteoApiKey({ OPEN_METEO_API_KEY: ` ${KEY}\n` })).toBe(KEY);
  });

  it('키가 없으면 받은 URL 그대로 — 무료 호스트, apikey 없음', () => {
    for (const host of FREE_HOSTS) {
      const url = new URL(`https://${host}/v1/x?latitude=1`);
      const out = openMeteoRequestUrl(url, undefined);
      expect(out).toBe(url);
      expect(out.searchParams.has('apikey')).toBe(false);
    }
  });

  it('키가 있으면 세 호스트 모두 customer- 로 바꾸고 apikey 를 붙인 사본을 만든다', () => {
    FREE_HOSTS.forEach((host, i) => {
      const url = new URL(`https://${host}/v1/forecast?latitude=37.5,35.1&timezone=Asia%2FSeoul`);
      const out = openMeteoRequestUrl(url, KEY);
      expect(out.hostname).toBe(COMMERCIAL_HOSTS[i]);
      expect(out.pathname).toBe('/v1/forecast');
      expect(out.searchParams.get('apikey')).toBe(KEY);
      expect(out.searchParams.get('latitude')).toBe('37.5,35.1');
      expect(out.searchParams.get('timezone')).toBe('Asia/Seoul');
      // 호출부의 URL 은 그대로다.
      expect(url.hostname).toBe(host);
      expect(url.searchParams.has('apikey')).toBe(false);
    });
  });

  it('모르는 호스트에는 키를 붙이지 않는다', () => {
    const url = new URL('https://example.com/v1/forecast');
    const out = openMeteoRequestUrl(url, KEY);
    expect(out.hostname).toBe('example.com');
    expect(out.searchParams.has('apikey')).toBe(false);
  });

  it('redactOpenMeteoUrl 은 apikey 값을 가린다', () => {
    const redacted = redactOpenMeteoUrl(openMeteoRequestUrl(new URL('https://api.open-meteo.com/v1/forecast?a=1'), KEY));
    expect(redacted).not.toContain(KEY);
    expect(new URL(redacted).searchParams.get('apikey')).toBe('REDACTED');
    expect(redactOpenMeteoUrl('https://api.open-meteo.com/v1/forecast?a=1')).toBe('https://api.open-meteo.com/v1/forecast?a=1');
  });
});

describe('fetchOpenMeteo — 키는 요청에만 실리고 로그에는 없다', () => {
  it('성공: 상업 호스트로 부르고 로그에는 commercial:true 만 남는다', async () => {
    const logs = captureLogs();
    const fetchMock = stubOpenMeteo();
    await fetchOpenMeteo('forecast', new URL('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2'), 60, KEY);

    const [url] = urlsOf(fetchMock);
    expect(url!.hostname).toBe('customer-api.open-meteo.com');
    expect(url!.searchParams.get('apikey')).toBe(KEY);
    const line = JSON.parse(logs());
    expect(line).toMatchObject({ at: 'weather.fetch', kind: 'forecast', commercial: true, status: 200, cacheStatus: 'MISS' });
    expect(logs()).not.toContain(KEY);
    expect(logs()).not.toContain('open-meteo.com');
  });

  it('실패(에러 메시지에 URL 이 실려도): 로그에 키가 없다', async () => {
    const logs = captureLogs();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        throw new TypeError(`fetch failed: ${input}`);
      }),
    );
    await expect(
      fetchOpenMeteo('air', new URL('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=1'), null, KEY),
    ).rejects.toThrow(TypeError);
    const line = JSON.parse(logs());
    expect(line).toMatchObject({ at: 'weather.fetch', kind: 'air', commercial: true, status: null, error: 'TypeError' });
    expect(logs()).not.toContain(KEY);
  });

  it('키가 없으면 무료 호스트 그대로, commercial:false', async () => {
    const logs = captureLogs();
    const fetchMock = stubOpenMeteo();
    await fetchOpenMeteo('geocode', new URL('https://geocoding-api.open-meteo.com/v1/search?name=x'), 60);
    const [url] = urlsOf(fetchMock);
    expect(url!.hostname).toBe('geocoding-api.open-meteo.com');
    expect(url!.searchParams.has('apikey')).toBe(false);
    expect(JSON.parse(logs())).toMatchObject({ commercial: false });
  });
});

describe('GET /tts/prerender-variant — 워커의 OPEN_METEO_API_KEY 를 따른다', () => {
  it('미설정: 목록 지역은 무료 예보·대기질 호스트, apikey 없음(예전과 같다)', async () => {
    captureLogs();
    const fetchMock = stubOpenMeteo();
    const res = await requestVariant({ region: 'kr-busan' }, {});
    expect(res.status).toBe(200);
    expect((await res.json()).variant_index).not.toBeNull();
    const urls = urlsOf(fetchMock);
    expect(urls.map((u) => u.hostname).sort()).toEqual(['air-quality-api.open-meteo.com', 'api.open-meteo.com']);
    expect(urls.every((u) => !u.searchParams.has('apikey'))).toBe(true);
  });

  it('빈 값도 미설정과 같다', async () => {
    captureLogs();
    const fetchMock = stubOpenMeteo();
    await requestVariant({ region: 'kr-busan' }, { OPEN_METEO_API_KEY: '  ' });
    const urls = urlsOf(fetchMock);
    expect(urls.every((u) => FREE_HOSTS.includes(u.hostname) && !u.searchParams.has('apikey'))).toBe(true);
  });

  it('설정: 목록 지역은 상업 예보·대기질 호스트 + apikey, 로그에 키 없음', async () => {
    const logs = captureLogs();
    const fetchMock = stubOpenMeteo();
    const res = await requestVariant({ region: 'kr-busan' }, { OPEN_METEO_API_KEY: KEY });
    expect(res.status).toBe(200);
    expect((await res.json()).variant_index).not.toBeNull();
    const urls = urlsOf(fetchMock);
    expect(urls.map((u) => u.hostname).sort()).toEqual([
      'customer-air-quality-api.open-meteo.com',
      'customer-api.open-meteo.com',
    ]);
    expect(urls.every((u) => u.searchParams.get('apikey') === KEY)).toBe(true);
    expect(logs()).not.toContain(KEY);
  });

  it('설정: 되짚지 못한 옛 글자의 지오코딩도 상업 호스트로 간다', async () => {
    const logs = captureLogs();
    const fetchMock = stubOpenMeteo();
    const res = await requestVariant({ country: '영국', city: '런던시티', timezone: 'Europe/London' }, { OPEN_METEO_API_KEY: KEY });
    expect((await res.json()).variant_index).not.toBeNull();
    const urls = urlsOf(fetchMock);
    expect(urls.map((u) => u.hostname)).toEqual([
      'customer-geocoding-api.open-meteo.com',
      'customer-api.open-meteo.com',
      'customer-air-quality-api.open-meteo.com',
    ]);
    expect(urls.every((u) => u.searchParams.get('apikey') === KEY)).toBe(true);
    expect(logs()).not.toContain(KEY);
  });
});

describe('refreshWeatherRegionDaily — cron 도 같은 키를 쓴다', () => {
  const NOW = new Date('2026-09-30T03:00:00.000Z');
  const db = () => mockDB.client as unknown as DbExecutor;

  it('설정: 모든 묶음이 상업 호스트 + apikey', async () => {
    const logs = captureLogs();
    const fetchMock = stubOpenMeteo();
    const result = await refreshWeatherRegionDaily(db(), NOW, { openMeteoApiKey: KEY });
    expect(result.failedChunks).toBe(0);
    expect(result.stored).toBe(WeatherRegions.all.length * 3);
    const urls = urlsOf(fetchMock);
    expect(urls).toHaveLength(6);
    expect(new Set(urls.map((u) => u.hostname))).toEqual(
      new Set(['customer-api.open-meteo.com', 'customer-air-quality-api.open-meteo.com']),
    );
    expect(urls.every((u) => u.searchParams.get('apikey') === KEY)).toBe(true);
    expect(logs()).not.toContain(KEY);
  });

  it('미설정: 무료 호스트, apikey 없음', async () => {
    captureLogs();
    const fetchMock = stubOpenMeteo();
    await refreshWeatherRegionDaily(db(), NOW);
    const urls = urlsOf(fetchMock);
    expect(new Set(urls.map((u) => u.hostname))).toEqual(
      new Set(['api.open-meteo.com', 'air-quality-api.open-meteo.com']),
    );
    expect(urls.every((u) => !u.searchParams.has('apikey'))).toBe(true);
  });
});

describe('워커 시크릿 동기화', () => {
  it('OPEN_METEO_API_KEY 는 목록에 있고, 빈 값은 올리지 않는다', () => {
    expect(WORKER_SECRET_KEYS).toContain('OPEN_METEO_API_KEY');
    expect(selectWorkerSecrets('production', { OPEN_METEO_API_KEY: '' })).not.toHaveProperty('OPEN_METEO_API_KEY');
    expect(selectWorkerSecrets('dev', { OPEN_METEO_API_KEY: '   ' })).not.toHaveProperty('OPEN_METEO_API_KEY');
    expect(selectWorkerSecrets('production', { OPEN_METEO_API_KEY: KEY })).toMatchObject({ OPEN_METEO_API_KEY: KEY });
  });
});

describe('틀린 키 — 조용히 무료로 되돌아가지 않고, 로그가 warn 으로 드러난다', () => {
  it('상업 호스트가 400 이면 미해결(null)이고 weather.fetch 는 warn', async () => {
    const infos: string[] = [];
    const warns: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => void infos.push(String(line)));
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => void warns.push(String(line)));
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: true, reason: 'The supplied API key is invalid.' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await requestVariant({ region: 'kr-seoul' }, { OPEN_METEO_API_KEY: KEY });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    // 무료 호스트로 다시 묻지 않는다(비상업 약관 — 틀린 설정을 가리지도 않는다).
    const hosts = fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])).hostname);
    expect(hosts.every((host) => host.startsWith('customer-'))).toBe(true);
    const warned = warns.map((line) => JSON.parse(line)).filter((entry) => entry.at === 'weather.fetch');
    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0]).toMatchObject({ level: 'warn', commercial: true, status: 400 });
    expect([...infos, ...warns].join('\n')).not.toContain(KEY);
  });
});
