/**
 * 지역별 날씨를 **서버가 미리 계산해 둔다** — `weather_region_daily`(마이그레이션 #123).
 *
 * 날씨 클립의 자리(인덱스)는 **지역 × 날짜** 로만 갈린다. 사람마다 Open-Meteo 에 물을 이유가 없어서,
 * cron 이 목록의 모든 지역에 대해 그 지역 시간대의 오늘·내일·모레를 묶어 계산해 두고
 * `GET /tts/prerender-variant` 는 DB 한 번 읽기로 답한다. 규칙 전문은
 * `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 *
 * - **읽기**(`resolveRegionVariantIndex`): 행이 있고 12시간 안에 계산한 것이면 그대로. 없거나 오래됐으면
 *   그 지역 하나를 박아 둔 좌표로 곧바로 계산해 upsert 하고 돌려준다(지오코딩 없음).
 *   ⚠ 표가 아직 없으면(배포 → 마이그레이션 창) **저장 없이** 계산만 한다 — 읽기 경로이고, 클라는
 *   `null`(미해결)까지 견딘다. 창 동안 느려질 뿐이다(CLAUDE.md 「배포가 마이그레이션보다 먼저 돈다」).
 * - **cron**(`refreshWeatherRegionDaily`): 한 시간에 한 번 들여다보고, 3시간 안에 계산하지 않은
 *   (지역, 날짜)가 있는 지역만 다시 계산한다. Open-Meteo 예보·대기질 API 는 위경도 목록(쉼표)을 받으므로
 *   **50곳씩 묶어** 부른다 — 133곳이면 예보 3번 + 대기질 3번이다. 행은 묶음마다 `db.batch` 한 번.
 *   한 실행의 subrequest(~50) 가운데 최대 1(조회) + 6(Open-Meteo) + 3(쓰기) 을 쓴다.
 *
 * ⚠ Open-Meteo 무료 엔드포인트는 **비상업용**이다. 워커에 `OPEN_METEO_API_KEY` 를 넣으면 같은 요청이
 *   상업 호스트(`customer-` 접두 + `apikey`)로 간다 — 고르는 곳은 `lib/weather-fetch.ts` 한 곳이고,
 *   운영 절차는 `docs/ops/environments.md` 「Open-Meteo 상업 키」.
 */
import { WeatherRegions, type WeatherRegion } from '@alarmtalk/shared';
import type { InStatement } from '@libsql/client';
import { logStructured } from './logger';
import type { DbExecutor } from './transactions';
import { fetchOpenMeteo } from './weather-fetch';
import {
  dailySamplesAt,
  dustFromHourly,
  loadWeatherSignalInput,
  resolvePrerenderWeatherIndex,
  TARGET_DATE_RE,
  WEATHER_DAILY_FIELDS,
  type AirQualityForecastResponse,
  type WeatherForecastResponse,
  type WeatherSignalInput,
} from './weather-signal';

const HOUR_MS = 60 * 60 * 1000;

/** 읽기 경로가 믿는 행의 나이. 넘으면 그 지역 하나를 곧바로 다시 계산한다. */
export const WEATHER_REGION_READ_STALE_MS = 12 * HOUR_MS;
/** cron 이 다시 계산하는 주기 — 이보다 최근에 계산한 (지역, 날짜)는 건너뛴다. */
export const WEATHER_REGION_REFRESH_MS = 3 * HOUR_MS;
/** Open-Meteo 한 요청에 싣는 위치 수 상한. */
export const WEATHER_REGION_BATCH_SIZE = 50;
/** 한 cron 실행이 부르는 묶음 수 상한 — 묶음마다 예보·대기질 두 번이라 subrequest 는 두 배다. */
export const WEATHER_REGION_MAX_CHUNKS_PER_RUN = 3;
/** 지역 시간대의 오늘·내일·모레. 클라의 준비창(48시간)을 덮는다. */
export const WEATHER_REGION_PRECOMPUTE_DAYS = 3;

/** 미리 계산한 한 칸 — (지역, 지역 달력의 날짜)의 표본과 클립 자리. */
export type WeatherRegionDay = {
  regionKey: string;
  targetDate: string;
  input: WeatherSignalInput;
  variantIndex: number;
};

const UPSERT_SQL = `INSERT INTO weather_region_daily (
    region_key, target_date, variant_index, weather_code, temp_max, temp_min,
    precip_prob, precip_sum, dust_level, computed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(region_key, target_date) DO UPDATE SET
    variant_index = excluded.variant_index,
    weather_code = excluded.weather_code,
    temp_max = excluded.temp_max,
    temp_min = excluded.temp_min,
    precip_prob = excluded.precip_prob,
    precip_sum = excluded.precip_sum,
    dust_level = excluded.dust_level,
    computed_at = excluded.computed_at`;

