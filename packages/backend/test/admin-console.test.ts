// 관리자 콘솔(`docs/spec/admin-console.md`) — 실제 SQLite(메모리)에 마이그레이션을 전부 돌리고 확인한다.
//  - 대상 고르기: 플랫폼·빌드 미만·기록 없는 기기·재동의 필요·광고 동의·켜진 알람·탈퇴 대기 제외
//  - 발송: 시험 발송 없이는 전체 발송을 못 만든다, 광고는 시간 밖에 못 보낸다, 걸음이 커서를 따라 끝까지 간다,
//    같은 걸음을 두 번 밟으면 한쪽만 보낸다, 기록에 받는 사람을 적지 않는다
//  - 앱 빌드 기록: 헤더 검증, 같은 값은 한 시간에 한 번
//  - 화면: 개요·사용자·알림 화면이 실제 DB 로 그려진다
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import { countAudience, parseAudience, DEFAULT_AUDIENCE } from '../src/lib/admin/audience';
import {
  AdminPushError,
  CLAIM_STALE_MS,
  STEP_SEND_LIMIT,
  cancelPushJob,
  createPushJob,
  isWithinAdHours,
  parseCopy,
  renderCopy,
  runJobStep,
  sendTestPush,
} from '../src/lib/admin/push-jobs';
import { listPushJobs, loadOverview } from '../src/lib/admin/metrics';
import {
  appPresenceMiddleware,
  parseAppVersionHeader,
  resetAppPresenceMemo,
} from '../src/middleware/appPresence';
import adminRoutes from '../src/routes/admin';
import { securityHeadersMiddleware } from '../src/middleware/securityHeaders';

const NO_PUSH_ENV = {} as AppEnv['Bindings'];
/** 한국 시각 정오 — 광고 가능 시간. */
const NOON_KST = Date.parse('2026-10-23T03:00:00.000Z');
/** 한국 시각 22시 — 광고 불가. */
const NIGHT_KST = Date.parse('2026-10-23T13:00:00.000Z');

let db: Client;

async function run(sql: string, args: Array<string | number | null> = []) {
  await db.execute({ sql, args });
}

async function consent(userId: string, type: string, version: string, agreed = 1) {
  await run(
    `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), userId, type, version, agreed],
  );
}

async function fullConsent(userId: string, version = CURRENT_POLICY_VERSION) {
  for (const type of ['terms', 'privacy', 'age14']) await consent(userId, type, version);
}

/**
 * 사람들:
 *  u-a  안드로이드 빌드 30 · 동의 완료 · 마케팅 동의 · 켜진 알람
 *  u-b  안드로이드 빌드 35 · privacy 3(재동의 필요)
 *  u-c  iOS 빌드 10 · 동의 완료
 *  u-d  안드로이드 · 빌드 기록 없음 · 동의 완료
 *  u-e  안드로이드 빌드 20 · 탈퇴 대기 → 언제나 제외
 *  u-f  안드로이드 + iOS 두 기기 · 빌드 기록 없음 · privacy 4(재동의 필요) · 마케팅 거절
 */
async function seedPeople() {
  for (const [id, status] of [
    ['u-a', 'active'],
    ['u-b', 'active'],
    ['u-c', 'active'],
    ['u-d', 'active'],
    ['u-e', 'pending_deletion'],
    ['u-f', 'active'],
  ] as const) {
    await run(`INSERT INTO users (id, email, name, plan, deletion_status) VALUES (?, ?, ?, 'free', ?)`, [
      id,
      `${id}@example.com`,
      id,
      status,
    ]);
  }
  await run(`UPDATE users SET email = 'Tester@Example.com' WHERE id = 'u-c'`);
  const tokens: Array<[string, string, string]> = [
    ['pt-a', 'u-a', 'android'],
    ['pt-b', 'u-b', 'android'],
    ['pt-c', 'u-c', 'ios'],
    ['pt-d', 'u-d', 'android'],
    ['pt-e', 'u-e', 'android'],
    ['pt-f1', 'u-f', 'android'],
    ['pt-f2', 'u-f', 'ios'],
  ];
  for (const [id, user, platform] of tokens) {
    await run(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)`, [id, user, `tok-${id}`, platform]);
  }
  for (const [user, platform, version] of [
    ['u-a', 'android', 30],
    ['u-b', 'android', 35],
    ['u-c', 'ios', 10],
    ['u-e', 'android', 20],
  ] as const) {
    await run(`INSERT INTO user_app_presence (user_id, platform, app_version) VALUES (?, ?, ?)`, [user, platform, version]);
  }
  await fullConsent('u-a');
  await consent('u-a', 'marketing', CURRENT_POLICY_VERSION);
  await consent('u-b', 'terms', '3');
  await consent('u-b', 'privacy', '3');
  await consent('u-b', 'age14', '3');
  await fullConsent('u-c');
  await fullConsent('u-d');
  await fullConsent('u-e');
  await consent('u-f', 'terms', '4');
  await consent('u-f', 'privacy', '4');
  await consent('u-f', 'age14', '4');
  await consent('u-f', 'marketing', '4', 0);
  await run(`INSERT INTO alarms (id, user_id, time, repeat_days, is_active) VALUES ('al-a', 'u-a', '07:00', '[]', 1)`);
  await run(`INSERT INTO alarms (id, user_id, time, repeat_days, is_active) VALUES ('al-d', 'u-d', '07:00', '[]', 0)`);
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  holder.db = db;
  await seedPeople();
});

