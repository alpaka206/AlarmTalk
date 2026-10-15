// **다시 로그인하면 탈퇴를 철회한다** + **탈퇴 신청은 모든 기기의 세션과 푸시 등록을 끊는다**(2026-10-15).
//
// 예전에는 로그인 뒤 '회원 탈퇴가 진행 중이에요' 화면의 버튼을 한 번 더 눌러야 철회됐고, 탈퇴를 신청한
// 기기만 스스로 로그아웃해 다른 기기는 모든 요청이 403 인 채로 남았다. 앱의 탈퇴 안내 문구는 처음부터
// "그 전에 다시 로그인하면 탈퇴를 취소할 수 있어요" 였다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-sign-in-cancel-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
const sendAccountDeletionRequestedPush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/lib/fcm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/fcm')>()),
  sendAccountDeletionRequestedPush,
}));

import authRoutes from '../src/routes/auth';
import { authMiddleware } from '../src/middleware/auth';
import user from '../src/routes/user';
import { hashPassword } from '../src/lib/password';
import { cancelPendingDeletionOnSignIn } from '../src/lib/account-deletion';
import { signAppJwt } from '../src/lib/jwt';
import { pushRegisterStatements } from '../src/routes/push';

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
} as Env;

async function row(id: string) {
  const r = await db.execute({
    sql: 'SELECT deletion_status, deletion_requested_at, deletion_purge_at, token_epoch FROM users WHERE id = ?',
    args: [id],
  });
  return r.rows[0]!;
}

beforeAll(async () => {
  await runMigrations(db);
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.execute("DELETE FROM push_tokens WHERE user_id IN ('owner','other')");
  await db.execute("DELETE FROM users WHERE id IN ('owner','other')");
  const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
  await db.execute({
    sql: `INSERT INTO users
            (id, google_id, email, password_hash, deletion_status, deletion_requested_at, deletion_purge_at,
             family_alarm_quiet_windows)
          VALUES ('owner', 'owner', 'owner@example.test', ?, 'pending_deletion', '2026-10-01', '2026-10-31', '[]'),
                 ('other', 'other', 'other@example.test', ?, 'pending_deletion', '2026-10-01', '2026-10-31', '[]')`,
    args: [hash, hash],
  });
});

