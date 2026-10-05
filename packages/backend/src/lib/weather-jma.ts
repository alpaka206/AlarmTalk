/**
 * 気象庁 bosai 예보 JSON(JP) 어댑터 — 예보 office 하나의 `forecast/{office}.json` → 날짜별 표본(`SourceDay`).
 *
 * 공식 API 가 아니다(気象庁 홈페이지가 쓰는 JSON — 키 없음, S3 + CloudFront). 그래서 **발표 시각을 믿기 전에 잰다**
 * — 200 을 돌려주면서 갱신이 멈춘 전례가 있다(경보 JSON 은 2026-05-28 이후 그대로다). 규칙 전문은
 * `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 *
 * 응답은 두 칸이다: `[0]` 府県天気予報(단기 — 05·11·17시 발표), `[1]` 府県週間天気予報(주간 — 11·17시). 값은 모두
 * 문자열이고 없으면 "" 다. **위치가 아니라 `timeDefines` 의 날짜로** 맞춘다:
 *
 *  - 날씨: `[0].timeSeries[0]` 의 1차 세분 구역(`class10`) `weatherCodes`. 그 날짜가 없으면 주간 구역의 코드.
 *  - 강수확률: 그 날짜 6시간 `pops` 의 최댓값(`[0].timeSeries[1]`). 오늘이 아니면 4칸(00·06·12·18시)이 다 있어야
 *    한다. 없으면 주간 `pops`(하루 단위).
 *  - 기온(`[0].timeSeries[2]`, 기온 지점): 17시 발표는 [내일 최저, 내일 최고], 05·11시 발표는 [오늘 최고, 오늘 최고
 *    (24시간), 내일 최저, 내일 최고] — JMA 페이지 스크립트와 같은 인덱스 규칙이고, 날짜가 어긋나면 쓰지 않는다.
 *    D+2·D+3 은 주간 `tempsMin`/`tempsMax`(주간 구역에 짝지은 기온 지점). **발표일의 최저는 어떤 발표에도 없다**
 *    — 05시 발표부터 그날이 끝날 때까지 지역의 오늘 최저(17시 발표 뒤에는 최고도)는 이어받기로 채운다
 *    (`finalizeSourceDay`). ⚠ 자정 ~ 05시 발표 전에는 다르다 — 그때 믿는 발표는 전날 17시 발표(13시간)이고 그
 *    [내일 최저, 내일 최고] 가 곧 지역의 오늘 값이다(회귀 `test/weather-sources-dry-run.test.ts`).
 *  - 강수량 합이 없다 — '재지 않음'(NaN → DB NULL). 안개 코드도 없다(현행 66개에 없다) — JP 에서 안개 클립은 안 나온다.
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
  type SourceDay,
  type SourceFetchOptions,
} from './weather-source';

type JmaSource = Extract<WeatherSource, { kind: 'jma' }>;

const HOUR_MS = 60 * 60 * 1000;
/** 단기 발표(`[0].reportDatetime`)를 믿는 나이. 정시 발표 간격이 최대 12시간(17시 → 05시)이라 1시간 여유. */
export const JMA_SHORT_MAX_AGE_MS = 13 * HOUR_MS;
/** 주간 발표(`[1].reportDatetime`)를 믿는 나이. 11·17시 발표라 간격이 최대 18시간(17시 → 11시). */
export const JMA_WEEK_MAX_AGE_MS = 20 * HOUR_MS;

