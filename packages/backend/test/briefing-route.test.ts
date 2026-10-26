// 아침 소식 라우트·캐시 — 실제 SQLite(메모리)에 마이그레이션을 돌리고, 원천은 고정 응답으로 바꿔 끼운다(네트워크 없음).
// 규칙: `docs/spec/morning-briefing.md`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient, type Client } from '@libsql/client';
import { BriefingTodayResponseSchema } from '@alarmtalk/shared';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { fakeAuthMiddleware, jsonReq } from './helpers';
import { makeZip } from './support/make-zip';

let db: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import briefingRoutes from '../src/routes/briefing';
import { refreshCorpCodes, runBriefingCron } from '../src/lib/briefing/store';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'briefing');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const SAMSUNG = '00126380';
const HYNIX = '00164779';
const ODD = '01980000';
const DACO = '00434003';

const FULL_ENV = { OPENDART_API_KEY: 'dart-key', KOREA_POLICY_NEWS_API_KEY: 'policy-key' } as unknown as Env;

function buildApp(userId = USER_A) {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/briefing', briefingRoutes);
  return app;
}
function call(path: string, init?: RequestInit, env: Env = FULL_ENV, userId = USER_A) {
  return buildApp(userId).request(path, init, env);
}
function put(codes: unknown, userId = USER_A) {
  return buildApp(userId).request(jsonReq('PUT', '/briefing/interests', { corp_codes: codes }), undefined, FULL_ENV);
}

/** 원천 가짜 — 경로마다 응답을 돌려주고 부른 횟수를 센다. */
type Handler = (url: URL) => Response | Promise<Response>;
let dartHandler: Handler;
let policyHandler: Handler;
let calls: URL[];
function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'opendart.fss.or.kr') return dartHandler(url);
    if (url.hostname === 'apis.data.go.kr') return policyHandler(url);
    throw new Error(`예상하지 못한 호출: ${url.hostname}`);
  });
}
const jsonRes = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
const dartCalls = () => calls.filter((u) => u.pathname === '/api/list.json');
const policyCalls = () => calls.filter((u) => u.hostname === 'apis.data.go.kr');

/** 삼성전자는 두 쪽, 나머지는 013(없음). */
function defaultDart(url: URL): Response {
  if (url.searchParams.get('corp_code') !== SAMSUNG) return jsonRes(fixture('dart-list-013.json'));
  return jsonRes(fixture(url.searchParams.get('page_no') === '2' ? 'dart-list-page2.json' : 'dart-list-page1.json'));
}
const defaultPolicy = () => new Response(fixture('policy-news-list.xml'), { status: 200 });

const T0 = new Date('2026-10-26T00:00:00.000Z'); // 한국 09:00

async function seedCorpCodes() {
  dartHandler = () => new Response(makeZip([{ name: 'CORPCODE.xml', data: new TextEncoder().encode(fixture('corpcode-sample.xml')) }]));
  const result = await refreshCorpCodes(db, FULL_ENV, new Date('2026-10-25T21:00:00.000Z'), { minListedRows: 1 });
  expect(result).toMatchObject({ status: 'refreshed', stored: 3, unlisted: 1 });
}

async function today(userId = USER_A, env: Env = FULL_ENV) {
  const res = await call('/briefing/today', undefined, env, userId);
  const body = await res.json();
  return { res, body: body as ReturnType<typeof BriefingTodayResponseSchema.parse> };
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
}, 60_000);

