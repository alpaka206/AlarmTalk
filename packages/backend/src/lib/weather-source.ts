/**
 * 나라별 공식 예보 원천 — **지역 하나 → 날짜별 `WeatherSignalInput | null`**.
 *
 * | 나라 | 원천 | 어댑터 |
 * | --- | --- | --- |
 * | KR | 기상청 단기예보(data.go.kr `VilageFcstInfoService_2.0/getVilageFcst`) | `lib/weather-kma.ts` |
 * | JP | 気象庁 bosai 예보 JSON(`/bosai/forecast/data/forecast/{office}.json`) | `lib/weather-jma.ts` |
 * | US | NWS 원시 격자(`api.weather.gov/gridpoints/{gridId}/{x},{y}`) | `lib/weather-nws.ts` |
 *
 * 지역마다 어느 칸을 읽는지는 `packages/shared/src/weather-regions.json` 의 `source` 에 박아 둔다. 규칙 전문은
 * `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」. 여기는 셋이 함께 지키는 것들이다:
 *
 * - **반쪽 값 금지(다시 정의)**: 원천이 원래 주는 표본이 하나라도 빠지면 그 날짜는 null 이다. 원천에 원래
 *   없는 표본은 '재지 않음'(NaN → DB NULL)으로 두고 분류에서 뺀다 — 먼지 전부, JP 강수량, KR·JP 안개.
 *   필수 표본: KR = 코드·최고·최저·강수확률·강수량 / JP = 코드·최고·최저·강수확률 / US = 코드·최고·최저·
 *   강수확률·강수량(단 NWS 의 강수량은 발표 뒤 약 72시간까지만 온다 — 그 너머는 재지 않음).
 * - **오늘 행의 극값만 이어받는다**(`finalizeSourceDay`): 대상 날짜가 지역의 오늘이고 최저·최고가 비었을 때만,
 *   같은 (지역, 날짜)의 저장 행이 36시간 안에 계산된 것이면 그 값으로 메운다. 상태·강수확률·강수량은 절대
 *   이어받지 않는다. 쓰는 곳: KR 0500 회차의 오늘 TMN, JP 05시 발표 뒤의 오늘 최저(발표일의 최저는 어떤 발표에도
 *   없다 — 17시 발표 뒤에는 최고도), NWS 아침이 지난 오늘 최저.
 * - **먼지는 끈다**: `hasDust` 는 언제나 false, DB 는 NULL. 자리 3(미세먼지)은 나오지 않는다.
 * - **추측하지 않는다**: 값을 지어내지 않는다. 일본 예보를 끝내 못 받아도 다른 원천으로 대신하지 않는다
 *   (気象業務法 FAQ 의 '독자 예보' 우려) — null → 클립 8('못 봤어요').
 */
import type { WeatherRegion } from '@alarmtalk/shared';
import { isSubrequestLimitError, isTimeoutError, type WeatherSourceKind } from './weather-fetch';
import { CODED_SOURCE_RAIN_PROBABILITY_THRESHOLD, type WeatherSignalInput } from './weather-signal';

const HOUR_MS = 60 * 60 * 1000;

/**
 * 오늘 행의 극값을 이어받을 수 있는 저장 행의 나이 상한. 읽기 경로가 행을 믿는 나이
 * (`WEATHER_REGION_READ_STALE_MS`)와 같다 — 슬롯 두 번이 연달아 실패해도 버틴다.
 */
export const WEATHER_INHERIT_MAX_AGE_MS = 36 * HOUR_MS;

/**
 * **결정 D1 — 섞인 강수는 눈으로 본다**(세 나라 일관): KR PTY 2(비/눈), JP '雨か雪'(106·107·118·206·207·218·
 * 304·316·317), US rain_snow·sleet. 미끄럼 경고 쪽이 안전하고, 분류기의 우선순위(눈 > 비)와도 맞는다.
 * 오너가 '비' 로 정하면 이 값 하나만 바꾼다(세 어댑터가 이 상수를 본다).
 */
