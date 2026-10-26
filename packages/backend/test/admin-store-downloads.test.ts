// 관리자 콘솔 스토어 다운로드(`docs/spec/admin-console.md` 「스토어 다운로드」). 네트워크는 부르지 않는다 — fetch 를 갈아 끼운다.
//  - 파일 해석: Play CSV(UTF-16LE·BOM·머리줄 변형), App Store gzip TSV, 형식이 다르면 던진다
//  - App Store Connect 토큰: 머리·본문 모양과 서명
//  - 크론: 두 번 돌려도 같은 행(멱등), 받은 하루치는 다시 받지 않는다, 같은 날 인스턴스를 더하지 않는다, 설정이 없으면 DB 도
//    부르지 않는다, 한쪽 실패가 다른 쪽을 막지 않는다
//  - 화면: 설정 없음 / 연결됐는데 숫자 없음 / 숫자 있음
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import {
  StoreReportError,
  ascReportKind,
  decodeReportText,
  gunzipIfNeeded,
  normalizeDay,
  parseAscReport,
  parseDelimited,
  parsePlayInstallsCsv,
} from '../src/lib/admin/store-reports';
import {
  ascMissingSettings,
  playMissingSettings,
  playMonthsToFetch,
  playReportsBucket,
  resetAscCache,
  signAscJwt,
} from '../src/lib/admin/store-sources';
import { isStoreSyncTick, loadStoreDownloads, runStoreDownloadSync } from '../src/lib/admin/store-downloads';
import { storePanel } from '../src/lib/admin/pages';
import adminRoutes from '../src/routes/admin';

const utf16leWithBom = (text: string) => new Uint8Array([0xff, 0xfe, ...Buffer.from(text, 'utf16le')]);

function b64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function toPem(der: ArrayBuffer, escapedNewlines = false): string {
  const body = Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  return escapedNewlines ? pem.replace(/\n/g, '\\n') : pem;
}

// ── 파일 해석 ────────────────────────────────────────────────────────────────

describe('Play 통계 CSV', () => {
  const csv = [
    'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events',
    '2026-10-01,com.alarmtalk.app,5,1,2,120,4,1,90,6,3,1',
    '2026-10-02,com.alarmtalk.app,0,0,0,120,0,0,90,0,0,0',
    '',
  ].join('\r\n');

  it('UTF-16LE + BOM 을 읽고 날짜별 지표를 낸다', () => {
    const out = parsePlayInstallsCsv(utf16leWithBom(csv), 'com.alarmtalk.app');
    expect(out.get('2026-10-01')).toMatchObject({
      daily_device_installs: 5,
      daily_user_installs: 4,
      total_user_installs: 120,
      daily_user_uninstalls: 1,
      active_device_installs: 90,
      install_events: 6,
    });
    // 0 인 날도 0 으로 남는다(빠진 날과 다르다).
    expect(out.get('2026-10-02')?.daily_user_installs).toBe(0);
    expect(out.size).toBe(2);
  });

  it('BOM 없는 UTF-16LE · UTF-8 BOM · 맨 UTF-8 이 같은 글자가 된다', () => {
    const text = 'Date,Daily User Installs\n2026-10-01,3\n';
    expect(decodeReportText(new Uint8Array(Buffer.from(text, 'utf16le')))).toBe(text);
    expect(decodeReportText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(text)]))).toBe(text);
    expect(decodeReportText(new Uint8Array(Buffer.from(text)))).toBe(text);
    const be = Buffer.from(text, 'utf16le').swap16();
    expect(decodeReportText(new Uint8Array([0xfe, 0xff, ...be]))).toBe(text);
  });

  it('머리줄 변형 — 따옴표·대소문자·밑줄·옛 이름(Current Device Installs)', () => {
    const variant = [
      '"date","PACKAGE_NAME","daily_user_installs","Current Device Installs","Total User Installs "',
      '"20261003","com.alarmtalk.app","1,204","88","500"',
      '"10/04/2026","com.other.app","9","9","9"',
    ].join('\n');
    const out = parsePlayInstallsCsv(utf16leWithBom(variant), 'com.alarmtalk.app');
    expect(out.get('2026-10-03')).toEqual({ daily_user_installs: 1204, active_device_installs: 88, total_user_installs: 500 });
    // 다른 패키지 줄은 버린다.
    expect(out.has('2026-10-04')).toBe(false);
  });

  it('빈 칸은 0 이 아니라 없는 값이다', () => {
    const out = parsePlayInstallsCsv(utf16leWithBom('Date,Daily User Installs,Daily Device Installs\n2026-10-05,,7\n'));
    expect(out.get('2026-10-05')).toEqual({ daily_device_installs: 7 });
  });

  it('날짜·설치 칸이 없으면 던진다 — 조용히 0 을 쌓지 않는다', () => {
    expect(() => parsePlayInstallsCsv(utf16leWithBom('Day,Something\n2026-10-01,1\n'))).toThrow(StoreReportError);
    expect(() => parsePlayInstallsCsv(utf16leWithBom('Date,Ratings\n2026-10-01,1\n'))).toThrow(StoreReportError);
  });

  it('구분자 글 — 따옴표 안의 쉼표·줄바꿈·""', () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
    expect(normalizeDay('2026-10-01')).toBe('2026-10-01');
    expect(normalizeDay('1/2/2026')).toBe('2026-01-02');
    expect(normalizeDay('어제')).toBeNull();
  });
});

