// 지역별 날씨 **서버 미리 계산** — `lib/weather-region-daily.ts`, `GET /tts/prerender-variant` 의 지역 경로.
// 규칙: `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
//
//  - cron 은 지역마다 **현지 슬롯**(21:00~21:59 저녁 → 내일~+3, 06:00~06:59 아침 → 오늘~+3)에서만 일한다.
//    슬롯 밖이면 DB·네트워크를 부르지 않는다. [내일, +3] 에 슬롯 시작 뒤의 행이 없으면 due.
//  - 한 틱은 SELECT 1 + fetch ≤ 10(KMA 3·JMA 8·NWS 4) + batch 1. 'Too many subrequests' 면 멈춘다.
//  - 슬롯 마지막 틱(현지 분 ≥ 55)에 (나라, 시간대 묶음)마다 판정해 경보를 올린다.
//  - 읽기 경로는 36시간 안의 행이면 그대로, 아니면 [오늘, +3] 안에서만 원천을 한 번 부른다.
//
// DB 는 **실제 libSQL**(:memory: + runMigrations)이다 — 마이그레이션 #123 의 DDL·upsert·DELETE 를 그대로 돌린다.
// 원천은 픽스처(2026-10-01 실측)를 요청에 맞춰 돌려주는 스텁이다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient, type Client } from '@libsql/client';
import { WeatherRegions, type WeatherRegion } from '@alarmtalk/shared';
import type { AppEnv } from '../src/types';
import type { DbExecutor } from '../src/lib/transactions';

let currentDb: Client | null = null;
vi.mock('../src/lib/db', () => ({ getDB: () => currentDb }));

import ttsRoutes from '../src/routes/tts';
import { runMigrations } from '../src/lib/migrations';
import {
  hasOpenWeatherSlot,
  openWeatherSlot,
  refreshWeatherRegionDaily,
  resolveRegionVariantIndex,
  WEATHER_READ_DEADLINE_MS,
  WEATHER_REGION_READ_STALE_MS,
  WEATHER_SOURCE_FETCH_CAPS,
  WEATHER_TICK_FETCH_BUDGET,
  type WeatherSlotAlert,
} from '../src/lib/weather-region-daily';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';

const FIX = join(__dirname, 'fixtures/weather');
const read = (path: string) => readFileSync(join(FIX, path), 'utf8');
const KMA_1700 = JSON.parse(read('kma/seoul-20261001-1700.json'));
const KMA_0500 = JSON.parse(read('kma/seoul-20261001-0500.json'));
const JMA_TOKYO = read('jma/130000-20261001-1700.json');
const NWS_NY = read('nws/us-new-york-20261001.json');
const KEY = 'test-kma-key';
const HOUR = 60 * 60 * 1000;
const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

/** 21:05 KST·JST(한국·일본 저녁 슬롯), 06:05 MDT(미 산지 아침 슬롯) — 2026-10-01. */
const EVENING = new Date('2026-10-01T12:05:00Z');
const EVENING_LAST = new Date('2026-10-01T12:55:00Z');

function region(key: string): WeatherRegion {
  const found = WeatherRegions.byKey(key);
  if (!found) throw new Error(`목록에 없는 키: ${key}`);
  return found;
}

type Host = 'kma' | 'jma' | 'nws';
const hostOf = (url: URL): Host =>
  url.hostname === 'apis.data.go.kr' ? 'kma' : url.hostname === 'www.jma.go.jp' ? 'jma' : 'nws';

/** KMA 픽스처를 요청한 격자·회차로 다시 붙인다(날짜·값은 그대로). */
function kmaBody(url: URL): string {
  const fixture = url.searchParams.get('base_time') === '0500' ? KMA_0500 : KMA_1700;
  const items = fixture.response.body.items.item.map((i: Record<string, unknown>) => ({
    ...i,
    baseDate: url.searchParams.get('base_date'),
    baseTime: url.searchParams.get('base_time'),
    nx: Number(url.searchParams.get('nx')),
    ny: Number(url.searchParams.get('ny')),
  }));
  return JSON.stringify({
    ...fixture,
    response: { ...fixture.response, body: { ...fixture.response.body, items: { item: items } } },
  });
}

/** 東京 원본을 그 office 의 구역·지점 코드로 바꿔 돌려준다(값은 東京 것 그대로). */
function jmaBody(url: URL): string {
  const office = url.pathname.split('/').pop()!.replace('.json', '');
  const r = WeatherRegions.byCountry('JP').find((x) => x.source.kind === 'jma' && x.source.office === office)!;
  if (r.source.kind !== 'jma') throw new Error('jma');
  const doc = JSON.parse(JMA_TOKYO);
  doc[0].timeSeries[0].areas[0].area.code = r.source.class10;
  doc[0].timeSeries[1].areas[0].area.code = r.source.class10;
  doc[0].timeSeries[2].areas[0].area.code = r.source.tempStation;
  doc[1].timeSeries[0].areas[0].area.code = r.source.week[0]!.area;
  doc[1].timeSeries[1].areas[0].area.code = r.source.week[0]!.tempStation;
  return JSON.stringify(doc);
}