export const MIXED_PRECIPITATION_IS_SNOW = true;

/**
 * 원천에서 읽은 한 날짜의 표본. **null = 빠짐**(원천이 원래 주는데 없다 → 그 날짜는 미해결),
 * `precipitation` 의 **NaN = 재지 않음**(원천에 원래 없다 → 분류에서 빠진다).
 */
export type SourceDay = {
  code: number | null;
  maxTemp: number | null;
  minTemp: number | null;
  rainProbability: number | null;
  precipitation: number | null;
};

/**
 * 실패의 세 갈래.
 *  - `transient`: 타임아웃(읽기 경로의 마감 포함)·5xx·429, KMA 01/02/03/04/05/99, 낡은 발표(JMA·NWS) → 같은 슬롯
 *    안에서 다음 틱이 다시 한다.
 *  - `config`: 다시 해도 소용없는 것 → 슬롯 끝에서 경보를 올린다. 얼마나 번지는지는 `SourceFailureScope` 가 가른다.
 *  - `budget`: 실패로 세지 않는다. 사유가 둘이고 cron 에서 결과가 다르다(`refreshWeatherRegionDaily`):
 *    - `fetch_budget` — 이 틱의 fetch 상한(틱 10·원천별) → **그 지역만** 다음 틱으로 넘긴다. 다른 원천은 계속
 *      부르고, 받은 것은 그대로 적는다. (즉석 계산이면 그 한 번의 상한이고 결과는 `null` 이다.)
 *    - `subrequest_limit` — 워커 subrequest 한도('Too many subrequests') → 그 틱의 날씨 작업을 멈춘다(쓰지도 않는다).
 */
export type SourceFailureKind = 'transient' | 'config' | 'budget';

/**
 * 설정 실패가 미치는 범위.
 *  - `source`(기본): 원천 전체가 안 된다 — 키 없음, KMA 10~12·20/21/22/30/31/32/33·401/403(그 밖의 4xx 도),
 *    NWS 403 HTML(UA 차단)·404 밖의 4xx, JMA 404 밖의 4xx → 그 틱에서 그 원천은 더 부르지 않는다.
 *  - `region`: 그 지역에 박아 둔 칸만 틀렸다 — NWS 404(`InvalidGridpoint`·없는 office·격자), JMA 404(없는 office
 *    JSON) → **그 지역만** 실패로 두고 같은 원천의 다른 지역은 계속 부른다. 원천을 끄면 틱마다 같은 자리에서 다시
 *    걸려 그 뒤의 지역이 슬롯 내내 계산되지 않는다(코덱스 #846).
 * 일시·예산 실패는 끄는 일이 없어 늘 `source` 로 둔다.
 */
export type SourceFailureScope = 'source' | 'region';

export class WeatherSourceError extends Error {
  constructor(
    readonly failure: SourceFailureKind,
    /** 짧은 식별자(`http_503`·`kma_30`·`stale_report` …) — 경보 태그로 그대로 나간다. URL·본문은 넣지 않는다. */
    readonly reason: string,
    readonly scope: SourceFailureScope = 'source',
  ) {
    super(`${failure}:${reason}`);
    this.name = 'WeatherSourceError';
  }
}

export type SourceOutcome =
  | { ok: true; days: Map<string, SourceDay> }
  | { ok: false; failure: SourceFailureKind; reason: string; scope: SourceFailureScope };

/**
 * 한 번의 작업(cron 한 틱 · 즉석 계산 한 번)이 원천에 보낼 수 있는 fetch 수. 어댑터는 fetch **직전에**
 * `take()` 하고, false 면 부르지 않고 `budget` 실패로 끝낸다 — KMA 의 '한 회차 물러서기'·다음 페이지도
 * 이 예산 안에서만 한다.
 */
export type FetchBudget = { take(source: WeatherSourceKind): boolean };