export function jmaForecastUrl(office: string): URL {
  return new URL(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
}

/**
 * 현행 공식 날씨 코드 66개 — 気象庁防災情報XML 解説資料(jmaxml_20260826) 「府県天気予報・府県週間天気予報_解説資料付録」
 * 시트 「天気予報用テロップ番号」. 웹 페이지 스크립트의 TELOPS(118개) 가운데 나머지 52개는 퇴역 코드다
 * (209 霧 등 — 2026-09-24~10-01 XML 1,056개에서 이 66개 밖의 코드는 0건). **모르는 코드는 미해결**이다.
 */
export const JMA_WEATHER_CODES: Readonly<Record<string, string>> = {
  '100': '晴れ', '101': '晴れ時々くもり', '102': '晴れ一時雨', '103': '晴れ時々雨', '104': '晴れ一時雪',
  '105': '晴れ時々雪', '106': '晴れ一時雨か雪', '107': '晴れ時々雨か雪', '110': '晴れ後時々くもり',
  '111': '晴れ後くもり', '112': '晴れ後一時雨', '113': '晴れ後時々雨', '114': '晴れ後雨', '115': '晴れ後一時雪',
  '116': '晴れ後時々雪', '117': '晴れ後雪', '118': '晴れ後雨か雪', '160': '晴れ一時雪か雨', '170': '晴れ時々雪か雨',
  '181': '晴れ後雪か雨', '200': 'くもり', '201': 'くもり時々晴れ', '202': 'くもり一時雨', '203': 'くもり時々雨',
  '204': 'くもり一時雪', '205': 'くもり時々雪', '206': 'くもり一時雨か雪', '207': 'くもり時々雨か雪',
  '210': 'くもり後時々晴れ', '211': 'くもり後晴れ', '212': 'くもり後一時雨', '213': 'くもり後時々雨',
  '214': 'くもり後雨', '215': 'くもり後一時雪', '216': 'くもり後時々雪', '217': 'くもり後雪', '218': 'くもり後雨か雪',
  '260': 'くもり一時雪か雨', '270': 'くもり時々雪か雨', '281': 'くもり後雪か雨', '300': '雨', '301': '雨時々晴れ',
  '302': '雨時々止む', '303': '雨時々雪', '304': '雨か雪', '308': '雨で暴風を伴う', '309': '雨一時雪',
  '311': '雨後晴れ', '313': '雨後くもり', '314': '雨後時々雪', '315': '雨後雪', '316': '雨か雪後晴れ',
  '317': '雨か雪後くもり', '340': '雪か雨', '361': '雪か雨後晴れ', '371': '雪か雨後くもり', '400': '雪',
  '401': '雪時々晴れ', '402': '雪時々止む', '403': '雪時々雨', '406': '風雪強い', '407': '暴風雪', '409': '雪一時雨',
  '411': '雪後晴れ', '413': '雪後くもり', '414': '雪後雨',
};

/**
 * 코드 → 대리 코드. 이름에 雪 → 눈, 雨 → 비, くもり로 시작 → 흐림, 晴 → 맑음. 우리 분류기의 눈 > 비 우선순위와
 * 미끄럼 경고 취지에 맞춘 것이다. '雨か雪'(비 또는 눈 — 106·107·118·206·207·218·304·316·317)은 결정 D1
 * (`MIXED_PRECIPITATION_IS_SNOW`) — JMA 의 지도 색(대표군)은 비로 칠하는 9개다. 모르는 코드는 null.
 */
export function jmaCodeToProxy(code: unknown): number | null {
  const name = typeof code === 'string' ? JMA_WEATHER_CODES[code] : undefined;
  if (!name) return null;
  if (name.includes('雨か雪')) return MIXED_PRECIPITATION_IS_SNOW ? WEATHER_PROXY_CODE.snow : WEATHER_PROXY_CODE.rain;
  if (name.includes('雪')) return WEATHER_PROXY_CODE.snow;
  if (name.includes('雨')) return WEATHER_PROXY_CODE.rain;
  if (name.startsWith('くもり')) return WEATHER_PROXY_CODE.cloud;
  if (name.startsWith('晴')) return WEATHER_PROXY_CODE.clear;
  return null;
}

type JmaArea = { area?: { code?: unknown } } & Record<string, unknown>;
type JmaSeries = { timeDefines?: unknown; areas?: unknown };
type JmaReport = { reportDatetime?: unknown; timeSeries?: unknown };

function seriesAt(report: JmaReport, index: number): JmaSeries | null {
  const list = Array.isArray(report.timeSeries) ? (report.timeSeries as unknown[]) : [];
  const series = list[index];
  return series && typeof series === 'object' ? (series as JmaSeries) : null;
}

function datesOf(series: JmaSeries | null): string[] | null {
  const defs = series?.timeDefines;
  if (!Array.isArray(defs) || !defs.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d))) {
    return null;
  }
  return (defs as string[]).map((d) => d.slice(0, 10));
}

function hoursOf(series: JmaSeries | null): number[] | null {
  const defs = series?.timeDefines;
  if (!Array.isArray(defs)) return null;
  return (defs as string[]).map((d) => Number(String(d).slice(11, 13)));
}

function areaIn(series: JmaSeries | null, code: string): JmaArea | null {
  const areas = Array.isArray(series?.areas) ? (series!.areas as unknown[]) : [];
  const hit = areas.find(
    (a) => a && typeof a === 'object' && String((a as JmaArea).area?.code ?? '') === code,
  );
  return (hit as JmaArea | undefined) ?? null;
}

