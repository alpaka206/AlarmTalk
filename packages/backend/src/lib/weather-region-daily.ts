/**
 * 지역별 날씨를 **서버가 미리 계산해 둔다** — `weather_region_daily`(마이그레이션 #123, 스키마 그대로).
 *
 * 날씨 클립의 자리(인덱스)는 **지역 × 날짜** 로만 갈린다. 사람마다 원천에 물을 이유가 없어서 cron 이 지역마다
 * 계산해 두고 `GET /tts/prerender-variant` 는 DB 한 번 읽기로 답한다. 원천은 나라별 공식 예보다(기상청·気象庁·
 * NWS — `lib/weather-source.ts`). 규칙 전문은 `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 *
 * - **cron**(`refreshWeatherRegionDaily`, 5분 틱): 지역마다 **현지 시각의 슬롯**에서만 일한다 — 저녁 21:00~21:59
 *   (내일~+3을 계산), 아침 06:00~06:59(오늘~+3). 슬롯 밖이면 DB 도 네트워크도 부르지 않는다(시간대 계산만으로
 *   안다). 슬롯이 열린 지역 가운데 [내일, +3] 의 어느 날짜에 `computed_at ≥ 슬롯 시작` 인 행이 없으면 due 다.
 *   한 틱은 SELECT 1 + fetch 최대 10(원천별 KMA 3·JMA 8·NWS 4, 원천을 번갈아, 동시 4) + `db.batch` 1 = 최대 12
 *   subrequest 다. 실패한 지역은 같은 슬롯의 다음 틱이 다시 하고, 슬롯 마지막 틱(현지 분 ≥ 55)에 판정해
 *   (나라, 시간대 묶음)에서 한 곳도 못 했거나 설정 실패가 있으면 경보를 올린다 — 그 틱이 예산 소진으로 멈췄어도.
 * - **읽기**(`resolveRegionVariantIndex`): 행이 36시간 안에 계산한 것이면 그대로. 아니면 대상 날짜가 지역의
 *   [오늘, +3] 안일 때만 원천을 **한 번** 부르고(밖이면 네트워크 없이 null, 호출 전체의 마감 5초), 계산되면 적고
 *   돌려준다. ⚠ 표가 없으면(배포 → 마이그레이션 창) 저장 없이 계산만 한다.
 */
import { WeatherRegions, type WeatherCountryCode, type WeatherRegion } from '@alarmtalk/shared';
import type { InStatement } from '@libsql/client';
import { inPlaceholders } from './caller-ids';
import { logStructured } from './logger';
import type { DbExecutor } from './transactions';
import { isSubrequestLimitError, WEATHER_SOURCE_CACHE_TTL_SECONDS, type WeatherSourceKind } from './weather-fetch';
import { resolvePrerenderWeatherIndex, TARGET_DATE_RE, type WeatherSignalInput } from './weather-signal';
import {
  addDaysToDate,
  fetchRegionSourceDays,
  finalizeSourceDay,
  fixedFetchBudget,
  zonedParts,
  zonedTimeToUtc,
  type FetchBudget,
  type SourceFailureKind,
  type SourceOutcome,
  type StoredExtremes,
} from './weather-source';

const HOUR_MS = 60 * 60 * 1000;

/**
 * 읽기 경로가 믿는 행의 나이. 슬롯 두 번(저녁·아침)이 연달아 실패해도 버티게 36시간 — 저녁 슬롯에 계산한
 * 내일 행은 다음 날 아침 슬롯·저녁 슬롯이 다 실패해도 그다음 아침까지 읽힌다.
 */