beforeEach(async () => {
  await run(`DELETE FROM admin_push_jobs`);
});

describe('대상 고르기', () => {
  const count = (raw: Record<string, unknown>) => countAudience(db, parseAudience(raw));

  it('조건이 없으면 탈퇴 대기를 뺀 모든 기기', async () => {
    expect(await count({})).toEqual({ android: 4, ios: 2, users: 5, capped: false });
  });

  it('플랫폼만 고르면 그 플랫폼 기기만', async () => {
    expect(await count({ platform: 'ios' })).toMatchObject({ android: 0, ios: 2, users: 2 });
  });

  it('안드로이드 빌드 미만 — 기록 없는 기기는 고를 때만 넣고, iOS 는 그대로 둔다', async () => {
    expect(await count({ androidBelow: '35' })).toMatchObject({ android: 1, ios: 2 }); // u-a(30)
    expect(await count({ androidBelow: '35', includeUnknownVersion: 'on' })).toMatchObject({ android: 3, ios: 2 }); // + u-d, u-f
    expect(await count({ platform: 'android', androidBelow: 35 })).toMatchObject({ android: 1, ios: 0 });
  });

  it('재동의가 필요한 사람만 — 서버가 실제로 막는 규칙(lib/consent.ts)과 같다', async () => {
    // u-b(privacy 3), u-f(privacy 4) — privacy 최소 버전이 5다.
    expect(await count({ reconsentOnly: true })).toMatchObject({ android: 2, ios: 1, users: 2 });
  });

  it('광고성 정보 수신 동의자만 — 거절한 사람은 빠진다', async () => {
    expect(await count({ marketingOnly: true })).toMatchObject({ android: 1, ios: 0, users: 1 });
  });

  it('켜진 알람이 있는 사람만', async () => {
    expect(await count({ activeAlarmOnly: '1' })).toMatchObject({ android: 1, ios: 0, users: 1 });
  });

  it('모르는 값은 기본값으로 떨어진다(주입 차단)', () => {
    expect(parseAudience({ platform: "android' OR 1=1 --", androidBelow: '1; DROP TABLE users' })).toEqual(DEFAULT_AUDIENCE);
  });
});