type StubOptions = {
  fail?: Partial<Record<Host, (url: URL) => Response | Error | null>>;
};

function stubSources(options: StubOptions = {}) {
  const calls: { host: Host; url: URL; init: RequestInit & { cf?: unknown } }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const host = hostOf(url);
    calls.push({ host, url, init: (init ?? {}) as RequestInit & { cf?: unknown } });
    const failure = options.fail?.[host]?.(url) ?? null;
    if (failure instanceof Error) throw failure;
    if (failure) return failure;
    const body = host === 'kma' ? kmaBody(url) : host === 'jma' ? jmaBody(url) : NWS_NY;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  return db;
}

const asExecutor = (db: Client) => db as unknown as DbExecutor;

async function rowsOf(db: Client, key?: string) {
  const result = await db.execute({
    sql: `SELECT region_key, target_date, variant_index, weather_code, temp_max, temp_min, precip_prob, precip_sum,
                 dust_level, computed_at FROM weather_region_daily ${key ? 'WHERE region_key = ?' : ''}
          ORDER BY region_key, target_date`,
    args: key ? [key] : [],
  });
  return result.rows;
}

async function insertRow(db: Client, key: string, date: string, computedAt: string, extra: Partial<Record<string, number>> = {}) {
  await db.execute({
    sql: `INSERT INTO weather_region_daily (region_key, target_date, variant_index, weather_code, temp_max, temp_min,
            precip_prob, precip_sum, dust_level, computed_at) VALUES (?, ?, ?, 0, ?, ?, 0, 0, NULL, ?)`,
    args: [key, date, extra.variant ?? 4, extra.max ?? 25, extra.min ?? 15, computedAt],
  });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  currentDb?.close();
  currentDb = null;
});

