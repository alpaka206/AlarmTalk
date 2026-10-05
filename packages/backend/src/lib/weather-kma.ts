/**
 * 기상청 단기예보(KR) 어댑터 — 격자 하나의 `getVilageFcst` 응답 → 날짜별 표본(`SourceDay`).
 *
 * 출처: 공공데이터포털 「기상청_단기예보 ((구)_동네예보) 조회서비스」(data.go.kr 15084084) 의 원 주소
 * `apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst` 와 활용가이드(2026-09). ⚠ 가이드 2609판의
 * 예제는 기상청 API허브(`apihub.kma.go.kr`, `authKey`) 주소다 — 그건 별도 회원 키라 data.go.kr 키로는 이 주소를 쓴다.
 *
 * 2026-10-01 실측(서울 60,127, 실제 키): `numOfRows=1500` 한 페이지로 다 온다(1700 회차 1,052건 141KB,
 * 0500 907건, 0200 944건). 날짜별 범위와 극값은 회차마다 다르다:
 *
 * | 발표 | 오늘 | 내일·모레 | 이후 |
 * | --- | --- | --- | --- |
 * | 1700·2000 | 남은 시각만, TMX·TMN 없음 | 24시간 + TMX·TMN | 마지막 날은 3시간 간격 8칸(TMX·TMN 있음) |
 * | 0500 | 06~23시, TMX 있음·**TMN 없음** | 24시간 | 3시간 간격 8칸 |
 * | 0200 | 03~23시, TMX·TMN 둘 다 | | |
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 */
import type { WeatherRegion, WeatherSource } from '@alarmtalk/shared';
import { logStructured } from './logger';
import { fetchWeatherSource, logWeatherFetch } from './weather-fetch';
import { WEATHER_PROXY_CODE } from './weather-signal';
import {
  httpFailure,
  MIXED_PRECIPITATION_IS_SNOW,
  WeatherSourceError,
  zonedParts,
  type SourceDay,
  type SourceFetchOptions,
} from './weather-source';

type KmaSource = Extract<WeatherSource, { kind: 'kma' }>;

export const KMA_VILAGE_FCST_URL =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
/** 한 페이지 행 수. 격자 하나가 1,052건(1700 회차)이라 1000 이면 잘린다 — 넉넉히 1500. */
export const KMA_NUM_OF_ROWS = 1500;
/** 발표 시각(KST) — 가이드 「Base_time : 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300 (1일 8회)」. */
const KMA_RUN_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
/** 가이드 「API 제공 시간(~이후) : 02:10, 05:10, …」 — 발표 10분 뒤부터 받을 수 있다. */
const KMA_AVAILABLE_AFTER_MS = 10 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 결과 코드 — 다시 해도 소용없는 것(설정 실패). 10~12 는 요청 모양이 틀린 것(우리 코드의 잘못)이다. */
const KMA_CONFIG_RESULT_CODES = new Set(['10', '11', '12', '20', '21', '22', '30', '31', '32', '33']);
/** 결과 코드 — `NODATA_ERROR`. 발표 직후 아직 안 올라온 것이라 한 회차 물러선다. */
export const KMA_NODATA_REASON = 'kma_03';

export type KmaRun = { baseDate: string; baseTime: string };

