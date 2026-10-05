// 기상청 단기예보(KR) 어댑터 — `lib/weather-kma.ts`. 규칙: `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
//
// 픽스처는 2026-10-01 실측(서울 60,127, 실제 키, 읽기 전용) 응답 그대로다 — 1700·0500·0200 회차. 키는 들어 있지
// 않다(응답 본문에 키가 실리지 않는다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeatherRegions, type WeatherSource } from '@alarmtalk/shared';
import {
  fetchKmaDays,
  KMA_NUM_OF_ROWS,
  kmaDaysFromItems,
  kmaRequestUrl,
  latestKmaRun,
  parseKmaPrecipAmount,
  previousKmaRun,
  readKmaPage,
  type KmaItem,
} from '../src/lib/weather-kma';
import {
  fetchRegionSourceDays,
  fixedFetchBudget,
  finalizeSourceDay,
  WeatherSourceError,
} from '../src/lib/weather-source';
import { resolvePrerenderWeatherIndex } from '../src/lib/weather-signal';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';

const FIXTURES = join(__dirname, 'fixtures/weather/kma');
const raw = (run: '0200' | '0500' | '1700') => readFileSync(join(FIXTURES, `seoul-20261001-${run}.json`), 'utf8');
const itemsOf = (run: '0200' | '0500' | '1700'): KmaItem[] => readKmaPage(200, raw(run)).items;

const SEOUL = WeatherRegions.byKey('kr-seoul')!;
const SEOUL_SOURCE = SEOUL.source as Extract<WeatherSource, { kind: 'kma' }>;
const KEY = 'test+key/with=chars';
const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('발표 회차 고르기 — 지금 −10분 이전의 가장 최근 회차(KST)', () => {
  it('저녁 슬롯(21:00~)은 2000, 아침 슬롯(06:00~)은 0500, 자정 넘어 02:09 까지는 전날 2300', () => {
    expect(latestKmaRun(new Date('2026-10-01T12:00:00Z'))).toEqual({ baseDate: '20261001', baseTime: '2000' }); // 21:00 KST
    expect(latestKmaRun(new Date('2026-10-01T21:00:00Z'))).toEqual({ baseDate: '20261002', baseTime: '0500' }); // 06:00 KST
    expect(latestKmaRun(new Date('2026-10-01T11:09:00Z'))).toEqual({ baseDate: '20261001', baseTime: '1700' }); // 20:09 → 아직 1700
    expect(latestKmaRun(new Date('2026-10-01T11:10:00Z'))).toEqual({ baseDate: '20261001', baseTime: '2000' }); // 20:10 → 2000
    expect(latestKmaRun(new Date('2026-09-30T17:05:00Z'))).toEqual({ baseDate: '20260930', baseTime: '2300' }); // 02:05 KST
  });

  it('한 회차 앞 — 0200 의 앞은 전날 2300', () => {
    expect(previousKmaRun({ baseDate: '20261001', baseTime: '2000' })).toEqual({ baseDate: '20261001', baseTime: '1700' });
    expect(previousKmaRun({ baseDate: '20261001', baseTime: '0200' })).toEqual({ baseDate: '20260930', baseTime: '2300' });
  });

  it('URL 은 키를 한 번만 인코딩한다(일반 인증키 Decoding 을 넣는다) — numOfRows 1500 한 페이지', () => {
    const url = kmaRequestUrl(SEOUL_SOURCE, { baseDate: '20261001', baseTime: '2000' }, KEY);
    expect(url.origin + url.pathname).toBe('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst');
    expect(url.searchParams.get('serviceKey')).toBe(KEY);
    expect(url.search).toContain('serviceKey=test%2Bkey%2Fwith%3Dchars');
    expect(url.searchParams.get('numOfRows')).toBe(String(KMA_NUM_OF_ROWS));
    expect(KMA_NUM_OF_ROWS).toBe(1500);
    expect(url.searchParams.get('dataType')).toBe('JSON');
    expect([url.searchParams.get('nx'), url.searchParams.get('ny')]).toEqual(['60', '127']);
  });
});