export const WEATHER_REGION_READ_STALE_MS = 36 * HOUR_MS;
/** 지역의 오늘부터 며칠 뒤까지 계산하나(오늘 ~ +3 = 4일). 원천 셋 모두 이 범위를 시간 단위로 덮는다. */
export const WEATHER_REGION_HORIZON_DAYS = 3;
/** 슬롯 — 현지 시각의 그 시간(00~59분) 동안 열린다. */
export const WEATHER_SLOT_HOURS = { evening: 21, morning: 6 } as const;
/** 이 분 이후의 틱이 그 슬롯의 마지막 틱이다(5분 틱이라 55분). 판정·경보는 여기서만 한다. */
export const WEATHER_SLOT_LAST_TICK_MINUTE = 55;
/** 한 틱이 원천에 보내는 fetch 상한. */
export const WEATHER_TICK_FETCH_BUDGET = 10;
/**
 * 원천별 한 틱 상한 — 큰 응답의 파싱 수도 이것으로 묶는다(KMA 141KB·1.3초, JMA 2~6KB, NWS 원본 248KB).
 * 시간당 용량은 10 × 12틱 = 120 이다. 가장 붐비는 겨울 12:00 UTC(KR 저녁 17 + JP 저녁 47 + 미 중부 아침 22 = 86)
 * 에도 재시도 여유가 34 남는다.
 */
export const WEATHER_SOURCE_FETCH_CAPS: Readonly<Record<WeatherSourceKind, number>> = { kma: 3, jma: 8, nws: 4 };
export const WEATHER_FETCH_CONCURRENCY = 4;
/** 즉석 계산 한 번의 fetch 상한 — KMA 의 '한 회차 물러서기'까지. */
export const WEATHER_READ_FETCH_BUDGET = 2;
/**
 * 즉석 계산 한 번의 **원천 호출 전체** 마감 — fetch 가 둘이어도(KMA 물러서기·다음 페이지) 합쳐서 이 안이다.
 * 앱이 저장에서 8초만 기다리므로(`WEATHER_RESOLVE_TIMEOUT_MILLIS` · `WeatherVariantSaveLookup.timeoutSeconds`)
 * DB 읽기·쓰기와 왕복을 남기고 5초다. fetch 마다 5초를 새로 주면 늦은 NODATA 하나로 10초가 되어 앱이 서버가 아직
 * 계산 중인 답을 버린다(코덱스 #846).
 */
export const WEATHER_READ_DEADLINE_MS = 5_000;

export type WeatherSlotKind = keyof typeof WEATHER_SLOT_HOURS;

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

/** 숫자 칸 하나 — '재지 않음'(NaN) 은 NULL 로 적는다. SQLite 는 NaN 을 담지 못한다. */
function sqlNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function upsertStatement(
  regionKey: string,
  targetDate: string,
  input: WeatherSignalInput,
  variantIndex: number,
  computedAt: string,
): InStatement {
  return {
    sql: UPSERT_SQL,
    args: [
      regionKey,
      targetDate,
      variantIndex,
      input.code,
      input.maxTemp,
      input.minTemp,
      input.rainProbability,
      sqlNumber(input.precipitation),
      // 먼지는 끈다 — 원천을 쓰지 않으므로 '재지 않음'(NULL)이다. 'ok' 로 적지 않는다.
      null,
      computedAt,
    ],
  };
}

function isMissingTableError(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).toLowerCase().includes('no such table');
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── 읽기 경로(GET /tts/prerender-variant) ─────────────────────────────────────────────────

/**
 * 목록 지역의 그 날짜 클립 자리. 못 구하면 **null**(미해결 — 클라가 다시 받는다).
 *
 * `rawTargetDate` 는 달력 날짜(YYYY-MM-DD)이고 **지역 시간대의 달력**으로 읽는다. 없거나 모양이 틀리면
 * 지역의 오늘. `openDb` 는 DB 가 필요할 때만 부른다 — 여는 것 자체가 실패해도 계산은 한다.
 */