function runAt(kstMs: number, hour: number): KmaRun {
  const d = new Date(kstMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { baseDate: `${y}${m}${day}`, baseTime: `${String(hour).padStart(2, '0')}00` };
}

/** '지금 − 10분' 이전의 가장 최근 회차. 00:00~02:09 KST 면 전날 2300. */
export function latestKmaRun(now: Date): KmaRun {
  const kst = now.getTime() + KST_OFFSET_MS - KMA_AVAILABLE_AFTER_MS;
  const hour = new Date(kst).getUTCHours();
  const run = [...KMA_RUN_HOURS].reverse().find((h) => h <= hour);
  if (run !== undefined) return runAt(kst, run);
  return runAt(kst - 24 * 60 * 60 * 1000, 23);
}

/** 한 회차 앞(3시간 전). NODATA(03) 를 받았을 때 한 번만 쓴다. */
export function previousKmaRun(run: KmaRun): KmaRun {
  const y = Number(run.baseDate.slice(0, 4));
  const m = Number(run.baseDate.slice(4, 6));
  const d = Number(run.baseDate.slice(6, 8));
  const h = Number(run.baseTime.slice(0, 2));
  const runUtcMs = Date.UTC(y, m - 1, d, h, 0) - KST_OFFSET_MS;
  // 그 회차 바로 앞 순간을 '지금' 으로 보고(10분 지연 없이) 최신 회차를 고른다.
  const kst = runUtcMs - 60 * 1000 + KST_OFFSET_MS;
  const hour = new Date(kst).getUTCHours();
  const prev = [...KMA_RUN_HOURS].reverse().find((hh) => hh <= hour);
  return prev !== undefined ? runAt(kst, prev) : runAt(kst - 24 * 60 * 60 * 1000, 23);
}

/**
 * 요청 URL. ⚠ **이 URL 은 서비스 키를 담는다** — 로그·오류 메시지에 싣지 말 것.
 * 키는 **일반 인증키(Decoding)** 를 받아 `URLSearchParams` 로 정확히 한 번 인코딩한다(`holidays-kasi.ts` 와 같은
 * 규약 — Encoding 키를 넣으면 이중 인코딩되어 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`).
 */
export function kmaRequestUrl(source: KmaSource, run: KmaRun, serviceKey: string, pageNo = 1): URL {
  const url = new URL(KMA_VILAGE_FCST_URL);
  url.search = new URLSearchParams({
    serviceKey,
    numOfRows: String(KMA_NUM_OF_ROWS),
    pageNo: String(pageNo),
    dataType: 'JSON',
    base_date: run.baseDate,
    base_time: run.baseTime,
    nx: String(source.nx),
    ny: String(source.ny),
  }).toString();
  return url;
}

export type KmaItem = {
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: unknown;
  baseDate?: unknown;
  baseTime?: unknown;
  nx?: unknown;
  ny?: unknown;
};

export type KmaPage = {
  resultCode: string;
  items: KmaItem[];
  totalCount: number;
  /** 서버가 실제로 쓴 페이지 크기(`body.numOfRows`). 요청보다 작게 자를 수 있어 다음 페이지 번호를 이것으로 센다. */
  pageSize: number;
};

/**
 * 응답 하나를 읽는다. 정상(`00`)이면 행과 `totalCount`, 아니면 `WeatherSourceError` 를 던진다.
 *
 * 봉투는 둘이다: 정상 경로의 `response.header.resultCode`, 그리고 게이트웨이 오류의
 * `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode`(XML 로 올 때가 많다 — `dataType=JSON` 이어도).
 */
export function readKmaPage(status: number, body: string): KmaPage {
  const code = kmaEnvelopeCode(body);
  if (status < 200 || status >= 300) {
    // 401/403 은 키 문제 — 봉투와 무관하게 설정 실패다.
    if (status === 401 || status === 403) throw new WeatherSourceError('config', `http_${status}`);
    if (code) throw kmaCodeError(code);
    throw httpFailure(status)!;
  }
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<')) {
    if (code && code !== '00' && code !== '0') throw kmaCodeError(code);
    throw new WeatherSourceError('transient', 'kma_unparsable');
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new WeatherSourceError('transient', 'kma_unparsable');
  }
  const gateway = (json as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: { returnReasonCode?: unknown } } })
    ?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) throw kmaCodeError(String(gateway.returnReasonCode ?? '99'));
  const response = (json as { response?: { header?: { resultCode?: unknown }; body?: unknown } })?.response;
  const resultCode = String(response?.header?.resultCode ?? '');
  if (resultCode !== '00' && resultCode !== '0') throw kmaCodeError(resultCode || '99');
  const bodyObj = (response?.body ?? {}) as {
    totalCount?: unknown;
    numOfRows?: unknown;
    items?: { item?: unknown } | string;
  };
  const totalCount = Number(bodyObj.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new WeatherSourceError('transient', 'kma_unparsable');
  }
  const raw = typeof bodyObj.items === 'object' && bodyObj.items !== null ? bodyObj.items.item : undefined;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const items: KmaItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.category !== 'string' || typeof e.fcstDate !== 'string' || typeof e.fcstTime !== 'string') {
      continue;
    }
    items.push(e as KmaItem);
  }
  const pageSize = Number(bodyObj.numOfRows);
  return {
    resultCode,
    items,
    totalCount,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : KMA_NUM_OF_ROWS,
  };
}