export function fixedFetchBudget(limit: number): FetchBudget {
  let left = limit;
  return {
    take() {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
  };
}

export type SourceFetchOptions = {
  now: Date;
  budget: FetchBudget;
  /** 기상청 서비스 키(일반 인증키 Decoding). 없으면 KR 은 `config:missing_key` — 네트워크를 부르지 않는다. */
  kmaServiceKey?: string;
  /** 즉석 계산(읽기 경로)에서만 JMA·NWS 에 건다. KMA·cron 은 언제나 null. */
  cacheTtlSeconds?: number | null;
  /**
   * 원천 호출 **전체**의 마감(epoch ms, 실제 시계 `Date.now()` 기준) — 즉석 계산(읽기 경로)만 건다. KMA 의 '한 회차
   * 물러서기'·다음 페이지도 이 안에서만 하고, fetch 하나의 타임아웃은 min(5초, 남은 시간)이다(`fetchWeatherSource`).
   * 없으면(cron) fetch 마다 5초. `now` 는 회차·날짜를 고르는 논리 시각이라 마감에 쓰지 않는다.
   */
  deadlineAt?: number | null;
};

/** 지역의 원천을 골라 날짜별 표본을 받는다. 던지지 않는다 — 실패는 `{ ok: false }` 로 돌아온다. */
export async function fetchRegionSourceDays(
  region: WeatherRegion,
  options: SourceFetchOptions,
): Promise<SourceOutcome> {
  try {
    const source = region.source;
    // 어댑터는 동적으로 부른다 — 어댑터가 이 모듈(실패 분류·날짜 도우미)을 가져다 쓰므로 정적으로 맞물리면
    // 순환이 되고, 한 틱에 쓰지 않는 원천의 코드는 읽지 않는다.
    switch (source.kind) {
      case 'kma': {
        const { fetchKmaDays } = await import('./weather-kma');
        return { ok: true, days: await fetchKmaDays(region, source, options) };
      }
      case 'jma': {
        const { fetchJmaDays } = await import('./weather-jma');
        return { ok: true, days: await fetchJmaDays(region, source, options) };
      }
      case 'nws': {
        const { fetchNwsDays } = await import('./weather-nws');
        return { ok: true, days: await fetchNwsDays(region, source, options) };
      }
    }
  } catch (err) {
    return classifySourceError(err);
  }
}

/** 어댑터 밖으로 나온 예외를 세 갈래로. 모르는 예외는 일시 실패다(다음 틱이 다시 한다). */
export function classifySourceError(err: unknown): Extract<SourceOutcome, { ok: false }> {
  if (err instanceof WeatherSourceError) {
    return { ok: false, failure: err.failure, reason: err.reason, scope: err.scope };
  }
  if (isSubrequestLimitError(err)) return { ok: false, failure: 'budget', reason: 'subrequest_limit', scope: 'source' };
  if (isTimeoutError(err)) return { ok: false, failure: 'transient', reason: 'timeout', scope: 'source' };
  // 연결 실패(DNS·연결 끊김)든 예상 밖의 예외든 다음 틱이 다시 한다. 메시지는 URL(키)을 담을 수 있어 싣지 않는다.
  return { ok: false, failure: 'transient', reason: 'error', scope: 'source' };
}

/** HTTP 상태만으로 가를 수 있는 실패. 2xx 면 null(본문을 봐야 한다). */
export function httpFailure(status: number): WeatherSourceError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429 || status >= 500) return new WeatherSourceError('transient', `http_${status}`);
  return new WeatherSourceError('config', `http_${status}`);
}

/** 이어받기에 쓰는 저장 행 — 같은 (지역, 날짜)의 극값과 계산 시각. */
export type StoredExtremes = { tempMin: number | null; tempMax: number | null; computedAt: string | null };

/**
 * 원천 표본 → 분류기 입력. 하나라도 빠졌으면 null(미해결).
 *
 * 오늘(`isToday`)이고 최저·최고가 비었으면 **그 둘만** `stored` 에서 이어받는다 — 36시간 안에 계산한 행이고
 * 값이 숫자일 때. 상태·강수확률·강수량은 이어받지 않는다.
 *
 * ⚠ `source` 는 **필수**다 — 강수확률만으로 비라고 보는 하한이 원천마다 다르다(결정 D7). 빼면 KR·JP 가 조용히 NWS
 * 하한(30)으로 분류된다: 점검 스크립트가 그렇게 빠뜨려 운영과 다른 분포를 냈다(코덱스 #846).
 */
