// 옛 글자(키 없는 country/city)의 두 갈래 — `docs/spec/voice-and-message.md` 5-1.
//  1. 목록으로 **되짚히면** 박아 둔 좌표로 간다(지오코딩 없음). 옛 프리셋은 전부 여기로 온다.
//  2. 되짚지 못하면 **엄격한 옛 지오코딩** — 나라로 거르고, 소재지·큰 도시만, 모호하면 null.
//     ⚠ `results[0]` 을 그냥 집지 않는다(부산 → 경북 의성군의 동명 마을, 2026-09-30 실측).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import ttsRoutes from '../src/routes/tts';
import {
  loadWeatherSignalInput,
  pickStrictGeocodeResult,
  weatherRegionFor,
  type WeatherGeocodingResult,
} from '../src/lib/weather-signal';

type FetchInit = RequestInit & { cf?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('옛 프리셋은 전부 목록 지역으로 되짚힌다', () => {
  it('한국어 프리셋 9개(나라 대한민국) — 수원은 경기(kr-gyeonggi)', () => {
    const expected: Record<string, string> = {
      서울: 'kr-seoul', 부산: 'kr-busan', 인천: 'kr-incheon', 대구: 'kr-daegu', 대전: 'kr-daejeon',
      광주: 'kr-gwangju', 울산: 'kr-ulsan', 수원: 'kr-gyeonggi', 제주: 'kr-jeju',
    };
    for (const [city, key] of Object.entries(expected)) {
      expect(weatherRegionFor(undefined, '대한민국', city)?.key, city).toBe(key);
    }
  });

  it('안드로이드 30 일본어 프리셋 8개 — 나라를 大韓民国 으로 보냈지만 일본 지역이다', () => {
    // origin/main apps/android-native/app/src/main/res/values-ja/strings.xml hs_weather_preset_cities
    const expected: Record<string, string> = {
      東京: 'jp-tokyo', 大阪: 'jp-osaka', 名古屋: 'jp-aichi', 横浜: 'jp-kanagawa',
      札幌: 'jp-hokkaido', 福岡: 'jp-fukuoka', 仙台: 'jp-miyagi', 那覇: 'jp-okinawa',
    };
    for (const [city, key] of Object.entries(expected)) {
      expect(weatherRegionFor(undefined, '大韓民国', city)?.key, city).toBe(key);
      expect(weatherRegionFor(undefined, '대한민국', city)?.key, city).toBe(key);
    }
  });

  it('영어 입력·한국어 표기 — Seoul/Tokyo/New York/NYC/LA, 도쿄·뉴욕', () => {
    expect(weatherRegionFor(undefined, 'South Korea', 'Seoul')?.key).toBe('kr-seoul');
    expect(weatherRegionFor(undefined, 'South Korea', 'Tokyo')?.key).toBe('jp-tokyo');
    expect(weatherRegionFor(undefined, 'New', 'York')?.key).toBe('us-new-york');
    expect(weatherRegionFor(undefined, '미국', '뉴욕')?.key).toBe('us-new-york');
    expect(weatherRegionFor(undefined, '대한민국', '도쿄')?.key).toBe('jp-tokyo');
  });

  it('알맞은 region 키가 옛 글자보다 먼저다 — 모르는 키면 글자로 간다', () => {
    expect(weatherRegionFor('jp-aichi', '대한민국', '서울')?.key).toBe('jp-aichi');
    expect(weatherRegionFor('kr-nowhere', '대한민국', '서울')?.key).toBe('kr-seoul');
    expect(weatherRegionFor(undefined, '대한민국', '속초')).toBeUndefined();
  });
});

// Open-Meteo 지오코딩 실측(2026-09-30, language=ko, countryCode=KR) — '부산' 은 마을·산만 나온다.
const BUSAN_VILLAGES: WeatherGeocodingResult[] = [
  { name: 'Pusan', feature_code: 'PPL', country_code: 'KR', country: '대한민국', latitude: 36.35, longitude: 128.7 },
  { name: 'Pusan', feature_code: 'PPL', country_code: 'KR', country: '대한민국', latitude: 35.2, longitude: 128.6 },
  { name: '부산', feature_code: 'PPL', country_code: 'KR', country: '대한민국', latitude: 35.3, longitude: 126.8 },
  { name: '부산', feature_code: 'MT', country_code: 'KR', country: '대한민국', latitude: 36.9, longitude: 127.9 },
];

describe('pickStrictGeocodeResult — results[0] 을 그냥 집지 않는다', () => {
  const kr = { countryCode: 'KR' as const, countryText: '대한민국' };

  it('동명 마을·산뿐이면 null (부산 실측)', () => {
    expect(pickStrictGeocodeResult(BUSAN_VILLAGES, kr)).toBeNull();
  });

  it('마을이 먼저 와도 소재지를 고른다', () => {
    const sokcho = { name: '속초', feature_code: 'PPLA2', country_code: 'KR', population: 81164, latitude: 38.2, longitude: 128.59 };
    expect(pickStrictGeocodeResult([BUSAN_VILLAGES[0]!, sokcho], kr)).toBe(sokcho);
  });

  it('소재지가 아니어도 인구 10만 이상이면 도시로 본다', () => {
    const big = { name: 'X', feature_code: 'PPL', country_code: 'KR', population: 250_000, latitude: 37, longitude: 127 };
    expect(pickStrictGeocodeResult([big], kr)).toBe(big);
  });

  it('도시가 여럿이면 가장 큰 곳이 두 배 이상일 때만 — 아니면 모호해서 null', () => {
    const a = { feature_code: 'PPLA2', country_code: 'KR', population: 300_000, latitude: 37, longitude: 127 };
    const b = { feature_code: 'PPLA2', country_code: 'KR', population: 200_000, latitude: 35, longitude: 128 };
    const small = { feature_code: 'PPLA2', country_code: 'KR', population: 50_000, latitude: 36, longitude: 128 };
    expect(pickStrictGeocodeResult([b, a], kr)).toBeNull();
    expect(pickStrictGeocodeResult([small, a], kr)).toBe(a);
    // 인구를 모르는 소재지 둘 — 고를 근거가 없다.
    expect(pickStrictGeocodeResult([{ ...a, population: undefined }, { ...b, population: undefined }], kr)).toBeNull();
  });

  it('아는 나라면 country_code 가 다른 결과는 버린다', () => {
    const osaka = { feature_code: 'PPLA', country_code: 'JP', population: 2_600_000, latitude: 34.7, longitude: 135.5 };
    expect(pickStrictGeocodeResult([osaka], kr)).toBeNull();
    expect(pickStrictGeocodeResult([osaka], { countryCode: 'JP', countryText: '일본' })).toBe(osaka);
  });

  it('모르는 나라 글자면 결과의 나라 이름이 **같은** 것만(부분 일치 아님)', () => {
    const paris = { name: '파리', feature_code: 'PPLC', country_code: 'FR', country: '프랑스', population: 2_138_551, latitude: 48.85, longitude: 2.35 };
    expect(pickStrictGeocodeResult([paris], { countryCode: null, countryText: '프랑스' })).toBe(paris);
    expect(pickStrictGeocodeResult([paris], { countryCode: null, countryText: '프랑' })).toBeNull();
    expect(pickStrictGeocodeResult([paris], { countryCode: null, countryText: '영국' })).toBeNull();
  });

  it('좌표가 없거나 null 인 결과는 후보가 아니다 — Number(null)=0 이 적도로 가지 않는다', () => {
    const noCoords = { feature_code: 'PPLA', country_code: 'KR', population: 1_000_000, latitude: null, longitude: null };
    expect(pickStrictGeocodeResult([noCoords], kr)).toBeNull();
  });
});

function stubGeocode(results: WeatherGeocodingResult[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: FetchInit) => {
    void init;
    const url = new URL(String(input));
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    if (url.hostname === 'api.open-meteo.com') {
      const date = url.searchParams.get('start_date') ?? '2026-10-01';
      return new Response(
        JSON.stringify({
          daily: {
            time: [date],
            weather_code: [0],
            temperature_2m_max: [22],
            temperature_2m_min: [15],
            precipitation_probability_max: [0],
            precipitation_sum: [0],
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ hourly: { pm10: [10], pm2_5: [5] } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /tts/prerender-variant — 되짚지 못한 옛 글자는 엄격한 지오코딩', () => {
  function request(query: Record<string, string>) {
    const app = new Hono<AppEnv>();
    app.route('/tts', ttsRoutes);
    const params = new URLSearchParams({ context: 'wake_weather', target_date: '2026-10-01', timezone: 'Asia/Seoul', ...query });
    return app.request(`/tts/prerender-variant?${params.toString()}`);
  }

  it('마을만 나오면 null — 예보를 부르지 않는다(동명 마을의 날씨를 박지 않는다)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode(BUSAN_VILLAGES);

    const res = await request({ country: '대한민국', city: '거제' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: null });
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    // 한국 안에서 못 고르면 나라 없이 한 번 더 묻는다(아래 London) — 그래도 마을뿐이면 끝.
    expect(urls.map((u) => u.hostname)).toEqual([
      'geocoding-api.open-meteo.com',
      'geocoding-api.open-meteo.com',
    ]);
    // 아는 나라면 Open-Meteo 가 먼저 거르게 나라 코드를 싣는다.
    expect(urls[0]!.searchParams.get('countryCode')).toBe('KR');
    expect(urls[0]!.searchParams.get('name')).toBe('거제');
    expect(urls[1]!.searchParams.get('countryCode')).toBeNull();
  });

  it('대한민국(옛 앱이 자동으로 붙인 나라)인데 한국에 없는 도시면 나라 없이 한 번 더 — 여전히 엄격하게', async () => {
    // 옛 영어 기기는 "London" 에 나라를 "South Korea" 로 붙였다. 예전 서버는 results[0] 으로 런던을
    // 잡았고, 나라 코드로만 거르면 이 값은 영영 null('못 봤어요')이 된다.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const londons: WeatherGeocodingResult[] = [
      { name: '런던', feature_code: 'PPLC', country_code: 'GB', country: '영국', population: 8_961_989, latitude: 51.5085, longitude: -0.1257 },
      { name: '런던', feature_code: 'PPLA2', country_code: 'CA', country: '캐나다', population: 346_765, latitude: 42.9834, longitude: -81.233 },
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === 'geocoding-api.open-meteo.com') {
        const results = url.searchParams.get('countryCode') === 'KR' ? [] : londons;
        return new Response(JSON.stringify({ results }), { status: 200 });
      }
      if (url.hostname === 'api.open-meteo.com') {
        return new Response(
          JSON.stringify({
            daily: {
              time: ['2026-10-01'],
              weather_code: [0],
              temperature_2m_max: [22],
              temperature_2m_min: [15],
              precipitation_probability_max: [0],
              precipitation_sum: [0],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ hourly: { pm10: [10], pm2_5: [5] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request({ country: 'South Korea', city: 'London' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: 0 });
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    const forecast = urls.find((u) => u.hostname === 'api.open-meteo.com')!;
    expect(forecast.searchParams.get('latitude')).toBe('51.5085');
  });

  it('일본·미국이라고 적었으면 나라를 넓히지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode([]);
    await request({ country: '일본', city: '어딘가' });
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((u) => u.searchParams.get('countryCode'))).toEqual(['JP']);
  });

  it('소재지가 나오면 그 좌표로 받는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode([
      BUSAN_VILLAGES[0]!,
      { name: '거제', feature_code: 'PPLA2', country_code: 'KR', population: 240_000, latitude: 34.88, longitude: 128.62 },
    ]);

    const res = await request({ country: '대한민국', city: '거제' });

    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: 0 });
    const forecast = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((u) => u.hostname === 'api.open-meteo.com')!;
    expect(forecast.searchParams.get('latitude')).toBe('34.88');
    expect(forecast.searchParams.get('longitude')).toBe('128.62');
  });

  it('모르는 나라 글자는 나라 코드를 싣지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode([]);
    await request({ country: '프랑스', city: '파리' });
    const geocode = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(geocode.searchParams.get('countryCode')).toBeNull();
  });
});

describe('라이브 생성(fallback)도 목록 지역이면 박아 둔 좌표로 간다', () => {
  it('대한민국 + 부산 → 부산 좌표·지역 시간대, 지오코딩 없음', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode(BUSAN_VILLAGES);

    const input = await loadWeatherSignalInput(
      { country: '대한민국', city: '부산', targetDate: '2026-10-01', timezone: 'America/New_York' },
      'fallback',
    );

    expect(input).not.toBeNull();
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.some((u) => u.hostname === 'geocoding-api.open-meteo.com')).toBe(false);
    const forecast = urls.find((u) => u.hostname === 'api.open-meteo.com')!;
    expect(forecast.searchParams.get('latitude')).toBe('35.1017');
    expect(forecast.searchParams.get('timezone')).toBe('Asia/Seoul');
  });

  it('region 키만 와도 된다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubGeocode([]);
    await loadWeatherSignalInput({ region: 'us-chicago', targetDate: '2026-10-01' }, 'fallback');
    const forecast = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((u) => u.hostname === 'api.open-meteo.com')!;
    expect(forecast.searchParams.get('timezone')).toBe('America/Chicago');
  });
});