/** 봉투에서 결과 코드를 꺼낸다(JSON 이든 XML 이든). 없으면 null. */
function kmaEnvelopeCode(body: string): string | null {
  const xml = /<(?:returnReasonCode|resultCode)>\s*(\d+)\s*<\//.exec(body);
  if (xml) return xml[1]!;
  const json = /"(?:returnReasonCode|resultCode)"\s*:\s*"?(\d+)"?/.exec(body);
  return json ? json[1]! : null;
}

function kmaCodeError(code: string): WeatherSourceError {
  const normalized = code.padStart(2, '0');
  return new WeatherSourceError(
    KMA_CONFIG_RESULT_CODES.has(normalized) ? 'config' : 'transient',
    `kma_${normalized}`,
  );
}

// ── 값 파싱 ───────────────────────────────────────────────────────────────────────────────

/** 가이드 「Missing 값」 — ±900 이상은 결측이다. */
function isMissingSentinel(value: number): boolean {
  return Math.abs(value) >= 900;
}

/** 숫자 칸(TMP·TMX·TMN·POP·SKY·PTY). 숫자가 아니거나 결측이면 null. */
function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && !isMissingSentinel(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && !isMissingSentinel(n) ? n : null;
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const PRECIP_EXACT_RE = new RegExp(String.raw`^${NUMBER}\s*(?:mm|cm)$`);
const PRECIP_BELOW_RE = new RegExp(String.raw`^${NUMBER}\s*(?:mm|cm)\s*미만$`);
const PRECIP_RANGE_RE = new RegExp(String.raw`^${NUMBER}\s*~\s*${NUMBER}\s*(?:mm|cm)$`);
const PRECIP_ABOVE_RE = new RegExp(String.raw`^${NUMBER}\s*(?:mm|cm)\s*이상$`);
const BARE_NUMBER_RE = new RegExp(String.raw`^${NUMBER}$`);

/**
 * PCP(1시간 강수량)·SNO(1시간 신적설) 칸 → 양(mm·cm). **못 읽으면 null**(그 날짜는 미해결).
 *
 * 2026-10-01 실측으로 값의 모양이 섞여 있다 — 정상 기간은 '강수없음'/'적설없음', 1700 발표의 D+3 시간 단위 칸은
 * 맨숫자 '0', D+4(3시간 간격·정성정보) 칸은 '0.4'·'2' 같은 맨숫자. 그래서 **날짜로 가르지 않고 값의 모양으로**
 * 읽는다:
 *  - '강수없음'·'적설없음'·'-'·'0'·빈 값 → 0
 *  - '1mm 미만'·'0.5cm 미만' → 그 경계의 절반(0 보다 크다는 것만 의미가 있다)
 *  - '6.2mm'·'1.0cm' → 그 수
 *  - '30.0~50.0mm' → 아래 경계(30), '50.0mm 이상' → 50
 *  - 맨숫자(정성코드 1/2/3 이거나 '0.4' 같은 값) → 그 수 — 분류는 0 보다 큰지만 본다
 *  - 그 밖의 글자 → null
 */
export function parseKmaPrecipAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && !isMissingSentinel(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '-' || text === '강수없음' || text === '적설없음') return 0;
  let m = PRECIP_EXACT_RE.exec(text);
  if (m) return Number(m[1]);
  m = PRECIP_BELOW_RE.exec(text);
  if (m) return Number(m[1]) / 2;
  m = PRECIP_RANGE_RE.exec(text);
  if (m) return Number(m[1]);
  m = PRECIP_ABOVE_RE.exec(text);
  if (m) return Number(m[1]);
  m = BARE_NUMBER_RE.exec(text);
  if (m) {
    const n = Number(m[1]);
    return isMissingSentinel(n) ? null : n;
  }
  return null;
}