describe('로그인하면 탈퇴를 철회한다', () => {
  it('이메일 로그인 — 자격증명이 맞으면 그 계정만 active 로 돌아온다', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/auth', authRoutes);
    const res = await app.request(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', password: 'superSecret1' }),
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(200);
    expect(await row('owner')).toMatchObject({
      deletion_status: 'active',
      deletion_requested_at: null,
      deletion_purge_at: null,
    });
    expect((await row('other')).deletion_status).toBe('pending_deletion');
  });

  it('비밀번호가 틀리면 철회하지 않는다', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/auth', authRoutes);
    const res = await app.request(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', password: 'wrongPassword1' }),
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
  });

  it('철회는 한 번만 — 같은 신청을 본 두 번째 로그인은 실패로 돌린다(다시 로그인하면 된다)', async () => {
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: '2026-10-01', tokenEpoch: 0 })).toBe('cancelled');
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: '2026-10-01', tokenEpoch: 0 })).toBe('superseded');
    expect((await row('owner')).deletion_status).toBe('active');
  });

  it('철회는 그 자리에서 다른 기기의 세션·푸시 등록도 끊는다 — 배포 전 신청이라 신청이 끊지 않았어도(코덱스 #904)', async () => {
    await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES
      ('o1', 'owner', 'tok-old-device', 'ios'), ('x1', 'other', 'tok-other', 'android')`);
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: '2026-10-01', tokenEpoch: 0 })).toBe('cancelled');
    expect(Number((await row('owner')).token_epoch)).toBe(1);
    const owner = await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'owner'");
    expect(owner.rows).toHaveLength(0);
    const other = await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'other'");
    expect(other.rows).toHaveLength(1);
  });

  it('로그인이 내준 토큰은 올린 세대로 서명돼 바로 쓸 수 있다', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/auth', authRoutes);
    const login = await app.request(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', password: 'superSecret1' }),
      }),
      undefined,
      ENV,
    );
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const me = await app.request(
      new Request('http://localhost/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
      undefined,
      ENV,
    );
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { deletion_status: string } }).user.deletion_status).toBe('active');
  });

  it('로그인이 처음 본 그 신청만 철회한다 — 그 사이 새로 낸 신청은 그대로 둔다(코덱스 #904)', async () => {
    // active 로 읽은 로그인(observed null)이 끝나기 전에 다른 기기가 새로 신청했다 — 철회하지 않고, 이 로그인은
    // 쓸 수 없는 토큰을 서명했으니 실패로 돌린다(superseded).
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: null, tokenEpoch: 0 })).toBe('superseded');
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
    // 유예로 읽었는데 그 사이 철회 → 다시 신청해 신청 시각이 바뀌었다.
    await db.execute("UPDATE users SET deletion_requested_at = '2026-10-15' WHERE id = 'owner'");
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: '2026-10-01', tokenEpoch: 0 })).toBe('superseded');
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
    // active 로 읽은 뒤 세대만 올랐다(다른 기기의 전 기기 로그아웃 등) — 이 토큰도 쓸 수 없다.
    await db.execute("UPDATE users SET deletion_status = 'active', deletion_requested_at = NULL, token_epoch = 3 WHERE id = 'owner'");
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: null, tokenEpoch: 2 })).toBe('superseded');
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', { requestedAt: null, tokenEpoch: 3 })).toBe('unchanged');
  });

  it('그 사이 파기됐으면 missing — 로그인은 토큰을 내주지 않는다', async () => {
    await db.execute("DELETE FROM users WHERE id = 'other'");
    expect(await cancelPendingDeletionOnSignIn(db, 'other', { requestedAt: '2026-10-01', tokenEpoch: 0 })).toBe('missing');
  });
});

describe('다른 기기의 끊긴 세션은 유예 코드로 답한다(코덱스 #904)', () => {
  it('GET /auth/me — 탈퇴 신청으로 폐기된 토큰이면 401 이 아니라 403 ACCOUNT_PENDING_DELETION(계정 내용 없음)', async () => {
    await db.execute("UPDATE users SET token_epoch = 1 WHERE id = 'owner'");
    const token = await signAppJwt({ sub: 'owner', email: 'owner@example.test', epoch: 0 }, ENV.JWT_SECRET);
    const app = new Hono<{ Bindings: Env }>();
    app.route('/auth', authRoutes);
    const res = await app.request(
      new Request('http://localhost/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('ACCOUNT_PENDING_DELETION');
    expect(body.user).toBeUndefined();
  });

  it('그 403 을 모르는 옛 앱(안드로이드 ≤33·iOS ≤10)에는 신청이 끊은 그 세대의 토큰이면 옛 유예 화면 모양(코덱스 #905)', async () => {
    await db.execute("UPDATE users SET token_epoch = 2 WHERE id = 'owner'");
    const deletionGen = await signAppJwt({ sub: 'owner', email: 'owner@example.test', epoch: 1 }, ENV.JWT_SECRET);
    const older = await signAppJwt({ sub: 'owner', email: 'owner@example.test', epoch: 0 }, ENV.JWT_SECRET);
    const app = new Hono<{ Bindings: Env }>();
    app.route('/auth', authRoutes);
    const ask = (token: string, platform?: string, version?: string) =>
      app.request(
        new Request('http://localhost/auth/me', {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(platform ? { 'X-App-Platform': platform } : {}),
            ...(version ? { 'X-App-Version': version } : {}),
          },
        }),
        undefined,
        ENV,
      );
    for (const [platform, version] of [['android', '33'], ['ios', '10']] as const) {
      const res = await ask(deletionGen, platform, version);
      expect(res.status, `${platform} ${version}`).toBe(200);
      const body = (await res.json()) as { token?: string; user: Record<string, unknown> };
      expect(body.user.deletion_status).toBe('pending_deletion');
      expect(body.token).toBeUndefined();
      // 폐기된 토큰이다 — 지금 계정 내용(설정·플랜)은 싣지 않는다. 이메일은 토큰이 담고 있던 값이다.
      expect(Object.keys(body.user).sort()).toEqual(['deletion_status', 'email', 'id', 'name', 'plan']);
      // 그보다 옛 토큰(비밀번호 재설정 등으로 끊긴 것)은 401 이다.
      expect((await ask(older, platform, version)).status, `${platform} ${version} older`).toBe(401);
    }
    for (const [platform, version] of [['android', '34'], ['ios', '11'], [undefined, undefined]] as const) {
      expect((await ask(deletionGen, platform, version)).status, `${platform} ${version}`).toBe(403);
    }
  });

  it('옛 유예 화면의 철회 버튼은 그 세대의 토큰으로 통과하고, 철회가 그 토큰까지 끝낸다(코덱스 #905)', async () => {
    await db.execute("UPDATE users SET token_epoch = 2 WHERE id = 'owner'");
    await db.execute("INSERT INTO push_tokens (id, user_id, token, platform) VALUES ('r1', 'owner', 'tok-owner', 'android')");
    const deletionGen = await signAppJwt({ sub: 'owner', email: 'owner@example.test', epoch: 1 }, ENV.JWT_SECRET);
    const older = await signAppJwt({ sub: 'owner', email: 'owner@example.test', epoch: 0 }, ENV.JWT_SECRET);
    const app = new Hono<AppEnv>();
    app.use('/user/*', authMiddleware);
    app.route('/user', user);
    const cancel = (token: string) =>
      app.request('/user/me/deletion', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, ENV);

    // 끊긴 지 더 오래된 토큰으로는 철회할 수 없다.
    expect((await cancel(older)).status).toBe(401);
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
    // 철회 말고는 그 세대로도 막힌다(유예 403).
    const other = await app.request('/user/me', { headers: { Authorization: `Bearer ${deletionGen}` } }, ENV);
    expect(other.status).toBe(403);

    expect((await cancel(deletionGen)).status).toBe(200);
    const after = await row('owner');
    expect(after.deletion_status).toBe('active');
    expect(Number(after.token_epoch)).toBe(3);
    expect((await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'owner'")).rows).toHaveLength(0);
    // 그 토큰은 이제 끝났다 — 옛 앱은 다시 로그인한다.
    expect((await app.request('/user/me', { headers: { Authorization: `Bearer ${deletionGen}` } }, ENV)).status).toBe(401);
  });
});

describe('탈퇴 신청은 모든 기기의 세션과 푸시 등록을 끊는다', () => {
  it('미들웨어를 이미 지난 등록 요청이 신청 뒤에 커밋돼도 유예 계정에는 푸시 행이 생기지 않는다(코덱스 #904)', async () => {
    // owner 는 유예다(beforeEach). 등록 문장은 그 조건을 스스로 본다.
    await db.batch(pushRegisterStatements('owner', 'tok-late', 'android'), 'write');
    const late = await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'owner'");
    expect(late.rows).toHaveLength(0);
    // 그 늦은 등록이 같은 기기 토큰을 가진 다른 계정의 행을 지우지도 않는다.
    await db.execute("UPDATE users SET deletion_status = 'active' WHERE id = 'other'");
    await db.execute("INSERT INTO push_tokens (id, user_id, token, platform) VALUES ('p-b', 'other', 'tok-shared', 'ios')");
    await db.batch(pushRegisterStatements('owner', 'tok-shared', 'ios'), 'write');
    const kept = await db.execute("SELECT user_id FROM push_tokens WHERE token = 'tok-shared'");
    expect(kept.rows.map((r) => r.user_id)).toEqual(['other']);
    await db.execute("DELETE FROM push_tokens WHERE user_id = 'other'");
    // 그 사이 탈퇴 신청(+1)과 철회 로그인(+1)으로 세대가 올라 active 로 돌아왔어도, 옛 세대의 늦은 등록은 적지 않는다.
    await db.execute("UPDATE users SET deletion_status = 'active', token_epoch = 2 WHERE id = 'owner'");
    await db.batch(pushRegisterStatements('owner', 'tok-revoked', 'android', 0), 'write');
    const revoked = await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'owner'");
    expect(revoked.rows).toHaveLength(0);
    await db.batch(pushRegisterStatements('owner', 'tok-current', 'android', 2), 'write');
    const current = await db.execute("SELECT token FROM push_tokens WHERE user_id = 'owner'");
    expect(current.rows.map((r) => r.token)).toEqual(['tok-current']);
    // active 계정은 그대로 적힌다.
    await db.batch(pushRegisterStatements('other', 'tok-ok', 'android'), 'write');
    const ok = await db.execute("SELECT token FROM push_tokens WHERE user_id = 'other'");
    expect(ok.rows.map((r) => r.token)).toEqual(['tok-ok']);
  });

  it('token_epoch 를 올리고 그 계정의 푸시 토큰만 지운다', async () => {
    await db.execute("UPDATE users SET deletion_status = 'active', deletion_requested_at = NULL, deletion_purge_at = NULL");
    await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES
      ('p1', 'owner', 'tok-owner-a', 'android'), ('p2', 'owner', 'tok-owner-b', 'ios'), ('p3', 'other', 'tok-other', 'android')`);
    const before = Number((await row('owner')).token_epoch);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', 'owner');
      await next();
    });
    app.route('/user', user);
    const waited: Promise<unknown>[] = [];
    const res = await app.request('/user/me/deletion', { method: 'POST' }, ENV, {
      waitUntil: (p: Promise<unknown>) => waited.push(p),
      passThroughOnException: () => undefined,
      props: {},
    } as never);
    expect(res.status).toBe(200);
    await Promise.all(waited);
    // 지우기 전에 읽은 그 계정의 토큰에 '탈퇴 신청됨' 신호를 보낸다 — 다른 계정의 토큰은 빠진다.
    expect(sendAccountDeletionRequestedPush).toHaveBeenCalledTimes(1);
    const targets = sendAccountDeletionRequestedPush.mock.calls[0]![1] as Array<{ token: string; platform: string }>;
    expect(targets.map((t) => t.token).sort()).toEqual(['tok-owner-a', 'tok-owner-b']);

    const after = await row('owner');
    expect(after.deletion_status).toBe('pending_deletion');
    expect(Number(after.token_epoch)).toBe(before + 1);
    const tokens = await db.execute('SELECT user_id, token FROM push_tokens ORDER BY token');
    expect(tokens.rows.map((r) => r.token)).toEqual(['tok-other']);
  });

  it('옛 앱의 철회 버튼(DELETE /user/me/deletion)도 다른 기기의 세션·푸시 등록을 끊는다(코덱스 #904)', async () => {
    // 이 배포 전에 신청해 세대가 그대로인 유예 행 — 마이그레이션 #129 보다 먼저 철회되는 경우.
    await db.execute("DELETE FROM push_tokens");
    await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES
      ('q1', 'owner', 'tok-owner-old', 'android'), ('q2', 'other', 'tok-other', 'android')`);
    const before = Number((await row('owner')).token_epoch);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', 'owner');
      await next();
    });
    app.route('/user', user);
    const res = await app.request('/user/me/deletion', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(200);

    const after = await row('owner');
    expect(after.deletion_status).toBe('active');
    expect(Number(after.token_epoch)).toBe(before + 1);
    const tokens = await db.execute('SELECT token FROM push_tokens ORDER BY token');
    expect(tokens.rows.map((r) => r.token)).toEqual(['tok-other']);
  });
});
