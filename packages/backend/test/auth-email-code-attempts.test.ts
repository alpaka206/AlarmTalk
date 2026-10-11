// **상한은 같은 순간에 온 요청에도 지켜진다 · 다시 받기 간격은 가장 새 코드만 붙잡는다**
// (스펙 session-and-auth 「이메일 인증 코드」).
//
// 판정은 줄을 읽고(SELECT) 숫자를 대조한 뒤 상한 확인과 세기를 한 문장으로 확정한다(`routes/auth.ts` 의
// `checkEmailVerificationCode`). 예전에는 읽은 횟수로 상한을 보고 틀리면 따로 +1 했다 — 같은 순간에 온 요청은
// 모두 상한 아래를 읽어 **보낸 수만큼 대조받았고**(맞는 숫자가 섞여 있으면 통과했다) 횟수는 상한을 넘었다.
//
// 경쟁은 순서를 정해 재현한다. DB 를 감싸 **읽기 결과를 붙잡아 두었다가**(읽기는 그 순간의 DB 를 본다) 다른
// 요청을 끝까지 돌린 뒤 내준다 — 붙잡힌 요청은 낡은 횟수를 들고 대조로 간다. 진짜 SQLite 라 상한 문장이
// 실제로 0행을 내는지까지 본다. 지키는 것:
//   1. 읽은 뒤 상한이 찬 틀린 코드는 429 이고 횟수는 5 그대로다(예전: 400, 횟수 6).
//   2. 읽은 뒤 상한이 찬 맞는 코드도 429 다(예전: 200).
//   3. 같은 순간에 열 번 틀리면 400 다섯·429 다섯이고 횟수 5 다(예전: 400 열, 횟수 10).
//   4. 맞는 코드는 횟수를 쓰지 않는다 — 네 번 틀린 뒤에도 인증 확인과 가입이 둘 다 통과한다.
//   5. 같은 초에 보낸 두 코드는 나중에 넣은 것만 된다.
//   6. 다시 받기 두 번이 같은 순간에 와 코드가 둘 생겨도 앞 코드는 간격을 붙잡지 않는다 — 가장 새 코드가 상한에
//      닿으면 곧바로 새 코드가 간다(예전: 앞 코드가 틀린 횟수 0 인 채로 최대 60초 동안 다시 받기를 막았다).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type InStatement } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  emailVerificationExpiresAt,
  hashEmailVerificationCode,
} from '../src/lib/email-verification';
import { jsonReq } from './helpers';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-email-code-attempts-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });

/** 붙잡을 읽기 — 맞는 문장 `remaining` 개의 결과를 `released` 가 풀릴 때까지 쥐고 있는다. */
type ReadHold = {
  matches: (sql: string) => boolean;
  remaining: number;
  arrived: () => void;
  released: Promise<void>;
};
let hold: ReadHold | null = null;