// ── 날짜별 집계 ───────────────────────────────────────────────────────────────────────────

/** 시각마다 하나씩 오는 범주. 날짜 D 의 칸이 이 다섯 다 같은 시각에 있어야 한다. */
const KMA_SLOT_CATEGORIES = ['SKY', 'PTY', 'POP', 'PCP', 'SNO'] as const;
const HOURLY_DAY = Array.from({ length: 24 }, (_, h) => h);
const THREE_HOURLY_DAY = Array.from({ length: 8 }, (_, i) => i * 3);

function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 칸 시각이 날짜의 모양에 맞는가 — 24칸, 3시간 간격 8칸, 또는 (오늘이면) 첫 칸부터 23시까지 1시간 간격. */
function hasExpectedShape(hours: readonly number[], isToday: boolean): boolean {
  const same = (expected: readonly number[]) =>
    hours.length === expected.length && hours.every((h, i) => h === expected[i]);
  if (same(HOURLY_DAY) || same(THREE_HOURLY_DAY)) return true;
  if (!isToday || hours.length === 0) return false;
  const first = hours[0]!;
  return same(Array.from({ length: 24 - first }, (_, i) => first + i));
}

function warnValue(category: string, value: unknown): void {
  logStructured('warn', {
    at: 'weather.kma_value',
    category,
    // 날씨 글자일 뿐이지만 길이는 묶어 둔다.
    value: typeof value === 'string' ? value.slice(0, 20) : typeof value,
  });
}

/**
 * 한 격자의 행들 → 날짜(지역 달력, `YYYY-MM-DD`)별 표본. 칸이 모자라거나 못 읽는 값이 있는 날짜는 **빼 둔다**
 * (그 날짜는 미해결). `today` 는 지역의 오늘(`YYYY-MM-DD`) — 오늘이면 남은 칸만 본다.
 *
 * - 눈(71): PTY 3(눈)·7(눈날림) 또는 SNO > 0. PTY 2(비/눈)·6(빗방울눈날림)은 결정 D1(`MIXED_PRECIPITATION_IS_SNOW`).
 * - 비(61): PTY 1(비)·4(소나기)·5(빗방울).
 * - 흐림(3): 06~18시 칸 가운데 절반 이상이 SKY ≥ 3(구름많음·흐림). 오늘 그 칸이 다 지났으면 남은 칸으로 본다.
 * - 강수확률 = POP 최댓값, 강수량 = PCP 합(진단용 근사값 — 분류는 0 보다 큰지만 본다).
 * - 최고·최저 = TMX(15시)·TMN(06시). 없으면 TMP 가 **24시간 다 있을 때만** 그 최대·최소. 그것도 없으면 null
 *   (오늘이면 공통 규칙의 이어받기, 아니면 미해결 — `finalizeSourceDay`).
 * - 안개 요소는 없다 — KR 에서는 안개 클립(5)이 나오지 않는다.
 */