/** 값 배열의 i 번째를 숫자로. "" 이나 숫자가 아닌 것은 null. */
function numberAt(values: unknown, index: number): number | null {
  if (!Array.isArray(values)) return null;
  const v = values[index];
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringAt(values: unknown, index: number): string | null {
  if (!Array.isArray(values)) return null;
  const v = values[index];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function reportTime(report: JmaReport): number | null {
  const ms = typeof report.reportDatetime === 'string' ? Date.parse(report.reportDatetime) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 응답 문서 → 날짜별 표본. 발표가 낡았으면(단기 13시간·주간 20시간) `transient:stale_report` 를 던진다.
 * 모양이 틀리면 `transient:jma_unparsable`.
 */
export function jmaDaysFromDocument(doc: unknown, source: JmaSource, now: Date): Map<string, SourceDay> {
  if (!Array.isArray(doc) || doc.length < 2) throw new WeatherSourceError('transient', 'jma_unparsable');
  const short = doc[0] as JmaReport;
  const week = doc[1] as JmaReport;
  const shortAt = reportTime(short);
  const weekAt = reportTime(week);
  if (shortAt === null || weekAt === null) throw new WeatherSourceError('transient', 'jma_unparsable');
  if (now.getTime() - shortAt > JMA_SHORT_MAX_AGE_MS || now.getTime() - weekAt > JMA_WEEK_MAX_AGE_MS) {
    throw new WeatherSourceError('transient', 'stale_report');
  }
  const reportDate = String(short.reportDatetime).slice(0, 10);
  const reportHour = Number(String(short.reportDatetime).slice(11, 13));
  const remainingPopHours = [0, 6, 12, 18].filter((hour) => hour >= reportHour);

  type Draft = { code?: string; pop?: number | null; max?: number | null; min?: number | null };
  const drafts = new Map<string, Draft>();
  const draft = (date: string) => {
    let d = drafts.get(date);
    if (!d) drafts.set(date, (d = {}));
    return d;
  };

  // 1) 날씨 코드 — class10.
  const ts0 = seriesAt(short, 0);
  const dates0 = datesOf(ts0);
  const area0 = areaIn(ts0, source.class10);
  if (dates0 && area0) {
    dates0.forEach((date, i) => {
      const code = stringAt(area0.weatherCodes, i);
      if (code) draft(date).code = code;
    });
  }

  // 2) 6시간 강수확률 — 발표일도 남은 칸을 모두 확인한다. timeDefines 자체가 빠질 수 있다.
  const ts1 = seriesAt(short, 1);
  const dates1 = datesOf(ts1);
  const hours1 = hoursOf(ts1);
  const area1 = areaIn(ts1, source.class10);
  if (dates1 && hours1 && area1) {
    const byDate = new Map<string, { hours: number[]; values: (number | null)[] }>();
    dates1.forEach((date, i) => {
      const bucket = byDate.get(date) ?? { hours: [], values: [] };
      bucket.hours.push(hours1[i]!);
      bucket.values.push(numberAt(area1.pops, i));
      byDate.set(date, bucket);
    });
    for (const [date, { hours, values }] of byDate) {
      if (values.some((v) => v === null)) continue;
      const expectedHours = date === reportDate ? remainingPopHours : [0, 6, 12, 18];
      if (expectedHours.length === 0 || !expectedHours.every((hour) => hours.includes(hour))) continue;
      if (new Set(hours).size !== hours.length || hours.some((hour) => ![0, 6, 12, 18].includes(hour))) continue;
      draft(date).pop = Math.max(...(values as number[]));
    }
  }

  // 3) 기온 — 기온 지점. JMA 페이지 스크립트의 인덱스 규칙 + 날짜 대조.
  const ts2 = seriesAt(short, 2);
  const dates2 = datesOf(ts2);
  const area2 = areaIn(ts2, source.tempStation);
  if (dates2 && area2 && Array.isArray(area2.temps)) {
    const tomorrow = addDaysToDate(reportDate, 1);
    const temps = area2.temps as unknown[];
    if (temps.length === 2 && dates2.length === 2 && dates2[0] === tomorrow && dates2[1] === tomorrow) {
      draft(tomorrow).min = numberAt(temps, 0);
      draft(tomorrow).max = numberAt(temps, 1);
    } else if (
      temps.length === 4 &&
      dates2.length === 4 &&
      dates2[0] === reportDate &&
      dates2[2] === tomorrow &&
      dates2[3] === tomorrow
    ) {
      draft(reportDate).max = numberAt(temps, 0);
      draft(tomorrow).min = numberAt(temps, 2);
      draft(tomorrow).max = numberAt(temps, 3);
    } else {
      logStructured('warn', { at: 'weather.jma_temps', length: temps.length, dates: dates2.length });
    }
  }

  // 4) 주간 — 단기에 없는 날짜를 채운다. 주간 구역은 후보 가운데 그날 응답에 실제로 있는 첫 구역.
  const wts0 = seriesAt(week, 0);
  const wts1 = seriesAt(week, 1);
  const wDates0 = datesOf(wts0);
  const wDates1 = datesOf(wts1);
  const pick = source.week.find((w) => areaIn(wts0, w.area) !== null);
  const weekArea = pick ? areaIn(wts0, pick.area) : null;
  const weekTemps = pick ? areaIn(wts1, pick.tempStation) : null;
  if (wDates0 && weekArea) {
    wDates0.forEach((date, i) => {
      const d = draft(date);
      if (d.code === undefined) {
        const code = stringAt(weekArea.weatherCodes, i);
        if (code) d.code = code;
      }
      if (d.pop === undefined || d.pop === null) {
        const pop = numberAt(weekArea.pops, i);
        if (pop !== null) d.pop = pop;
      }
    });
  }
  if (wDates1 && weekTemps) {
    wDates1.forEach((date, i) => {
      const d = draft(date);
      if (d.min === undefined || d.min === null) {
        const min = numberAt(weekTemps.tempsMin, i);
        if (min !== null) d.min = min;
      }
      if (d.max === undefined || d.max === null) {
        const max = numberAt(weekTemps.tempsMax, i);
        if (max !== null) d.max = max;
      }
    });
  }

  const days = new Map<string, SourceDay>();
  for (const [date, d] of drafts) {
    const code = d.code === undefined ? null : jmaCodeToProxy(d.code);
    if (d.code !== undefined && code === null) {
      logStructured('warn', { at: 'weather.jma_code', code: d.code.slice(0, 8) });
    }
    days.set(date, {
      code,
      maxTemp: d.max ?? null,
      minTemp: d.min ?? null,
      rainProbability: d.pop ?? null,
      // 気象庁 예보에는 강수량 합이 없다 — 재지 않음.
      precipitation: Number.NaN,
    });
  }
  return days;
}

/**
 * 오류 응답 → 실패 갈래. 404 는 그 office 의 JSON 이 없다는 뜻이라 **그 지역의 칸** 설정 실패다(2026-10-05 실측 —
 * 없는 office 는 404 HTML). 그 밖의 4xx 는 원천 전체, 429·5xx 는 일시 실패.
 */
function jmaFailure(status: number): WeatherSourceError | null {
  if (status === 404) return new WeatherSourceError('config', 'http_404', 'region');
  return httpFailure(status);
}

/**
 * 지역 하나의 예보를 받는다. 실패는 `WeatherSourceError` 로 던진다. 즉석 계산(읽기 경로)만 엣지 캐시를 건다.
 */
export async function fetchJmaDays(
  _region: WeatherRegion,
  source: JmaSource,
  options: SourceFetchOptions,
): Promise<Map<string, SourceDay>> {
  if (!options.budget.take('jma')) throw new WeatherSourceError('budget', 'fetch_budget');
  const result = await fetchWeatherSource('jma', 'forecast', jmaForecastUrl(source.office), {
    cacheTtlSeconds: options.cacheTtlSeconds ?? null,
    deadlineAt: options.deadlineAt ?? null,
  });
  const log = (level: 'info' | 'warn', resultCode: string | null, items: number | null) =>
    logWeatherFetch(level, {
      source: 'jma',
      kind: 'forecast',
      status: result.status,
      resultCode,
      ms: result.ms,
      timedOut: false,
      items,
    });
  const failure = jmaFailure(result.status);
  if (failure) {
    log('warn', failure.reason, null);
    throw failure;
  }
  try {
    let doc: unknown;
    try {
      doc = JSON.parse(result.body);
    } catch {
      throw new WeatherSourceError('transient', 'jma_unparsable');
    }
    const days = jmaDaysFromDocument(doc, source, options.now);
    log('info', null, days.size);
    return days;
  } catch (err) {
    log('warn', err instanceof WeatherSourceError ? err.reason : null, null);
    throw err;
  }
}