beforeEach(async () => {
  for (const table of ['briefing_corp_codes', 'briefing_interests', 'briefing_items', 'briefing_fetch_state']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  dartHandler = defaultDart;
  policyHandler = defaultPolicy;
  installFetch();
  await seedCorpCodes();
  calls.length = 0;
  dartHandler = defaultDart;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('고유번호 캐시', () => {
  it('상장사만 담는다 — 비상장(공백 종목코드)은 빠진다', async () => {
    const rows = await db.execute('SELECT corp_code FROM briefing_corp_codes ORDER BY corp_code');
    expect(rows.rows.map((r) => r.corp_code)).toEqual([SAMSUNG, HYNIX, ODD]);
    expect(rows.rows.map((r) => r.corp_code)).not.toContain(DACO);
  });

  it('잠금 — 하루 안에는 다시 받지 않고, 동시에 둘이 와도 하나만 받는다', async () => {
    const again = await refreshCorpCodes(db, FULL_ENV, T0, { minListedRows: 1 });
    expect(again).toEqual({ status: 'not_due' });
    await db.execute(`UPDATE briefing_fetch_state SET last_success_at = '2026-10-20T00:00:00.000Z' WHERE scope_key = 'corpcode'`);
    dartHandler = () => new Response(makeZip([{ name: 'CORPCODE.xml', data: new TextEncoder().encode(fixture('corpcode-sample.xml')) }]));
    const [first, second] = await Promise.all([
      refreshCorpCodes(db, FULL_ENV, T0, { minListedRows: 1 }),
      refreshCorpCodes(db, FULL_ENV, T0, { minListedRows: 1 }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['not_due', 'refreshed']);
    expect(calls.filter((u) => u.pathname === '/api/corpCode.xml')).toHaveLength(1);
  });

  it('행이 너무 적은 파일이면 캐시를 그대로 둔다(통째로 비우지 않는다)', async () => {
    await db.execute(`UPDATE briefing_fetch_state SET last_success_at = '2026-10-20T00:00:00.000Z' WHERE scope_key = 'corpcode'`);
    dartHandler = () => new Response(makeZip([{ name: 'CORPCODE.xml', data: new TextEncoder().encode('<result></result>') }]));
    expect(await refreshCorpCodes(db, FULL_ENV, T0)).toEqual({ status: 'failed', kind: 'failed' });
    expect((await db.execute('SELECT COUNT(*) AS n FROM briefing_corp_codes')).rows[0]!.n).toBe(3);
  });

  it('크론은 한국 시각 06시대에만 일한다', async () => {
    expect(await runBriefingCron(db, FULL_ENV, new Date('2026-10-26T03:00:00.000Z'))).toBeNull(); // 12시
    expect(calls).toHaveLength(0);
    await db.execute(`UPDATE briefing_fetch_state SET last_success_at = '2026-10-20T00:00:00.000Z' WHERE scope_key = 'corpcode'`);
    dartHandler = () => new Response(fixture('dart-corpcode-010.xml'));
    expect(await runBriefingCron(db, FULL_ENV, new Date('2026-10-25T21:02:00.000Z'))).toEqual({
      status: 'failed',
      kind: 'key_invalid',
    });
  });
});

describe('GET /briefing/companies/search', () => {
  it('이름 일부로 찾고, 정확히 같은 이름이 먼저 온다', async () => {
    const res = await call('/briefing/companies/search?q=' + encodeURIComponent('삼성'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ companies: [{ corp_code: SAMSUNG, corp_name: '삼성전자', stock_code: '005930' }] });
    const byStock = await (await call('/briefing/companies/search?q=000660')).json();
    expect(byStock.companies.map((c: { corp_code: string }) => c.corp_code)).toEqual([HYNIX]);
  });

  it('LIKE 와일드카드(%·_)는 글자로 찾는다', async () => {
    const percent = await (await call('/briefing/companies/search?q=' + encodeURIComponent('%'))).json();
    expect(percent.companies.map((c: { corp_code: string }) => c.corp_code)).toEqual([ODD]);
    const underscore = await (await call('/briefing/companies/search?q=' + encodeURIComponent('_'))).json();
    expect(underscore.companies.map((c: { corp_code: string }) => c.corp_code)).toEqual([ODD]);
    const backslash = await (await call('/briefing/companies/search?q=' + encodeURIComponent('\\'))).json();
    expect(backslash.companies).toEqual([]);
  });

  it('검색어가 비었거나 30자를 넘으면 400, limit 은 1~20 으로 자른다', async () => {
    expect((await call('/briefing/companies/search?q=%20%20')).status).toBe(400);
    expect((await call('/briefing/companies/search?q=' + 'a'.repeat(31))).status).toBe(400);
    const body = await (await call('/briefing/companies/search?q=' + encodeURIComponent('스') + '&limit=999')).json();
    expect(Array.isArray(body.companies)).toBe(true);
    const zero = await call('/briefing/companies/search?q=' + encodeURIComponent('삼성') + '&limit=-5');
    expect((await zero.json()).companies).toHaveLength(1);
  });

  it('캐시가 비었으면 503 — 키가 없으면 NOT_CONFIGURED, 있으면 받기를 시작하고 NOT_READY', async () => {
    await db.execute('DELETE FROM briefing_corp_codes');
    const noKey = await call('/briefing/companies/search?q=x', undefined, {} as Env);
    expect(noKey.status).toBe(503);
    expect((await noKey.json()).error_code).toBe('BRIEFING_NOT_CONFIGURED');

    await db.execute(`DELETE FROM briefing_fetch_state`);
    dartHandler = () => new Response(fixture('dart-corpcode-010.xml'));
    const pending = await call('/briefing/companies/search?q=x');
    expect(pending.status).toBe(503);
    expect(pending.headers.get('Retry-After')).toBe('60');
    expect((await pending.json()).error_code).toBe('BRIEFING_CORP_CODES_NOT_READY');
    await vi.waitFor(() => expect(calls.some((u) => u.pathname === '/api/corpCode.xml')).toBe(true));
  });
});

describe('관심 기업', () => {
  it('최대 3개 — 넷이면 400, 중복·형식 오류도 400, 캐시에 없는 기업은 400', async () => {
    const four = await put([SAMSUNG, HYNIX, ODD, '00000001']);
    expect(four.status).toBe(400);
    expect((await four.json()).error_code).toBe('BRIEFING_INVALID_INTERESTS');
    expect((await (await put([SAMSUNG, SAMSUNG])).json()).error_code).toBe('BRIEFING_INVALID_INTERESTS');
    expect((await (await put(['5930'])).json()).error_code).toBe('BRIEFING_INVALID_INTERESTS');
    const unknown = await put([DACO]);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error_code: 'BRIEFING_CORP_NOT_FOUND', missing: [DACO] });
    expect((await db.execute('SELECT COUNT(*) AS n FROM briefing_interests')).rows[0]!.n).toBe(0);
  });

  it('통째로 바꾼다 — 남은 기업의 등록 시각은 그대로', async () => {
    const first = await put([SAMSUNG, HYNIX]);
    expect(first.status).toBe(200);
    const created = (await first.json()).interests.find((i: { corp_code: string }) => i.corp_code === SAMSUNG).created_at;
    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    const second = await (await put([ODD, SAMSUNG])).json();
    expect(second.interests.map((i: { corp_code: string }) => i.corp_code).sort()).toEqual([SAMSUNG, ODD].sort());
    expect(second.interests.find((i: { corp_code: string }) => i.corp_code === SAMSUNG).created_at).toBe(created);
    const cleared = await (await put([])).json();
    expect(cleared.interests).toEqual([]);
  });

  it('남의 목록을 읽거나 바꿀 수 없다(IDOR) — 사람 id 는 인증에서만 온다', async () => {
    await put([SAMSUNG, HYNIX], USER_A);
    const asB = await (await call('/briefing/interests', undefined, FULL_ENV, USER_B)).json();
    expect(asB.interests).toEqual([]);
    await put([ODD], USER_B);
    // 본문에 남의 id 를 실어도 무시된다(스키마에 그런 칸이 없다).
    await buildApp(USER_B).request(
      jsonReq('PUT', '/briefing/interests', { corp_codes: [], user_id: USER_A }),
      undefined,
      FULL_ENV,
    );
    const asA = await (await call('/briefing/interests', undefined, FULL_ENV, USER_A)).json();
    expect(asA.interests.map((i: { corp_code: string }) => i.corp_code).sort()).toEqual([SAMSUNG, HYNIX].sort());
    const aToday = await today(USER_B);
    expect(aToday.body.companies).toEqual([]);
  });
});

describe('GET /briefing/today', () => {
  it('두 원천 모두 성공 — 공시·정책뉴스·확인 시각, complete', async () => {
    await put([SAMSUNG, HYNIX]);
    const { res, body } = await today();
    expect(res.status).toBe(200);
    expect(BriefingTodayResponseSchema.parse(body)).toBeTruthy();
    expect(body.window).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(body.complete).toBe(true);
    expect(body.stale).toBe(false);
    expect(body.errors).toEqual([]);
    expect(body.fetched_at).toBe(T0.toISOString());
    expect(body.companies.map((c) => c.status)).toEqual(['ok', 'ok']);
    expect(body.disclosures.map((d) => d.id)).toEqual(['20261026000123', '20261023000456', '20261021000789']);
    expect(body.disclosures[0]).toMatchObject({
      receipt_date: '2026-10-26',
      flags: { amended_report: true, corrected_later: true },
      url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261026000123',
    });
    expect(body.disclosures[2]!.flags.withdrawn).toBe(true);
    expect(body.policy_news.map((n) => n.id)).toEqual(['148950001', '148950002']);
    // 요청 창: 오늘 포함 7일 / 정책뉴스 이틀.
    expect(dartCalls()[0]!.searchParams.get('bgn_de')).toBe('20261020');
    expect(policyCalls()[0]!.searchParams.get('startDate')).toBe('20261025');
  });

  it('15분 안에는 원천을 다시 부르지 않는다 — 같은 기업을 고른 다른 사람도 캐시를 쓴다', async () => {
    await put([SAMSUNG]);
    await put([SAMSUNG], USER_B);
    await today();
    const before = calls.length;
    vi.setSystemTime(new Date(T0.getTime() + 14 * 60_000));
    const { body } = await today(USER_B);
    expect(calls.length).toBe(before);
    expect(body.complete).toBe(true);
    expect(body.fetched_at).toBe(T0.toISOString());
    vi.setSystemTime(new Date(T0.getTime() + 16 * 60_000));
    await today();
    expect(calls.length).toBeGreaterThan(before);
  });

  it('한국 날짜가 바뀌면 15분 안이어도 새 창으로 다시 묻는다', async () => {
    await put([SAMSUNG]);
    vi.setSystemTime(new Date('2026-10-26T14:55:00.000Z')); // 한국 23:55
    await today();
    const before = dartCalls().length;
    vi.setSystemTime(new Date('2026-10-26T15:05:00.000Z')); // 한국 다음 날 00:05
    const { body } = await today();
    expect(dartCalls().length).toBeGreaterThan(before);
    expect(dartCalls().at(-1)!.searchParams.get('end_de')).toBe('20261027');
    expect(body.window).toEqual({ from: '2026-10-21', to: '2026-10-27' });
  });

  it('013(없음)이 성공한 회차에서만 "공시 없음" — ok 이고 빈 목록', async () => {
    await put([HYNIX]);
    const { body } = await today();
    expect(body.companies).toEqual([
      { corp_code: HYNIX, corp_name: 'SK하이닉스', status: 'ok', fetched_at: T0.toISOString() },
    ]);
    expect(body.disclosures).toEqual([]);
    expect(body.complete).toBe(true);
  });

  it('한 번도 성공하지 못한 실패는 unavailable — 빈 목록을 "없음" 으로 말하지 않는다', async () => {
    await put([SAMSUNG]);
    dartHandler = () => jsonRes('{"status":"800","message":"점검"}');
    const { res, body } = await today();
    expect(res.status).toBe(200);
    expect(body.companies[0]).toMatchObject({ status: 'unavailable', fetched_at: null });
    expect(body.complete).toBe(false);
    expect(body.stale).toBe(false);
    expect(body.errors).toEqual([{ source: 'opendart', code: 'BRIEFING_SOURCE_MAINTENANCE', corp_code: SAMSUNG }]);
  });

  it('새로 고치다 실패하면 전에 받은 것을 그때 시각과 함께 stale 로 보여 준다', async () => {
    await put([SAMSUNG]);
    await today();
    vi.setSystemTime(new Date(T0.getTime() + 20 * 60_000));
    dartHandler = async () => {
      throw new TypeError('network down');
    };
    policyHandler = () => new Response('', { status: 502 });
    const { body } = await today();
    expect(body.stale).toBe(true);
    expect(body.complete).toBe(false);
    expect(body.fetched_at).toBe(T0.toISOString());
    expect(body.companies[0]).toMatchObject({ status: 'stale', fetched_at: T0.toISOString() });
    expect(body.disclosures).toHaveLength(3);
    expect(body.policy_news).toHaveLength(2);
    expect(body.errors.map((e) => e.code).sort()).toEqual(['BRIEFING_SOURCE_FAILED', 'BRIEFING_SOURCE_FAILED']);

    // 실패 직후(60초 안) 다시 열어도 원천을 두드리지 않는다.
    const before = calls.length;
    vi.setSystemTime(new Date(T0.getTime() + 20 * 60_000 + 30_000));
    expect((await today()).body.stale).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('요청 한도(020)면 Retry-After 를 싣고, 대기 동안 그 원천에 묻지 않는다', async () => {
    await put([SAMSUNG, HYNIX]);
    dartHandler = () => jsonRes(fixture('dart-list-020.json'));
    const { res, body } = await today();
    expect(res.headers.get('Retry-After')).toBe('900');
    expect(body.errors.filter((e) => e.code === 'BRIEFING_SOURCE_RATE_LIMITED')).toHaveLength(2);
    expect(body.errors[0]).toMatchObject({ retry_after_seconds: 900 });

    vi.setSystemTime(new Date(T0.getTime() + 5 * 60_000));
    const before = dartCalls().length;
    const again = await today();
    expect(dartCalls().length).toBe(before);
    expect(Number(again.res.headers.get('Retry-After'))).toBe(600);
  });

  it('원천 키가 하나 없으면 그 원천만 not configured, 둘 다 없으면 503', async () => {
    await put([SAMSUNG]);
    const { body } = await today(USER_A, { OPENDART_API_KEY: 'dart-key' } as unknown as Env);
    expect(body.errors).toEqual([{ source: 'policy_news', code: 'BRIEFING_SOURCE_NOT_CONFIGURED' }]);
    expect(body.policy_news).toEqual([]);
    expect(body.complete).toBe(false);
    expect(policyCalls()).toHaveLength(0);

    const none = await call('/briefing/today', undefined, {} as Env);
    expect(none.status).toBe(503);
    expect((await none.json()).error_code).toBe('BRIEFING_NOT_CONFIGURED');
  });

  it('원천에서 사라진 공시는 다음 성공에서 지우고, 같은 내용은 다시 쓰지 않는다', async () => {
    await put([SAMSUNG]);
    await today();
    const firstFetched = (await db.execute(`SELECT fetched_at FROM briefing_items WHERE source_id = '20261026000123'`))
      .rows[0]!.fetched_at;
    vi.setSystemTime(new Date(T0.getTime() + 16 * 60_000));
    dartHandler = () => jsonRes(fixture('dart-list-page1.json').replace('"total_page": 2', '"total_page": 1'));
    const { body } = await today();
    expect(body.disclosures.map((d) => d.id)).toEqual(['20261026000123', '20261023000456']);
    const after = (await db.execute(`SELECT fetched_at FROM briefing_items WHERE source_id = '20261026000123'`)).rows[0]!
      .fetched_at;
    expect(after).toBe(firstFetched);
  });

  it('기업마다 따로 자른다 — 공시가 많은 한 곳이 다른 기업을 밀어내지 않고, 잘렸으면 complete 가 아니다', async () => {
    await put([SAMSUNG, HYNIX]);
    await today();
    // 삼성전자에 공시를 잔뜩 더 둔다(최근 날짜), SK하이닉스에는 오래된 두 건.
    const insert = (id: string, corp: string, date: string) =>
      db.execute({
        sql: `INSERT INTO briefing_items (source_kind, source_id, corp_code, title, org_name, summary, remarks, flags_json,
                published_date, published_at, source_url, content_hash, fetched_at)
              VALUES ('opendart', ?, ?, '보고서', '회사', '', '', '{}', ?, NULL, 'https://dart.fss.or.kr/x', 'h', ?)`,
        args: [id, corp, date, T0.toISOString()],
      });
    for (let i = 0; i < 30; i++) await insert(`9026102600${String(i).padStart(4, '0')}`, SAMSUNG, '2026-10-26');
    await insert('80261020000001', HYNIX, '2026-10-20');
    await insert('80261020000002', HYNIX, '2026-10-20');
    const { body } = await today(); // 15분 안 — 원천을 다시 부르지 않고 캐시를 읽는다
    const byCorp = (corp: string) => body.disclosures.filter((d) => d.corp_code === corp).length;
    expect(byCorp(HYNIX)).toBe(2);
    expect(byCorp(SAMSUNG)).toBe(20);
    expect(body.complete).toBe(false);
  });

  it('먼저 시작해 늦게 끝난 새로고침은 뒤 새로고침이 적은 것을 지우거나 덮지 못한다', async () => {
    await put([SAMSUNG]);
    await today();
    const T1 = new Date(T0.getTime() + 16 * 60_000);
    vi.setSystemTime(T1);
    // A: 첫 쪽만 든 옛 답(한 쪽짜리 = complete → 창 안의 나머지를 지우려 한다). 문이 열릴 때까지 붙잡는다.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    dartHandler = async (url) => {
      if (first) {
        first = false;
        await gate;
        return jsonRes(fixture('dart-list-page1.json').replace('"total_page": 2', '"total_page": 1'));
      }
      return defaultDart(url);
    };
    const before = dartCalls().length;
    const a = today();
    await vi.waitFor(() => expect(dartCalls()).toHaveLength(before + 1));
    // B: 1초 뒤에 시작해 두 쪽을 다 받고 먼저 끝난다.
    vi.setSystemTime(new Date(T1.getTime() + 1000));
    const b = await today();
    const all = b.body.disclosures.map((d) => d.id).sort();
    expect(all.length).toBeGreaterThan(2);
    release();
    await a;
    const kept = (
      await db.execute(`SELECT source_id FROM briefing_items WHERE source_kind = 'opendart' ORDER BY source_id`)
    ).rows.map((row) => String(row.source_id));
    expect(kept).toEqual(all);
    const state = (await db.execute(`SELECT last_success_at FROM briefing_fetch_state WHERE scope_key LIKE '%${SAMSUNG}%'`))
      .rows[0]!;
    expect(state.last_success_at).toBe(new Date(T1.getTime() + 1000).toISOString());
  });

  it('잘린 응답(쪽 상한)이면 complete 가 아니고 지우지도 않는다', async () => {
    await put([SAMSUNG]);
    dartHandler = (url) =>
      jsonRes(
        url.searchParams.get('page_no') === '1'
          ? fixture('dart-list-page1.json').replace('"total_page": 2', '"total_page": 9')
          : fixture('dart-list-page2.json').replace('"total_page": 2', '"total_page": 9'),
      );
    const { body } = await today();
    expect(body.complete).toBe(false);
    expect(body.companies[0]!.status).toBe('ok');
    expect(dartCalls()).toHaveLength(3);
  });
});
