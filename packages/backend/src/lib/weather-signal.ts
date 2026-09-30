/**
 * 날씨 조건 조회 — 위치를 정하고(목록 지역 · 좌표 · 엄격한 옛 지오코딩), Open-Meteo 예보·미세먼지를
 * 받아, 사전렌더 날씨 클립의 자리(`resolvePrerenderWeatherIndex`)로 환원한다.
 *
 * 예전에는 전부 `routes/tts.ts` 안에 있었다. 서버가 지역별 날씨를 미리 계산하게 되면서(cron —
 * `lib/weather-region-daily.ts`) 라우트 밖에서도 같은 분류·같은 파싱을 써야 해 여기로 옮겼다.
 * `routes/tts.ts` 는 `loadWeatherSignalInput`·`resolvePrerenderWeatherIndex` 를 그대로 다시 내보낸다.
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` 5-1(「날씨 지역은 목록에서만 고른다」·「서버가 미리
 * 계산해 둔다」).
 */
import {
  WeatherRegions,
  canonicalizeWeatherLabel,
  type WeatherCountryCode,
  type WeatherRegion,
} from '@alarmtalk/shared';
import { CLONE_WEATHER_CONDITIONS } from './stock-clips';
import {
  fetchOpenMeteo,
  WEATHER_FORECAST_CACHE_TTL_SECONDS,
  WEATHER_GEOCODE_CACHE_TTL_SECONDS,
} from './weather-fetch';

export type WeatherForecastDaily = {
  time?: unknown[];
  weather_code?: unknown[];
  temperature_2m_max?: unknown[];
  temperature_2m_min?: unknown[];
  precipitation_probability_max?: unknown[];
  precipitation_sum?: unknown[];
};

export type WeatherForecastResponse = { daily?: WeatherForecastDaily };

export type AirQualityHourly = {
  time?: unknown[];
  pm10?: unknown[];
  pm2_5?: unknown[];
};

export type AirQualityForecastResponse = { hourly?: AirQualityHourly };

/** Open-Meteo 지오코딩 결과 한 줄 — GeoNames 의 feature_code·인구·나라 코드가 함께 온다. */
export type WeatherGeocodingResult = {
  name?: unknown;
  country?: unknown;
  country_code?: unknown;
  feature_code?: unknown;
  population?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type WeatherGeocodingResponse = { results?: WeatherGeocodingResult[] };

/** 예보 요청의 `daily` 계열. 사전렌더 분류가 다섯 표본을 다 본다. */
export const WEATHER_DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
] as const;

export const RAIN_WMO_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
export const SNOW_WMO_CODES = [71, 73, 75, 77, 85, 86];
const FOG_WMO_CODES = [45, 48];
const CLOUD_WMO_CODES = [2, 3]; // partly cloudy / overcast = 흐림