describe('슬롯 — 현지 21:00~21:59(저녁), 06:00~06:59(아침)', () => {
  it('한국 저녁: 12:00Z 에 열려 12:59Z 까지, 내일~+3 을 계산하고 마지막 틱은 55분부터', () => {
    const seoul = region('kr-seoul');
    expect(openWeatherSlot(seoul, new Date('2026-10-01T11:59:00Z'))).toBeNull();
    const slot = openWeatherSlot(seoul, EVENING)!;
    expect(slot.slot).toBe('evening');
    expect(slot.slotStart.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(slot.today).toBe('2026-10-01');
    expect(slot.dates).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(slot.dueDates).toEqual(slot.dates);
    expect(slot.lastTick).toBe(false);
    expect(openWeatherSlot(seoul, EVENING_LAST)!.lastTick).toBe(true);
    expect(openWeatherSlot(seoul, new Date('2026-10-01T13:00:00Z'))).toBeNull();
  });

  it('아침은 오늘~+3 을 계산하지만 due 판정에서 오늘은 뺀다', () => {
    const slot = openWeatherSlot(region('jp-tokyo'), new Date('2026-09-30T21:05:00Z'))!; // 06:05 JST 10-01
    expect(slot.slot).toBe('morning');
    expect(slot.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(slot.dueDates).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('서머타임 경계 — 뉴욕 아침 06:00 은 EDT 면 10:00Z, EST 면 11:00Z. 피닉스는 늘 13:00Z', () => {
    const ny = region('us-new-york');
    // 2026-11-01 02:00 에 EST 로 돌아간다.
    expect(openWeatherSlot(ny, new Date('2026-10-31T10:05:00Z'))!.slotStart.toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(openWeatherSlot(ny, new Date('2026-11-01T10:05:00Z'))).toBeNull(); // 05:05 EST
    const after = openWeatherSlot(ny, new Date('2026-11-01T11:05:00Z'))!;
    expect(after.slotStart.toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(after.today).toBe('2026-11-01');
    // 저녁 21:00 EST 는 다음 날 02:00Z.
    expect(openWeatherSlot(ny, new Date('2026-11-02T02:30:00Z'))!.slot).toBe('evening');
    // 2026-03-08 02:00 에 EDT 로 넘어간다.
    expect(openWeatherSlot(ny, new Date('2026-03-07T11:05:00Z'))!.slotStart.toISOString()).toBe('2026-03-07T11:00:00.000Z');
    expect(openWeatherSlot(ny, new Date('2026-03-08T10:05:00Z'))!.slotStart.toISOString()).toBe('2026-03-08T10:00:00.000Z');
    expect(openWeatherSlot(region('us-phoenix'), new Date('2026-07-01T13:05:00Z'))!.slot).toBe('morning');
    expect(openWeatherSlot(region('us-phoenix'), new Date('2026-12-01T13:05:00Z'))!.slot).toBe('morning');
  });

  it('슬롯이 열린 지역이 없으면 DB 도 네트워크도 부르지 않는다', async () => {
    const closed = new Date('2026-10-01T08:30:00Z');
    expect(hasOpenWeatherSlot(closed)).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const execute = vi.fn();
    const batch = vi.fn();
    const result = await refreshWeatherRegionDaily({ execute, batch } as unknown as DbExecutor, closed, {
      kmaServiceKey: KEY,
    });
    expect(result.open).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasOpenWeatherSlot(EVENING)).toBe(true);
  });
});

describe('refreshWeatherRegionDaily — 실제 libSQL', () => {
  it('한 틱: SELECT 1 + fetch ≤ 10(원천별 상한) + batch 1 — 원천을 번갈아 부른다', async () => {
    const db = await freshDb();
    const calls = stubSources();
    const execute = vi.spyOn(db, 'execute');
    const batch = vi.spyOn(db, 'batch');

    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY });

    const count = (host: Host) => calls.filter((c) => c.host === host).length;
    expect(WEATHER_TICK_FETCH_BUDGET).toBe(10);
    expect(WEATHER_SOURCE_FETCH_CAPS).toEqual({ kma: 3, jma: 8, nws: 4 });
    expect(calls.length).toBe(10);
    expect(count('kma')).toBe(3);
    expect(count('nws')).toBeLessThanOrEqual(4);
    expect(count('jma')).toBeLessThanOrEqual(8);
    // 원천을 번갈아 세운다 — 한 원천이 틱을 다 쓰지 않는다(KMA 3, NWS 3, JMA 4).
    expect([count('kma'), count('jma'), count('nws')]).toEqual([3, 4, 3]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledTimes(1);
    // 한국 17 + 일본 47 + 미 산지 아침.
    const mountain = WeatherRegions.byCountry('US').filter((r) => openWeatherSlot(r, EVENING)).length;
    expect(mountain).toBeGreaterThan(0);
    expect(result).toMatchObject({ open: 17 + 47 + mountain, due: 17 + 47 + mountain, attempted: 10, failures: [] });
    // cron 은 엣지 캐시를 쓰지 않는다. 타임아웃은 건다.
    for (const c of calls) {
      expect(c.init.cf).toBeUndefined();
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
    }
    db.close();
  });

  it('due 판정 — 슬롯 시작 뒤에 계산한 [내일, +3] 행이 다 있으면 건너뛰고, 슬롯 전의 행은 다시 한다', async () => {
    const db = await freshDb();
    const kr = WeatherRegions.byCountry('KR');
    for (const r of kr) {
      for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) {
        // 서울만 슬롯 전(11:59Z)에 계산한 행 — 나머지는 슬롯 안(12:01Z).
        await insertRow(db, r.key, d, r.key === 'kr-seoul' ? '2026-10-01T11:59:00.000Z' : '2026-10-01T12:01:00.000Z');
      }
    }
    const calls = stubSources();
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY, regions: kr });
    expect(result).toMatchObject({ open: 17, due: 1, attempted: 1, stored: 3 });
    expect(calls.map((c) => [c.url.searchParams.get('nx'), c.url.searchParams.get('ny')])).toEqual([['60', '127']]);
    const seoul = await rowsOf(db, 'kr-seoul');
    expect(seoul.map((r) => [r.target_date, r.weather_code, r.temp_max, r.temp_min, r.precip_prob])).toEqual([
      ['2026-10-02', 0, 21, 12, 0],
      ['2026-10-03', 3, 22, 11, 30],
      ['2026-10-04', 3, 23, 14, 30],
    ]);
    // 먼지는 끈다 — NULL. 계산 시각은 이 틱.
    expect(seoul.every((r) => r.dust_level === null && r.computed_at === EVENING.toISOString())).toBe(true);
    db.close();
  });

  it('한국만: KMA 상한 3 — 틱마다 세 곳씩, 슬롯 안에서 다 채운다', async () => {
    const db = await freshDb();
    const kr = WeatherRegions.byCountry('KR');
    stubSources();
    let stored = 0;
    for (let minute = 5; minute < 60; minute += 5) {
      const now = new Date(`2026-10-01T12:${String(minute).padStart(2, '0')}:00Z`);
      const result = await refreshWeatherRegionDaily(asExecutor(db), now, { kmaServiceKey: KEY, regions: kr });
      expect(result.attempted).toBeLessThanOrEqual(3);
      stored += result.stored;
    }
    expect(stored).toBe(17 * 3);
    // 다 채운 뒤에는 due 가 없다 — 원천을 부르지 않는다.
    const calls = stubSources();
    const last = await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, { kmaServiceKey: KEY, regions: kr });
    expect(last.due).toBe(0);
    expect(calls).toHaveLength(0);
    db.close();
  });

  it('일본은 강수량을 재지 않는다 — precip_sum NULL. 미국 행은 강수량을 적되 QPF 지평(약 72시간) 너머는 NULL', async () => {
    const db = await freshDb();
    stubSources();
    await refreshWeatherRegionDaily(asExecutor(db), EVENING, {
      kmaServiceKey: KEY,
      regions: [region('jp-tokyo'), region('us-denver')],
    });
    const tokyo = await rowsOf(db, 'jp-tokyo');
    expect(tokyo.map((r) => [r.target_date, r.weather_code, r.precip_sum, r.dust_level])).toEqual([
      ['2026-10-02', 61, null, null],
      ['2026-10-03', 0, null, null],
      ['2026-10-04', 3, null, null],
    ]);
    expect(Number(tokyo[0]!.variant_index)).toBe(idx('rain'));
    // 덴버는 아침 슬롯(06:05 MDT) — 오늘~+3. 강수량은 +2 까지 숫자, +3 은 QPF 지평 너머라 NULL(재지 않음).
    const denver = await rowsOf(db, 'us-denver');
    expect(denver.map((r) => r.target_date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(denver.slice(0, 3).every((r) => typeof r.precip_sum === 'number')).toBe(true);
    expect(denver[3]!.precip_sum).toBeNull();
    db.close();
  });

  it('오늘 극값 이어받기 — KR 아침(0500 회차)의 오늘 TMN 을 36시간 안의 저장 행에서', async () => {
    const db = await freshDb();
    const morning = new Date('2026-09-30T21:05:00Z'); // 06:05 KST 10-01 → 0500 회차
    // 어제 저녁 슬롯이 '내일'로 계산해 둔 오늘 행.
    await insertRow(db, 'kr-seoul', '2026-10-01', '2026-09-30T12:05:00.000Z', { min: 12, max: 30 });
    // 이어받을 행이 없는 곳(부산)은 오늘을 못 만든다 — 그래도 [내일, +3] 은 적고 due 가 아니다.
    const calls = stubSources();
    const result = await refreshWeatherRegionDaily(asExecutor(db), morning, {
      kmaServiceKey: KEY,
      regions: [region('kr-seoul'), region('kr-busan')],
    });
    expect(calls.map((c) => c.url.searchParams.get('base_time'))).toEqual(['0500', '0500']);
    const seoulToday = (await rowsOf(db, 'kr-seoul')).find((r) => r.target_date === '2026-10-01')!;
    // TMX 는 원천(20), TMN 만 이어받는다(12). 상태·강수확률은 원천의 것(맑음·30).
    expect([seoulToday.temp_max, seoulToday.temp_min, seoulToday.precip_prob, seoulToday.weather_code]).toEqual([20, 12, 30, 0]);
    expect(seoulToday.computed_at).toBe(morning.toISOString());
    const busan = await rowsOf(db, 'kr-busan');
    expect(busan.map((r) => r.target_date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(result.stored).toBe(4 + 3);
    db.close();
  });

  it('36시간을 넘긴 행에서는 이어받지 않는다', async () => {
    const db = await freshDb();
    const morning = new Date('2026-09-30T21:05:00Z');
    await insertRow(db, 'kr-seoul', '2026-10-01', '2026-09-29T08:00:00.000Z', { min: 12 });
    stubSources();
    await refreshWeatherRegionDaily(asExecutor(db), morning, { kmaServiceKey: KEY, regions: [region('kr-seoul')] });
    const today = (await rowsOf(db, 'kr-seoul')).find((r) => r.target_date === '2026-10-01')!;
    expect(today.computed_at).toBe('2026-09-29T08:00:00.000Z'); // 그대로(덮지 않았다)
    db.close();
  });

  it('지난 행은 첫 쓰기에 함께 지운다(UTC 오늘 − 3일 이전)', async () => {
    const db = await freshDb();
    await insertRow(db, 'kr-seoul', '2026-09-27', '2026-09-27T12:00:00.000Z');
    await insertRow(db, 'kr-seoul', '2026-09-28', '2026-09-28T12:00:00.000Z');
    stubSources();
    await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY, regions: [region('kr-seoul')] });
    const dates = (await rowsOf(db, 'kr-seoul')).map((r) => r.target_date);
    expect(dates).not.toContain('2026-09-27');
    expect(dates).toContain('2026-09-28');
    db.close();
  });

  it("'Too many subrequests' 면 그 틱의 날씨 작업을 멈춘다 — 실패로 세지 않고 쓰지도 않는다", async () => {
    const db = await freshDb();
    const calls = stubSources({ fail: { jma: () => new Error('Too many subrequests.') } });
    const batch = vi.spyOn(db, 'batch');
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY });
    expect(result.budgetExhausted).toBe(true);
    expect(result.failures).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
    expect(calls.length).toBeLessThan(10);
    // 마지막 틱이 아니면 경보는 없다 — 다음 틱이 이어 한다.
    expect(result.alerts).toEqual([]);
    db.close();
  });

  it('그 지역의 칸이 틀린 설정 실패(JMA office 404)는 그 지역만 — 원천을 끄지 않아 슬롯 안에 나머지를 다 채운다', async () => {
    // 원천을 끄면 틀린 office 가 틱마다 맨 앞에서 다시 걸려 그 뒤 지역이 슬롯 내내 밀린다(코덱스 #846).
    const db = await freshDb();
    const jp = WeatherRegions.byCountry('JP');
    const bad = jp[0]!;
    if (bad.source.kind !== 'jma') throw new Error('jma');
    const badPath = `/${bad.source.office}.json`;
    const calls = stubSources({
      fail: {
        jma: (url) =>
          url.pathname.endsWith(badPath)
            ? new Response('<!DOCTYPE html>', { status: 404, headers: { 'content-type': 'text/html' } })
            : null,
      },
    });
    const first = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY, regions: jp });
    // 한 틱에 JMA 상한(8)을 다 쓴다 — 틀린 office 하나 + 나머지 일곱.
    expect(calls.filter((c) => c.host === 'jma')).toHaveLength(WEATHER_SOURCE_FETCH_CAPS.jma);
    expect(first.failures).toEqual([{ regionKey: bad.key, source: 'jma', failure: 'config', reason: 'http_404' }]);
    expect(first.stored).toBe((WEATHER_SOURCE_FETCH_CAPS.jma - 1) * 3);

    // 슬롯의 나머지 틱 — 틀린 office 는 틱마다 다시 부르지만(상한 안), 나머지 46곳은 마지막 틱까지 다 채운다.
    const alerts: WeatherSlotAlert[] = [];
    for (let minute = 10; minute < 60; minute += 5) {
      const now = new Date(`2026-10-01T12:${String(minute).padStart(2, '0')}:00Z`);
      await refreshWeatherRegionDaily(asExecutor(db), now, { kmaServiceKey: KEY, regions: jp, onAlert: (a) => alerts.push(a) });
    }
    const keys = new Set((await rowsOf(db)).map((r) => String(r.region_key)));
    expect(keys.has(bad.key)).toBe(false);
    expect(keys.size).toBe(jp.length - 1);
    // 설정 실패라 일부가 끝났어도 슬롯 끝에서 경보는 오른다 — 목록의 칸을 고치게.
    expect(alerts).toEqual([
      { country: 'JP', slot: 'evening', source: 'jma', reason: 'http_404', done: jp.length - 1, total: jp.length },
    ]);
    db.close();
  });

  it('NWS 격자 404(InvalidGridpoint)도 그 지역만 — 같은 틱의 다른 NWS 지역은 상한까지 부른다', async () => {
    const db = await freshDb();
    // 원천이 섞인 틱(일본 저녁 + 미 산지 아침). 틀린 격자를 NWS 줄의 맨 앞에 둔다.
    const mountain = WeatherRegions.byCountry('US').filter((r) => openWeatherSlot(r, EVENING));
    const bad = mountain[0]!;
    if (bad.source.kind !== 'nws') throw new Error('nws');
    expect(mountain.length).toBeGreaterThan(WEATHER_SOURCE_FETCH_CAPS.nws);
    const badPath = `/gridpoints/${bad.source.gridId}/${bad.source.gridX},${bad.source.gridY}`;
    const calls = stubSources({
      fail: {
        nws: (url) =>
          url.pathname === badPath
            ? new Response(JSON.stringify({ type: 'https://api.weather.gov/problems/InvalidGridpoint', status: 404 }), {
                status: 404,
                headers: { 'content-type': 'application/problem+json' },
              })
            : null,
      },
    });
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, {
      kmaServiceKey: KEY,
      regions: [...WeatherRegions.byCountry('JP'), ...mountain],
    });
    const nws = calls.filter((c) => c.host === 'nws');
    expect(nws).toHaveLength(WEATHER_SOURCE_FETCH_CAPS.nws);
    expect(nws[0]!.url.pathname).toBe(badPath);
    expect(result.failures).toEqual([{ regionKey: bad.key, source: 'nws', failure: 'config', reason: 'invalid_gridpoint' }]);
    // 틀린 격자 뒤의 세 곳은 계산해 적었다.
    for (const r of mountain.slice(1, WEATHER_SOURCE_FETCH_CAPS.nws)) {
      expect((await rowsOf(db, r.key)).length).toBeGreaterThan(0);
    }
    db.close();
  });

  it('설정 실패(KMA 30)면 그 틱에서 그 원천을 더 부르지 않는다 — 다른 원천은 계속', async () => {
    const db = await freshDb();
    const keyError = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    const calls = stubSources({ fail: { kma: () => new Response(keyError, { status: 200 }) } });
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY });
    // 동시 4 라 첫 KMA 가 실패로 돌아오기 전에 시작한 KMA 는 하나 더 있을 수 있다.
    expect(calls.filter((c) => c.host === 'kma').length).toBeLessThanOrEqual(2);
    expect(result.failures.every((f) => f.source === 'kma' && f.failure === 'config' && f.reason === 'kma_30')).toBe(true);
    expect(calls.filter((c) => c.host !== 'kma').length).toBeGreaterThan(0);
    // 마지막 틱이 아니면 경보는 없다.
    expect(result.alerts).toEqual([]);
    db.close();
  });

  it('표가 없으면(마이그레이션 전) 조용히 건너뛴다 — 원천도 부르지 않는다', async () => {
    const db = createClient({ url: ':memory:' });
    const calls = stubSources();
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY });
    expect(result.missingTable).toBe(true);
    expect(calls).toHaveLength(0);
    db.close();
  });

  it('다른 DB 오류는 던진다 — cron 이 Sentry 로 올린다', async () => {
    stubSources();
    const broken = { execute: vi.fn().mockRejectedValue(new Error('SQLITE_IOERR')), batch: vi.fn() };
    await expect(
      refreshWeatherRegionDaily(broken as unknown as DbExecutor, EVENING, { kmaServiceKey: KEY }),
    ).rejects.toThrow('SQLITE_IOERR');
  });
});