describe('App Store 분석 보고서', () => {
  const downloadsTsv = [
    ['Date', 'App Name', 'App Apple Identifier', 'Download Type', 'App Version', 'Device', 'Territory', 'Counts'].join('\t'),
    ['2026-10-19', '알람톡', '123', 'First-time download', '1.2.14', 'iPhone', 'KR', '7'].join('\t'),
    ['2026-10-19', '알람톡', '123', 'First-time download', '1.2.14', 'iPad', 'JP', '2'].join('\t'),
    ['2026-10-19', '알람톡', '123', 'Redownload', '1.2.14', 'iPhone', 'KR', '3'].join('\t'),
    ['2026-10-19', '알람톡', '123', 'Manual update', '1.2.14', 'iPhone', 'KR', '40'].join('\t'),
    ['2026-10-19', '알람톡', '123', 'Auto-update', '1.2.14', 'iPhone', 'KR', '50'].join('\t'),
  ].join('\n');

  it('gzip TSV 를 풀어 최초 다운로드·재다운로드만 센다(업데이트 제외)', async () => {
    const bytes = await gunzipIfNeeded(new Uint8Array(gzipSync(Buffer.from(downloadsTsv))));
    expect(parseAscReport(bytes, 'downloads').get('2026-10-19')).toEqual({ first_time_downloads: 9, redownloads: 3 });
  });

  it('gzip 이 아니면 그대로 읽는다', async () => {
    const plain = new Uint8Array(Buffer.from(downloadsTsv));
    expect(await gunzipIfNeeded(plain)).toBe(plain);
  });

  it('설치·삭제 보고서', async () => {
    const tsv = ['Date\tEvent\tDownload Type\tCounts\tUnique Devices', '2026-10-19\tInstall\tFirst-time download\t5\t5', '2026-10-19\tDelete\t\t2\t2'].join(
      '\n',
    );
    const bytes = await gunzipIfNeeded(new Uint8Array(gzipSync(Buffer.from(tsv))));
    expect(parseAscReport(bytes, 'installs').get('2026-10-19')).toEqual({ installs: 5, deletions: 2 });
  });

  it('칸이 없으면 던진다', () => {
    expect(() => parseAscReport(new Uint8Array(Buffer.from('Date\tCounts\n2026-10-19\t1')), 'downloads')).toThrow(StoreReportError);
  });

  it('보고서 이름 — Standard 만 고른다', () => {
    expect(ascReportKind('App Downloads Standard')).toBe('downloads');
    expect(ascReportKind('App Store Installation and Deletion Standard')).toBe('installs');
    expect(ascReportKind('App Downloads Detailed')).toBeNull();
    expect(ascReportKind('App Sessions Standard')).toBeNull();
  });
});