function upsertStatement(day: WeatherRegionDay, computedAt: string): InStatement {
  const { input } = day;
  return {
    sql: UPSERT_SQL,
    args: [
      day.regionKey,
      day.targetDate,
      day.variantIndex,
      input.code,
      input.maxTemp,
      input.minTemp,
      input.rainProbability,
      input.precipitation,
      input.hasDust ? 'bad' : 'ok',
      computedAt,
    ],
  };
}

/** 'YYYY-MM-DD' 에 날수를 더한다(달력 계산만 — 시간대와 무관). */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** 그 지역 시간대의 오늘부터 `WEATHER_REGION_PRECOMPUTE_DAYS` 날. */
export function regionTargetDates(region: WeatherRegion, now: Date): string[] {
  const today = WeatherRegions.localDate(region, now);
  return Array.from({ length: WEATHER_REGION_PRECOMPUTE_DAYS }, (_, i) => addDaysToDate(today, i));
}

function isMissingTableError(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).toLowerCase().includes('no such table');
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

// ── 읽기 경로(GET /tts/prerender-variant) ─────────────────────────────────────────────────

/**
 * 목록 지역의 그 날짜 클립 자리. 못 구하면 **null**(미해결 — 클라가 다시 받는다).
 *
 * `rawTargetDate` 는 달력 날짜(YYYY-MM-DD)이고 **지역 시간대의 달력**으로 읽는다. 없거나 모양이 틀리면
 * 지역의 오늘. `openDb` 는 DB 가 필요할 때만 부른다 — 여는 것 자체가 실패해도 계산은 한다.
 * `openMeteoApiKey` 는 상업 키(`openMeteoApiKey(env)`) — 없으면 무료 호스트다.
 */
export async function resolveRegionVariantIndex(
  openDb: () => DbExecutor,
  region: WeatherRegion,
  rawTargetDate: unknown,
  options: { now?: Date; openMeteoApiKey?: string } = {},
): Promise<number | null> {
  const now = options.now ?? new Date();
  const targetDate =
    typeof rawTargetDate === 'string' && TARGET_DATE_RE.test(rawTargetDate)
      ? rawTargetDate
      : WeatherRegions.localDate(region, now);

  // 표를 못 읽으면 null — 그때는 적지도 않는다(아래).
  let db: DbExecutor | null;
  try {
    db = openDb();
    const result = await db.execute({
      sql: `SELECT variant_index, computed_at FROM weather_region_daily
            WHERE region_key = ? AND target_date = ? LIMIT 1`,
      args: [region.key, targetDate],
    });
    const row = result.rows[0];
    if (row) {
      const variantIndex = row.variant_index == null ? null : Number(row.variant_index);
      const computedAt = Date.parse(String(row.computed_at ?? ''));
      if (
        variantIndex !== null &&
        Number.isInteger(variantIndex) &&
        Number.isFinite(computedAt) &&
        now.getTime() - computedAt <= WEATHER_REGION_READ_STALE_MS
      ) {
        return variantIndex;
      }
    }
  } catch (err) {
    // 표가 아직 없거나(배포 → 마이그레이션 창) DB 가 잠깐 안 된다 — 저장하지 않고 계산만 한다.
    // ⚠ 지역 키·좌표는 남기지 않는다(`weather.fetch` 로그와 같은 규칙).
    logStructured('warn', {
      at: 'weather.region_daily',
      op: 'read',
      missingTable: isMissingTableError(err),
      error: errorName(err),
    });
    db = null;
  }

  const input = await loadWeatherSignalInput(
    { region: region.key, targetDate },
    'unresolved',
    options.openMeteoApiKey,
  );
  if (!input) return null;
  const variantIndex = resolvePrerenderWeatherIndex(input);

  if (db && isStorableDate(region, targetDate, now)) {
    try {
      await db.execute(
        upsertStatement({ regionKey: region.key, targetDate, input, variantIndex }, now.toISOString()),
      );
    } catch (err) {
      // 저장은 캐시일 뿐이다 — 못 적어도 이번 답은 맞다. 다음 요청이나 cron 이 다시 적는다.
      logStructured('warn', {
        at: 'weather.region_daily',
        op: 'write',
        missingTable: isMissingTableError(err),
        error: errorName(err),
      });
    }
  }
  return variantIndex;
}