describe('슬롯 끝 경보 — 마지막 틱(현지 분 ≥ 55)에 (나라, 시간대 묶음)마다', () => {
  const jp = () => WeatherRegions.byCountry('JP');

  it('그 묶음에서 한 곳도 못 했으면 경보 — 원인 갈래와 함께', async () => {
    const db = await freshDb();
    stubSources({ fail: { jma: () => new Response('down', { status: 503 }) } });
    const alerts: WeatherSlotAlert[] = [];
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, {
      kmaServiceKey: KEY,
      regions: jp(),
      onAlert: (a) => alerts.push(a),
    });
    expect(alerts).toEqual([{ country: 'JP', slot: 'evening', source: 'jma', reason: 'http_503', done: 0, total: 47 }]);
    expect(result.alerts).toEqual(alerts);
    // 마지막 틱이 아니면 같은 실패에도 경보가 없다(다음 틱이 다시 한다).
    const quiet: WeatherSlotAlert[] = [];
    await refreshWeatherRegionDaily(asExecutor(db), new Date('2026-10-01T12:50:00Z'), {
      kmaServiceKey: KEY,
      regions: jp(),
      onAlert: (a) => quiet.push(a),
    });
    expect(quiet).toEqual([]);
    db.close();
  });

  it('일부만 실패했으면 경보 없이 warn 한 줄', async () => {
    const db = await freshDb();
    // 열 곳은 이미 이번 슬롯에 계산해 두었다.
    for (const r of jp().slice(0, 10)) {
      for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) await insertRow(db, r.key, d, '2026-10-01T12:10:00.000Z');
    }
    stubSources({ fail: { jma: () => new Response('down', { status: 503 }) } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alerts: WeatherSlotAlert[] = [];
    await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, {
      kmaServiceKey: KEY,
      regions: jp(),
      onAlert: (a) => alerts.push(a),
    });
    expect(alerts).toEqual([]);
    expect(warn.mock.calls.some(([l]) => String(l).includes('slot_partial'))).toBe(true);
    db.close();
  });

  it('설정 실패는 일부가 끝났어도 올린다(격자 404)', async () => {
    const db = await freshDb();
    const mountain = WeatherRegions.byCountry('US').filter((r) => openWeatherSlot(r, EVENING_LAST));
    for (const r of mountain.slice(1)) {
      for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) await insertRow(db, r.key, d, '2026-10-01T12:10:00.000Z');
    }
    stubSources({
      fail: {
        nws: () =>
          new Response(JSON.stringify({ type: 'https://api.weather.gov/problems/InvalidGridpoint' }), { status: 404 }),
      },
    });
    const alerts: WeatherSlotAlert[] = [];
    await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, {
      regions: mountain,
      onAlert: (a) => alerts.push(a),
    });
    expect(alerts).toEqual([
      {
        country: 'US',
        slot: 'morning',
        source: 'nws',
        reason: 'invalid_gridpoint',
        done: mountain.length - 1,
        total: mountain.length,
      },
    ]);
    db.close();
  });

  it('KMA 키가 없으면 네트워크 없이 — 운영은 경보(missing_key), dev 는 info 로그만', async () => {
    const db = await freshDb();
    const calls = stubSources();
    const kr = WeatherRegions.byCountry('KR');
    const prod: WeatherSlotAlert[] = [];
    await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, {
      regions: kr,
      alertOnMissingKey: true,
      onAlert: (a) => prod.push(a),
    });
    expect(prod).toEqual([{ country: 'KR', slot: 'evening', source: 'kma', reason: 'missing_key', done: 0, total: 17 }]);
    const dev: WeatherSlotAlert[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await refreshWeatherRegionDaily(asExecutor(db), EVENING_LAST, {
      regions: kr,
      alertOnMissingKey: false,
      onAlert: (a) => dev.push(a),
    });
    expect(dev).toEqual([]);
    expect(log.mock.calls.some(([l]) => String(l).includes('slot_skipped'))).toBe(true);
    expect(calls).toHaveLength(0);
    db.close();
  });
});

