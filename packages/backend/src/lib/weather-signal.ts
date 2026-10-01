/**
 * 날씨 신호 → 사전렌더 날씨 클립의 자리(`resolvePrerenderWeatherIndex`).
 *
 * 신호(`WeatherSignalInput`)는 나라별 공식 예보(기상청·気象庁·NWS)에서 어댑터가 만든다 —
 * `lib/weather-source.ts`(나라별 디스패치) 와 `weather-kma.ts`·`weather-jma.ts`·`weather-nws.ts`.
 * 날씨 상태는 **WMO 대리 코드**로 적는다(맑음 0 / 흐림 3 / 안개 45 / 비 61 / 눈 71 — `WEATHER_PROXY_CODE`).
 * 그래서 아래 분류기와 `weather_region_daily.weather_code` 컬럼의 뜻은 원천이 바뀌어도 그대로다.
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` 5-1(「날씨 지역은 목록에서만 고른다」·「서버가 미리
 * 계산해 둔다」).
 */
import { WeatherRegions, type WeatherRegion } from '@alarmtalk/shared';
import { CLONE_WEATHER_CONDITIONS } from './stock-clips';

export const TARGET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 어댑터가 쓰는 대리 코드 — WMO 날씨 코드표에서 각 상태의 대표값 하나씩. 분류기의 코드 집합(아래)이
 * 이 값을 그대로 알아본다.
 */
export const WEATHER_PROXY_CODE = { clear: 0, cloud: 3, fog: 45, rain: 61, snow: 71 } as const;

export const RAIN_WMO_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
export const SNOW_WMO_CODES = [71, 73, 75, 77, 85, 86];
const FOG_WMO_CODES = [45, 48];
const CLOUD_WMO_CODES = [2, 3]; // partly cloudy / overcast = 흐림

/**
 * 한 (지역, 날짜)의 날씨 신호.
 *
 * - `precipitation` 이 **NaN** 이면 그 원천이 '재지 않는' 값이다(気象庁 예보에는 강수량 합이 없다) — 분류에서
 *   빠지고 DB 에는 NULL 로 적는다. 0 으로 때우지 않는다.
 * - `hasDust` 는 지금 언제나 false 다 — 먼지 원천을 쓰지 않는다(스펙 5-1 「먼지는 끈다」).
 */
export interface WeatherSignalInput {
  code: number;
  maxTemp: number;
  minTemp: number;
  rainProbability: number;
  precipitation: number;
  hasDust: boolean;
  /** 강수확률**만으로** 비라고 볼 하한. 없으면 `DEFAULT_RAIN_PROBABILITY_THRESHOLD`(30). */
  rainProbabilityThreshold?: number;
}

/** 강수확률만으로 비라고 보는 기본 하한 — NWS 의 'Chance'(30% 이상) 표현과 같다. */
export const DEFAULT_RAIN_PROBABILITY_THRESHOLD = 30;
/**
 * 강수 **형태**를 직접 주는 원천(기상청 PTY·PCP, 気象庁 날씨 코드)의 하한(결정 D7, 2026-10-01).
 * 그 원천에서는 형태가 1차다 — 형태가 비·눈이면 이미 `code` 가 비·눈이다. 30 을 그대로 쓰면 원천이 '강수 없음'
 * 이라고 한 날도 비 클립이 나갔다(실측: KR 비 판정 34건 중 33건이 PTY 전 시간 0·'강수없음', JP 비 54건 중 33건이
 * 晴·くもり). 강수확률이 60 이상인데 형태가 없는 드문 날만 비로 본다.
 */
export const CODED_SOURCE_RAIN_PROBABILITY_THRESHOLD = 60;

/** 목록의 지역을 고른다 — 알맞은 키가 먼저, 없으면 옛 (나라, 도시) 글자를 되짚는다. */
export function weatherRegionFor(
  region: unknown,
  country: unknown,
  city: unknown,
): WeatherRegion | undefined {
  return WeatherRegions.byKey(region) ?? WeatherRegions.resolveAlias(country, city);
}

/**
 * 날씨 신호를 CLONE_WEATHER_CONDITIONS(nice/rain/snow/dust/cloud/fog/heat/cold) 인덱스로 분류한다.
 * 사전렌더 weather 클립은 이 순서로 저장되므로, 클라가 이 인덱스로 오프라인 선택한다.
 * 우선순위: 눈>비>미세먼지>안개>더위>추위>흐림>맑음(기본).
 */
export function resolvePrerenderWeatherIndex(input: WeatherSignalInput): number {
  const { code, maxTemp, minTemp, rainProbability, precipitation, hasDust } = input;
  // 인덱스는 CLONE_WEATHER_CONDITIONS 순서에서 파생(하드코딩 대신 → 순서 바뀌어도 안전).
  const idx = (kind: (typeof CLONE_WEATHER_CONDITIONS)[number]) =>
    Math.max(0, CLONE_WEATHER_CONDITIONS.indexOf(kind));
  const rainy =
    (Number.isFinite(rainProbability) &&
      rainProbability >= (input.rainProbabilityThreshold ?? DEFAULT_RAIN_PROBABILITY_THRESHOLD)) ||
    (Number.isFinite(precipitation) && precipitation > 0) ||
    RAIN_WMO_CODES.includes(code);
  if (SNOW_WMO_CODES.includes(code)) return idx('snow');
  if (rainy) return idx('rain');
  if (hasDust) return idx('dust');
  if (FOG_WMO_CODES.includes(code)) return idx('fog');
  if (Number.isFinite(maxTemp) && maxTemp >= 30) return idx('heat');
  // 추위: 최저<=0 또는 최고<=12 — 6~12°C 맑은 날 '산책' 오재 방지.
  if ((Number.isFinite(minTemp) && minTemp <= 0) || (Number.isFinite(maxTemp) && maxTemp <= 12)) {
    return idx('cold');
  }
  if (CLOUD_WMO_CODES.includes(code)) return idx('cloud');
  return idx('nice');
}

/** 표본 하나를 숫자로. null·undefined·빈 문자열 등 자료가 없으면 NaN — `Number(null) === 0` 을 막는다. */
export function sampleOrNaN(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/**
 * 계열의 최댓값. 쓸 만한 표본이 하나도 없으면 null.
 * ⚠ `null` 표본을 `Number()` 로 읽으면 **0** 이 된다 — 숫자(또는 숫자 문자열)만 센다.
 */
export function maxFinite(values: unknown[] | undefined): number | null {
  const numbers = (values ?? [])
    .filter((value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}
