// 광고 시청 승인 세션 — 발급·시작·끝·SSV 정산·cron 재정산·관리자 대조(`docs/spec/ad-rewards.md` §3·§7).
//
// 진짜 SQLite(파일)로 돌린다 — 동시 요청·부분 고유 인덱스·batch 의 원자성이 SQL 에서 정해지기 때문이다. 순서 큐 목
// (`helpers.ts` 의 createMockDB)은 SQL 을 실행하지 않아 '두 기기가 마지막 자리를 함께 잡는가' 를 볼 수 없다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { resetAdMobKeyCacheForTest } from '../src/lib/admob-ssv';
import { AD_REWARD_MONTHLY_LIMIT, consumeAdRewardCredit, refundAdRewardCredit } from '../src/lib/ad-reward-credits';
import {
  AD_REWARD_SESSION_TTL_MS,
  AD_REWARD_START_LOCK_MS,
  AD_REWARD_STALE_MS,
  adRewardView,
  readAdRewardStatus,
  retryUnsettledAdRewardCallbacks,
} from '../src/lib/ad-reward-sessions';
import { loadAdRewardReconciliation, loadUserAdRewards } from '../src/lib/admin/ad-rewards';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-ad-reward-sessions-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });
/** 다음 정산의 첫 조회를 한 번 실패시킨다 — '기록은 남고 정산만 실패' 를 만든다. */
let failNextSettle = false;
const flakyDb = new Proxy(db, {
  get(target, prop, receiver) {
    if (prop === 'execute') {
      return (stmt: { sql: string }) => {
        if (failNextSettle && typeof stmt === 'object' && stmt.sql.includes('FROM ad_reward_callbacks WHERE transaction_id = ?') && stmt.sql.includes('reward_month, status, outcome')) {
          failNextSettle = false;
          return Promise.reject(new Error('turso hiccup'));
        }
        return target.execute(stmt as never);
      };
    }
    const v = Reflect.get(target, prop, receiver);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
vi.mock('../src/lib/db', () => ({ getDB: () => flakyDb }));

const USER = '30000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000002';
const UNIT = 'ca-app-pub-1/1234567890';
const KEY_ID = '3335741209';
const ENV = {
  JWT_SECRET: 'x',
  PASSWORD_PEPPER: 'x',
  ENVIRONMENT: 'test',
  ADMOB_REWARDED_AD_UNITS: UNIT,
  ADMOB_REWARDED_ADS_ENABLED: 'true',
} as unknown as Env;
const OFF = { ...ENV, ADMOB_REWARDED_ADS_ENABLED: undefined } as unknown as Env;

let keyPair: CryptoKeyPair;
let keysJson: string;

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.subarray(i);
    if (v[0]! & 0x80) v = Uint8Array.from([0, ...v]);
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
async function signedQuery(params: Record<string, string>): Promise<string> {
  const content = new URLSearchParams(params).toString();
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(content)),
  );
  const sig = b64(rawToDer(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${content}&signature=${sig}&key_id=${KEY_ID}`;
}

function buildApp() {
  return import('../src/routes/ad-reward-sessions').then(async ({ default: sessions }) => {
    const { default: ads } = await import('../src/routes/ads');
    const app = new Hono<AppEnv>();
    app.route('/api/ads', ads);
    // 인증 미들웨어 대신 — `x-user` 헤더의 계정으로 들어온 것으로 본다.
    app.use('/api/ad-rewards/*', async (c, next) => {
      const user = c.req.header('x-user') ?? USER;
      c.set('userIdPK', user);
      c.set('userId', user);
      await next();
    });
    app.route('/api/ad-rewards', sessions);
    return app;
  });
}

async function api(method: string, path: string, body?: unknown, opts: { env?: Env; user?: string } = {}) {
  const app = await buildApp();
  const res = await app.request(
    `/api/ad-rewards${path}`,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-user': opts.user ?? USER },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts.env ?? ENV,
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const prepare = (opts: { env?: Env; user?: string; platform?: string } = {}) =>
  api('POST', '/sessions', { platform: opts.platform ?? 'android', ad_unit: UNIT }, opts);
const start = (id: string, opts: { env?: Env; user?: string } = {}) => api('POST', `/sessions/${id}/start`, undefined, opts);
const close = (id: string, outcome: string, opts: { user?: string } = {}) =>
  api('POST', `/sessions/${id}/close`, { outcome }, opts);

let txSeq = 0;
/** AdMob 서버의 SSV 콜백 하나. `session` 이 없으면 승인 id 없는 옛 콜백이다. */
async function ssv(o: { session?: string; user?: string; tx?: string; at?: number; adUnit?: string; env?: Env } = {}) {
  const { default: ads } = await import('../src/routes/ads');
  const app = new Hono<AppEnv>();
  app.route('/api/ads', ads);
  const q = await signedQuery({
    ad_network: '5450213213286189855',
    ad_unit: o.adUnit ?? '1234567890',
    custom_data: o.session ?? '',
    reward_amount: '1',
    reward_item: 'manual_tts',
    timestamp: String(o.at ?? Date.now()),
    transaction_id: o.tx ?? `tx-${++txSeq}`,
    user_id: o.user ?? USER,
  });
  const res = await app.request(`/api/ads/admob-ssv?${q}`, undefined, o.env ?? ENV);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const status = () => readAdRewardStatus(db, USER);
const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.execute({ sql, args })).rows[0]!.n);

/** 이번 달 적립 n 개를 미리 깔아 둔다(다른 광고로 받은 것). */
async function seedGrants(n: number, month: string, user = USER) {
  for (let i = 0; i < n; i++) {
    await db.execute({
      sql: `INSERT INTO ad_reward_credits (transaction_id, user_id, ad_unit, grant_month) VALUES (?, ?, '1234567890', ?)`,
      args: [`seed-${user}-${month}-${i}`, user, month],
    });
  }
}

/** 준비 → 시작까지 마친 세션 id. */
async function startedSession(opts: { user?: string } = {}): Promise<string> {
  const p = await prepare(opts);
  expect(p.status).toBe(201);
  const s = await start(p.body.session.id, opts);
  expect(s.status).toBe(200);
  return p.body.session.id as string;
}

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  keysJson = JSON.stringify({ keys: [{ keyId: Number(KEY_ID), pem: 'unused', base64: b64(spki) }] });
  await runMigrations(db);
}, 60_000);

beforeEach(async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00.000Z')); // KST 10월 15일 정오
  resetAdMobKeyCacheForTest();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(keysJson, { status: 200 })));
  failNextSettle = false;
  for (const t of ['ad_reward_callbacks', 'ad_reward_sessions', 'ad_reward_credits', 'plan_grants']) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await db.execute({ sql: `DELETE FROM users WHERE id IN (?, ?)`, args: [USER, OTHER] });
  for (const id of [USER, OTHER]) {
    await db.execute({
      sql: `INSERT INTO users (id, email, name, plan) VALUES (?, ?, '무료', 'free')`,
      args: [id, `${id}@example.com`],
    });
  }
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('발급 — 자리 예약과 한 계정 한 세션', () => {
  it('승인 id 를 발급하고 SSV 에 실을 계정 PK·승인 id 를 준다 — 자리 하나를 잡는다', async () => {
    const p = await prepare();
    expect(p.status).toBe(201);
    expect(p.body.ssv).toEqual({ user_id: USER, custom_data: p.body.session.id });
    expect(p.body.session.status).toBe('prepared');
    expect((await status()).remaining_grants).toBe(AD_REWARD_MONTHLY_LIMIT - 1);
    expect((await status()).session_open).toBe(true);
  });

  it('두 기기가 마지막 자리를 동시에 요청하면 하나만 받는다', async () => {
    await seedGrants(AD_REWARD_MONTHLY_LIMIT - 1, '2026-10');
    const results = await Promise.all([prepare({ platform: 'android' }), prepare({ platform: 'ios' })]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    const refused = results.find((r) => r.status === 409)!;
    expect(['AD_REWARD_SESSION_OPEN', 'AD_REWARD_MONTHLY_LIMIT']).toContain(refused.body.error_code);
    expect(await count(`SELECT COUNT(*) AS n FROM ad_reward_sessions WHERE user_id = ?`, [USER])).toBe(1);
  });

  it('자리가 남아도 열린 세션이 있으면 다른 기기는 기다린다', async () => {
    await prepare();
    const second = await prepare({ platform: 'ios' });
    expect(second.status).toBe(409);
    expect(second.body.error_code).toBe('AD_REWARD_SESSION_OPEN');
  });

  it('이번 달 자리가 없으면 다음 제공일과 함께 거절한다', async () => {
    await seedGrants(AD_REWARD_MONTHLY_LIMIT, '2026-10');
    const p = await prepare();
    expect(p.status).toBe(409);
    expect(p.body.error_code).toBe('AD_REWARD_MONTHLY_LIMIT');
    expect(p.body.next_grant_at).toBe('2026-10-31T15:00:00Z'); // 11월 1일 0시 KST
    const view = adRewardView(ENV, await status());
    expect(view).toMatchObject({ can_watch: false, unavailable_reason: 'monthly_limit', next_grant_at: '2026-10-31T15:00:00Z' });
  });

  it('플러스·관리자 지급 계정에는 발급하지 않는다 — 광고 제안 없음', async () => {
    await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [USER] });
    const p = await prepare();
    expect(p.status).toBe(409);
    expect(p.body).toMatchObject({ error_code: 'AD_REWARD_UNAVAILABLE', reason: 'plan' });
  });

  it('서버 허용 목록에 없는 광고 단위로는 발급하지 않는다', async () => {
    const p = await api('POST', '/sessions', { platform: 'ios', ad_unit: 'ca-app-pub-1/999' });
    expect(p.body).toMatchObject({ error_code: 'AD_REWARD_UNAVAILABLE', reason: 'ad_unit' });
  });
});

describe('운영 스위치 — 신규 시청만 끈다', () => {
  it('꺼지면 새 세션을 만들지 않지만, 이미 시작한 세션의 보상은 정산한다', async () => {
    const id = await startedSession();
    await close(id, 'earned');
    const refused = await prepare({ env: OFF });
    expect(refused.body).toMatchObject({ error_code: 'AD_REWARD_UNAVAILABLE', reason: 'disabled' });
    const cb = await ssv({ session: id, env: OFF });
    expect(cb.body).toEqual({ granted: true });
    expect((await status()).credits).toBe(1);
    expect(adRewardView(OFF, await status())).toMatchObject({ credits: 1, can_watch: false, unavailable_reason: 'disabled' });
  });

  it('준비와 시작 사이에 꺼지면 시작을 거절하고 예약을 푼다', async () => {
    const p = await prepare();
    const s = await start(p.body.session.id, { env: OFF });
    expect(s.body).toMatchObject({ error_code: 'AD_REWARD_UNAVAILABLE', reason: 'disabled' });
    expect((await status()).remaining_grants).toBe(AD_REWARD_MONTHLY_LIMIT);
    expect((await status()).session_open).toBe(false);
  });
});

describe('보상이 생길 수 없는 끝 — 예약과 잠금을 푼다', () => {
  it('재고 없음', async () => {
    const p = await prepare();
    const c = await close(p.body.session.id, 'no_fill');
    expect(c.body.session.status).toBe('released');
    expect(await status()).toMatchObject({ remaining_grants: AD_REWARD_MONTHLY_LIMIT, session_open: false });
    expect((await prepare()).status).toBe(201);
  });

  it('시작 전 10분이 지나면 시작할 수 없고 자리는 돌아온다', async () => {
    const p = await prepare();
    vi.setSystemTime(Date.now() + AD_REWARD_SESSION_TTL_MS + 1_000);
    expect((await status()).remaining_grants).toBe(AD_REWARD_MONTHLY_LIMIT);
    const s = await start(p.body.session.id);
    expect(s.status).toBe(409);
    expect(s.body).toMatchObject({ error_code: 'AD_REWARD_SESSION_INVALID', reason: 'expired' });
    expect((await prepare()).status).toBe(201);
  });
});

describe('중도 닫기·결과 불명 — 시작 뒤에는 지우지 않는다', () => {
  it('보상 신호 없이 닫혀도 늦게 온 정당한 콜백은 정산한다', async () => {
    const id = await startedSession();
    const c = await close(id, 'dismissed');
    expect(c.body.session.status).toBe('closed');
    // 잠금·자리는 풀린다 — 곧바로 다음 광고를 볼 수 있다.
    expect(await status()).toMatchObject({ remaining_grants: AD_REWARD_MONTHLY_LIMIT, session_open: false });
    vi.setSystemTime(Date.now() + 30 * 60 * 1000);
    expect((await ssv({ session: id })).body).toEqual({ granted: true });
    expect((await status()).credits).toBe(1);
  });

  it('시작 뒤 끝을 못 들으면 15분 뒤 잠금만 풀고 자리는 남긴다 — 콜백이 오면 정산한다', async () => {
    const id = await startedSession();
    vi.setSystemTime(Date.now() + AD_REWARD_START_LOCK_MS + 1_000);
    expect((await status()).session_open).toBe(false);
    const next = await prepare({ platform: 'ios' });
    expect(next.status).toBe(201);
    const row = await db.execute({ sql: `SELECT status FROM ad_reward_sessions WHERE id = ?`, args: [id] });
    expect(row.rows[0]!.status).toBe('unknown');
    expect((await status()).remaining_grants).toBe(AD_REWARD_MONTHLY_LIMIT - 2);
    expect((await ssv({ session: id })).body).toEqual({ granted: true });
  });
});

describe('정산 대기 · 앱 재시작 · 지연 지급', () => {
  it('끝까지 봤다고 알린 뒤 콜백 전에는 정산 대기로 보이고, 콜백이 오면 지급된다', async () => {
    const id = await startedSession();
    const c = await close(id, 'earned');
    expect(c.body.session).toMatchObject({ status: 'pending', granted: false });
    // 앱이 다시 열려도(세션 id 를 잊어도) 현황이 대기를 말한다 — '보상을 확인하고 있어요'.
    expect(await status()).toMatchObject({ pending: 1, credits: 0, session_open: false });
    // 몇 시간 뒤에 와도 받는다.
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    expect((await ssv({ session: id })).body).toEqual({ granted: true });
    expect(await status()).toMatchObject({ pending: 0, credits: 1 });
    expect((await api('GET', `/sessions/${id}`)).body.session).toMatchObject({ status: 'granted', granted: true });
  });

  it('앱의 earned 만으로는 적립하지 않는다', async () => {
    const id = await startedSession();
    await close(id, 'earned');
    await close(id, 'earned');
    expect((await status()).credits).toBe(0);
  });

  it('정산이 실패해도 기록은 남고 200 이다 — cron 이 다시 정산한다', async () => {
    const id = await startedSession();
    await close(id, 'earned');
    failNextSettle = true;
    const cb = await ssv({ session: id, tx: 'tx-deferred' });
    expect(cb.status).toBe(200);
    expect(cb.body).toMatchObject({ granted: false, deferred: true });
    expect(await count(`SELECT COUNT(*) AS n FROM ad_reward_callbacks WHERE status = 'received'`)).toBe(1);
    expect((await status()).credits).toBe(0);
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    expect(await retryUnsettledAdRewardCallbacks(db, ENV)).toEqual({ settled: 1, failed: 0 });
    expect((await status()).credits).toBe(1);
  });
});

describe('SSV 대조 — 거래 id 중복·승인 id 재사용·계정·광고 단위', () => {
  it('같은 콜백이 다시 와도 한 번만 적립한다', async () => {
    const id = await startedSession();
    const first = await ssv({ session: id, tx: 'tx-same' });
    const again = await ssv({ session: id, tx: 'tx-same' });
    expect(first.body).toEqual({ granted: true });
    expect(again.body).toEqual({ granted: true });
    expect((await status()).credits).toBe(1);
    expect(await count(`SELECT attempts AS n FROM ad_reward_callbacks WHERE transaction_id = 'tx-same'`)).toBe(2);
  });

  it('승인 하나에는 보상 한 번 — 다른 거래 id 로 같은 승인을 다시 쓰지 못한다', async () => {
    const id = await startedSession();
    expect((await ssv({ session: id, tx: 'tx-a' })).body).toEqual({ granted: true });
    expect((await ssv({ session: id, tx: 'tx-b' })).body).toEqual({ granted: false });
    expect((await status()).credits).toBe(1);
    const outcome = await db.execute(`SELECT outcome FROM ad_reward_callbacks WHERE transaction_id = 'tx-b'`);
    expect(outcome.rows[0]!.outcome).toBe('session_reused');
  });

  it('남의 승인 id 를 실은 콜백은 적립하지 않는다', async () => {
    const id = await startedSession();
    expect((await ssv({ session: id, user: OTHER })).body).toEqual({ granted: false });
    expect(await readAdRewardStatus(db, OTHER)).toMatchObject({ credits: 0 });
    expect((await status()).credits).toBe(0);
  });

  it('세션과 다른 광고 단위의 콜백은 적립하지 않는다', async () => {
    const id = await startedSession();
    const env = { ...ENV, ADMOB_REWARDED_AD_UNITS: `${UNIT},ca-app-pub-1/555` } as unknown as Env;
    expect((await ssv({ session: id, adUnit: '555', env })).body).toEqual({ granted: false });
  });

  it('모르는 승인 id 는 적립하지 않는다 — 옛 경로로 새지 않는다', async () => {
    expect((await ssv({ session: '30000000-0000-4000-8000-0000000000aa' })).body).toEqual({ granted: false });
    expect((await ssv({ session: 'not-a-uuid' })).body).toEqual({ granted: false });
    expect((await status()).credits).toBe(0);
  });
});

describe('시청 중 플러스 전환 · 월 경계', () => {
  it('무료로 승인한 시청은 그 사이 플러스가 돼도 적립해 잔액으로 남긴다', async () => {
    const id = await startedSession();
    await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [USER] });
    expect((await ssv({ session: id })).body).toEqual({ granted: true });
    expect((await status()).credits).toBe(1);
  });

  it('승인 없는 옛 콜백은 옛 규칙 그대로 — 유료면 적립하지 않는다', async () => {
    await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [USER] });
    expect((await ssv()).body).toEqual({ granted: false });
    await db.execute({ sql: `UPDATE users SET plan = 'free' WHERE id = ?`, args: [USER] });
    expect((await ssv()).body).toEqual({ granted: true });
  });

  it('시청 중 달이 바뀌면 보상 시각의 달로 적립하고, 그 달이 이미 찼어도 잃지 않는다', async () => {
    vi.setSystemTime(new Date('2026-10-31T14:58:00.000Z')); // KST 10월 31일 23:58
    const id = await startedSession();
    await seedGrants(AD_REWARD_MONTHLY_LIMIT, '2026-11'); // 11월은 이미 찼다(다른 기기에서)
    vi.setSystemTime(new Date('2026-10-31T15:00:30.000Z')); // KST 11월 1일 00:00:30
    const cb = await ssv({ session: id, at: Date.now() });
    expect(cb.body).toEqual({ granted: true });
    const row = await db.execute({ sql: `SELECT granted_month FROM ad_reward_sessions WHERE id = ?`, args: [id] });
    expect(row.rows[0]!.granted_month).toBe('2026-11');
  });

  it('발급과 시작 사이에 달이 바뀌면 새 달의 자리를 다시 본다', async () => {
    vi.setSystemTime(new Date('2026-10-31T14:55:00.000Z')); // KST 23:55
    const p = await prepare();
    await seedGrants(AD_REWARD_MONTHLY_LIMIT, '2026-11');
    vi.setSystemTime(new Date('2026-10-31T15:01:00.000Z')); // KST 11월 1일 00:01
    const s = await start(p.body.session.id);
    expect(s.body.error_code).toBe('AD_REWARD_MONTHLY_LIMIT');
    expect((await status()).session_open).toBe(false);
  });
});

describe('생성 실패 환급', () => {
  it('쓴 보상을 돌려주면 다시 쓸 수 있다 — 쓴 것도 그 달 적립으로 센다', async () => {
    const id = await startedSession();
    await ssv({ session: id });
    const used = await consumeAdRewardCredit(db, USER);
    expect(used).not.toBeNull();
    expect((await status()).credits).toBe(0);
    await refundAdRewardCredit(db, used!);
    expect(await status()).toMatchObject({ credits: 1, remaining_grants: AD_REWARD_MONTHLY_LIMIT - 1 });
  });
});

describe('관리자 대조 (읽기 전용)', () => {
  it('24시간 넘은 미확정 세션과 정산 못 한 콜백을 모은다', async () => {
    const id = await startedSession();
    await close(id, 'earned');
    failNextSettle = true;
    const other = await startedSession({ user: OTHER });
    await ssv({ session: other, user: OTHER, tx: 'tx-stuck' });
    vi.setSystemTime(Date.now() + AD_REWARD_STALE_MS + 60_000);
    const all = await loadAdRewardReconciliation(db, new Date());
    expect(all.stale_sessions.map((s) => s.id)).toContain(id);
    expect(all.unsettled_callbacks.map((c) => c.transaction_id)).toEqual(['tx-stuck']);
    const mine = await loadUserAdRewards(db, USER, new Date());
    expect(mine.mismatches).toEqual([{ kind: 'stale_pending', ref: id }]);
    expect(mine.balance.pending).toBe(0); // 앱의 '확인하고 있어요' 창(24시간)은 지났다 — 이제 운영 확인 대상이다
  });
});