describe('읽기 경로 — resolveRegionVariantIndex', () => {
  const AFTER_1700 = new Date('2026-10-01T08:30:00Z'); // 17:30 KST·JST, 04:30 EDT

  it('36시간 안에 계산한 행이면 원천을 부르지 않는다 — 넘으면 다시 계산해 적는다', async () => {
    const db = await freshDb();
    const calls = stubSources();
    await insertRow(db, 'jp-tokyo', '2026-10-02', new Date(AFTER_1700.getTime() - 35 * HOUR).toISOString(), { variant: 6 });
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('jp-tokyo'), '2026-10-02', { now: AFTER_1700 })).toBe(6);
    expect(calls).toHaveLength(0);

    const later = new Date(AFTER_1700.getTime() + 2 * HOUR); // 행은 37시간 전 것이 된다
    expect(WEATHER_REGION_READ_STALE_MS).toBe(36 * HOUR);
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('jp-tokyo'), '2026-10-02', { now: later })).toBe(
      idx('rain'),
    );
    expect(calls.map((c) => c.host)).toEqual(['jma']);
    // 즉석 계산은 JMA·NWS 에만 엣지 캐시를 건다(600초).
    expect(calls[0]!.init.cf).toEqual({ cacheTtl: 600, cacheEverything: true });
    const row = (await rowsOf(db, 'jp-tokyo'))[0]!;
    expect([row.variant_index, row.computed_at]).toEqual([idx('rain'), later.toISOString()]);
    db.close();
  });

  it('지평 가드 — 지역의 [오늘, +3] 밖이면 네트워크 없이 null', async () => {
    const db = await freshDb();
    const calls = stubSources();
    for (const date of ['2026-09-30', '2026-10-05', '2020-01-01']) {
      expect(await resolveRegionVariantIndex(() => asExecutor(db), region('kr-seoul'), date, { now: AFTER_1700, kmaServiceKey: KEY })).toBeNull();
    }
    expect(calls).toHaveLength(0);
    db.close();
  });

  it('KMA 즉석 계산은 엣지 캐시를 쓰지 않는다 · 키가 없으면 null(네트워크 없음)', async () => {
    const db = await freshDb();
    const calls = stubSources();
    // 10-03 은 강수확률 30 이지만 기상청 PTY 가 전부 0 이라 흐림이다(결정 D7 — 예전 규칙으로는 비였다).
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('kr-seoul'), '2026-10-03', { now: AFTER_1700, kmaServiceKey: KEY })).toBe(
      idx('cloud'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.cf).toBeUndefined();
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('kr-busan'), '2026-10-03', { now: AFTER_1700 })).toBeNull();
    expect(calls).toHaveLength(1);
    db.close();
  });

  it('오늘 극값이 원천에 없고 이어받을 행도 없으면 null(추측 금지) — 슬롯이 적어 둔 오늘 행이 있으면 그것을 읽는다', async () => {
    const db = await freshDb();
    const calls = stubSources();
    // 17:30 KST 의 1700 회차 — 오늘은 TMX·TMN 이 없다.
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('kr-seoul'), '2026-10-01', { now: AFTER_1700, kmaServiceKey: KEY })).toBeNull();
    expect(calls).toHaveLength(1);
    // 아침 슬롯이 적어 둔 오늘 행(11시간 전) — 그대로 읽힌다. 읽기 경로의 행 나이(36h)와 이어받기 나이(36h)가
    // 같아서, 오늘 행은 언제나 슬롯이 이어받기로 만들어 둔 것을 읽는다.
    await insertRow(db, 'kr-seoul', '2026-10-01', '2026-09-30T21:05:00.000Z', { variant: 2, min: 1, max: 9 });
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('kr-seoul'), '2026-10-01', { now: AFTER_1700, kmaServiceKey: KEY })).toBe(2);
    expect(calls).toHaveLength(1);
    db.close();
  });

  it('표가 없으면(배포 → 마이그레이션 창) 저장 없이 계산만 한다', async () => {
    const db = createClient({ url: ':memory:' });
    stubSources();
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('jp-tokyo'), '2026-10-02', { now: AFTER_1700 })).toBe(
      idx('rain'),
    );
    db.close();
  });

  it('원천 호출 전체의 마감은 5초 — 늦은 KMA NODATA 뒤에는 물러서지 않고 null, cron 은 마감 없이 물러선다', async () => {
    // 앱은 저장에서 8초만 기다린다. 물러서기에 새 5초를 주면 늦은 NODATA 하나로 10초가 된다(코덱스 #846).
    expect(WEATHER_READ_DEADLINE_MS).toBe(5_000);
    const db = await freshDb();
    let clock = Date.UTC(2026, 9, 1, 8, 30);
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const nodata = JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } });
    /** 그 회차는 NODATA 를 마감까지 다 써서(5초) 돌려준다. */
    const slowNodataAt = (baseTime: string) => (url: URL) => {
      if (url.searchParams.get('base_time') !== baseTime) return null;
      clock += 5_000;
      return new Response(nodata, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    // 17:30 KST → 1700 회차. 물러서면 1400 이지만 마감이 다해 부르지 않는다.
    let calls = stubSources({ fail: { kma: slowNodataAt('1700') } });
    expect(
      await resolveRegionVariantIndex(() => asExecutor(db), region('kr-seoul'), '2026-10-02', {
        now: AFTER_1700,
        kmaServiceKey: KEY,
      }),
    ).toBeNull();
    expect(calls.map((c) => c.url.searchParams.get('base_time'))).toEqual(['1700']);

    // cron 에는 마감이 없다 — 같은 늦은 NODATA 에도 한 회차 물러서서 적는다(21:05 KST → 2000 → 1700).
    calls = stubSources({ fail: { kma: slowNodataAt('2000') } });
    const result = await refreshWeatherRegionDaily(asExecutor(db), EVENING, { kmaServiceKey: KEY, regions: [region('kr-seoul')] });
    expect(calls.map((c) => c.url.searchParams.get('base_time'))).toEqual(['2000', '1700']);
    expect(result.stored).toBe(3);
    db.close();
  });

  it('원천 실패면 null — 5xx·낡은 발표', async () => {
    const db = await freshDb();
    stubSources({ fail: { nws: () => new Response('x', { status: 502 }) } });
    expect(await resolveRegionVariantIndex(() => asExecutor(db), region('us-new-york'), '2026-10-02', { now: AFTER_1700 })).toBeNull();
    stubSources();
    // JMA 17시 발표를 다음 날 07시(13시간 넘음)에 받으면 못 받은 것이다.
    expect(
      await resolveRegionVariantIndex(() => asExecutor(db), region('jp-tokyo'), '2026-10-02', {
        now: new Date('2026-10-01T22:30:00Z'),
      }),
    ).toBeNull();
    db.close();
  });
});

