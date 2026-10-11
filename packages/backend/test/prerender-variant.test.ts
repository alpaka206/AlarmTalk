import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import ttsRoutes, { resolvePrerenderWeatherIndex, type WeatherSignalInput } from '../src/routes/tts';
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
// GET /tts/prerender-variant — 되짚지 못한 옛 글자는 **null** 이고 원천을 부르지 않는다.
//
// 예전에는 목록에 없는 옛 도시 글자를 Open-Meteo 로 엄격하게 지오코딩했다. 원천을 나라별 공식 예보(기상청·
// 気象庁·NWS)로 바꾸면서 지역마다 원천의 칸을 박아 두게 됐고(`weather-regions.json` 의 `source`), 목록 밖의
// 곳은 그 칸을 정할 수 없다 — 지어내지 않고 null(클라는 미해결로 두고, 끝내 못 받으면 '못 봤어요' 클립).
// 목록 지역 경로는 `weather-region-daily.test.ts`, 원천별 파싱은 `weather-kma`·`weather-jma`·`weather-nws.test.ts`.
// ---------------------------------------------------------------------------------------------
describe('GET /tts/prerender-variant — 되짚지 못한 옛 글자', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function request(query: Record<string, string>) {
    const app = new Hono<AppEnv>();
    app.route('/tts', ttsRoutes);
    const params = new URLSearchParams({ context: 'wake_weather', ...query });
    return app.request(`/tts/prerender-variant?${params.toString()}`, {}, { KMA_SERVICE_KEY: 'k' });
  }

  it('목록에 없는 도시(김해·속초·런던)는 null — 네트워크를 부르지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const [country, city] of [
      ['South Korea', 'Gimhae'],
      ['대한민국', '속초'],
      ['영국', '런던'],
      ['', ''],
    ]) {
      const res = await request({ country: country!, city: city!, target_date: '2026-10-02', timezone: 'Asia/Seoul' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('날씨가 아닌 context 는 언제나 null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = new Hono<AppEnv>();
    app.route('/tts', ttsRoutes);
    const res = await app.request('/tts/prerender-variant?context=wake_fortune&region=kr-seoul');
    expect(await res.json()).toEqual({ context: 'wake_fortune', variant_index: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
