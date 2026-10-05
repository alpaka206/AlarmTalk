/**
 * 미국 국립기상청(NWS) 어댑터 — 원시 격자 `api.weather.gov/gridpoints/{gridId}/{x},{y}` → 날짜별 표본(`SourceDay`).
 *
 * 2026-10-01 실측(69곳, 첫 시도 전부 200): 원시 격자는 약 248KB(gzip 전송 약 9KB), 중앙값 595ms. 각 층(layer)은
 * `validTime` 이 ISO 8601 구간(`2026-10-01T12:00:00+00:00/PT13H`)인 값의 목록이다. 날짜 D 는 **지역 시간대의
 * [00시, 24시)** 다. 규칙 전문은 `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 *
 *  - 최고·최저: `maxTemperature`·`minTemperature` 가운데 구간 **중점**의 현지 날짜가 D 인 값.
 *  - 강수확률: D 와 겹치는 `probabilityOfPrecipitation` 의 최댓값. ⚠ `/forecast` 의 12시간 PoP 는 쓰지 않는다 —
 *    밤 구간이 자정을 걸쳐 276건 중 76건이 날짜가 어긋났다.
 *  - 강수량: `quantitativePrecipitation` 을 D 와 겹친 비율만큼 나눠 더한 값(mm).
 *  - 눈(71): 눈 계열 `weather`(snow·snow_showers·blowing_snow·ice_crystals, 결정 D1 이면 rain_snow·sleet 도)가 있고
 *    적설 합 > 0 또는 PoP ≥ 30. 비(61): PoP ≥ 30 또는 QPF > 0 — `coverage` 만 보고 비 코드를 만들지 않는다
 *    (NYC 'chance rain_showers' 인데 PoP 7 이었다). 안개(45): fog·freezing_fog·ice_fog 이고 coverage 가 patchy 가
 *    아닐 때(결정 D2). 흐림(3): 07~19시 `skyCover` 시간 가중 평균 > 50.
 *  - 아이콘·`shortForecast` 는 폐기 예고 필드라 쓰지 않는다.
 *  - 필수 표본(코드·최고·최저·PoP·QPF)의 층이 그날을 다 덮지 못하면 그 날짜는 미해결이다. 단 QPF 는 발표 뒤
 *    약 72시간까지만 오는 층이라, **그 지평 너머**는 빠짐이 아니라 '재지 않음'(NaN)이다(`qpfBeyondHorizon`).
 *    지평은 실제로 온 숫자 표본이 정한다 — 표본이 하나도 없는 QPF 층에는 지평이 없어 모든 날짜가 빠짐이다.
 */
import type { WeatherRegion, WeatherSource } from '@alarmtalk/shared';
import { logStructured } from './logger';
import { fetchWeatherSource, logWeatherFetch } from './weather-fetch';
import { WEATHER_PROXY_CODE } from './weather-signal';
import {
  addDaysToDate,
  httpFailure,
  MIXED_PRECIPITATION_IS_SNOW,
  WeatherSourceError,
  zonedParts,
  zonedTimeToUtc,
  type SourceDay,
  type SourceFetchOptions,
} from './weather-source';

type NwsSource = Extract<WeatherSource, { kind: 'nws' }>;

const HOUR_MS = 60 * 60 * 1000;
/** `properties.updateTime` 을 믿는 나이. */
export const NWS_MAX_AGE_MS = 18 * HOUR_MS;
/**
 * NWS 는 User-Agent 로 호출자를 식별한다(api.weather.gov 문서 — "A User Agent is required to identify your
 * application… include contact information"). 없거나 막힌 UA 는 403 HTML 이다.
 */
export const NWS_USER_AGENT = 'AlarmTalkBackend (alarm-talk.com, support@alarm-talk.com)';
/** 오늘부터 며칠까지 계산하나(오늘 + 3). 미리 계산 지평과 같다. */
const NWS_DAYS = 4;

export function nwsGridUrl(source: NwsSource): URL {
  return new URL(`https://api.weather.gov/gridpoints/${source.gridId}/${source.gridX},${source.gridY}`);
}

const SNOW_WEATHER = new Set(['snow', 'snow_showers', 'blowing_snow', 'ice_crystals']);
const MIXED_WEATHER = new Set(['rain_snow', 'sleet']);
const FOG_WEATHER = new Set(['fog', 'freezing_fog', 'ice_fog']);

type Interval = { start: number; end: number };
type Sample<T> = Interval & { value: T };