const heldDb = new Proxy(db, {
  get(target, prop) {
    if (prop === 'execute') {
      return async (stmt: InStatement) => {
        const result = await target.execute(stmt);
        const active = hold;
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        if (active && active.remaining > 0 && active.matches(sql)) {
          active.remaining -= 1;
          if (active.remaining === 0) active.arrived();
          await active.released;
        }
        return result;
      };
    }
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

vi.mock('../src/lib/db', () => ({ getDB: () => heldDb }));

import authRoutes from '../src/routes/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  // 메일 서비스 설정이 없는 test 환경 — 보내지는 않고, 새 코드를 만들었을 때만 `debug_code` 를 싣는다.
  ENVIRONMENT: 'test',
};

const EMAIL = 'kim@example.test';
const CODE = '111111';
const WRONG = '222222';
const OTHER_WRONG = '333333';

/** 판정의 읽기(가장 새 코드 한 줄) — 상한 문장 앞에서 낡은 횟수를 들게 만들 자리다. */
const isJudgingRead = (sql: string) => /^\s*SELECT\b/i.test(sql) && sql.includes('code_hash');
/** 다시 받기 간격·하루 상한의 읽기 — 두 요청이 모두 '보낸 코드 없음' 을 읽게 만들 자리다. */
const isCooldownRead = (sql: string) => sql.includes("datetime('now', '-1 day')");

/** 다음 `count` 번의 맞는 읽기를 붙잡는다. `arrived` 는 그만큼 읽었을 때 풀린다. */
function holdReads(matches: (sql: string) => boolean, count: number) {
  let arrived!: () => void;
  let release!: () => void;
  const arrivedPromise = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  hold = { matches, remaining: count, arrived, released };
  return {
    arrived: arrivedPromise,
    release: () => {
      hold = null;
      release();
    },
  };
}

function post(path: string, body: Record<string, unknown>) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  return app.request(jsonReq('POST', path, body), undefined, ENV);
}

function verify(code: string) {
  return post('/auth/email-code/verify', { email: EMAIL, code });
}

/** 가입 코드를 달라고 한다 — 새 코드를 만들었으면 그 숫자, 보내지 않은 성공이면 undefined. */
async function requestCode(): Promise<string | undefined> {
  const res = await post('/auth/email-code', { email: EMAIL });
  expect(res.status).toBe(200);
  return ((await res.json()) as { debug_code?: string }).debug_code;
}

/** `secondsAgo` 초 전에 보낸 가입 코드 한 줄 — 발급 시각은 운영과 같은 `datetime('now')` 꼴(초 단위). */
async function issue(code: string, secondsAgo = 10) {
  await db.execute({
    sql: `INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at, created_at)
          VALUES (?, ?, 'register', ?, ?, datetime('now', ?))`,
    args: [
      crypto.randomUUID(),
      EMAIL,
      await hashEmailVerificationCode(EMAIL, code, ENV.PASSWORD_PEPPER),
      emailVerificationExpiresAt(Date.now() - secondsAgo * 1000),
      `-${secondsAgo} seconds`,
    ],
  });
}

/** 그 주소의 가입 코드마다 틀린 횟수 — 넣은 순서대로. */
async function attemptsByInsertOrder(): Promise<number[]> {
  const result = await db.execute({
    sql: `SELECT attempts FROM email_verification_codes
          WHERE email = ? AND purpose = 'register' ORDER BY rowid`,
    args: [EMAIL],
  });
  return result.rows.map((row) => Number(row.attempts));
}

async function failWrong(times: number) {
  for (let i = 0; i < times; i += 1) {
    const res = await verify(WRONG);
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
  }
}

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  hold = null;
  await db.execute('DELETE FROM email_verification_codes');
  // 이 테스트가 만든 주소만 지운다 — 마이그레이션이 심은 시스템 계정은 목소리 행이 참조하고 있다.
  await db.execute({ sql: 'DELETE FROM users WHERE email = ?', args: [EMAIL] });
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('틀린 횟수 상한 — 같은 순간에 온 요청에도 지켜진다(진짜 SQLite)', () => {
  it('읽은 뒤 상한이 찬 틀린 코드는 429 이고, 횟수는 상한을 넘지 않는다', async () => {
    await issue(CODE);
    await failWrong(EMAIL_VERIFICATION_MAX_ATTEMPTS - 1);

    const held = holdReads(isJudgingRead, 1);
    const late = verify(OTHER_WRONG); // 횟수 4 를 읽고 붙잡힌다
    await held.arrived;
    await failWrong(1); // 다섯 번째 — 상한이 찬다
    held.release();

    const res = await late;
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED');
    expect(await attemptsByInsertOrder()).toEqual([EMAIL_VERIFICATION_MAX_ATTEMPTS]);
  });

  it('읽은 뒤 상한이 찬 맞는 코드도 429 다 — 읽은 횟수만으로 통과시키지 않는다', async () => {
    await issue(CODE);
    await failWrong(EMAIL_VERIFICATION_MAX_ATTEMPTS - 1);

    const held = holdReads(isJudgingRead, 1);
    const late = verify(CODE);
    await held.arrived;
    await failWrong(1);
    held.release();

    const res = await late;
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED');
    expect(await attemptsByInsertOrder()).toEqual([EMAIL_VERIFICATION_MAX_ATTEMPTS]);
  });

  it('같은 순간에 열 번 틀리면 다섯 번만 세고 나머지는 429 다', async () => {
    await issue(CODE);

    const held = holdReads(isJudgingRead, 10);
    const pending = Array.from({ length: 10 }, () => verify(WRONG));
    await held.arrived; // 열 요청이 모두 횟수 0 을 읽었다
    held.release();

    const responses = await Promise.all(pending);
    const bodies = await Promise.all(responses.map((res) => res.json()));
    const outcomes = responses.map((res, i) => `${res.status} ${bodies[i].error_code}`).sort();
    expect(outcomes).toEqual([
      ...Array(EMAIL_VERIFICATION_MAX_ATTEMPTS).fill('400 AUTH_EMAIL_CODE_INVALID'),
      ...Array(10 - EMAIL_VERIFICATION_MAX_ATTEMPTS).fill('429 AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED'),
    ]);
    expect(await attemptsByInsertOrder()).toEqual([EMAIL_VERIFICATION_MAX_ATTEMPTS]);
  });

  // 상한 문장은 맞는 코드에도 돈다 — +0 이라 횟수를 쓰지 않는다. 인증 확인과 가입은 같은 코드를 두 번
  // 판정하므로, 맞는 코드가 횟수를 쓰면 네 번 틀린 사람은 인증을 통과하고도 가입에서 429 를 받는다.
  it('맞는 코드는 횟수를 쓰지 않는다 — 네 번 틀린 뒤에도 인증 확인과 가입이 둘 다 통과한다', async () => {
    await issue(CODE);
    await failWrong(EMAIL_VERIFICATION_MAX_ATTEMPTS - 1);

    expect((await verify(CODE)).status).toBe(200);
    expect(await attemptsByInsertOrder()).toEqual([EMAIL_VERIFICATION_MAX_ATTEMPTS - 1]);

    const registered = await post('/auth/register', {
      email: EMAIL,
      password: 'superSecret1',
      name: '김규원',
      email_verification_code: CODE,
    });
    expect(registered.status).toBe(201);
  });
});

describe('가장 새 코드만 — 같은 순간에 보낸 둘이어도(진짜 SQLite)', () => {
  it('같은 초에 보낸 두 코드는 나중에 넣은 것만 되고, 앞 코드의 숫자는 그 코드의 틀린 횟수로 센다', async () => {
    await issue(OTHER_WRONG, 10);
    await issue(CODE, 10); // 같은 초 — 나중에 넣은 줄

    const older = await verify(OTHER_WRONG);
    expect(older.status).toBe(400);
    expect((await older.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
    expect((await verify(CODE)).status).toBe(200);
    expect(await attemptsByInsertOrder()).toEqual([0, 1]);
  });

  it('다시 받기 두 번이 같은 순간에 와도, 가장 새 코드가 상한에 닿으면 곧바로 새 코드가 간다', async () => {
    const held = holdReads(isCooldownRead, 2);
    const first = requestCode();
    const second = requestCode();
    await held.arrived; // 둘 다 '보낸 코드 없음' 을 읽었다 — 둘 다 코드를 만든다
    held.release();
    const twins = await Promise.all([first, second]);
    expect(twins.every((code) => typeof code === 'string')).toBe(true);
    expect(await attemptsByInsertOrder()).toEqual([0, 0]);

    // 판정은 나중에 넣은 코드만 본다 — 앞 코드는 틀린 횟수 0 인 채로 남는다.
    const wrong = ['000000', '999999'].find((code) => !twins.includes(code))!;
    for (let i = 0; i < EMAIL_VERIFICATION_MAX_ATTEMPTS; i += 1) {
      expect((await verify(wrong)).status).toBe(400);
    }
    expect(await attemptsByInsertOrder()).toEqual([0, EMAIL_VERIFICATION_MAX_ATTEMPTS]);
    expect((await verify(twins[0]!)).status).toBe(429);
    expect((await verify(twins[1]!)).status).toBe(429);

    // 간격(60초) 안이고 앞 코드는 아직 0번 틀렸지만, 판정에 쓰이지 않는 코드라 간격을 붙잡지 않는다.
    const fresh = await requestCode();
    expect(fresh).toEqual(expect.any(String));
    expect(await attemptsByInsertOrder()).toEqual([0, EMAIL_VERIFICATION_MAX_ATTEMPTS, 0]);
    expect((await verify(fresh!)).status).toBe(200);
  });
});