/**
 * 저장할 만한 날짜인가 — 지역의 어제 ~ 16일 뒤(Open-Meteo 예보 지평). 그 밖은 계산해 답만 하고
 * 표에 남기지 않는다(지난 날짜를 마구 물어 표를 채우지 못하게).
 */
function isStorableDate(region: WeatherRegion, targetDate: string, now: Date): boolean {
  const today = WeatherRegions.localDate(region, now);
  return targetDate >= addDaysToDate(today, -1) && targetDate <= addDaysToDate(today, 16);
}

// ── cron(미리 계산) ───────────────────────────────────────────────────────────────────────

/**
 * 이 틱이 미리 계산을 들여다볼 자리인가 — 5분 틱 가운데 **매시 첫 틱**(UTC 분 0~4).
 * 매 틱 들여다보면 표 전체를 하루 288번 읽는다. 한 시간에 한 번이면 3시간 주기에 충분하고,
 * 한 번 놓쳐도 읽기 경로가 12시간 기준으로 곧바로 계산한다.
 */
export function isWeatherRegionRefreshSlot(now: Date): boolean {
  return now.getUTCMinutes() < 5;
}

export type WeatherRegionRefreshResult = {
  /** 다시 계산할 지역 수(3시간 안에 계산하지 않은 날짜가 하나라도 있는 지역). */
  due: number;
  /** 부른 묶음 수 / 그 가운데 Open-Meteo 응답을 못 받은 묶음 수. */
  chunks: number;
  failedChunks: number;
  /** upsert 한 (지역, 날짜) 수. */
  stored: number;
  /** 표가 아직 없어 건너뛰었다(배포 → 마이그레이션 창). */
  missingTable: boolean;
};

type RegionPlan = { region: WeatherRegion; dates: string[] };

/**
 * 목록의 지역들을 미리 계산한다. 3시간 안에 계산한 (지역, 날짜)는 건너뛴다.
 *
 * 묶음 하나가 실패하면(타임아웃·비정상 응답·개수 불일치) 그 묶음만 건너뛴다 — 다음 시간에 다시 온다.
 * 표본이 빠진 (지역, 날짜)는 적지 않는다(반쪽 값 금지 — `WeatherFetchFailurePolicy` 의 'unresolved').
 */
export async function refreshWeatherRegionDaily(
  db: DbExecutor,
  now: Date,
  options: {
    /** 기본은 목록 전체. 테스트·부분 계산용. */
    regions?: readonly WeatherRegion[];
    /** Open-Meteo 상업 키(`openMeteoApiKey(env)`). 없으면 무료 호스트다. */
    openMeteoApiKey?: string;
  } = {},
): Promise<WeatherRegionRefreshResult> {
  const regions = options.regions ?? WeatherRegions.all;
  const result: WeatherRegionRefreshResult = {
    due: 0,
    chunks: 0,
    failedChunks: 0,
    stored: 0,
    missingTable: false,
  };
  const plans: RegionPlan[] = regions.map((region) => ({ region, dates: regionTargetDates(region, now) }));
  if (plans.length === 0) return result;
  const earliest = plans.map((plan) => plan.dates[0]!).sort()[0]!;
  const freshSince = new Date(now.getTime() - WEATHER_REGION_REFRESH_MS).toISOString();

  let fresh: Set<string>;
  try {
    const rows = await db.execute({
      sql: `SELECT region_key, target_date FROM weather_region_daily
            WHERE computed_at >= ? AND target_date >= ?`,
      args: [freshSince, earliest],
    });
    fresh = new Set(rows.rows.map((row) => `${String(row.region_key)}|${String(row.target_date)}`));
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    // 마이그레이션 전이다 — 다음 시간에 다시 온다. 경보 대상이 아니다.
    logStructured('info', { at: 'scheduled.weather_region_daily', missingTable: true });
    result.missingTable = true;
    return result;
  }

  const due = plans.filter((plan) => plan.dates.some((date) => !fresh.has(`${plan.region.key}|${date}`)));
  result.due = due.length;
  const computedAt = now.toISOString();
  // 한 묶음 안에서 지역마다 날짜가 다를 수 있어(한국의 오늘 = 미국의 내일) 묶음의 범위를 넓게 잡고
  // 지역마다 자기 날짜 칸만 읽는다. 지난 날짜 행은 첫 쓰기에 함께 지운다(표는 며칠치만 남는다).
  let pruneStatement: InStatement | null = {
    sql: 'DELETE FROM weather_region_daily WHERE target_date < ?',
    args: [addDaysToDate(computedAt.slice(0, 10), -3)],
  };
  for (let start = 0; start < due.length; start += WEATHER_REGION_BATCH_SIZE) {
    if (result.chunks >= WEATHER_REGION_MAX_CHUNKS_PER_RUN) break;
    const chunk = due.slice(start, start + WEATHER_REGION_BATCH_SIZE);
    result.chunks += 1;
    const days = await fetchChunk(chunk, options.openMeteoApiKey);
    if (days === null) {
      result.failedChunks += 1;
      continue;
    }
    if (days.length === 0) continue;
    const statements = days.map((day) => upsertStatement(day, computedAt));
    if (pruneStatement) statements.unshift(pruneStatement);
    await db.batch(statements);
    pruneStatement = null;
    result.stored += days.length;
  }
  return result;
}