describe('PCP·SNO — 날짜가 아니라 값의 모양으로 읽는다', () => {
  it.each([
    ['강수없음', 0],
    ['적설없음', 0],
    ['-', 0],
    ['0', 0],
    [null, null],
    [undefined, null],
    ['6.2mm', 6.2],
    ['1.0cm', 1],
    ['30.0~50.0mm', 30],
    ['50.0mm 이상', 50],
    ['0.4', 0.4],
    ['2', 2],
  ])('%s → %s', (value, expected) => {
    expect(parseKmaPrecipAmount(value)).toBe(expected);
  });

  it('미만은 0 보다 크다', () => {
    expect(parseKmaPrecipAmount('1mm 미만')).toBeGreaterThan(0);
    expect(parseKmaPrecipAmount('0.5cm 미만')).toBeGreaterThan(0);
  });

  it('모르는 글자·결측(±900)은 null — 그 날짜는 미해결', () => {
    expect(parseKmaPrecipAmount('약간')).toBeNull();
    expect(parseKmaPrecipAmount('999')).toBeNull();
    expect(parseKmaPrecipAmount('5in')).toBeNull();
  });
});

describe('응답 봉투 — 두 모양 + 상태', () => {
  it('정상: resultCode 00 이고 행 수가 totalCount 와 같다(실측 1700 = 1,052건)', () => {
    const page = readKmaPage(200, raw('1700'));
    expect(page.resultCode).toBe('00');
    expect(page.totalCount).toBe(1052);
    expect(page.items).toHaveLength(1052);
  });

  it('게이트웨이 오류(OpenAPI_ServiceResponse) — XML 이든 JSON 이든 결과 코드로 가른다', () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
      <returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode>
      </cmmMsgHeader></OpenAPI_ServiceResponse>`;
    expect(() => readKmaPage(200, xml)).toThrow(expect.objectContaining({ failure: 'config', reason: 'kma_30' }));
    const json = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: '22' } } });
    expect(() => readKmaPage(200, json)).toThrow(expect.objectContaining({ failure: 'config', reason: 'kma_22' }));
  });

  it('정상 봉투의 오류 코드 — 03(NODATA)·01·99 는 일시 실패, 20·31 은 설정 실패', () => {
    const body = (code: string) => JSON.stringify({ response: { header: { resultCode: code, resultMsg: 'X' } } });
    expect(() => readKmaPage(200, body('03'))).toThrow(expect.objectContaining({ failure: 'transient', reason: 'kma_03' }));
    expect(() => readKmaPage(200, body('01'))).toThrow(expect.objectContaining({ failure: 'transient' }));
    expect(() => readKmaPage(200, body('99'))).toThrow(expect.objectContaining({ failure: 'transient' }));
    expect(() => readKmaPage(200, body('20'))).toThrow(expect.objectContaining({ failure: 'config', reason: 'kma_20' }));
    expect(() => readKmaPage(200, body('31'))).toThrow(expect.objectContaining({ failure: 'config' }));
  });

  it('상태: 401·403 은 설정 실패(키), 429·5xx 는 일시 실패, 깨진 본문은 일시 실패', () => {
    expect(() => readKmaPage(401, 'Unauthorized')).toThrow(expect.objectContaining({ failure: 'config', reason: 'http_401' }));
    expect(() => readKmaPage(403, '')).toThrow(expect.objectContaining({ failure: 'config' }));
    expect(() => readKmaPage(429, '')).toThrow(expect.objectContaining({ failure: 'transient', reason: 'http_429' }));
    expect(() => readKmaPage(503, '')).toThrow(expect.objectContaining({ failure: 'transient', reason: 'http_503' }));
    expect(() => readKmaPage(200, '{oops')).toThrow(expect.objectContaining({ failure: 'transient', reason: 'kma_unparsable' }));
  });
});

describe('날짜별 집계 — 실측 응답', () => {
  it.each(['PCP', 'SNO'])('%s 행이 있어도 값이 null·누락이면 해당 날짜만 미해결이다', (category) => {
    for (const value of [null, undefined]) {
      const items = itemsOf('1700');
      const item = items.find((row) => row.category === category && row.fcstDate === '20261002')!;
      if (value === undefined) delete (item as Partial<KmaItem>).fcstValue;
      else item.fcstValue = value;
      const days = kmaDaysFromItems(items, '2026-10-01');
      expect(days.has('2026-10-02')).toBe(false);
      expect(days.has('2026-10-03')).toBe(true);
    }
  });

  it('1700 회차: 오늘은 18~23시뿐이고 TMX·TMN 이 없다 → 극값은 비워 둔다(이어받기 대상)', () => {
    const days = kmaDaysFromItems(itemsOf('1700'), '2026-10-01');
    expect(days.get('2026-10-01')).toEqual({
      code: 0,
      maxTemp: null,
      minTemp: null,
      rainProbability: 0,
      precipitation: 0,
    });
  });

  it('1700 회차: 내일~+3 은 24시간 + TMX·TMN, +4 는 3시간 간격 8칸(정성 PCP "2"·"0.4" 포함), +5 는 칸이 모자라 없다', () => {
    const days = kmaDaysFromItems(itemsOf('1700'), '2026-10-01');
    expect(days.get('2026-10-02')).toEqual({ code: 0, maxTemp: 21, minTemp: 12, rainProbability: 0, precipitation: 0 });
    // 낮 13칸 중 9칸이 구름많음 이상 → 흐림.
    expect(days.get('2026-10-03')).toEqual({ code: 3, maxTemp: 22, minTemp: 11, rainProbability: 30, precipitation: 0 });
    expect(days.get('2026-10-04')).toEqual({ code: 3, maxTemp: 23, minTemp: 14, rainProbability: 30, precipitation: 0 });
    // 3시간 간격 칸: PTY 1(비) 두 칸, PCP '2'·'0.4' → 비.
    expect(days.get('2026-10-05')).toEqual({ code: 61, maxTemp: 21, minTemp: 15, rainProbability: 70, precipitation: 2.4 });
    expect(days.has('2026-10-06')).toBe(false);
  });

  it('0500 회차: 오늘은 06~23시, TMX 는 있고 TMN 은 없다 · +3 은 3시간 간격(TMX·TMN 있음)', () => {
    const days = kmaDaysFromItems(itemsOf('0500'), '2026-10-01');
    expect(days.get('2026-10-01')).toEqual({ code: 0, maxTemp: 20, minTemp: null, rainProbability: 30, precipitation: 0 });
    expect(days.get('2026-10-04')).toEqual({ code: 3, maxTemp: 23, minTemp: 14, rainProbability: 20, precipitation: 0 });
  });

  it('0200 회차: 오늘은 03~23시, TMX·TMN 둘 다 있다', () => {
    const days = kmaDaysFromItems(itemsOf('0200'), '2026-10-01');
    expect(days.get('2026-10-01')).toEqual({ code: 0, maxTemp: 22, minTemp: 13, rainProbability: 0, precipitation: 0 });
  });

  it('0500 의 오늘 TMN 은 36시간 안의 저장 행에서만 이어받는다 — 상태·강수확률은 이어받지 않는다', () => {
    const today = kmaDaysFromItems(itemsOf('0500'), '2026-10-01').get('2026-10-01');
    const now = new Date('2026-09-30T21:10:00Z');
    const source = 'kma';
    expect(finalizeSourceDay(today, { isToday: true, stored: null, now, source })).toBeNull();
    const stored = { tempMin: 12, tempMax: 99, computedAt: '2026-09-30T12:05:00.000Z' };
    expect(finalizeSourceDay(today, { isToday: true, stored, now, source })).toEqual({
      code: 0,
      maxTemp: 20, // 원천에 있는 값이 이긴다.
      minTemp: 12,
      rainProbability: 30,
      precipitation: 0,
      hasDust: false,
      rainProbabilityThreshold: 60, // 결정 D7 — 기상청은 강수 형태가 1차다.
    });
    // 오늘이 아니면 이어받지 않는다.
    expect(finalizeSourceDay(today, { isToday: false, stored, now, source })).toBeNull();
    // 36시간을 넘긴 행은 쓰지 않는다.
    const old = { ...stored, computedAt: '2026-09-29T08:00:00.000Z' };
    expect(finalizeSourceDay(today, { isToday: true, stored: old, now, source })).toBeNull();
  });

  it('TMX·TMN 이 없으면 TMP 가 24시간 다 있을 때만 그 최대·최소 — 3시간 간격 날은 대신하지 않는다', () => {
    const items = itemsOf('1700').filter((i) => !(i.category === 'TMX' || i.category === 'TMN'));
    const days = kmaDaysFromItems(items, '2026-10-01');
    expect(days.get('2026-10-02')).toMatchObject({ maxTemp: 21, minTemp: 12 });
    expect(days.get('2026-10-05')).toMatchObject({ maxTemp: null, minTemp: null });
  });

  it('±900 결측·모르는 PCP 글자·칸 하나 빠짐 → 그 날짜만 빠진다(warn 한 줄)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const set = (date: string, time: string, category: string, value: string | null) => (items: KmaItem[]) =>
      items.flatMap((i) =>
        i.fcstDate === date && i.fcstTime === time && i.category === category
          ? value === null
            ? []
            : [{ ...i, fcstValue: value }]
          : [i],
      );
    const base = itemsOf('1700');
    expect(kmaDaysFromItems(set('20261002', '1200', 'POP', '-999')(base), '2026-10-01').has('2026-10-02')).toBe(false);
    expect(kmaDaysFromItems(set('20261003', '0900', 'PCP', '약간')(base), '2026-10-01').has('2026-10-03')).toBe(false);
    expect(warn.mock.calls.some(([line]) => String(line).includes('weather.kma_value'))).toBe(true);
    expect(kmaDaysFromItems(set('20261004', '1300', 'SKY', null)(base), '2026-10-01').has('2026-10-04')).toBe(false);
    // 다른 날짜는 그대로다.
    expect(kmaDaysFromItems(set('20261004', '1300', 'SKY', null)(base), '2026-10-01').get('2026-10-02')).toBeDefined();
  });

  it('PTY 2(비/눈)는 눈(결정 D1), 3 은 눈, 1·4 는 비 — 눈 > 비', () => {
    const withPty = (value: string) =>
      itemsOf('1700').map((i) =>
        i.fcstDate === '20261002' && i.fcstTime === '0800' && i.category === 'PTY' ? { ...i, fcstValue: value } : i,
      );
    const codeFor = (value: string) => kmaDaysFromItems(withPty(value), '2026-10-01').get('2026-10-02')?.code;
    expect(codeFor('2')).toBe(71);
    expect(codeFor('3')).toBe(71);
    expect(codeFor('1')).toBe(61);
    expect(codeFor('4')).toBe(61);
    expect(codeFor('9')).toBeUndefined(); // 모르는 값은 미해결.
  });

  it('분류: 실측 1700 의 내일은 맑음, 모레는 강수확률 30 이어도 기상청이 강수 없음(PTY 0)이라 흐림 — 결정 D7', () => {
    const now = new Date('2026-10-01T08:30:00Z');
    const days = kmaDaysFromItems(itemsOf('1700'), '2026-10-01');
    const index = (date: string) =>
      resolvePrerenderWeatherIndex(finalizeSourceDay(days.get(date), { isToday: false, now, source: 'kma' })!);
    expect(index('2026-10-02')).toBe(idx('nice'));
    // 예전(강수확률 30 → 비)에는 비였다. 기상청은 그날 모든 시간 PTY 0·'강수없음' 이다.
    expect(index('2026-10-03')).toBe(idx('cloud'));
  });

  it('결정 D7 — 강수 형태를 주는 원천(기상청·気象庁)은 강수확률 60 부터만 비, NWS 는 30 부터', () => {
    const now = new Date('2026-10-01T08:30:00Z');
    const day = (rainProbability: number) => ({
      code: 3, // 흐림 — 강수 형태 없음
      maxTemp: 22,
      minTemp: 14,
      rainProbability,
      precipitation: 0,
    });
    const index = (rainProbability: number, source: 'kma' | 'jma' | 'nws') =>
      resolvePrerenderWeatherIndex(finalizeSourceDay(day(rainProbability), { isToday: false, now, source })!);
    expect(index(30, 'kma')).toBe(idx('cloud'));
    expect(index(50, 'jma')).toBe(idx('cloud'));
    expect(index(60, 'kma')).toBe(idx('rain'));
    expect(index(60, 'jma')).toBe(idx('rain'));
    expect(index(30, 'nws')).toBe(idx('rain'));
    // 원천이 강수 형태를 비로 주면(code 61) 강수확률과 무관하게 비다.
    expect(
      resolvePrerenderWeatherIndex(
        finalizeSourceDay({ ...day(10), code: 61 }, { isToday: false, now, source: 'kma' })!,
      ),
    ).toBe(idx('rain'));
  });
});

describe('fetchKmaDays — 호출', () => {
  const NOW = new Date('2026-10-01T12:05:00Z'); // 21:05 KST → 2000 회차

  function stub(responses: Array<() => Response>) {
    const calls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      calls.push(new URL(String(input instanceof Request ? input.url : input)));
      const next = responses.shift();
      if (!next) throw new Error('예상 밖의 호출');
      return next();
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }
  const json = (body: string, status = 200) => () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
  const relabel = (run: '1700', baseTime: string) =>
    raw(run).replaceAll('"baseTime":"1700"', `"baseTime":"${baseTime}"`);

  it('키가 없으면 네트워크를 부르지 않는다 — config:missing_key', async () => {
    const calls = stub([]);
    await expect(fetchKmaDays(SEOUL, SEOUL_SOURCE, { now: NOW, budget: fixedFetchBudget(2) })).rejects.toMatchObject({
      failure: 'config',
      reason: 'missing_key',
    });
    expect(calls).toHaveLength(0);
  });

  it('03(NODATA)이면 한 회차 물러서서 한 번 더 — 예산 안에서만', async () => {
    const nodata = JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } });
    const calls = stub([json(nodata), json(relabel('1700', '1700'))]);
    const days = await fetchKmaDays(SEOUL, SEOUL_SOURCE, { now: NOW, budget: fixedFetchBudget(2), kmaServiceKey: KEY });
    expect(calls.map((u) => u.searchParams.get('base_time'))).toEqual(['2000', '1700']);
    expect(days.get('2026-10-02')).toMatchObject({ maxTemp: 21, minTemp: 12 });

    stub([json(nodata)]);
    await expect(
      fetchKmaDays(SEOUL, SEOUL_SOURCE, { now: NOW, budget: fixedFetchBudget(1), kmaServiceKey: KEY }),
    ).rejects.toMatchObject({ failure: 'budget' });
  });

  it('마감(deadlineAt — 읽기 경로)이 있으면 물러서기도 그 안에서만 — fetch 마다 5초를 새로 주지 않는다', async () => {
    // 앱은 저장에서 8초만 기다린다. 늦은 NODATA 뒤에 새 5초를 주면 10초가 된다(코덱스 #846).
    const nodata = JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } });
    let clock = Date.UTC(2026, 9, 1, 12, 5);
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    /** 응답이 `ms` 만큼 걸렸다. */
    const after = (ms: number, body: string) => () => {
      clock += ms;
      return json(body)();
    };
    const options = () => ({ now: NOW, budget: fixedFetchBudget(2), kmaServiceKey: KEY, deadlineAt: clock + 5_000 });

    // 첫 응답(NODATA)이 마감을 다 썼다 → 물러서지 않는다(부르지 않는다) — 일시 실패 'timeout'.
    let calls = stub([after(5_000, nodata), json(relabel('1700', '1700'))]);
    expect(await fetchRegionSourceDays(SEOUL, options())).toEqual({
      ok: false,
      failure: 'transient',
      reason: 'timeout',
      scope: 'source',
    });
    expect(calls).toHaveLength(1);

    // 첫 응답이 0.3초 → 물러서기는 남은 4.7초를 타임아웃으로 받는다.
    timeouts.mockClear();
    calls = stub([after(300, nodata), json(relabel('1700', '1700'))]);
    const quick = await fetchRegionSourceDays(SEOUL, options());
    expect(quick.ok).toBe(true);
    expect(calls.map((u) => u.searchParams.get('base_time'))).toEqual(['2000', '1700']);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([5_000, 4_700]);

    // 마감이 없으면(cron) fetch 마다 5초 그대로 — 늦은 NODATA 여도 물러선다.
    timeouts.mockClear();
    calls = stub([after(5_000, nodata), json(relabel('1700', '1700'))]);
    const cron = await fetchRegionSourceDays(SEOUL, { now: NOW, budget: fixedFetchBudget(2), kmaServiceKey: KEY });
    expect(cron.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([5_000, 5_000]);
  });

  it('행 수가 totalCount 보다 적으면 다음 페이지를 받아 잇는다 — 그래도 모자라면 실패', async () => {
    const full = JSON.parse(raw('1700'));
    const all = full.response.body.items.item as unknown[];
    const page = (items: unknown[]) =>
      JSON.stringify({ ...full, response: { ...full.response, body: { ...full.response.body, items: { item: items } } } });
    const calls = stub([json(page(all.slice(0, 1000))), json(page(all.slice(1000)))]);
    const now = new Date('2026-10-01T08:30:00Z'); // 17:30 KST → 1700 회차
    const days = await fetchKmaDays(SEOUL, SEOUL_SOURCE, { now, budget: fixedFetchBudget(2), kmaServiceKey: KEY });
    expect(calls.map((u) => u.searchParams.get('pageNo'))).toEqual(['1', '2']);
    expect(days.get('2026-10-05')).toMatchObject({ code: 61 });

    stub([json(page(all.slice(0, 1000))), json(page([]))]);
    await expect(
      fetchKmaDays(SEOUL, SEOUL_SOURCE, { now, budget: fixedFetchBudget(2), kmaServiceKey: KEY }),
    ).rejects.toMatchObject({ failure: 'transient', reason: 'kma_count_mismatch' });
  });

  it('로그 한 줄 — source·status·resultCode·items, URL·키는 없다. 엣지 캐시를 걸지 않는다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(relabel('1700', '2000'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchKmaDays(SEOUL, SEOUL_SOURCE, { now: NOW, budget: fixedFetchBudget(2), kmaServiceKey: KEY });
    const init = fetchMock.mock.calls[0]![1 as never] as RequestInit & { cf?: unknown };
    expect(init?.cf).toBeUndefined();
    const lines = log.mock.calls.map(([l]) => String(l)).filter((l) => l.includes('weather.fetch'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ source: 'kma', status: 200, resultCode: '00', items: 1052, timedOut: false });
    expect(lines[0]).not.toContain('serviceKey');
    expect(lines[0]).not.toContain('test');
    expect(lines[0]).not.toContain('apis.data.go.kr');
  });

  it('다른 격자·회차의 행이 오면 믿지 않는다', async () => {
    stub([json(raw('1700').replaceAll('"nx":60', '"nx":61'))]);
    const now = new Date('2026-10-01T08:30:00Z');
    await expect(
      fetchKmaDays(SEOUL, SEOUL_SOURCE, { now, budget: fixedFetchBudget(2), kmaServiceKey: KEY }),
    ).rejects.toBeInstanceOf(WeatherSourceError);
  });
});