const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** `2026-10-01T12:00:00+00:00/PT13H` → [시작, 끝) ms. 못 읽으면 null. */
export function parseNwsInterval(validTime: unknown): Interval | null {
  if (typeof validTime !== 'string') return null;
  const [startText, durationText] = validTime.split('/');
  const start = Date.parse(startText ?? '');
  const m = DURATION_RE.exec(durationText ?? '');
  if (!Number.isFinite(start) || !m) return null;
  const [, d, h, mi, s] = m;
  const ms = ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(mi ?? 0)) * 60_000 + Number(s ?? 0) * 1000;
  if (ms <= 0) return null;
  return { start, end: start + ms };
}

function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

type Layer = { uom?: unknown; values?: unknown };

/** 숫자 층 → 구간 표본. 단위가 기대와 다르면 null(그 층은 못 믿는다). 값이 null 인 칸은 빼 둔다. */
function numericLayer(layer: unknown, uom: string): Sample<number>[] | null {
  const l = layer as Layer | undefined;
  if (!l || !Array.isArray(l.values) || l.uom !== uom) return null;
  const out: Sample<number>[] = [];
  for (const entry of l.values as { validTime?: unknown; value?: unknown }[]) {
    const iv = parseNwsInterval(entry?.validTime);
    if (!iv || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue;
    out.push({ ...iv, value: entry.value });
  }
  return out;
}

type WeatherEntry = { coverage: string | null; weather: string | null };

function weatherLayer(layer: unknown): Sample<WeatherEntry[]>[] | null {
  const l = layer as Layer | undefined;
  if (!l || !Array.isArray(l.values)) return null;
  const out: Sample<WeatherEntry[]>[] = [];
  for (const entry of l.values as { validTime?: unknown; value?: unknown }[]) {
    const iv = parseNwsInterval(entry?.validTime);
    if (!iv || !Array.isArray(entry.value)) continue;
    out.push({
      ...iv,
      value: (entry.value as { coverage?: unknown; weather?: unknown }[]).map((w) => ({
        coverage: typeof w?.coverage === 'string' ? w.coverage : null,
        weather: typeof w?.weather === 'string' ? w.weather : null,
      })),
    });
  }
  return out;
}

/** 표본들이 창을 (1분 여유로) 다 덮는가. 층의 구간은 서로 겹치지 않는다. */
function covers<T>(samples: readonly Sample<T>[], window: Interval): boolean {
  const covered = samples.reduce((sum, s) => sum + overlapMs(s, window), 0);
  return covered >= window.end - window.start - 60_000;
}

/**
 * 강수량(QPF)이 그날을 다 덮지 못했을 때. NWS 의 QPF 는 **발표 뒤 약 72시간까지만** 온다(2026-10-01 실측 — 뉴욕
 * 격자는 PoP·하늘이 10-09 까지인데 QPF·적설은 10-04 12Z 에서 끝났다). 그래서 +3 일은 동부·중부에서 언제나 뒤쪽이
 * 비어 있다 — 이걸 '빠짐' 으로 보면 +3 은 영영 미해결이고 cron 이 슬롯 내내 다시 부른다.
 *
 *  - 층의 끝(지평)까지는 빈틈없이 덮여 있고 그 뒤가 비었다 → 지평 너머는 **재지 않음**. 덮인 부분에 이미 비가
 *    있으면(합 > 0) 그 합(아래 경계 — 분류는 0 보다 큰지만 본다), 없으면 NaN(재지 않음 — 비는 PoP 가 정한다).
 *  - 지평 안에 빈틈이 있다 → **빠짐**(null, 그 날짜는 미해결).
 *  - 숫자 표본이 하나도 없다(빈 `values`, 값이 전부 null) → 지평이 없다 — **빠짐**. ⚠ 지평을 −∞ 로 두고 '모든
 *    날짜가 지평 너머' 로 읽으면 오늘·내일까지 강수량 없이 해결된다(반쪽 값, 코덱스 #846).
 */
function qpfBeyondHorizon(qpf: readonly Sample<number>[], window: Interval): number | null {
  if (qpf.length === 0) return null;
  const horizon = qpf.reduce((end, s) => Math.max(end, s.end), Number.NEGATIVE_INFINITY);
  if (!(horizon < window.end)) return null; // 지평 안의 빈틈
  if (horizon <= window.start) return Number.NaN;
  const covered: Interval = { start: window.start, end: horizon };
  if (!covers(qpf, covered)) return null;
  const sum = qpf.reduce((acc, s) => acc + (s.value * overlapMs(s, covered)) / (s.end - s.start), 0);
  return sum > 0 ? sum : Number.NaN;
}

function timeWeightedMean(samples: readonly Sample<number>[], window: Interval): number | null {
  let weight = 0;
  let sum = 0;
  for (const s of samples) {
    const w = overlapMs(s, window);
    if (w <= 0) continue;
    weight += w;
    sum += s.value * w;
  }
  return weight > 0 ? sum / weight : null;
}

/**
 * 원시 격자 문서 → 지역의 오늘부터 4일치 표본. 발표가 낡았으면(18시간) `transient:stale_grid`, 필요한 층이
 * 없거나 단위가 다르면 `transient:nws_layers` 를 던진다.
 */
export function nwsDaysFromGrid(doc: unknown, timeZone: string, now: Date): Map<string, SourceDay> {
  const props = (doc as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props || typeof props !== 'object') throw new WeatherSourceError('transient', 'nws_unparsable');
  const updated = typeof props.updateTime === 'string' ? Date.parse(props.updateTime) : Number.NaN;
  if (!Number.isFinite(updated)) throw new WeatherSourceError('transient', 'nws_unparsable');
  if (now.getTime() - updated > NWS_MAX_AGE_MS) throw new WeatherSourceError('transient', 'stale_grid');
  const valid = parseNwsInterval(props.validTimes);
  if (!valid) throw new WeatherSourceError('transient', 'nws_unparsable');

  const maxT = numericLayer(props.maxTemperature, 'wmoUnit:degC');
  const minT = numericLayer(props.minTemperature, 'wmoUnit:degC');
  const pop = numericLayer(props.probabilityOfPrecipitation, 'wmoUnit:percent');
  const qpf = numericLayer(props.quantitativePrecipitation, 'wmoUnit:mm');
  const sky = numericLayer(props.skyCover, 'wmoUnit:percent');
  const weather = weatherLayer(props.weather);
  // 적설은 눈 판정의 보조 근거다 — 층이 없으면 PoP 만으로 본다.
  const snowfall = numericLayer(props.snowfallAmount, 'wmoUnit:mm') ?? [];
  if (!maxT || !minT || !pop || !qpf || !sky || !weather) {
    throw new WeatherSourceError('transient', 'nws_layers');
  }

  const localDateOf = (ms: number) => zonedParts(new Date(ms), timeZone).date;
  const today = localDateOf(now.getTime());
  // 최고·최저는 구간 중점의 현지 날짜로 고른다 — 표본마다 한 번만 잰다.
  const midDay = (s: Interval) => localDateOf(s.start + (s.end - s.start) / 2);
  const maxByDate = maxT.map((s) => ({ date: midDay(s), value: s.value }));
  const minByDate = minT.map((s) => ({ date: midDay(s), value: s.value }));
  const days = new Map<string, SourceDay>();
  for (let i = 0; i < NWS_DAYS; i += 1) {
    const date = addDaysToDate(today, i);
    const dayStart = zonedTimeToUtc(date, 0, timeZone).getTime();
    const dayEnd = zonedTimeToUtc(addDaysToDate(date, 1), 0, timeZone).getTime();
    // 오늘은 격자가 시작하는 때부터(지난 시각은 격자에 없다). 격자 끝이 그날을 다 못 덮으면 그날은 없다.
    const window: Interval = { start: Math.max(dayStart, valid.start), end: dayEnd };
    if (window.start >= window.end || valid.end < dayEnd) continue;

    const maxes = maxByDate.filter((s) => s.date === date).map((s) => s.value);
    const mins = minByDate.filter((s) => s.date === date).map((s) => s.value);

    const popOk = covers(pop, window);
    const qpfOk = covers(qpf, window);
    const weatherOk = covers(weather, window);
    const daytime: Interval = {
      start: Math.max(window.start, zonedTimeToUtc(date, 7, timeZone).getTime()),
      end: Math.min(window.end, zonedTimeToUtc(date, 19, timeZone).getTime()),
    };
    // 오늘 07~19시가 다 지났으면 남은 시각으로 본다.
    const skyWindow = daytime.start < daytime.end ? daytime : window;
    const skyOk = covers(sky, skyWindow);

    const popMax = popOk
      ? Math.max(...pop.filter((s) => overlapMs(s, window) > 0).map((s) => s.value))
      : null;
    const qpfSum = qpfOk
      ? qpf.reduce((sum, s) => sum + (s.value * overlapMs(s, window)) / (s.end - s.start), 0)
      : qpfBeyondHorizon(qpf, window);
    const snowSum = snowfall.reduce((sum, s) => sum + (s.value * overlapMs(s, window)) / (s.end - s.start), 0);
    const skyMean = skyOk ? timeWeightedMean(sky, skyWindow) : null;
    const entries = weather.filter((s) => overlapMs(s, window) > 0).flatMap((s) => s.value);

    let code: number | null = null;
    if (popMax !== null && qpfSum !== null && weatherOk && skyMean !== null) {
      const snowy = entries.some(
        (e) =>
          e.weather !== null &&
          (SNOW_WEATHER.has(e.weather) || (MIXED_PRECIPITATION_IS_SNOW && MIXED_WEATHER.has(e.weather))),
      );
      const foggy = entries.some((e) => e.weather !== null && FOG_WEATHER.has(e.weather) && e.coverage !== 'patchy');
      if (snowy && (snowSum > 0 || popMax >= 30)) code = WEATHER_PROXY_CODE.snow;
      else if (popMax >= 30 || qpfSum > 0) code = WEATHER_PROXY_CODE.rain;
      else if (foggy) code = WEATHER_PROXY_CODE.fog;
      else if (skyMean > 50) code = WEATHER_PROXY_CODE.cloud;
      else code = WEATHER_PROXY_CODE.clear;
    }

    days.set(date, {
      code,
      maxTemp: maxes.length > 0 ? round1(Math.max(...maxes)) : null,
      minTemp: mins.length > 0 ? round1(Math.min(...mins)) : null,
      rainProbability: popMax,
      precipitation: qpfSum === null ? null : round1(qpfSum),
    });
  }
  return days;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 오류 응답 → 실패 갈래. 429·5xx 는 일시 실패, 그 밖의 4xx 는 설정 실패다.
 *  - 404 는 **그 지역의 칸**(`scope: 'region'`)이다 — 2026-10-05 실측으로 박아 둔 칸이 틀린 경우가 셋 다 404 였다:
 *    없는 격자(`InvalidGridpoint`), 없는 office(`NotFound` + `path.wfo`), 숫자가 아닌 x(`NotFound` + `path.x`).
 *  - 403 HTML(UA 차단)·400 등 나머지는 원천 전체다.
 */
function nwsFailure(status: number, body: string, contentType: string): WeatherSourceError | null {
  const failure = httpFailure(status);
  if (!failure) return null;
  if (status === 404) {
    return new WeatherSourceError('config', /InvalidGridpoint/i.test(body) ? 'invalid_gridpoint' : 'http_404', 'region');
  }
  if (status === 403 && contentType.includes('html')) return new WeatherSourceError('config', 'http_403_html');
  return failure;
}

/**
 * 지역 하나의 원시 격자를 받는다. 실패는 `WeatherSourceError` 로 던진다. 즉석 계산(읽기 경로)만 엣지 캐시를 건다.
 */
export async function fetchNwsDays(
  region: WeatherRegion,
  source: NwsSource,
  options: SourceFetchOptions,
): Promise<Map<string, SourceDay>> {
  if (!options.budget.take('nws')) throw new WeatherSourceError('budget', 'fetch_budget');
  const result = await fetchWeatherSource('nws', 'gridpoint', nwsGridUrl(source), {
    headers: { 'user-agent': NWS_USER_AGENT, accept: 'application/geo+json' },
    cacheTtlSeconds: options.cacheTtlSeconds ?? null,
    deadlineAt: options.deadlineAt ?? null,
  });
  const log = (level: 'info' | 'warn', resultCode: string | null, items: number | null) =>
    logWeatherFetch(level, {
      source: 'nws',
      kind: 'gridpoint',
      status: result.status,
      resultCode,
      ms: result.ms,
      timedOut: false,
      items,
    });
  const failure = nwsFailure(result.status, result.body, result.contentType);
  if (failure) {
    log('warn', failure.reason, null);
    throw failure;
  }
  try {
    let doc: unknown;
    try {
      doc = JSON.parse(result.body);
    } catch {
      throw new WeatherSourceError('transient', 'nws_unparsable');
    }
    const days = nwsDaysFromGrid(doc, region.tz, options.now);
    log('info', null, days.size);
    return days;
  } catch (err) {
    log('warn', err instanceof WeatherSourceError ? err.reason : null, null);
    if (!(err instanceof WeatherSourceError)) logStructured('warn', { at: 'weather.nws_parse', error: String(err) });
    throw err;
  }
}