describe('문구', () => {
  it('제목·본문이 비면 거절한다', () => {
    expect(() => parseCopy({ title: ' ', body: 'x' })).toThrow(AdminPushError);
  });

  it('광고는 (광고) 표시와 수신 거부 줄을 서버가 붙인다 — 사람이 쓴 (광고)는 한 번만', () => {
    const copy = parseCopy({ kind: 'ad', title: '(광고) 가을 할인', body: '이번 주만' });
    expect(copy.title).toBe('가을 할인');
    expect(renderCopy(copy)).toEqual({ title: '(광고) 가을 할인', body: '이번 주만\n수신 거부: 더보기 → 약관 및 동의' });
  });

  it('보이지 않는 글자·제어문자를 걸러낸다 — 제목의 줄바꿈은 공백, 본문의 줄바꿈은 남긴다', () => {
    const zw = String.fromCodePoint(0x200b);
    const rtl = String.fromCodePoint(0x202e);
    const copy = parseCopy({ title: `점${zw}검\n안내`, body: `첫 줄\n둘째${rtl} 줄${String.fromCodePoint(0x07)}` });
    expect(copy).toMatchObject({ title: '점검 안내', body: '첫 줄\n둘째 줄' });
  });

  it('안내는 그대로 나간다', () => {
    expect(renderCopy(parseCopy({ kind: 'notice', title: '점검', body: '곧 끝나요' }))).toEqual({ title: '점검', body: '곧 끝나요' });
  });

  it('광고 가능 시간은 한국 시각 8시부터 21시 전까지', () => {
    expect(isWithinAdHours(NOON_KST)).toBe(true);
    expect(isWithinAdHours(NIGHT_KST)).toBe(false);
    expect(isWithinAdHours(Date.parse('2026-10-22T23:00:00.000Z'))).toBe(true); // 08:00 KST
    expect(isWithinAdHours(Date.parse('2026-10-23T12:00:00.000Z'))).toBe(false); // 21:00 KST
  });
});