export async function resolveRegionVariantIndex(
  openDb: () => DbExecutor,
  region: WeatherRegion,
  rawTargetDate: unknown,
  options: { now?: Date; kmaServiceKey?: string } = {},
): Promise<number | null> {
  const now = options.now ?? new Date();
  const today = WeatherRegions.localDate(region, now);
  const targetDate =
    typeof rawTargetDate === 'string' && TARGET_DATE_RE.test(rawTargetDate) ? rawTargetDate : today;

  // 표를 못 읽으면 적지도 않는다(아래).
  let db: DbExecutor | null;
  let stored: StoredExtremes | null = null;
  try {
    db = openDb();
    const result = await db.execute({
      sql: `SELECT variant_index, computed_at, temp_min, temp_max FROM weather_region_daily
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
      stored = {
        tempMin: numberOrNull(row.temp_min),
        tempMax: numberOrNull(row.temp_max),
        computedAt: row.computed_at == null ? null : String(row.computed_at),
      };
    }
  } catch (err) {
    // 표가 아직 없거나(배포 → 마이그레이션 창) DB 가 잠깐 안 된다 — 저장하지 않고 계산만 한다.
    // ⚠ 지역 키는 남기지 않는다(`weather.fetch` 로그와 같은 규칙).
    logStructured('warn', {
      at: 'weather.region_daily',
      op: 'read',
      missingTable: isMissingTableError(err),
      error: errorName(err),
    });
    db = null;
  }

  // ⚠ **지평 가드** — [오늘, +3] 밖이면 원천을 부르지 않는다. 원천 셋 모두 그 밖을 시간 단위로 주지 않고,
  //   아무 날짜나 물어 쿼터를 태우는 요청을 막는다.
  if (targetDate < today || targetDate > addDaysToDate(today, WEATHER_REGION_HORIZON_DAYS)) return null;

  const outcome = await fetchRegionSourceDays(region, {
    now,
    budget: fixedFetchBudget(WEATHER_READ_FETCH_BUDGET),
    kmaServiceKey: options.kmaServiceKey,
    // JMA·NWS 의 즉석 계산만 엣지 캐시를 건다 — KMA 는 200 본문에 NODATA 가 올 수 있고 URL 에 키가 있다.
    cacheTtlSeconds: region.source.kind === 'kma' ? null : WEATHER_SOURCE_CACHE_TTL_SECONDS,
    // ⚠ 마감은 실제 시계로 잰다 — `now` 는 회차·날짜를 고르는 논리 시각이다(테스트가 바꿔 넣는다).
    deadlineAt: Date.now() + WEATHER_READ_DEADLINE_MS,
  });
  if (!outcome.ok) {
    logStructured('warn', {
      at: 'weather.region_daily',
      op: 'compute',
      source: region.source.kind,
      failure: outcome.failure,
      reason: outcome.reason,
    });
    return null;
  }
  const input = finalizeSourceDay(outcome.days.get(targetDate), {
    isToday: targetDate === today,
    stored,
    now,
    source: region.source.kind,
  });
  if (!input) return null;
  const variantIndex = resolvePrerenderWeatherIndex(input);

  if (db && isStorableDate(today, targetDate)) {
    try {
      await db.execute(upsertStatement(region.key, targetDate, input, variantIndex, now.toISOString()));
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

/** 저장할 만한 날짜인가 — 지역의 어제 ~ +3. 그 밖은 표에 남기지 않는다. */
function isStorableDate(today: string, targetDate: string): boolean {
  return targetDate >= addDaysToDate(today, -1) && targetDate <= addDaysToDate(today, WEATHER_REGION_HORIZON_DAYS);
}

// ── cron(미리 계산) ───────────────────────────────────────────────────────────────────────

export type OpenWeatherSlot = {
  region: WeatherRegion;
  slot: WeatherSlotKind;
  /** 슬롯이 열린 순간(현지 21:00 또는 06:00). 이보다 먼저 계산한 행은 이번 슬롯의 것이 아니다. */
  slotStart: Date;
  /** 지역의 오늘(YYYY-MM-DD). */
  today: string;
  /** 계산해 적는 날짜 — 저녁: 내일~+3, 아침: 오늘~+3. */
  dates: string[];
  /**
   * due 판정 날짜 = `dates` ∩ [내일, +3]. **오늘은 뺀다** — 이어받을 값이 없어 오늘을 구조적으로 못 만드는
   * 경우(KR 0500 의 TMN, JP 오늘 최저) 무한 재시도를 막는다. 오늘은 아침 슬롯에 가져올 때 함께 쓴다.
   */
  dueDates: string[];
  /** 이 틱이 슬롯의 마지막 틱(현지 분 ≥ 55)인가. */
  lastTick: boolean;
};

/** 이 순간 그 지역의 슬롯이 열려 있으면 그 슬롯, 아니면 null. 시간대 계산만 한다. */
export function openWeatherSlot(region: WeatherRegion, now: Date): OpenWeatherSlot | null {
  const local = zonedParts(now, region.tz);
  const slot: WeatherSlotKind | null =
    local.hour === WEATHER_SLOT_HOURS.evening ? 'evening' : local.hour === WEATHER_SLOT_HOURS.morning ? 'morning' : null;
  if (!slot) return null;
  const first = slot === 'evening' ? 1 : 0;
  const dates = Array.from({ length: WEATHER_REGION_HORIZON_DAYS + 1 - first }, (_, i) =>
    addDaysToDate(local.date, first + i),
  );
  return {
    region,
    slot,
    slotStart: zonedTimeToUtc(local.date, local.hour, region.tz),
    today: local.date,
    dates,
    dueDates: dates.filter((date) => date > local.date),
    lastTick: local.minute >= WEATHER_SLOT_LAST_TICK_MINUTE,
  };
}

/** 이 틱에 슬롯이 열린 지역이 하나라도 있나 — cron 이 모듈 밖에서 먼저 묻는다(DB·네트워크 없음). */
export function hasOpenWeatherSlot(now: Date, regions: readonly WeatherRegion[] = WeatherRegions.all): boolean {
  // 5분마다 도는 자리라 시간대마다 한 번만 잰다(133곳이지만 시간대는 열몇 개다).
  const hours = new Set([...new Set(regions.map((region) => region.tz))].map((tz) => zonedParts(now, tz).hour));
  return hours.has(WEATHER_SLOT_HOURS.evening) || hours.has(WEATHER_SLOT_HOURS.morning);
}

/** 슬롯 끝 경보 한 건 — `captureCron('scheduled.weather_region_daily.slot_failed', …, 태그)` 로 나간다. */
export type WeatherSlotAlert = {
  country: WeatherCountryCode;
  slot: WeatherSlotKind;
  source: WeatherSourceKind;
  /** `missing_key`·`kma_30`·`invalid_gridpoint`·`http_503`·`timeout`·`stale_report`·`subrequest_limit`·`not_attempted` … */
  reason: string;
  /** 그 묶음에서 이번 슬롯을 마친 지역 수 / 전체. */
  done: number;
  total: number;
};

export type WeatherRegionFailure = {
  regionKey: string;
  source: WeatherSourceKind;
  failure: SourceFailureKind;
  reason: string;
};

export type WeatherRegionRefreshResult = {
  /** 슬롯이 열린 지역 수. 0 이면 DB·네트워크를 부르지 않았다. */
  open: number;
  /** 그 가운데 due 인 지역 수. */
  due: number;
  /** 원천을 부른 지역 수(부르다 실패한 것 포함). */
  attempted: number;
  /** upsert 한 (지역, 날짜) 수. */
  stored: number;
  /** 원천 실패(일시·설정). 예산 소진은 넣지 않는다. */
  failures: WeatherRegionFailure[];
  /** 예산(이 틱의 fetch 상한·워커 subrequest 한도)이 다해 남은 지역을 다음 틱에 넘겼다. */
  deferred: number;
  /**
   * 워커 subrequest 한도에 걸려 이 틱의 날씨 작업을 멈췄다(fetch 든 쓰기든 — 쓰기는 하지 않았거나 실패했다).
   * 마지막 틱이면 판정은 그래도 한다(`evaluateSlotEnds`).
   */
  budgetExhausted: boolean;
  /** 표가 아직 없어 건너뛰었다(배포 → 마이그레이션 창). */
  missingTable: boolean;
  alerts: WeatherSlotAlert[];
};

type StoredRow = StoredExtremes & { computedAtMs: number };

/**
 * 슬롯이 열린 지역들을 미리 계산한다. 슬롯 밖이면 곧바로 끝난다(DB·네트워크 없음).
 *
 * 표본이 빠진 (지역, 날짜)는 적지 않는다(반쪽 값 금지 — `finalizeSourceDay`). 원천 실패는 세 갈래다
 * (`SourceFailureKind`): 일시 실패는 다음 틱이 다시 하고, 설정 실패는 원천 전체면 그 틱에서 그 원천을 더 부르지
 * 않고 그 지역의 칸이면 그 지역만 실패로 둔다(`SourceFailureScope`), 예산 소진은 실패로 세지 않는다 — 그래도 슬롯
 * 마지막 틱이면 판정은 한다.
 */
export async function refreshWeatherRegionDaily(
  db: DbExecutor,
  now: Date,
  options: {
    /** 기본은 목록 전체. 테스트·부분 계산용. */
    regions?: readonly WeatherRegion[];
    /** 기상청 서비스 키(`kmaServiceKey(env)`). 없으면 KR 은 부르지 않는다. */
    kmaServiceKey?: string;
    /** 키 없는 KR 슬롯을 경보로 올리나(운영). 아니면(dev) info 로그만. */
    alertOnMissingKey?: boolean;
    onAlert?: (alert: WeatherSlotAlert) => void;
  } = {},
): Promise<WeatherRegionRefreshResult> {
  const result: WeatherRegionRefreshResult = {
    open: 0,
    due: 0,
    attempted: 0,
    stored: 0,
    failures: [],
    deferred: 0,
    budgetExhausted: false,
    missingTable: false,
    alerts: [],
  };
  const slots = (options.regions ?? WeatherRegions.all)
    .map((region) => openWeatherSlot(region, now))
    .filter((slot): slot is OpenWeatherSlot => slot !== null);
  result.open = slots.length;
  if (slots.length === 0) return result;

  // 1) SELECT 1회 — 열린 지역들의 행. 이어받기용 극값과 계산 시각을 함께 읽는다.
  const keys = slots.map((s) => s.region.key);
  const earliest = slots.map((s) => s.today).sort()[0]!;
  const latest = slots.map((s) => addDaysToDate(s.today, WEATHER_REGION_HORIZON_DAYS)).sort().at(-1)!;
  const stored = new Map<string, StoredRow>();
  try {
    const rows = await db.execute({
      sql: `SELECT region_key, target_date, temp_min, temp_max, computed_at FROM weather_region_daily
            WHERE region_key IN (${inPlaceholders(keys)}) AND target_date >= ? AND target_date <= ?`,
      args: [...keys, earliest, latest],
    });
    for (const row of rows.rows) {
      const computedAt = row.computed_at == null ? null : String(row.computed_at);
      stored.set(`${String(row.region_key)}|${String(row.target_date)}`, {
        tempMin: numberOrNull(row.temp_min),
        tempMax: numberOrNull(row.temp_max),
        computedAt,
        computedAtMs: computedAt ? Date.parse(computedAt) : Number.NaN,
      });
    }
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    // 마이그레이션 전이다 — 다음 틱에 다시 온다. 경보 대상이 아니다.
    logStructured('info', { at: 'scheduled.weather_region_daily', missingTable: true });
    result.missingTable = true;
    return result;
  }

  const freshFor = (slot: OpenWeatherSlot, date: string) => {
    const row = stored.get(`${slot.region.key}|${date}`);
    return row !== undefined && Number.isFinite(row.computedAtMs) && row.computedAtMs >= slot.slotStart.getTime();
  };
  const written = new Set<string>();
  const isDone = (slot: OpenWeatherSlot) =>
    slot.dueDates.every((date) => freshFor(slot, date) || written.has(`${slot.region.key}|${date}`));

  const due = slots.filter((slot) => !isDone(slot));
  result.due = due.length;
  const kmaKey = options.kmaServiceKey?.trim() || undefined;
  // 키가 없으면 KR 은 부르지 않는다(경보는 슬롯 끝에서).
  const runnable = due.filter((slot) => slot.region.source.kind !== 'kma' || kmaKey);

  // 2) fetch — 원천을 번갈아, 원천별 상한·틱 상한 안에서, 동시 4.
  const tasks = interleaveBySource(runnable);
  const budget = tickBudget();
  const disabled = new Set<WeatherSourceKind>();
  const computedAt = now.toISOString();
  const statements: InStatement[] = [];
  const failedReasons = new Map<string, WeatherRegionFailure>();
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const slot = tasks[next++]!;
      const source = slot.region.source.kind;
      // ⚠ 첫 fetch 몫은 **시작할 때 곧바로** 잡아 둔다 — 동시 4 라, 어댑터가 실제로 부를 때 세면 그 사이에 시작한
      //   다른 지역이 같은 몫을 보고 들어와 상한을 넘긴 채 시작했다가 '예산 없음' 으로 버려진다.
      if (result.budgetExhausted || disabled.has(source) || !budget.take(source)) {
        result.deferred += 1;
        continue;
      }
      result.attempted += 1;
      let reserved = true;
      const outcome: SourceOutcome = await fetchRegionSourceDays(slot.region, {
        now,
        budget: {
          take(kind) {
            if (reserved) {
              reserved = false;
              return true;
            }
            return budget.take(kind);
          },
        },
        kmaServiceKey: kmaKey,
        cacheTtlSeconds: null,
      });
      if (!outcome.ok) {
        if (outcome.failure === 'budget') {
          // 실패로 세지 않는다. 워커 한도면 이 틱의 날씨 작업을 멈춘다.
          result.deferred += 1;
          if (outcome.reason === 'subrequest_limit') result.budgetExhausted = true;
          continue;
        }
        // 원천 전체의 설정 실패만 원천을 끈다. 그 지역의 칸이 틀린 것(격자·office 404)으로 끄면 틱마다 같은 자리에서
        // 다시 걸려 그 뒤의 지역이 슬롯 내내 계산되지 않는다 — 그 지역만 실패로 둔다(경보는 슬롯 끝에서 같이 오른다).
        if (outcome.failure === 'config' && outcome.scope === 'source') disabled.add(source);
        const failure = { regionKey: slot.region.key, source, failure: outcome.failure, reason: outcome.reason };
        result.failures.push(failure);
        failedReasons.set(slot.region.key, failure);
        continue;
      }
      for (const date of slot.dates) {
        const key = `${slot.region.key}|${date}`;
        const input = finalizeSourceDay(outcome.days.get(date), {
          isToday: date === slot.today,
          stored: stored.get(key),
          now,
          source,
        });
        if (!input) continue;
        statements.push(upsertStatement(slot.region.key, date, input, resolvePrerenderWeatherIndex(input), computedAt));
        written.add(key);
      }
      if (!isDone(slot)) {
        // 원천은 받았는데 [내일, +3] 가운데 못 만든 날짜가 있다 — 다음 틱이 다시 한다.
        logStructured('warn', {
          at: 'scheduled.weather_region_daily',
          op: 'unresolved_dates',
          source,
          missing: slot.dueDates.filter((d) => !written.has(`${slot.region.key}|${d}`)).length,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WEATHER_FETCH_CONCURRENCY, tasks.length) }, worker));

  // 3) db.batch 1회 — upsert + 지난 행 정리(UTC 오늘 − 3일 이전). 워커 한도에 걸렸으면 쓰기도 실패하므로 부르지
  //    않는다. 쓰기에서 처음 걸려도 같은 예산 소진이다(실패로 세지 않는다 — 다음 틱이 이어 한다).
  if (!result.budgetExhausted && statements.length > 0) {
    try {
      await db.batch([
        { sql: 'DELETE FROM weather_region_daily WHERE target_date < ?', args: [addDaysToDate(computedAt.slice(0, 10), -3)] },
        ...statements,
      ]);
      result.stored = statements.length;
    } catch (err) {
      if (!isSubrequestLimitError(err)) throw err;
      result.budgetExhausted = true;
    }
  }
  if (result.budgetExhausted) {
    // 받은 것은 버린다(새 발표라 다음 틱에도 같다). 적지 않았으니 '이번 틱에 마친 것' 으로도 세지 않는다 — 아래
    // 판정은 DB 에 이미 있는 행만 본다.
    written.clear();
    logStructured('warn', { at: 'scheduled.weather_region_daily', budgetExhausted: true, attempted: result.attempted });
  }

  // 4) 슬롯 마지막 틱의 판정 — (나라, 시간대 묶음)마다. ⚠ 예산이 다해 멈춘 틱에도 한다: 마지막 틱 뒤에는 슬롯이
  //    닫혀 다른 틱이 없으므로, 여기서 빠지면 그 슬롯은 아무 신호 없이 지나간다(코덱스 #846).
  evaluateSlotEnds(slots, {
    isDone,
    failedReasons,
    kmaKey,
    result,
    options,
    unrecordedReason: result.budgetExhausted ? 'subrequest_limit' : 'not_attempted',
  });
  return result;
}

/** 이 틱의 fetch 예산 — 틱 상한(10)과 원천별 상한을 함께 센다. */
function tickBudget(): FetchBudget {
  let total = WEATHER_TICK_FETCH_BUDGET;
  const left: Record<WeatherSourceKind, number> = { ...WEATHER_SOURCE_FETCH_CAPS };
  return {
    take(source) {
      if (total <= 0 || left[source] <= 0) return false;
      total -= 1;
      left[source] -= 1;
      return true;
    },
  };
}

/**
 * 원천을 번갈아 세운다(KMA → JMA → NWS → KMA …). 원천 안에서는 **마지막 틱인 지역이 먼저**, 그다음 목록 순서 —
 * 슬롯이 닫히기 전에 판정 대상부터 시도한다.
 */
function interleaveBySource(slots: readonly OpenWeatherSlot[]): OpenWeatherSlot[] {
  const queues: Record<WeatherSourceKind, OpenWeatherSlot[]> = { kma: [], jma: [], nws: [] };
  for (const slot of slots) queues[slot.region.source.kind].push(slot);
  for (const queue of Object.values(queues)) {
    queue.sort((a, b) => Number(b.lastTick) - Number(a.lastTick));
  }
  const out: OpenWeatherSlot[] = [];
  const order: WeatherSourceKind[] = ['kma', 'jma', 'nws'];
  for (let i = 0; out.length < slots.length; i += 1) {
    for (const source of order) {
      const slot = queues[source][i];
      if (slot) out.push(slot);
    }
  }
  return out;
}

function evaluateSlotEnds(
  slots: readonly OpenWeatherSlot[],
  context: {
    isDone: (slot: OpenWeatherSlot) => boolean;
    failedReasons: ReadonlyMap<string, WeatherRegionFailure>;
    kmaKey: string | undefined;
    result: WeatherRegionRefreshResult;
    options: { alertOnMissingKey?: boolean; onAlert?: (alert: WeatherSlotAlert) => void };
    /** 못 마쳤는데 실패가 적히지 않은 묶음의 사유 — 워커 한도로 멈춘 틱이면 `subrequest_limit`. */
    unrecordedReason: string;
  },
): void {
  const groups = new Map<string, OpenWeatherSlot[]>();
  for (const slot of slots) {
    if (!slot.lastTick) continue;
    const key = `${slot.region.country}|${slot.slot}|${slot.slotStart.toISOString()}`;
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    const source = first.region.source.kind;
    const done = group.filter(context.isDone).length;
    const failures = group
      .map((slot) => context.failedReasons.get(slot.region.key))
      .filter((f): f is WeatherRegionFailure => f !== undefined);
    const configFailure = failures.find((f) => f.failure === 'config');
    const missingKey = source === 'kma' && !context.kmaKey && done < group.length;
    if (done === group.length && !configFailure) continue;
    const reason = missingKey
      ? 'missing_key'
      : (configFailure?.reason ?? failures.at(-1)?.reason ?? context.unrecordedReason);
    const alert: WeatherSlotAlert = {
      country: first.region.country,
      slot: first.slot,
      source,
      reason,
      done,
      total: group.length,
    };
    if (missingKey && !context.options.alertOnMissingKey) {
      logStructured('info', { at: 'scheduled.weather_region_daily', op: 'slot_skipped', ...alert });
      continue;
    }
    if (done === 0 || configFailure || missingKey) {
      context.result.alerts.push(alert);
      context.options.onAlert?.(alert);
    } else {
      // 일부만 실패 — 경보가 아니라 warn 한 줄(다음 슬롯·읽기 경로의 즉석 계산이 메운다).
      logStructured('warn', { at: 'scheduled.weather_region_daily', op: 'slot_partial', ...alert });
    }
  }
}