export function kmaDaysFromItems(items: readonly KmaItem[], today: string): Map<string, SourceDay> {
  const byDate = new Map<string, Map<string, Map<number, unknown>>>();
  for (const item of items) {
    if (!/^\d{8}$/.test(item.fcstDate) || !/^\d{4}$/.test(item.fcstTime)) continue;
    const date = isoDate(item.fcstDate);
    const hour = Number(item.fcstTime.slice(0, 2));
    let categories = byDate.get(date);
    if (!categories) byDate.set(date, (categories = new Map()));
    let slots = categories.get(item.category);
    if (!slots) categories.set(item.category, (slots = new Map()));
    slots.set(hour, item.fcstValue);
  }

  const days = new Map<string, SourceDay>();
  for (const [date, categories] of byDate) {
    if (date < today) continue;
    const isToday = date === today;
    const sky = categories.get('SKY');
    if (!sky) continue;
    const hours = [...sky.keys()].sort((a, b) => a - b);
    if (!hasExpectedShape(hours, isToday)) continue;
    const sameHours = KMA_SLOT_CATEGORIES.every((category) => {
      const slots = categories.get(category);
      return slots !== undefined && slots.size === hours.length && hours.every((h) => slots.has(h));
    });
    if (!sameHours) continue;

    let unresolved = false;
    let snow = false;
    let rain = false;
    let popMax = -1;
    let pcpSum = 0;
    let cloudySlots = 0;
    let daytimeSlots = 0;
    let cloudyAll = 0;
    for (const hour of hours) {
      const skyValue = readNumber(categories.get('SKY')!.get(hour));
      const pty = readNumber(categories.get('PTY')!.get(hour));
      const pop = readNumber(categories.get('POP')!.get(hour));
      const pcp = parseKmaPrecipAmount(categories.get('PCP')!.get(hour));
      const sno = parseKmaPrecipAmount(categories.get('SNO')!.get(hour));
      if (skyValue === null || !Number.isInteger(skyValue) || skyValue < 1 || skyValue > 4) {
        warnValue('SKY', categories.get('SKY')!.get(hour));
        unresolved = true;
        break;
      }
      if (pty === null || !Number.isInteger(pty) || pty < 0 || pty > 7) {
        warnValue('PTY', categories.get('PTY')!.get(hour));
        unresolved = true;
        break;
      }
      if (pop === null || pop < 0 || pop > 100) {
        warnValue('POP', categories.get('POP')!.get(hour));
        unresolved = true;
        break;
      }
      if (pcp === null) {
        warnValue('PCP', categories.get('PCP')!.get(hour));
        unresolved = true;
        break;
      }
      if (sno === null) {
        warnValue('SNO', categories.get('SNO')!.get(hour));
        unresolved = true;
        break;
      }
      const mixed = pty === 2 || pty === 6;
      if (pty === 3 || pty === 7 || sno > 0 || (mixed && MIXED_PRECIPITATION_IS_SNOW)) snow = true;
      if (pty === 1 || pty === 4 || pty === 5 || (mixed && !MIXED_PRECIPITATION_IS_SNOW)) rain = true;
      popMax = Math.max(popMax, pop);
      pcpSum += pcp;
      if (skyValue >= 3) cloudyAll += 1;
      if (hour >= 6 && hour <= 18) {
        daytimeSlots += 1;
        if (skyValue >= 3) cloudySlots += 1;
      }
    }
    if (unresolved) continue;
    const cloudy =
      daytimeSlots > 0 ? cloudySlots * 2 >= daytimeSlots : cloudyAll * 2 >= hours.length;
    const code = snow
      ? WEATHER_PROXY_CODE.snow
      : rain
        ? WEATHER_PROXY_CODE.rain
        : cloudy
          ? WEATHER_PROXY_CODE.cloud
          : WEATHER_PROXY_CODE.clear;

    const extreme = (category: 'TMX' | 'TMN'): number | null => {
      const slots = categories.get(category);
      if (!slots || slots.size === 0) return null;
      const values = [...slots.values()].map(readNumber);
      return values.every((v) => v !== null) ? (values as number[])[0]! : null;
    };
    let maxTemp = extreme('TMX');
    let minTemp = extreme('TMN');
    if (maxTemp === null || minTemp === null) {
      const tmp = categories.get('TMP');
      const full = tmp && tmp.size === 24 && HOURLY_DAY.every((h) => tmp.has(h));
      if (full) {
        const temps = HOURLY_DAY.map((h) => readNumber(tmp.get(h)));
        if (temps.every((v) => v !== null)) {
          maxTemp ??= Math.max(...(temps as number[]));
          minTemp ??= Math.min(...(temps as number[]));
        }
      }
    }
    days.set(date, {
      code,
      maxTemp,
      minTemp,
      rainProbability: popMax,
      precipitation: Math.round(pcpSum * 10) / 10,
    });
  }
  return days;
}

// ── 호출 ─────────────────────────────────────────────────────────────────────────────────

