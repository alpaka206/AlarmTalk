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

import authRoutes from '../src/routes/auth';
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

  it('헬퍼는 멱등이다 — 이미 active 면 아무것도 바꾸지 않는다', async () => {
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', '2026-10-01')).toBe('cancelled');
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', '2026-10-01')).toBe('unchanged');
    expect((await row('owner')).deletion_status).toBe('active');
  });

  it('로그인이 처음 본 그 신청만 철회한다 — 그 사이 새로 낸 신청은 그대로 둔다(코덱스 #904)', async () => {
    // active 로 읽은 로그인(observed null)이 끝나기 전에 다른 기기가 새로 신청했다 — 쿼리도 없이 그대로 둔다.
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', null)).toBe('unchanged');
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
    // 유예로 읽었는데 그 사이 철회 → 다시 신청해 신청 시각이 바뀌었다.
    await db.execute("UPDATE users SET deletion_requested_at = '2026-10-15' WHERE id = 'owner'");
    expect(await cancelPendingDeletionOnSignIn(db, 'owner', '2026-10-01')).toBe('unchanged');
    expect((await row('owner')).deletion_status).toBe('pending_deletion');
  });

  it('그 사이 파기됐으면 missing — 로그인은 토큰을 내주지 않는다', async () => {
    await db.execute("DELETE FROM users WHERE id = 'other'");
    expect(await cancelPendingDeletionOnSignIn(db, 'other', '2026-10-01')).toBe('missing');
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
});

describe('탈퇴 신청은 모든 기기의 세션과 푸시 등록을 끊는다', () => {
  it('미들웨어를 이미 지난 등록 요청이 신청 뒤에 커밋돼도 유예 계정에는 푸시 행이 생기지 않는다(코덱스 #904)', async () => {
    // owner 는 유예다(beforeEach). 등록 문장은 그 조건을 스스로 본다.
    await db.batch(pushRegisterStatements('owner', 'tok-late', 'android'), 'write');
    const late = await db.execute("SELECT 1 FROM push_tokens WHERE user_id = 'owner'");
    expect(late.rows).toHaveLength(0);
    // active 계정은 그대로 적힌다.
    await db.execute("UPDATE users SET deletion_status = 'active' WHERE id = 'other'");
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
    const res = await app.request('/user/me/deletion', { method: 'POST' }, ENV);
    expect(res.status).toBe(200);

    const after = await row('owner');
    expect(after.deletion_status).toBe('pending_deletion');
    expect(Number(after.token_epoch)).toBe(before + 1);
    const tokens = await db.execute('SELECT user_id, token FROM push_tokens ORDER BY token');
    expect(tokens.rows.map((r) => r.token)).toEqual(['tok-other']);
  });
});