describe('App Store Connect 토큰', () => {
  it('ES256 머리·본문 모양이 규격대로이고 서명이 맞다 — 한 줄 \\n PEM 도 받는다', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pem = toPem((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer, true);
    const nowMs = Date.parse('2026-10-20T00:00:00Z');
    const jwt = await signAscJwt({ issuerId: 'issuer-uuid', keyId: 'KEY123ABCD', privateKeyPem: pem }, nowMs);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(b64urlDecode(h!)).toString())).toEqual({ alg: 'ES256', kid: 'KEY123ABCD', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(b64urlDecode(p!)).toString());
    expect(payload).toEqual({ iss: 'issuer-uuid', iat: nowMs / 1000, exp: nowMs / 1000 + 1200, aud: 'appstoreconnect-v1' });
    expect(payload).not.toHaveProperty('bid');
    const sig = b64urlDecode(s!);
    expect(sig.length).toBe(64); // r||s — DER 이 아니다
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      sig as BufferSource,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

describe('설정·일정', () => {
  it('버킷 값은 gs:// 꼴도 받고, 이상한 값은 없는 것으로 본다', () => {
    expect(playReportsBucket({ PLAY_REPORTS_BUCKET: 'gs://pubsite_prod_rev_0123/' })).toBe('pubsite_prod_rev_0123');
    expect(playReportsBucket({ PLAY_REPORTS_BUCKET: 'pubsite_prod_rev_0123' })).toBe('pubsite_prod_rev_0123');
    expect(playReportsBucket({ PLAY_REPORTS_BUCKET: '../etc?x' })).toBeNull();
    expect(playReportsBucket({})).toBeNull();
  });

  it('빠진 설정 이름', () => {
    expect(playMissingSettings({})).toEqual(['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'ANDROID_PACKAGE_NAME', 'PLAY_REPORTS_BUCKET']);
    expect(playMissingSettings({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: 'not json' })).toContain('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    expect(ascMissingSettings({ APPLE_BUNDLE_ID: 'com.alarmtalk.app' })).toEqual([
      'ASC_API_ISSUER_ID',
      'ASC_API_KEY_ID',
      'ASC_API_PRIVATE_KEY',
    ]);
  });

  it('지난달은 처음 연결한 날과 달 초에만 받는다', () => {
    expect(playMonthsToFetch(new Date('2026-10-20T00:00:00Z'), false)).toEqual(['202610']);
    expect(playMonthsToFetch(new Date('2026-10-20T00:00:00Z'), true)).toEqual(['202609', '202610']);
    expect(playMonthsToFetch(new Date('2026-01-03T00:00:00Z'), false)).toEqual(['202512', '202601']);
  });

  it('하루 여섯 틱(한국 시각 0·3·9·12·15·18시 35~39분)', () => {
    expect(isStoreSyncTick(new Date('2026-10-20T00:35:00Z'))).toBe(true); // 09:35 KST
    expect(isStoreSyncTick(new Date('2026-10-20T00:39:59Z'))).toBe(true);
    expect(isStoreSyncTick(new Date('2026-10-20T00:40:00Z'))).toBe(false);
    expect(isStoreSyncTick(new Date('2026-10-20T12:35:00Z'))).toBe(false); // 21:35 KST — 날씨 슬롯
    expect(isStoreSyncTick(new Date('2026-10-19T15:35:00Z'))).toBe(true); // 00:35 KST
  });
});

// ── 크론 ─────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-20T00:35:00Z');
let db: Client;
let env: Partial<Env>;

const PLAY_CSV = [
  'Date,Package Name,Daily Device Installs,Total User Installs,Daily User Installs,Daily User Uninstalls',
  ...Array.from({ length: 19 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')},com.alarmtalk.app,${i + 2},${100 + i},${i + 1},1`),
].join('\n');

const DL_HEADER = 'Date\tApp Name\tDownload Type\tTerritory\tCounts';
const dlSegment = (rows: string[]) => new Uint8Array(gzipSync(Buffer.from([DL_HEADER, ...rows].join('\n'))));

interface FakeCall {
  url: string;
  method: string;
  auth: string | null;
}

/** 스토어 두 곳을 흉내 낸다. `calls` 에 부른 주소를 남긴다. */
function fakeStores(opts: { gcsStatus?: number; requests?: unknown[] } = {}) {
  const calls: FakeCall[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('authorization') });
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'google-token', expires_in: 3600 });
    if (url.startsWith('https://storage.googleapis.com/storage/v1/b/pubsite_prod_rev_0123/o/')) {
      if (opts.gcsStatus) return new Response('nope', { status: opts.gcsStatus });
      const object = decodeURIComponent(url.split('/o/')[1]!.split('?')[0]!);
      if (object === 'stats/installs/installs_com.alarmtalk.app_202610_overview.csv') return new Response(utf16leWithBom(PLAY_CSV));
      return new Response('missing', { status: 404 });
    }
    const asc = 'https://api.appstoreconnect.apple.com';
    if (url.startsWith(`${asc}/v1/apps?`)) return json({ data: [{ id: 'app-1', type: 'apps' }] });
    if (url.startsWith(`${asc}/v1/apps/app-1/analyticsReportRequests`)) {
      return json({ data: opts.requests ?? [{ id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] });
    }
    if (url === `${asc}/v1/analyticsReportRequests` && init?.method === 'POST') return json({ data: { id: 'req-new' } }, 201);
    if (url.startsWith(`${asc}/v1/analyticsReportRequests/req-1/reports`)) {
      return json({
        data: [
          { id: 'rep-dl', attributes: { name: 'App Downloads Standard' } },
          { id: 'rep-in', attributes: { name: 'App Store Installation and Deletion Standard' } },
          { id: 'rep-x', attributes: { name: 'App Sessions Standard' } },
        ],
      });
    }
    if (url.startsWith(`${asc}/v1/analyticsReports/rep-dl/instances`)) {
      return json({
        data: [
          { id: 'inst-dl-18', attributes: { granularity: 'DAILY', processingDate: '2026-10-18' } },
          // 애플이 같은 날을 다시 낸 인스턴스 — 더하면 두 배가 된다.
          { id: 'inst-dl-18b', attributes: { granularity: 'DAILY', processingDate: '2026-10-18' } },
          { id: 'inst-dl-19', attributes: { granularity: 'DAILY', processingDate: '2026-10-19' } },
        ],
      });
    }
    if (url.startsWith(`${asc}/v1/analyticsReports/rep-in/instances`)) {
      return json({ data: [{ id: 'inst-in-19', attributes: { granularity: 'DAILY', processingDate: '2026-10-19' } }] });
    }
    const seg = /\/v1\/analyticsReportInstances\/([^/]+)\/segments/.exec(url);
    if (seg) {
      const id = seg[1]!;
      const count = id === 'inst-dl-19' ? 2 : 1;
      return json({
        data: Array.from({ length: count }, (_, i) => ({
          id: `${id}-s${i}`,
          attributes: { url: `https://segments.example/${id}/${i}.csv.gz?X-Amz-Signature=secret`, checksum: 'x' },
        })),
      });
    }
    if (url.startsWith('https://segments.example/')) {
      if (url.includes('/inst-dl-18')) return new Response(dlSegment(['2026-10-18\t알람톡\tFirst-time download\tKR\t4']));
      if (url.includes('/inst-dl-19/0')) {
        // 처리일 10-19 인스턴스가 10-18 숫자를 고쳐 다시 낸다(4 → 6) — 처리일이 더 늦은 쪽이 이긴다.
        return new Response(
          dlSegment([
            '2026-10-19\t알람톡\tFirst-time download\tKR\t5',
            '2026-10-19\t알람톡\tRedownload\tKR\t1',
            '2026-10-18\t알람톡\tFirst-time download\tKR\t6',
          ]),
        );
      }
      if (url.includes('/inst-dl-19/1')) return new Response(dlSegment(['2026-10-19\t알람톡\tFirst-time download\tJP\t2']));
      // 설치·삭제 보고서는 줄이 없다 → 아무것도 적지 않는다(그날이 0 인지 모른다)
      return new Response(new Uint8Array(gzipSync(Buffer.from('Date\tEvent\tCounts\n'))));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, impl };
}

async function rows(sql: string) {
  return (await db.execute(sql)).rows.map((r) => ({ ...r }));
}

beforeAll(async () => {
  const rsa = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  env = {
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'reports@example.iam.gserviceaccount.com',
      private_key: toPem((await crypto.subtle.exportKey('pkcs8', rsa.privateKey)) as ArrayBuffer),
    }),
    ANDROID_PACKAGE_NAME: 'com.alarmtalk.app',
    PLAY_REPORTS_BUCKET: 'gs://pubsite_prod_rev_0123/',
    ASC_API_ISSUER_ID: 'issuer-uuid',
    ASC_API_KEY_ID: 'KEY123ABCD',
    ASC_API_PRIVATE_KEY: toPem((await crypto.subtle.exportKey('pkcs8', ec.privateKey)) as ArrayBuffer, true),
    APPLE_BUNDLE_ID: 'com.alarmtalk.app',
  };
});

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  holder.db = db;
  resetAscCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('크론', () => {
  it('두 번 돌려도 같은 행이다 — 덮어쓰고, 받은 하루치는 다시 받지 않는다', async () => {
    const stores = fakeStores();
    vi.stubGlobal('fetch', vi.fn(stores.impl));
    const first = await runStoreDownloadSync(db, env, NOW);
    expect(first).toEqual([
      { platform: 'android', status: 'ok', stored: 19 * 4 },
      { platform: 'ios', status: 'ok', stored: 4 },
    ]);
    // 처음 연결한 날은 지난달도 찾는다(없으면 404 로 건너뛴다).
    expect(stores.calls.filter((c) => new URL(c.url).host === 'storage.googleapis.com').length).toBe(2);
    const snapshot = await rows(`SELECT platform, day, metric, value FROM store_download_daily ORDER BY platform, day, metric`);

    const segmentsBefore = stores.calls.filter((c) => c.url.startsWith('https://segments.example/')).length;
    expect(segmentsBefore).toBe(5);
    const second = await runStoreDownloadSync(db, env, NOW);
    expect(second.map((o) => o.status)).toEqual(['ok', 'ok']);
    expect(await rows(`SELECT platform, day, metric, value FROM store_download_daily ORDER BY platform, day, metric`)).toEqual(
      snapshot,
    );
    // 두 번째는 조각을 하나도 받지 않는다 — 이미 적은 인스턴스다.
    expect(stores.calls.filter((c) => c.url.startsWith('https://segments.example/')).length).toBe(segmentsBefore);
    // 두 번째 회차에는 지난달 파일을 찾지 않는다.
    expect(stores.calls.filter((c) => new URL(c.url).host === 'storage.googleapis.com').length).toBe(3);

    const ios = Object.fromEntries(
      (await rows(`SELECT day || ':' || metric AS k, value FROM store_download_daily WHERE platform = 'ios'`)).map((r) => [r.k, r.value]),
    );
    expect(ios).toEqual({
      // 같은 날 인스턴스 셋(처리일 10-18 둘·10-19 하나) — 더하지 않고, 처리일이 늦은 10-19 의 고친 숫자가 남는다.
      '2026-10-18:first_time_downloads': 6,
      '2026-10-18:redownloads': 0,
      '2026-10-19:first_time_downloads': 7, // 조각 둘은 더한다
      '2026-10-19:redownloads': 1,
      // 줄이 없던 설치·삭제 인스턴스는 0 으로 채우지 않는다.
    });
    const android = await rows(
      `SELECT value FROM store_download_daily WHERE platform = 'android' AND day = '2026-10-19' AND metric = 'daily_user_installs'`,
    );
    expect(android).toEqual([{ value: 19 }]);
    expect(await rows(`SELECT COUNT(*) AS n FROM store_report_instances`)).toEqual([{ n: 4 }]);
  });

  it('회차를 건너도 더 이른 처리일은 더 늦은 처리일이 적은 숫자를 덮지 못한다', async () => {
    // 지난 회차가 처리일 10-25 인스턴스에서 고친 숫자를 이미 적었다.
    await db.execute({
      sql: `INSERT INTO store_download_daily (platform, day, metric, value, fetched_at, source_date)
            VALUES ('ios', '2026-10-18', 'first_time_downloads', 9, '2026-10-25T00:00:00Z', '2026-10-25')`,
      args: [],
    });
    vi.stubGlobal('fetch', vi.fn(fakeStores().impl));
    await runStoreDownloadSync(db, env, NOW);
    const kept = await rows(
      `SELECT value, source_date FROM store_download_daily WHERE platform = 'ios' AND day = '2026-10-18' AND metric = 'first_time_downloads'`,
    );
    expect(kept).toEqual([{ value: 9, source_date: '2026-10-25' }]);
    const later = await rows(
      `SELECT value, source_date FROM store_download_daily WHERE platform = 'ios' AND day = '2026-10-19' AND metric = 'first_time_downloads'`,
    );
    expect(later).toEqual([{ value: 7, source_date: '2026-10-19' }]);
  });

  it('인증 머리 — 스토어 API 에는 토큰을, 서명된 조각 주소에는 싣지 않는다. 오류·상태에 조각 주소를 남기지 않는다', async () => {
    const stores = fakeStores();
    vi.stubGlobal('fetch', vi.fn(stores.impl));
    await runStoreDownloadSync(db, env, NOW);
    for (const c of stores.calls) {
      if (new URL(c.url).host === 'api.appstoreconnect.apple.com') expect(c.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      if (new URL(c.url).host === 'storage.googleapis.com') expect(c.auth).toBe('Bearer google-token');
      if (c.url.startsWith('https://segments.example/')) expect(c.auth).toBeNull();
    }
    const state = JSON.stringify(await rows(`SELECT * FROM store_download_sync`));
    expect(state).not.toContain('X-Amz-Signature');
  });

  it('설정이 하나도 없으면 DB 도 네트워크도 부르지 않는다', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const noDb = { execute: vi.fn(), batch: vi.fn() } as unknown as Client;
    const out = await runStoreDownloadSync(noDb, { APPLE_BUNDLE_ID: 'com.alarmtalk.app' }, NOW);
    expect(out.map((o) => o.status)).toEqual(['unconfigured', 'unconfigured']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((noDb.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('Play 가 403 이어도 App Store 는 받고, Play 의 오류는 상태에 한 줄 남는다', async () => {
    const stores = fakeStores({ gcsStatus: 403 });
    vi.stubGlobal('fetch', vi.fn(stores.impl));
    const onError = vi.fn();
    const out = await runStoreDownloadSync(db, env, NOW, { onError });
    expect(out.map((o) => `${o.platform}:${o.status}`)).toEqual(['android:failed', 'ios:ok']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe('android');
    const state = await rows(`SELECT platform, last_error, last_success_at FROM store_download_sync ORDER BY platform`);
    expect(state[0]).toMatchObject({ platform: 'android', last_success_at: null });
    expect(String(state[0]!.last_error)).toContain('권한');
    expect(state[1]).toMatchObject({ platform: 'ios', last_error: null });
  });

  it('지속 보고서 요청이 없으면 만들고 그 회차는 끝난다 — 화면에 안내가 남는다', async () => {
    const stores = fakeStores({ requests: [{ id: 'old', attributes: { stoppedDueToInactivity: true } }] });
    vi.stubGlobal('fetch', vi.fn(stores.impl));
    await runStoreDownloadSync(db, { ...env, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: undefined }, NOW);
    const post = stores.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://api.appstoreconnect.apple.com/v1/analyticsReportRequests');
    expect(stores.calls.some((c) => c.url.includes('/reports'))).toBe(false);
    const view = await loadStoreDownloads(db, env);
    expect(view.ios.note).toContain('하루 이틀');
    expect(view.ios.primaryMetric).toBeNull();
  });
});

// ── 화면 ─────────────────────────────────────────────────────────────────────

describe('화면', () => {
  const NOW_MS = NOW.getTime();

  it('설정이 없으면 플랫폼마다 연결 대기와 필요한 설정을 말한다', async () => {
    const view = await loadStoreDownloads(db, {});
    const android = storePanel('android', view, NOW_MS);
    expect(android).toContain('연결 대기');
    expect(android).toContain('필요한 설정: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, ANDROID_PACKAGE_NAME, PLAY_REPORTS_BUCKET');
    const ios = storePanel('ios', view, NOW_MS);
    expect(ios).toContain('필요한 설정: ASC_API_ISSUER_ID, ASC_API_KEY_ID, ASC_API_PRIVATE_KEY, APPLE_BUNDLE_ID');
    expect(android + ios).not.toContain('class="chart"');
    expect(android + ios).not.toContain('—');
  });

  it('연결됐는데 숫자가 없으면 기다리는 중이라고 말하고 0 을 그리지 않는다', async () => {
    const html = storePanel('ios', await loadStoreDownloads(db, env), NOW_MS);
    expect(html).toContain('아직 받은 숫자가 없어요');
    expect(html).toContain('연결됨');
    expect(html).not.toContain('class="chart"');
  });

  it('숫자가 있으면 받은 마지막 날까지 30일을 그리고, 받지 못한 날은 기록 없음이다', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeStores().impl));
    await runStoreDownloadSync(db, env, NOW);
    const view = await loadStoreDownloads(db, env);
    expect(view.android.latestDay).toBe('2026-10-19');
    expect(view.android.points).toHaveLength(30);
    expect(view.android.points.at(-1)).toEqual({ day: '2026-10-19', value: 19 });
    expect(view.android.points[0]).toEqual({ day: '2026-09-20', value: null }); // 9월 파일은 없었다
    expect(view.android.totals.daily_user_installs).toBe((19 * 20) / 2);
    expect(view.android.latestValues.total_user_installs).toBe(118);

    const android = storePanel('android', view, NOW_MS);
    expect(android).toContain('class="chart"');
    expect(android).toContain('사용자 설치');
    expect(android).toContain('190'); // 30일 합
    expect(android).toContain('누적 사용자 설치');
    expect(android).toContain('기록 없음');
    expect(android).not.toContain('—');
    const ios = storePanel('ios', view, NOW_MS);
    expect(ios).toContain('최초 다운로드');
    expect(ios).toContain('재다운로드 (30일)');
  });

  it('개요 화면이 스토어 패널을 그린다 — 표를 못 읽어도 나머지는 그린다', async () => {
    const SECRET = 'admin-secret-value';
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const auth = { Authorization: 'Basic ' + Buffer.from('x:' + SECRET).toString('base64') };
    const res = await a.request('http://localhost/admin', { headers: auth }, { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings']);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('스토어 다운로드 · Google Play');
    expect(html).toContain('스토어 다운로드 · App Store');
    expect(html).toContain('필요한 설정: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    expect(html).not.toContain('—');

    await db.execute('DROP TABLE store_download_daily');
    const degraded = await a.request('http://localhost/admin', { headers: auth }, { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings']);
    expect(degraded.status).toBe(200);
    const text = await degraded.text();
    expect(text).toContain('전체 가입자');
    expect(text).toContain('숫자를 불러오지 못했어요');
  });
});
