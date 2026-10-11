// **가장 새 코드만 된다 — 쓴 뒤에도**(스펙 session-and-auth 「이메일 인증 코드」).
//
// 판정은 쓰지 않은 코드 중 가장 새 것 하나만 본다(`routes/auth.ts` 의 `checkEmailVerificationCode`).
// 예전에는 가입·재설정이 성공하면 판정에 쓴 줄 하나만 소모했다. 그러면 바로 앞에 받은 코드가 '가장 새
// 것' 으로 올라와 제 수명(10분)이 다할 때까지 다시 통했다 — 메일은 "가장 최근에 받은 코드만 쓸 수
// 있어요" 라고 약속하고, 재설정이면 방금 바꾼 비밀번호를 그 앞 코드로 한 번 더 바꿀 수 있었다.
//
// `auth.test.ts` 의 순서 큐 목은 SQL 을 실행하지 않는다(무엇을 읽든 넣어 둔 줄을 돌려준다). **어느 줄이
// 소모되는가** 는 SQL 이 정하므로 진짜 SQLite 로 돌린다. 지키는 것:
//   1. 재설정: 새 코드로 마친 뒤 앞 코드는 `400 AUTH_EMAIL_CODE_INVALID` — 비밀번호를 다시 못 바꾼다.
//   2. 가입: 새 코드로 마친 뒤 앞 코드는 인증 확인도 통과하지 못한다. 인증 확인은 아무것도 쓰지 않는다.
//   3. 소모는 그 주소·그 용도만이다 — 다른 용도·다른 주소의 코드는 그대로 남는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  emailVerificationExpiresAt,
  hashEmailVerificationCode,
} from '../src/lib/email-verification';
import { jsonReq } from './helpers';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-email-code-consume-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import authRoutes from '../src/routes/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

const EMAIL = 'kim@example.test';
const OTHER_EMAIL = 'lee@example.test';
const OLDER_CODE = '111111';
const NEWER_CODE = '222222';

type Purpose = 'register' | 'reset';

function post(path: string, body: Record<string, unknown>) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  return app.request(jsonReq('POST', path, body), undefined, ENV);
}

/** `secondsAgo` 초 전에 보낸 코드 한 줄 — 발급 시각은 운영과 같은 `datetime('now')` 꼴, 수명은 그때부터 10분. */
async function issue(email: string, purpose: Purpose, code: string, secondsAgo: number) {
  await db.execute({
    sql: `INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
    args: [
      crypto.randomUUID(),
      email,
      purpose,
      await hashEmailVerificationCode(email, code, ENV.PASSWORD_PEPPER),
      emailVerificationExpiresAt(Date.now() - secondsAgo * 1000),
      `-${secondsAgo} seconds`,
    ],
  });
}

async function unusedCodes(email: string, purpose: Purpose): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM email_verification_codes
          WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
    args: [email, purpose],
  });
  return Number(result.rows[0]!.n);
}

async function tokenEpoch(email: string): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT token_epoch FROM users WHERE email = ?',
    args: [email],
  });
  return Number(result.rows[0]!.token_epoch);
}

/** 재설정은 비밀번호 계정에만 닿는다 — 해시 값은 판정에 쓰이지 않는다(비어 있지만 않으면 된다). */
async function addPasswordAccount(email: string) {
  await db.execute({
    sql: 'INSERT INTO users (id, email, name, plan, password_hash) VALUES (?, ?, ?, ?, ?)',
    args: [crypto.randomUUID(), email, '김규원', 'free', 'bcrypt-hash'],
  });
}

function confirmReset(code: string, password: string) {
  return post('/auth/password-reset/confirm', { email: EMAIL, code, password });
}

function verify(code: string) {
  return post('/auth/email-code/verify', { email: EMAIL, code });
}

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  await db.execute('DELETE FROM email_verification_codes');
  // 이 테스트가 만든 두 주소만 지운다 — 마이그레이션이 심은 시스템 계정(기본 목소리의 주인)은
  // 목소리 행이 참조하고 있어 통째로 지우면 외래 키로 실패한다.
  await db.execute({
    sql: 'DELETE FROM users WHERE email IN (?, ?)',
    args: [EMAIL, OTHER_EMAIL],
  });
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('인증 코드 소모 — 쓴 코드의 앞 코드가 되살아나지 않는다(진짜 SQLite)', () => {
  it('재설정: 새 코드로 마친 뒤 앞 코드로는 비밀번호를 다시 바꾸지 못한다', async () => {
    await addPasswordAccount(EMAIL);
    await issue(EMAIL, 'reset', OLDER_CODE, 120);
    await issue(EMAIL, 'reset', NEWER_CODE, 30);

    expect((await confirmReset(NEWER_CODE, 'newSecret1')).status).toBe(200);

    const replay = await confirmReset(OLDER_CODE, 'otherSecret2');
    expect(replay.status).toBe(400);
    expect((await replay.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
    // 비밀번호는 한 번만 바뀌었다 — 세션 폐기(`token_epoch`)도 한 번이다.
    expect(await tokenEpoch(EMAIL)).toBe(1);
    expect(await unusedCodes(EMAIL, 'reset')).toBe(0);
  });

  it('가입: 새 코드로 마친 뒤 앞 코드는 인증 확인도 통과하지 못한다', async () => {
    await issue(EMAIL, 'register', OLDER_CODE, 120);
    await issue(EMAIL, 'register', NEWER_CODE, 30);

    // 인증 확인은 쓰지 않는다 — 가입이 같은 코드를 한 번 더 판정한다.
    expect((await verify(NEWER_CODE)).status).toBe(200);
    expect(await unusedCodes(EMAIL, 'register')).toBe(2);

    const registered = await post('/auth/register', {
      email: EMAIL,
      password: 'superSecret1',
      name: '김규원',
      email_verification_code: NEWER_CODE,
    });
    expect(registered.status).toBe(201);
    expect(await unusedCodes(EMAIL, 'register')).toBe(0);

    const replay = await verify(OLDER_CODE);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
  });

  it('소모는 그 주소·그 용도만이다 — 다른 용도·다른 주소의 코드는 그대로 남는다', async () => {
    await addPasswordAccount(EMAIL);
    await issue(EMAIL, 'reset', NEWER_CODE, 30);
    await issue(EMAIL, 'register', OLDER_CODE, 60); // 같은 주소, 다른 용도
    await issue(OTHER_EMAIL, 'reset', OLDER_CODE, 60); // 같은 용도, 다른 주소

    expect((await confirmReset(NEWER_CODE, 'newSecret1')).status).toBe(200);

    expect(await unusedCodes(EMAIL, 'reset')).toBe(0);
    expect(await unusedCodes(EMAIL, 'register')).toBe(1);
    expect(await unusedCodes(OTHER_EMAIL, 'reset')).toBe(1);
  });
});