describe('GET /tts/prerender-variant — 지역 경로', () => {
  function request(query: Record<string, string>, env: Record<string, string> = { KMA_SERVICE_KEY: KEY }) {
    const app = new Hono<AppEnv>();
    app.route('/tts', ttsRoutes);
    const params = new URLSearchParams({ context: 'wake_weather', ...query });
    return app.request(`/tts/prerender-variant?${params.toString()}`, {}, env);
  }

  it('미리 계산한 행이 있으면 DB 한 번 읽기로 답한다 — 모르는 region 이면 옛 글자를 되짚는다', async () => {
    currentDb = await freshDb();
    const calls = stubSources();
    const today = WeatherRegions.localDate(region('kr-gyeonggi'));
    await insertRow(currentDb, 'kr-gyeonggi', today, new Date().toISOString(), { variant: 2 });
    const res = await request({ region: 'xx-nowhere', country: '대한민국', city: '수원', target_date: today });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ context: 'wake_weather', variant_index: 2 });
    expect(calls).toHaveLength(0);
  });

  it('행이 없으면 그 지역의 원천을 한 번 불러 계산하고 적는다(워커의 KMA_SERVICE_KEY)', async () => {
    currentDb = await freshDb();
    const calls = stubSources();
    const seoul = region('kr-seoul');
    const tomorrow = new Date(Date.now() + 24 * HOUR);
    const target = WeatherRegions.localDate(seoul, tomorrow);
    const res = await request({ region: 'kr-seoul', target_date: target });
    expect(res.status).toBe(200);
    // 픽스처의 날짜(2026-10-01~)와 오늘이 다르면 그 날짜가 응답에 없을 수 있다 — 어느 쪽이든 원천은 한 번이다.
    const body = (await res.json()) as { variant_index: number | null };
    expect(body.variant_index === null || Number.isInteger(body.variant_index)).toBe(true);
    expect(calls.map((c) => c.host)).toEqual(['kma']);
    expect(calls[0]!.url.searchParams.get('serviceKey')).toBe(KEY);
  });
});