describe('발송', () => {
  const copy = parseCopy({ kind: 'notice', title: '업데이트 안내', body: '새 버전이 나왔어요' });

  it('같은 문구의 시험 발송 없이는 전체 발송을 만들지 못한다', async () => {
    await expect(createPushJob(db, copy, parseAudience({}), 6, NOON_KST)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_TEST_REQUIRED',
    });
  });

  it('시험 발송이 닿지 않았으면(성공 0) 여전히 막는다', async () => {
    // 푸시 키가 없는 환경이라 시험 발송은 실패로 기록된다.
    const r = await sendTestPush(db, NO_PUSH_ENV, 'tester@example.com', copy);
    expect(r).toMatchObject({ devices: 1, sent: 0, failed: 1 });
    await expect(createPushJob(db, copy, parseAudience({}), 6, Date.now())).rejects.toMatchObject({
      code: 'ADMIN_PUSH_TEST_REQUIRED',
    });
  });

  it('시험 발송 기록에는 받는 사람이 남지 않는다', async () => {
    await sendTestPush(db, NO_PUSH_ENV, 'TESTER@example.com', copy);
    const rows = await db.execute(`SELECT * FROM admin_push_jobs`);
    const flat = JSON.stringify(rows.rows);
    expect(flat).not.toContain('u-c');
    expect(flat.toLowerCase()).not.toContain('tester@example.com');
    expect(flat).not.toContain('tok-');
  });

  it('없는 계정·기기 없는 계정은 알려 준다', async () => {
    await expect(sendTestPush(db, NO_PUSH_ENV, 'nobody@example.com', copy)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND',
    });
    await run(`INSERT OR IGNORE INTO users (id, email, name, plan) VALUES ('u-none', 'none@example.com', 'n', 'free')`);
    await fullConsent('u-none'); // 기기만 없는 사람 — 개요의 재동의 숫자를 흔들지 않게
    await expect(sendTestPush(db, NO_PUSH_ENV, 'none@example.com', copy)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_TEST_RECIPIENT_NO_DEVICE',
    });
  });

  async function passTest(c = copy) {
    await run(
      `INSERT INTO admin_push_jobs (id, kind, is_test, title, body, audience_json, sent, status)
       VALUES (?, ?, 1, ?, ?, '{"test":true}', 1, 'done')`,
      [crypto.randomUUID(), c.kind, c.title, c.body],
    );
  }

  it('광고는 시간 밖이면 만들지 못하고, 만든 뒤 시간이 지나면 걸음이 멈춘다', async () => {
    const ad = parseCopy({ kind: 'ad', title: '할인', body: '이번 주' });
    await passTest(ad);
    await expect(createPushJob(db, ad, parseAudience({}), 1, NIGHT_KST)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_OUTSIDE_AD_HOURS',
    });
    const id = await createPushJob(db, ad, parseAudience({}), 1, NOON_KST);
    const stored = await db.execute({ sql: `SELECT audience_json FROM admin_push_jobs WHERE id = ?`, args: [id] });
    // 광고는 화면에서 체크를 풀어도 마케팅 동의 조건이 붙어 저장된다.
    expect(JSON.parse(String(stored.rows[0]!.audience_json)).marketingOnly).toBe(true);
    const paused = await runJobStep(db, NO_PUSH_ENV, id, NIGHT_KST);
    expect(paused).toMatchObject({ status: 'sending', paused: 'outside_ad_hours', sent: 0, failed: 0 });
    const done = await runJobStep(db, NO_PUSH_ENV, id, NOON_KST);
    // 마케팅 동의자는 u-a 한 명(기기 하나) — 푸시 키가 없어 실패로 센다.
    expect(done).toMatchObject({ status: 'done', sent: 0, failed: 1 });
  });

  it('걸음은 커서를 따라 끝까지 가고, 끝나면 더 보내지 않는다', async () => {
    // 한 걸음 상한을 넘기도록 기기를 늘린다.
    const extra = STEP_SEND_LIMIT + 5;
    for (let i = 0; i < extra; i++) {
      const id = `u-bulk-${String(i).padStart(3, '0')}`;
      await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, 'free')`, [id, `${id}@example.com`, id]);
      await run(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`, [
        `pt-bulk-${String(i).padStart(3, '0')}`,
        id,
        `tok-bulk-${i}`,
      ]);
    }
    try {
      await passTest();
      const audience = parseAudience({ platform: 'android' });
      const expected = (await countAudience(db, audience)).android;
      expect(expected).toBe(4 + extra);
      const id = await createPushJob(db, copy, audience, expected, NOON_KST);
      const first = await runJobStep(db, NO_PUSH_ENV, id, NOON_KST);
      expect(first).toMatchObject({ status: 'sending', failed: STEP_SEND_LIMIT });
      const second = await runJobStep(db, NO_PUSH_ENV, id, NOON_KST);
      expect(second).toMatchObject({ status: 'done', failed: expected });
      const again = await runJobStep(db, NO_PUSH_ENV, id, NOON_KST);
      expect(again).toMatchObject({ status: 'done', failed: expected });
    } finally {
      await run(`DELETE FROM push_tokens WHERE id LIKE 'pt-bulk-%'`);
      await run(`DELETE FROM users WHERE id LIKE 'u-bulk-%'`);
    }
  });

  it('같은 걸음을 두 번 동시에 밟으면 한쪽만 보낸다', async () => {
    await passTest();
    const id = await createPushJob(db, copy, parseAudience({}), 6, NOON_KST);
    const [a, b] = await Promise.all([
      runJobStep(db, NO_PUSH_ENV, id, NOON_KST),
      runJobStep(db, NO_PUSH_ENV, id, NOON_KST),
    ]);
    const counted = await db.execute({ sql: `SELECT sent + failed AS n FROM admin_push_jobs WHERE id = ?`, args: [id] });
    expect(Number(counted.rows[0]!.n)).toBe(6);
    expect([a.paused, b.paused].filter((p) => p === 'busy').length).toBeLessThanOrEqual(1);
  });

  it('맡기의 응답이 끊겨도 그 묶음을 빠뜨리지 않는다 — 2분 뒤 같은 구간을 다시 보낸다', async () => {
    await passTest();
    const id = await createPushJob(db, copy, parseAudience({}), 6, NOON_KST);
    // 맡기 쓰기는 커밋됐는데 응답을 잃은 경우를 흉내 낸다.
    const lossy = {
      execute: async (stmt: Parameters<Client['execute']>[0]) => {
        const out = await db.execute(stmt);
        if (typeof stmt !== 'string' && /SET cursor = \?, claim_from/.test(stmt.sql)) throw new Error('response lost');
        return out;
      },
      batch: db.batch.bind(db),
    } as unknown as Client;
    await expect(runJobStep(lossy, NO_PUSH_ENV, id, NOON_KST)).rejects.toThrow('response lost');
    // 아직 도는 중일 수 있는 걸음은 가로채지 않는다.
    expect(await runJobStep(db, NO_PUSH_ENV, id, NOON_KST + 1000)).toMatchObject({ paused: 'busy', sent: 0, failed: 0 });
    const resumed = await runJobStep(db, NO_PUSH_ENV, id, NOON_KST + CLAIM_STALE_MS);
    expect(resumed).toMatchObject({ status: 'done', sent: 0, failed: 6 });
    const row = await db.execute({ sql: `SELECT claim_from FROM admin_push_jobs WHERE id = ?`, args: [id] });
    expect(row.rows[0]!.claim_from).toBeNull();
  });

  it('광고 시험 발송도 광고 동의자에게만', async () => {
    const ad = parseCopy({ kind: 'ad', title: '할인 안내', body: '이번 주만' });
    await expect(sendTestPush(db, NO_PUSH_ENV, 'tester@example.com', ad, NOON_KST)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT',
    });
    await expect(sendTestPush(db, NO_PUSH_ENV, 'u-a@example.com', ad, NOON_KST)).resolves.toMatchObject({ devices: 1 });
    // 광고 시험도 시간 밖이면 보내지 않는다.
    await expect(sendTestPush(db, NO_PUSH_ENV, 'u-a@example.com', ad, NIGHT_KST)).rejects.toMatchObject({
      code: 'ADMIN_PUSH_OUTSIDE_AD_HOURS',
    });
  });

  it('보내는 중인 발송은 새 기록이 많아도 목록에 남는다 — 이어 보내기를 잃지 않게', async () => {
    await passTest();
    const id = await createPushJob(db, copy, parseAudience({}), 6, NOON_KST);
    for (let i = 0; i < 5; i++) await passTest();
    const jobs = await listPushJobs(db, 3);
    expect(jobs[0]!.id).toBe(id);
    expect(jobs.filter((j) => j.status !== 'sending')).toHaveLength(3);
    await cancelPushJob(db, id);
  });

  it('없는 기록은 404 갈래로', async () => {
    await expect(runJobStep(db, NO_PUSH_ENV, 'missing', NOON_KST)).rejects.toMatchObject({ code: 'ADMIN_PUSH_JOB_NOT_FOUND' });
  });
});