/**
 * 지역 하나의 단기예보를 받는다. 실패는 `WeatherSourceError` 로 던진다(`fetchRegionSourceDays` 가 받는다).
 *
 * - 키가 없으면 네트워크를 부르지 않고 `config:missing_key`.
 * - 결과 코드 03(NODATA)이면 **한 회차 물러서서 한 번 더** — 예산 안에서만, 그리고 마감(`deadlineAt`, 읽기 경로)
 *   안에서만. 마감이 지났으면 부르지 않고 타임아웃이다(`fetchWeatherSource`).
 * - `items.length` ≠ `totalCount` 면 다음 페이지를 받는다(예산·마감 안). 그래도 다르면 실패다.
 * - 엣지 캐시는 쓰지 않는다(`weather-fetch.ts` 의 `WEATHER_SOURCE_CACHE_TTL_SECONDS` 주석).
 */
export async function fetchKmaDays(
  region: WeatherRegion,
  source: KmaSource,
  options: SourceFetchOptions,
): Promise<Map<string, SourceDay>> {
  const serviceKey = options.kmaServiceKey?.trim();
  if (!serviceKey) throw new WeatherSourceError('config', 'missing_key');
  const today = zonedParts(options.now, region.tz).date;
  let run = latestKmaRun(options.now);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const items = await fetchAllPages(source, run, serviceKey, options);
      return kmaDaysFromItems(items, today);
    } catch (err) {
      if (attempt === 0 && err instanceof WeatherSourceError && err.reason === KMA_NODATA_REASON) {
        run = previousKmaRun(run);
        continue;
      }
      throw err;
    }
  }
}

async function fetchAllPages(
  source: KmaSource,
  run: KmaRun,
  serviceKey: string,
  options: SourceFetchOptions,
): Promise<KmaItem[]> {
  const first = await fetchPage(source, run, serviceKey, 1, options);
  const items = [...first.items];
  // 서버가 페이지를 요청보다 작게 자르면(`numOfRows` 상한) 그 크기로 센다.
  const pages = Math.ceil(first.totalCount / Math.max(1, Math.min(first.pageSize, first.items.length || 1)));
  for (let page = 2; items.length < first.totalCount && page <= pages; page += 1) {
    const next = await fetchPage(source, run, serviceKey, page, options);
    items.push(...next.items);
  }
  if (items.length !== first.totalCount) throw new WeatherSourceError('transient', 'kma_count_mismatch');
  // 다른 격자·다른 회차의 행이 섞여 오면 믿지 않는다.
  for (const item of items) {
    if (
      (item.nx !== undefined && Number(item.nx) !== source.nx) ||
      (item.ny !== undefined && Number(item.ny) !== source.ny) ||
      (item.baseDate !== undefined && String(item.baseDate) !== run.baseDate) ||
      (item.baseTime !== undefined && String(item.baseTime) !== run.baseTime)
    ) {
      throw new WeatherSourceError('transient', 'kma_mismatch');
    }
  }
  return items;
}

async function fetchPage(
  source: KmaSource,
  run: KmaRun,
  serviceKey: string,
  pageNo: number,
  options: SourceFetchOptions,
): Promise<KmaPage> {
  if (!options.budget.take('kma')) throw new WeatherSourceError('budget', 'fetch_budget');
  const result = await fetchWeatherSource('kma', 'vilage', kmaRequestUrl(source, run, serviceKey, pageNo), {
    cacheTtlSeconds: null,
    deadlineAt: options.deadlineAt ?? null,
  });
  try {
    const page = readKmaPage(result.status, result.body);
    logWeatherFetch('info', {
      source: 'kma',
      kind: 'vilage',
      status: result.status,
      resultCode: page.resultCode,
      ms: result.ms,
      timedOut: false,
      items: page.items.length,
    });
    return page;
  } catch (err) {
    logWeatherFetch('warn', {
      source: 'kma',
      kind: 'vilage',
      status: result.status,
      resultCode: err instanceof WeatherSourceError ? err.reason : null,
      ms: result.ms,
      timedOut: false,
      items: null,
    });
    throw err;
  }
}