export function finalizeSourceDay(
  day: SourceDay | undefined,
  context: { isToday: boolean; stored?: StoredExtremes | null; now: Date; source: WeatherSourceKind },
): WeatherSignalInput | null {
  if (!day) return null;
  const inherit = context.isToday ? usableStored(context.stored, context.now) : null;
  const maxTemp = day.maxTemp ?? inherit?.tempMax ?? null;
  const minTemp = day.minTemp ?? inherit?.tempMin ?? null;
  const { code, rainProbability, precipitation } = day;
  if (code === null || !Number.isFinite(code)) return null;
  if (maxTemp === null || !Number.isFinite(maxTemp)) return null;
  if (minTemp === null || !Number.isFinite(minTemp)) return null;
  if (rainProbability === null || !Number.isFinite(rainProbability)) return null;
  // NaN 은 '재지 않음'(통과), null 은 '빠짐'(미해결).
  if (precipitation === null) return null;
  // 강수 형태를 직접 주는 원천(기상청·気象庁)은 형태가 1차다 — 강수확률은 60 부터만 비로 본다(결정 D7).
  const coded = context.source === 'kma' || context.source === 'jma';
  return {
    code,
    maxTemp,
    minTemp,
    rainProbability,
    precipitation,
    hasDust: false,
    ...(coded ? { rainProbabilityThreshold: CODED_SOURCE_RAIN_PROBABILITY_THRESHOLD } : {}),
  };
}

function usableStored(
  stored: StoredExtremes | null | undefined,
  now: Date,
): { tempMin: number | null; tempMax: number | null } | null {
  if (!stored?.computedAt) return null;
  const computedAt = Date.parse(stored.computedAt);
  if (!Number.isFinite(computedAt)) return null;
  const age = now.getTime() - computedAt;
  if (age < 0 || age > WEATHER_INHERIT_MAX_AGE_MS) return null;
  const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null);
  return { tempMin: finite(stored.tempMin), tempMax: finite(stored.tempMax) };
}

// ── 날짜·시간대 ───────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' 에 날수를 더한다(달력 계산만 — 시간대와 무관). */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** 시간대마다 포맷터 하나 — 만드는 비용이 커서(격자 하나에 수십 번 부른다) 재사용한다. */
const ZONED_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** 그 시간대의 벽시계(년·월·일·시·분·초). */
export function zonedParts(
  at: Date,
  timeZone: string,
): { date: string; hour: number; minute: number; second: number } {
  let formatter = ZONED_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    ZONED_FORMATTERS.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

/**
 * 그 시간대에서 `date` 의 `hour` 시 정각이 되는 UTC 순간. 서머타임 경계에서도 맞다(오프셋을 두 번 잰다).
 * 우리 지역들은 모두 정시 오프셋이고 전환은 새벽 2시라 0시·6시·21시는 하루에 한 번씩만 있다.
 */
export function zonedTimeToUtc(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hour, 0, 0);
  const offsetAt = (ms: number) => {
    const p = zonedParts(new Date(ms), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number);
    return Date.UTC(py!, pm! - 1, pd!, p.hour, p.minute, p.second) - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/**
 * 워커 환경에서 기상청 서비스 키(일반 인증키 — **Decoding**)를 꺼낸다. 없거나 공백뿐이면 `undefined`.
 * 운영 절차는 `docs/ops/environments.md` 「기상청 단기예보 키(KMA_SERVICE_KEY)」.
 */
export function kmaServiceKey(env: { KMA_SERVICE_KEY?: string } | undefined): string | undefined {
  const key = env?.KMA_SERVICE_KEY?.trim();
  return key ? key : undefined;
}