/** 클라가 보내는 IANA 시간대의 모양. 목록 지역은 자기 `tz` 를 쓰므로 여기 걸리지 않는다. */
const TIMEZONE_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;
export const TARGET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 세 호출(지오코딩·예보·미세먼지) 가운데 하나를 못 받았을 때 어떻게 할지.
 *
 *  - `'unresolved'` — **null**. 사전렌더 인덱스(`GET /prerender-variant`)용. 그 인덱스는 클라가
 *    '해결된 사실' 로 저장하고 발사 24시간 창 안에서 **다시 받지 않는다**(Android
 *    `weatherVariantNeedsRefresh`, iOS `BucketVariantResolver`). 그래서 한 조각이라도 못 받은 값을
 *    내보내면 그게 그 알람의 최종 조건이 된다 — 지오코딩만 타임아웃이면 서울 예보로 만든 인덱스가
 *    부산 알람에 박혀 엉뚱한 날씨를 읽는다(코덱스 #788 P2). null 이면 클라는 미해결로 두고 시간당
 *    재시도하며, 끝내 못 받으면 '못 알아봤어요' 안내 클립을 튼다(`docs/spec/voice-and-message.md` 5-1).
 *  - `'fallback'` — 지오코딩 실패는 서울 좌표로, 미세먼지 실패는 '없음' 으로 이어 간다. 라이브
 *    생성(`POST /generate`)용 — 저장되지 않는 문장 하나라 다시 받을 기회가 없고, 문장을 비우는 것보다
 *    낫다고 본 기존 규약이다. 예보 자체를 못 받으면 여기서도 null(날씨 문장 생략).
 */
export type WeatherFetchFailurePolicy = 'unresolved' | 'fallback';

export interface WeatherSignalInput {
  code: number;
  maxTemp: number;
  minTemp: number;
  rainProbability: number;
  precipitation: number;
  hasDust: boolean;
}

/** 목록의 지역을 고른다 — 알맞은 키가 먼저, 없으면 옛 (나라, 도시) 글자를 되짚는다. */
export function weatherRegionFor(
  region: unknown,
  country: unknown,
  city: unknown,
): WeatherRegion | undefined {
  return WeatherRegions.byKey(region) ?? WeatherRegions.resolveAlias(country, city);
}

/** open-meteo 원시 데이터(코드·기온·강수·미세먼지)를 가져와 구조화 입력으로만 환원한다. */
export async function loadWeatherSignalInput(
  args: {
    latitude?: unknown;
    longitude?: unknown;
    locationLabel?: unknown;
    /** 목록 지역 키. 알맞으면 박아 둔 좌표·시간대로 잰다(지오코딩 없음). */
    region?: unknown;
    country?: unknown;
    city?: unknown;
    targetDate?: unknown;
    timezone?: unknown;
  },
  onFetchFailure: WeatherFetchFailurePolicy,
  /** Open-Meteo 상업 키(`openMeteoApiKey(env)`). 없으면 무료 호스트 — `lib/weather-fetch.ts`. */
  openMeteoApiKey?: string,
): Promise<WeatherSignalInput | null> {
  const resolved = await resolveWeatherLocation(args, openMeteoApiKey);
  const location =
    resolved.location ??
    (onFetchFailure === 'fallback' ? { ...SEOUL_LOCATION, label: resolved.label } : null);
  if (!location) return null;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('daily', WEATHER_DAILY_FIELDS.join(','));
  const targetDate =
    typeof args.targetDate === 'string' && TARGET_DATE_RE.test(args.targetDate)
      ? args.targetDate
      : null;
  // 목록 지역이면 **그 지역의 시간대**다 — `target_date` 는 지역 달력의 날짜로 읽는다(서울 기기 +
  // 뉴욕 지역이어도 "그 날짜의 뉴욕 날씨"). 그 밖에는 예전처럼 클라가 보낸 시간대.
  const timezone =
    location.timezone ??
    (typeof args.timezone === 'string' && TIMEZONE_RE.test(args.timezone)
      ? args.timezone
      : 'Asia/Seoul');
  url.searchParams.set('timezone', timezone);
  if (targetDate) {
    url.searchParams.set('start_date', targetDate);
    url.searchParams.set('end_date', targetDate);
  } else {
    url.searchParams.set('forecast_days', '1');
  }

  try {
    // 타임아웃·엣지 캐시·로그는 `lib/weather-fetch.ts` 한 곳에서. 타임아웃으로 거부되면 이
    // try 가 잡아 null 로 돌아간다 — 저장 버튼이 이 응답을 기다리고 있으므로 500 으로 새면 안 된다.
    // ⚠ 캐시는 URL 에 날짜가 실린 호출(`start_date=end_date=targetDate`)에만 건다. 날짜 없는
    //   라이브 경로(`forecast_days=1`)를 캐시하면 자정을 넘긴 어제 예보가 TTL 동안 오늘로 나간다.
    const response = await fetchOpenMeteo(
      'forecast',
      url,
      targetDate ? WEATHER_FORECAST_CACHE_TTL_SECONDS : null,
      openMeteoApiKey,
    );
    const json = await response
      .json<WeatherForecastResponse>()
      .catch(() => ({}) as WeatherForecastResponse);
    if (!response.ok || !json.daily) return null;
    const targetIndex = targetDate
      ? (json.daily.time?.findIndex((value) => value === targetDate) ?? -1)
      : 0;
    if (targetIndex < 0) return null;
    const samples = dailySamplesAt(json.daily, targetIndex);
    const values = [
      samples.code,
      samples.maxTemp,
      samples.minTemp,
      samples.rainProbability,
      samples.precipitation,
    ];
    if (onFetchFailure === 'unresolved') {
      // 사전렌더 인덱스는 다섯 표본을 다 보고 고른다(눈·비·안개·흐림은 code, 더위·추위는 기온,
      // 비는 강수). 하나라도 없으면 그 자리의 조건을 못 본 채 굳히는 것이라 **받은 것이 아니다.**
      // 실측(2026-09-22): Open-Meteo 는 예보 범위 안의 날짜에 다섯 값을 모두 주고, 범위 밖은
      // 200 이 아니라 400(`error: true`)이라 위 `!response.ok` 로 걸러진다.
      if (values.some((value) => !Number.isFinite(value))) return null;
    } else if (values.every((value) => !Number.isFinite(value))) {
      // 라이브 문장: 코드·기온·강수가 모두 없을 때만 분류 불가 → null(문장 생략). weather_code 만
      // 없고 기온/강수가 있으면 그것으로 분류한다 — buildWeatherSignal 의 우산·한파 멘트는 code 없이도
      // 나온다(code 만으로 null 을 돌리면 라이브 날씨 멘트가 통째로 사라진다).
      return null;
    }
    const dust = await loadDustSignal(location, targetDate, timezone, openMeteoApiKey);
    if (dust === null && onFetchFailure === 'unresolved') return null;
    return { ...samples, hasDust: dust ?? false };
  } catch {
    return null;
  }
}

/**
 * 예보 `daily` 의 한 날짜 칸을 표본 다섯으로. 없는 표본은 NaN.
 * ⚠ `Number(null)` 은 0 이다 — Open-Meteo 는 자료 없는 표본을 null 로 채우므로 그대로 읽으면
 *   "기온 0도·강수 0" 이 되어 없는 자료가 '추위' 로 분류된다(코덱스 #788 4차).
 */
export function dailySamplesAt(
  daily: WeatherForecastDaily,
  index: number,
): Omit<WeatherSignalInput, 'hasDust'> {
  return {
    code: sampleOrNaN(daily.weather_code?.[index]),
    maxTemp: sampleOrNaN(daily.temperature_2m_max?.[index]),
    minTemp: sampleOrNaN(daily.temperature_2m_min?.[index]),
    rainProbability: sampleOrNaN(daily.precipitation_probability_max?.[index]),
    precipitation: sampleOrNaN(daily.precipitation_sum?.[index]),
  };
}

/**
 * open-meteo 원시 입력을 CLONE_WEATHER_CONDITIONS(nice/rain/snow/dust/cloud/fog/heat) 인덱스로
 * 분류한다. 사전렌더 weather 클립은 이 순서로 저장되므로, 클라가 이 인덱스로 오프라인 선택한다.
 * 우선순위: 눈>비>미세먼지>안개>더위>흐림>맑음(기본).
 */
export function resolvePrerenderWeatherIndex(input: WeatherSignalInput): number {
  const { code, maxTemp, minTemp, rainProbability, precipitation, hasDust } = input;
  // 인덱스는 CLONE_WEATHER_CONDITIONS 순서에서 파생(하드코딩 대신 → 순서 바뀌어도 안전).
  const idx = (kind: (typeof CLONE_WEATHER_CONDITIONS)[number]) =>
    Math.max(0, CLONE_WEATHER_CONDITIONS.indexOf(kind));
  const rainy =
    (Number.isFinite(rainProbability) && rainProbability >= 30) ||
    (Number.isFinite(precipitation) && precipitation > 0) ||
    RAIN_WMO_CODES.includes(code);
  if (SNOW_WMO_CODES.includes(code)) return idx('snow');
  if (rainy) return idx('rain');
  if (hasDust) return idx('dust');
  if (FOG_WMO_CODES.includes(code)) return idx('fog');
  if (Number.isFinite(maxTemp) && maxTemp >= 30) return idx('heat');
  // 추위: 라이브 buildWeatherSignal 과 동일 기준(최저<=0 또는 최고<=12). buildWeatherSignal 은 최고<=5
  // 와 최고<=12 두 분기 모두 cold 로 밀어넣으므로 실질 기준이 <=12 → 6~12°C 맑은 날 '산책' 오재 방지.
  if ((Number.isFinite(minTemp) && minTemp <= 0) || (Number.isFinite(maxTemp) && maxTemp <= 12)) {
    return idx('cold');
  }
  if (CLOUD_WMO_CODES.includes(code)) return idx('cloud');
  return idx('nice');
}

/** 미세먼지가 나쁜 날의 기준 — 그날 시간별 최댓값이 PM10 > 80 또는 PM2.5 > 35. */
export function isDustyDay(pm10Max: number, pm25Max: number): boolean {
  return pm10Max > 80 || pm25Max > 35;
}

/**
 * 미세먼지 시간 계열에서 한 날짜(`YYYY-MM-DD`, 지역 시간대)의 판정. 날짜를 안 주면 계열 전체.
 * 요청한 두 계열 다 쓸 만한 표본이 있어야 판정한다 — 아니면 **null(못 받음)**.
 */
export function dustFromHourly(hourly: AirQualityHourly, date: string | null): boolean | null {
  const times = hourly.time ?? [];
  const pick = (values: unknown[] | undefined) =>
    date === null
      ? values
      : (values ?? []).filter((_, i) => typeof times[i] === 'string' && (times[i] as string).startsWith(`${date}T`));
  const pm10Max = maxFinite(pick(hourly.pm10));
  const pm25Max = maxFinite(pick(hourly.pm2_5));
  // 200 에 `hourly` 가 있어도 요청한 두 계열이 비어 있거나 전부 null 이면(예보 지평 밖·자료 없음)
  // **받은 것이 아니다** — 여기서 false 로 뭉개면 사전렌더 경로가 그것을 '먼지 없음' 으로 굳힌다
  // (코덱스 #788 3차). 두 계열 다 쓸 만한 표본이 있어야 판정한다.
  if (pm10Max === null || pm25Max === null) return null;
  return isDustyDay(pm10Max, pm25Max);
}

/**
 * 미세먼지가 나쁜 날인가. **못 받았으면 `null`** — 타임아웃·불통·비정상 응답 모두. false 로 뭉개지
 * 않는다: 사전렌더 인덱스는 먼지 여부가 곧 클립 번호라(`resolvePrerenderWeatherIndex` 의 dust),
 * 못 받은 것을 '없음' 으로 굳히면 그 알람은 먼지 나쁜 날에 산책을 권한다. 폴백은 호출부가 정한다.
 */
async function loadDustSignal(
  location: { latitude: number; longitude: number },
  targetDate: string | null,
  timezone: string,
  openMeteoApiKey: string | undefined,
): Promise<boolean | null> {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('hourly', ['pm10', 'pm2_5'].join(','));
  url.searchParams.set('timezone', timezone);
  if (targetDate) {
    url.searchParams.set('start_date', targetDate);
    url.searchParams.set('end_date', targetDate);
  } else {
    url.searchParams.set('forecast_days', '1');
  }

  try {
    // 예보와 같은 TTL — 미세먼지도 같은 (좌표·날짜) 키로 하루 네 번만 오리진에 닿는다.
    // 타임아웃이면 이 try 가 잡아 null(못 받음)로 돌아간다 — 폴백 여부는 `loadWeatherSignalInput` 이 정한다.
    // 날짜 없는 호출은 예보와 같은 이유로 캐시하지 않는다.
    const response = await fetchOpenMeteo(
      'air',
      url,
      targetDate ? WEATHER_FORECAST_CACHE_TTL_SECONDS : null,
      openMeteoApiKey,
    );
    const json = await response
      .json<AirQualityForecastResponse>()
      .catch(() => ({}) as AirQualityForecastResponse);
    if (!response.ok || !json.hourly) return null;
    // 요청이 이미 그 날짜 하루(start_date=end_date)라 계열 전체를 본다.
    return dustFromHourly(json.hourly, null);
  } catch {
    return null;
  }
}

/** 표본 하나를 숫자로. null·undefined·빈 문자열 등 자료가 없으면 NaN — `Number(null) === 0` 을 막는다. */
export function sampleOrNaN(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/**
 * 계열의 최댓값. 쓸 만한 표본이 하나도 없으면 null.
 * ⚠ `null` 표본을 `Number()` 로 읽으면 **0** 이 된다 — Open-Meteo 는 자료 없는 시각을 `null` 로
 *   채우므로, 그대로 두면 전부 null 인 계열이 "pm 0 = 먼지 없음" 으로 읽힌다. 숫자(또는 숫자 문자열)만 센다.
 */
export function maxFinite(values: unknown[] | undefined): number | null {
  const numbers = (values ?? [])
    .filter((value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

type WeatherLocation = {
  latitude: number;
  longitude: number;
  label: string;
  /** 목록 지역일 때만 — 그 지역의 IANA 시간대. `target_date` 를 이 달력으로 읽는다. */
  timezone?: string;
};

/** 도시가 없을 때의 기본 위치이자, 라이브 생성이 지오코딩 실패에 쓰는 폴백. */
const SEOUL_LOCATION: WeatherLocation = { latitude: 37.5665, longitude: 126.978, label: '서울' };

/**
 * 어느 좌표의 예보를 볼지. 순서:
 *  1. 좌표가 오면 그대로.
 *  2. **목록 지역**(키, 또는 옛 글자를 되짚은 것) → 박아 둔 좌표·시간대. 지오코딩하지 않는다.
 *  3. 도시가 없으면 서울(기본값).
 *  4. 되짚지 못한 옛 글자 → **엄격한 지오코딩**(`pickStrictGeocodeResult`). 옛 앱 버전을 위한 경로다.
 *     나라가 `대한민국` 인데 한국 안에 알맞은 곳이 없으면 나라 없이 한 번 더 찾는다(`geocodeStrict` 주석).
 *
 * 지오코딩을 시도했는데 못 했으면 **`location: null`** 이다 — 타임아웃·불통·비정상 응답·결과 없음·
 * 알맞은 후보 없음·모호함 모두. 여기서 서울로 바꿔치기하지 않는다: 그 좌표로 받은 예보는 겉보기에
 * 멀쩡한 '해결된 값' 이라 사전렌더 경로에서는 클라가 다시 받지 않고 서울 아닌 도시의 알람이 서울
 * 날씨를 읽게 된다(코덱스 #788 P2). 폴백 여부는 호출부가 정한다(`WeatherFetchFailurePolicy`).
 */
async function resolveWeatherLocation(
  args: {
    latitude?: unknown;
    longitude?: unknown;
    locationLabel?: unknown;
    region?: unknown;
    country?: unknown;
    city?: unknown;
  },
  openMeteoApiKey: string | undefined,
): Promise<{ location: WeatherLocation | null; label: string }> {
  const fallback = SEOUL_LOCATION;
  const latitude = optionalNumber(args.latitude, -90, 90);
  const longitude = optionalNumber(args.longitude, -180, 180);
  const country = normalizeShortText(args.country, 30);
  const city = normalizeShortText(args.city, 30);
  const label =
    normalizeShortText(args.locationLabel, 40) ||
    [country, city].filter(Boolean).join(' ').trim() ||
    fallback.label;
  if (latitude != null && longitude != null) {
    return { location: { latitude, longitude, label }, label };
  }
  const region = weatherRegionFor(args.region, country, city);
  if (region) {
    const regionLabel = region.names.ko;
    return {
      location: { latitude: region.lat, longitude: region.lon, label: regionLabel, timezone: region.tz },
      label: regionLabel,
    };
  }
  if (!city && label !== fallback.label) {
    return { location: { ...fallback, label: fallback.label }, label: fallback.label };
  }
  if (!city) {
    return { location: { ...fallback, label }, label };
  }
  const countryCode = WeatherRegions.countryForLabel(country);
  try {
    let matched = await geocodeStrict(city, countryCode, country, openMeteoApiKey);
    // ⚠ **`대한민국` 은 옛 앱이 자동으로 붙인 나라일 수 있다.** 공백 없는 입력에는 나라를 스스로
    //   `대한민국`(영어 기기는 "South Korea")으로 채웠다 — 영어 기기에서 "London" 을 친 사용자의 값이
    //   (대한민국, London) 으로 남아 있다. 되짚기(`resolveAlias` 둘째 규칙)가 이 나라를 '미지정' 으로도
    //   읽는 것과 같은 이유로, **한국 안에 알맞은 곳이 없을 때만** 나라 없이 한 번 더 찾는다. 고르는
    //   규칙(소재지·인구·두 배)은 그대로라 `results[0]` 을 집지 않는다. 첫 조회가 실패(타임아웃·비정상
    //   응답)면 다시 묻지 않는다 — 그건 '없음' 이 아니라 '못 받음' 이다(`undefined` 가 아니라 throw/null).
    if (matched === undefined && countryCode === 'KR') {
      matched = await geocodeStrict(city, null, null, openMeteoApiKey);
    }
    if (!matched) return { location: null, label };
    const resolvedCity = typeof matched.name === 'string' ? matched.name : city;
    const resolvedCountry = typeof matched.country === 'string' ? matched.country : country;
    const resolvedLabel = [resolvedCountry, resolvedCity].filter(Boolean).join(' ').trim() || label;
    return {
      location: {
        latitude: optionalNumber(matched.latitude, -90, 90)!,
        longitude: optionalNumber(matched.longitude, -180, 180)!,
        label: resolvedLabel,
      },
      label: resolvedLabel,
    };
  } catch {
    return { location: null, label };
  }
}

/**
 * 옛 글자 하나를 지오코딩해 `pickStrictGeocodeResult` 로 고른다.
 *
 * - 고른 곳 → 그 결과.
 * - 응답은 받았는데 알맞은 곳이 없다(결과 0건·마을뿐·모호함) → **`undefined`**. 호출부가 나라를 넓혀
 *   다시 물을 수 있다.
 * - 못 받았다(비정상 상태코드) → **`null`**. 타임아웃·불통은 던진다(호출부의 catch 가 null 로 접는다).
 */
async function geocodeStrict(
  city: string,
  countryCode: WeatherCountryCode | null,
  countryText: string | null,
  openMeteoApiKey: string | undefined,
): Promise<WeatherGeocodingResult | null | undefined> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'ko');
  url.searchParams.set('format', 'json');
  // 아는 나라면 Open-Meteo 가 먼저 거른다(ISO-3166-1 alpha2). 결과에서 한 번 더 확인한다.
  if (countryCode) url.searchParams.set('countryCode', countryCode);
  // 도시명 → 좌표는 바뀌지 않으니 7일 캐시. 타임아웃은 다른 실패와 같이 호출부의 catch 로 들어간다.
  const response = await fetchOpenMeteo('geocode', url, WEATHER_GEOCODE_CACHE_TTL_SECONDS, openMeteoApiKey);
  const json = await response
    .json<WeatherGeocodingResponse>()
    .catch(() => ({}) as WeatherGeocodingResponse);
  if (!response.ok) return null;
  return pickStrictGeocodeResult(json.results ?? [], { countryCode, countryText }) ?? undefined;
}

/** 행정 소재지(수도·광역 소재지·기초 소재지). 동명 마을(PPL)·산(MT) 같은 것은 여기 없다. */
const GEOCODE_SEAT_FEATURE_CODES = new Set(['PPLC', 'PPLA', 'PPLA2']);
/** 소재지가 아니어도 이만큼 크면 도시로 본다. */
export const GEOCODE_MIN_CITY_POPULATION = 100_000;

function populationOf(result: WeatherGeocodingResult): number {
  const value = typeof result.population === 'number' ? result.population : Number(result.population);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 옛 글자 지오코딩 결과에서 **확신할 수 있는 한 곳**을 고른다. 못 고르면 null.
 *
 * ⚠ **`results[0]` 을 그냥 집지 않는다.** 두 글자 한국어 이름은 Open-Meteo 에서 "정확히 같은 이름"
 *   만 찾는데, 그 이름의 동명 마을이 먼저 나온다(실측 2026-09-30: '부산' → 경북 의성군·경남 창원시의
 *   `PPL` 마을들 — 부산광역시는 아예 없다). 예전 코드는 나라 이름 부분 일치로 거른 뒤 없으면
 *   `results[0]` 으로 떨어져 그 마을의 날씨를 부산 알람에 박았다.
 *
 * 1. 나라: 아는 나라(`WeatherRegions.countryForLabel` — 대한민국·일본·미국의 여러 표기)면
 *    `country_code` 가 같은 것만. 모르는 나라 글자면 결과의 나라 이름(`language=ko`)이 정규형으로
 *    **같은** 것만(부분 일치 아님). 나라가 비었으면 거르지 않는다.
 * 2. 도시다운 곳만: 행정 소재지(`PPLC`·`PPLA`·`PPLA2`)이거나 인구 10만 이상.
 * 3. 하나면 그것. 여럿이면 인구가 가장 큰 곳이 **다음 곳의 두 배 이상**일 때만 — 아니면 모호하다(null).
 */
export function pickStrictGeocodeResult(
  results: readonly WeatherGeocodingResult[],
  options: { countryCode: WeatherCountryCode | null; countryText: string | null },
): WeatherGeocodingResult | null {
  const wantedCountry = options.countryText ? canonicalizeWeatherLabel(options.countryText) : '';
  const candidates = results.filter((result) => {
    if (optionalNumber(result.latitude, -90, 90) == null) return false;
    if (optionalNumber(result.longitude, -180, 180) == null) return false;
    if (options.countryCode) {
      return typeof result.country_code === 'string' && result.country_code.toUpperCase() === options.countryCode;
    }
    if (wantedCountry) return canonicalizeWeatherLabel(result.country) === wantedCountry;
    return true;
  });
  const cities = candidates
    .filter(
      (result) =>
        GEOCODE_SEAT_FEATURE_CODES.has(String(result.feature_code ?? '')) ||
        populationOf(result) >= GEOCODE_MIN_CITY_POPULATION,
    )
    .sort((a, b) => populationOf(b) - populationOf(a));
  const [top, next] = cities;
  if (!top) return null;
  if (!next) return top;
  const topPopulation = populationOf(top);
  return topPopulation > 0 && topPopulation >= 2 * populationOf(next) ? top : null;
}

function optionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}