/** 묶음 하나를 예보·대기질 두 요청으로 받아 (지역, 날짜) 칸으로 편다. 응답을 못 믿으면 null. */
async function fetchChunk(
  chunk: readonly RegionPlan[],
  openMeteoApiKey: string | undefined,
): Promise<WeatherRegionDay[] | null> {
  const allDates = chunk.flatMap((plan) => plan.dates).sort();
  const startDate = allDates[0]!;
  const endDate = allDates[allDates.length - 1]!;
  const common = (url: URL) => {
    url.searchParams.set('latitude', chunk.map((plan) => String(plan.region.lat)).join(','));
    url.searchParams.set('longitude', chunk.map((plan) => String(plan.region.lon)).join(','));
    // 위치마다 자기 시간대 — `daily.time`·`hourly.time` 이 그 지역의 달력으로 온다.
    url.searchParams.set('timezone', chunk.map((plan) => plan.region.tz).join(','));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    return url;
  };
  const forecastUrl = common(new URL('https://api.open-meteo.com/v1/forecast'));
  forecastUrl.searchParams.set('daily', WEATHER_DAILY_FIELDS.join(','));
  const airUrl = common(new URL('https://air-quality-api.open-meteo.com/v1/air-quality'));
  airUrl.searchParams.set('hourly', ['pm10', 'pm2_5'].join(','));

  const [forecasts, airs] = await Promise.all([
    fetchLocationList<WeatherForecastResponse>('forecast', forecastUrl, chunk.length, openMeteoApiKey),
    fetchLocationList<AirQualityForecastResponse>('air', airUrl, chunk.length, openMeteoApiKey),
  ]);
  if (!forecasts || !airs) return null;

  const days: WeatherRegionDay[] = [];
  chunk.forEach((plan, i) => {
    const daily = forecasts[i]?.daily;
    const hourly = airs[i]?.hourly;
    if (!daily || !hourly) return;
    for (const date of plan.dates) {
      const index = daily.time?.findIndex((value) => value === date) ?? -1;
      if (index < 0) continue;
      const samples = dailySamplesAt(daily, index);
      if (Object.values(samples).some((value) => !Number.isFinite(value))) continue;
      const hasDust = dustFromHourly(hourly, date);
      if (hasDust === null) continue;
      const input: WeatherSignalInput = { ...samples, hasDust };
      days.push({
        regionKey: plan.region.key,
        targetDate: date,
        input,
        variantIndex: resolvePrerenderWeatherIndex(input),
      });
    }
  });
  return days;
}

/**
 * 위치 여럿을 한 번에 부른 응답 → 위치 순서대로의 목록. 위치가 하나면 Open-Meteo 는 배열이 아니라
 * 객체 하나를 준다. 개수가 요청과 다르면 순서를 믿을 수 없으니 null.
 *
 * 엣지 캐시는 걸지 않는다(`cacheTtlSeconds: null`) — 미리 계산의 목적이 새 예보라, 캐시된 옛 응답을
 * 3시간마다 다시 적는 것은 의미가 없다.
 */
async function fetchLocationList<T>(
  kind: 'forecast' | 'air',
  url: URL,
  expected: number,
  openMeteoApiKey: string | undefined,
): Promise<T[] | null> {
  try {
    const response = await fetchOpenMeteo(kind, url, null, openMeteoApiKey);
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as T | T[] | null;
    if (json === null || typeof json !== 'object') return null;
    const list = Array.isArray(json) ? json : [json];
    return list.length === expected ? list : null;
  } catch {
    // 타임아웃·불통 — `fetchOpenMeteo` 가 이미 한 줄 남겼다.
    return null;
  }
}