describe('앱 빌드 기록', () => {
  beforeEach(() => resetAppPresenceMemo());

  function app() {
    const a = new Hono<AppEnv>();
    a.use('*', async (c, next) => {
      c.set('userIdPK', 'u-d');
      await next();
    });
    a.use('*', appPresenceMiddleware);
    a.get('/x', (c) => c.text('ok'));
    return a;
  }

  async function presence() {
    const r = await db.execute(`SELECT platform, app_version FROM user_app_presence WHERE user_id = 'u-d'`);
    return r.rows.map((x) => `${x.platform}:${x.app_version}`).sort();
  }

  it('헤더의 빌드 번호는 숫자만 받는다', () => {
    expect(parseAppVersionHeader('35')).toBe(35);
    expect(parseAppVersionHeader(' 12 ')).toBe(12);
    expect(parseAppVersionHeader('1.2.15')).toBeNull();
    expect(parseAppVersionHeader('0')).toBeNull();
    expect(parseAppVersionHeader('99999999')).toBeNull();
    expect(parseAppVersionHeader(undefined)).toBeNull();
  });

  it('플랫폼별로 마지막 빌드를 적고, 응답은 막지 않는다', async () => {
    await run(`DELETE FROM user_app_presence WHERE user_id = 'u-d'`);
    const res = await app().request('/x', { headers: { 'X-App-Platform': 'android', 'X-App-Version': '34' } });
    expect(await res.text()).toBe('ok');
    await vi.waitFor(async () => expect(await presence()).toEqual(['android:34']));
    await app().request('/x', { headers: { 'X-App-Platform': 'Android', 'X-App-Version': '35' } });
    await vi.waitFor(async () => expect(await presence()).toEqual(['android:35']));
    await app().request('/x', { headers: { 'X-App-Platform': 'ios', 'X-App-Version': '13' } });
    await vi.waitFor(async () => expect(await presence()).toEqual(['android:35', 'ios:13']));
  });

  it('모르는 플랫폼·이상한 빌드는 적지 않는다', async () => {
    await run(`DELETE FROM user_app_presence WHERE user_id = 'u-d'`);
    await app().request('/x', { headers: { 'X-App-Platform': 'web', 'X-App-Version': '5' } });
    await app().request('/x', { headers: { 'X-App-Platform': 'android', 'X-App-Version': 'abc' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await presence()).toEqual([]);
  });

  it('같은 값은 한 시간 안에 다시 쓰지 않는다', async () => {
    await run(`DELETE FROM user_app_presence WHERE user_id = 'u-d'`);
    await app().request('/x', { headers: { 'X-App-Platform': 'android', 'X-App-Version': '35' } });
    await vi.waitFor(async () => expect(await presence()).toEqual(['android:35']));
    await run(`UPDATE user_app_presence SET last_seen_at = '2000-01-01 00:00:00' WHERE user_id = 'u-d'`);
    await app().request('/x', { headers: { 'X-App-Platform': 'android', 'X-App-Version': '35' } });
    await new Promise((r) => setTimeout(r, 20));
    const r = await db.execute(`SELECT last_seen_at FROM user_app_presence WHERE user_id = 'u-d'`);
    expect(String(r.rows[0]!.last_seen_at)).toBe('2000-01-01 00:00:00');
  });
});

describe('화면', () => {
  const SECRET = 'admin-secret-value';
  const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
  function request(path: string, init: RequestInit = {}) {
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    return a.request(`http://localhost${path}`, init, {
      ADMIN_SECRET: SECRET,
      ADMIN_TEST_PUSH_EMAIL: 'owner@example.com',
    } as unknown as AppEnv['Bindings']);
  }

  it('개요 숫자는 실제 DB 에서 온다', async () => {
    const o = await loadOverview(db, 30);
    expect(o.users.total).toBeGreaterThanOrEqual(6);
    expect(o.users.pendingDeletion).toBe(1);
    expect(o.consent.reconsentNeeded).toBe(2); // u-b, u-f (탈퇴 대기 u-e 는 세지 않는다)
    expect(o.signupsByDay).toHaveLength(30);
    expect(o.versions.find((v) => v.platform === 'android' && v.version === 30)?.users).toBe(1);
  });

  it('동의 행이 하나도 없는 사람도 재동의 필요로 센다 — 서버는 그 사람도 막는다', async () => {
    await run(`INSERT INTO users (id, email, name, plan) VALUES ('u-zero', 'zero@example.com', 'zero', 'free')`);
    try {
      expect((await loadOverview(db, 30)).consent.reconsentNeeded).toBe(3);
    } finally {
      await run(`DELETE FROM users WHERE id = 'u-zero'`);
    }
  });

  it('바깥 보안 미들웨어가 콘솔 정책을 덮지 않는다 — 화면 안 fetch 가 막히지 않게', async () => {
    const a = new Hono<AppEnv>();
    a.use('*', securityHeadersMiddleware);
    a.route('/admin', adminRoutes);
    const env = { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings'];
    const res = await a.request('http://localhost/admin/push', { headers: { Authorization: AUTH } }, env);
    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    // 스크립트 없는 응답은 바깥 기본 정책을 받는다.
    const redirect = await a.request('http://localhost/admin/push', {}, env);
    expect(redirect.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('개요 화면이 그려진다 — nonce 스크립트·캐시 금지', async () => {
    const res = await request('/admin', { headers: { Authorization: AUTH } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>개요</h1>');
    expect(html).toContain('전체 가입자');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain('—');
  });

  it('사용자 검색은 LIKE 와일드카드를 이스케이프한다', async () => {
    const res = await request('/admin/users?q=%25', { headers: { Authorization: AUTH } });
    const html = await res.text();
    expect(html).toContain('찾는 사용자가 없어요');
    const hit = await request('/admin/users?q=u-b%40', { headers: { Authorization: AUTH } });
    expect(await hit.text()).toContain('u-b@example.com');
  });

  it('알림 화면은 시험 발송 받는 사람을 비밀값에서 채운다', async () => {
    const res = await request('/admin/push', { headers: { Authorization: AUTH } });
    const html = await res.text();
    expect(html).toContain('value="owner@example.com"');
    expect(html).not.toContain('—');
  });

  it('미리보기·발송 API 는 같은 출처 POST 만 받는다', async () => {
    const cross = await request('/admin/push/preview', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(cross.status).toBe(403);
    const ok = await request('/admin/push/preview', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'ios' }),
    });
    expect(await ok.json()).toMatchObject({ ios: 2, android: 0 });
  });

  it('시험 발송 없이 전체 발송을 부르면 409 와 이유', async () => {
    const res = await request('/admin/push/jobs', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ title: '처음 보는 문구', body: '본문', kind: 'notice' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error_code: 'ADMIN_PUSH_TEST_REQUIRED' });
  });

  it('세션이 끝난 뒤의 POST 는 리다이렉트가 아니라 401', async () => {
    const res = await request('/admin/push/preview', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});
