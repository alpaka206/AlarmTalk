import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { createMockDB, jsonReq, type MockRow } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import authRoutes from '../src/routes/auth';
import { hashPassword } from '../src/lib/password';
import {
  EMAIL_VERIFICATION_DAILY_CAP,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  hashEmailVerificationCode,
} from '../src/lib/email-verification';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const EMAIL_CODE = '123456';

/** 판정의 상한 문장 — 대조 뒤 상한 확인과 세기를 한 번에 한다(틀렸으면 +1, 맞았으면 +0). */
const ATTEMPT_GATE_SQL = 'SET attempts = attempts + ?';

async function pushValidEmailVerification(email: string) {
  mockDB.pushResult([
    {
      id: 'email-code-1',
      code_hash: await hashEmailVerificationCode(email, EMAIL_CODE, ENV.PASSWORD_PEPPER),
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  ]);
  // 상한 문장은 SQL 로 짝지어 둔다 — 큐 자리를 차지하지 않으니 뒤에 넣어 둔 결과의 순서가 그대로다.
  // 1행 = 상한 아래였다(0행이면 그 사이에 상한이 찬 것이라 맞는 코드도 429 — 진짜 SQLite 로는
  // `auth-email-code-attempts.test.ts`).
  mockDB.pushResultFor(ATTEMPT_GATE_SQL, [], 1);
}

/** 상한 문장이 센 값 — 틀렸으면 1, 맞았으면 0. 문장이 없었으면 undefined. */
function countedIncrement(): unknown {
  return mockDB.calls.find((c) => c.sql.includes(ATTEMPT_GATE_SQL))?.args[0];
}

function registerBody(email: string, password = 'superSecret1', name = '김규원') {
  return {
    email,
    password,
    name,
    email_verification_code: EMAIL_CODE,
  };
}

/**
 * ASCII 숫자를 **아라비아-인도 숫자(U+0660–0669)** 로 옮긴다 — 그런 숫자를 내는 키보드로 친 코드.
 * 눈으로는 구분이 안 되는 글자라 리터럴로 적지 않고 코드포인트로 만든다.
 */
function toArabicIndicDigits(code: string): string {
  return [...code].map((digit) => String.fromCodePoint(0x0660 + Number(digit))).join('');
}

describe('POST /auth/password-reset', () => {
  it('비밀번호 계정이면 reset 목적의 코드를 발급한다', async () => {
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]); // classifyExistingAccount → password
    mockDB.pushResult([]); // recent codes (none → no cooldown/cap)
    mockDB.pushResult([], 1); // INSERT

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/password-reset', { email: 'KIM@Test.COM' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.debug_code).toMatch(/^\d{6}$/);
    const insertCall = mockDB.calls.find((c) =>
      c.sql.includes('INSERT INTO email_verification_codes'),
    );
    expect(insertCall?.args[1]).toBe('kim@test.com');
    expect(insertCall?.args[2]).toBe('reset'); // purpose
  });

  it('미가입/소셜 계정이면 코드를 보내지 않고 동일 성공 응답을 준다(계정 열거 방지)', async () => {
    mockDB.pushResult([]); // classifyExistingAccount → none

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/password-reset', { email: 'nobody@test.com' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.debug_code).toBeUndefined();
    expect(
      mockDB.calls.some((c) => c.sql.includes('INSERT INTO email_verification_codes')),
    ).toBe(false);
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('유효한 코드 + 비밀번호 계정이면 비밀번호 교체 + token_epoch 증가', async () => {
    await pushValidEmailVerification('kim@test.com'); // checkEmailVerificationCode SELECT
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]); // classify → password
    mockDB.pushResult([], 1); // UPDATE users
    mockDB.pushResult([], 1); // consume code

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/password-reset/confirm', {
        email: 'kim@test.com',
        code: EMAIL_CODE,
        password: 'newSecret1',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const upd = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE users') && c.sql.includes('token_epoch'),
    );
    expect(upd).toBeTruthy();
    expect(upd?.sql).toContain('password_hash');
  });

  it('아라비아-인도 숫자로 친 코드로도 재설정한다(인증 확인과 같은 스키마)', async () => {
    await pushValidEmailVerification('kim@test.com'); // checkEmailVerificationCode SELECT
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]); // classify → password
    mockDB.pushResult([], 1); // UPDATE users
    mockDB.pushResult([], 1); // consume code

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/password-reset/confirm', {
        email: 'kim@test.com',
        code: toArabicIndicDigits(EMAIL_CODE),
        password: 'newSecret1',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('코드가 없거나 틀리면 400 AUTH_EMAIL_CODE_INVALID', async () => {
    mockDB.pushResult([]); // checkEmailVerificationCode → no row

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/password-reset/confirm', {
        email: 'kim@test.com',
        code: '000000',
        password: 'newSecret1',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
  });
});

describe('POST /auth/email-code', () => {
  it('신규 이메일에 6자리 인증 코드를 발급한다', async () => {
    mockDB.pushResult([]); // existing user lookup (none)
    mockDB.pushResult([]); // recent codes (none → no cooldown/cap)
    mockDB.pushResult([], 1); // INSERT

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'KIM@Test.COM' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.debug_code).toMatch(/^\d{6}$/);
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes'));
    expect(insertCall?.args[1]).toBe('kim@test.com');
  });

  it('이미 가입된 이메일(비밀번호 계정)은 409 AUTH_EMAIL_TAKEN 으로 막는다', async () => {
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'kim@test.com' }),
      undefined,
      ENV,
    );

    // 중복 이메일이면 회원가입을 막고 로그인으로 안내한다.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_TAKEN');
    // 코드를 발송/삽입하지 않는다.
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes'));
    expect(insertCall).toBeUndefined();
  });

  it('이미 소셜로 가입된 이메일은 409 AUTH_EMAIL_SOCIAL(+provider)로 안내한다', async () => {
    mockDB.pushResult([{ password_hash: null }]); // 비번 없음 → google 소셜

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'social@test.com' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_SOCIAL');
    expect(body.provider).toBe('google');
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes'));
    expect(insertCall).toBeUndefined();
  });

  it('쿨다운 내 재요청은 새 코드를 보내지 않고 동일 응답을 반환한다', async () => {
    mockDB.pushResult([]); // existing user lookup (none)
    // 최근(쿨다운 내) 미만료 코드가 존재
    mockDB.pushResult([
      {
        created_at: new Date(Date.now() - 5 * 1000).toISOString(),
        expires_at: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
      },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'cooldown@test.com' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.debug_code).toBeUndefined();
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes'));
    expect(insertCall).toBeUndefined();
  });

  it('일일 발급 상한 초과 시 새 코드를 보내지 않는다', async () => {
    mockDB.pushResult([]); // existing user lookup (none)
    // 24시간 내 발급 건수가 상한(10) 이상 — 모두 만료된 오래된 코드라도 카운트
    const rows = Array.from({ length: 10 }, (_, i) => ({
      created_at: new Date(Date.now() - (i + 2) * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - (i + 1) * 60 * 1000).toISOString(),
    }));
    mockDB.pushResult(rows);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'capped@test.com' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.debug_code).toBeUndefined();
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes'));
    expect(insertCall).toBeUndefined();
  });
});

// ── 다시 받기 간격은 **쓸 수 있는 코드**만 붙잡는다(스펙 session-and-auth 「이메일 인증 코드」) ──
//
// 틀린 횟수가 상한(5번)에 닿은 코드는 맞는 숫자를 넣어도 429 다. 두 앱은 그때 "다시 받아 주세요" 라고
// 하는데, 그 코드가 60초 간격을 붙잡고 있으면 곧바로 누른 다시 받기가 '보내지 않는 성공' 으로 끝난다 —
// 앱은 '보냈어요' 라고 하고, 메일은 오지 않고, 든 코드는 계속 429 다(2026-10-09 의 그 사람은 코드를 받은
// 지 34초 만에 상한에 닿았다). 이미 쓴 코드도 판정에서 빠지므로 같다.
//
// 메일이 정말 나가는지 보려고 메일 서비스 설정을 넣고 `fetch` 를 대역으로 둔다 — 나가는 요청은 없다.
// 설정이 있으면 `debug_code` 가 실리지 않으므로 INSERT 와 대역 호출로 본다.
describe('다시 받기 간격 — 쓸 수 없는 코드는 붙잡지 않는다(가입·재설정 공통)', () => {
  const DELIVERY_ENV: Env = {
    ...ENV,
    RESEND_API_KEY: 'test-resend-key',
    AUTH_EMAIL_FROM: 'AlarmTalk <no-reply@example.test>',
  };

  const REGISTER = {
    name: '가입',
    path: '/auth/email-code',
    purpose: 'register',
    account: [] as MockRow[], // 미가입 주소여야 보낸다
  };
  const RESET = {
    name: '재설정',
    path: '/auth/password-reset',
    purpose: 'reset',
    account: [{ password_hash: 'bcrypt-hash' }] as MockRow[], // 비밀번호 계정이어야 보낸다
  };
  const ROUTES = [REGISTER, RESET];

  /** `secondsAgo` 초 전에 보낸 코드 한 줄 — 실제 줄처럼 수명은 발급 시각에서 센다. */
  function issuedCode(
    secondsAgo: number,
    fields: { attempts?: number; consumed_at?: string } = {},
  ): MockRow {
    const issuedAt = Date.now() - secondsAgo * 1000;
    return {
      created_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + EMAIL_VERIFICATION_TTL_SECONDS * 1000).toISOString(),
      attempts: fields.attempts ?? 0,
      consumed_at: fields.consumed_at ?? null,
    };
  }

  /** 다시 받기를 누른다 — 최근 24시간 발급 이력으로 `recent` 를 돌려준다. */
  async function requestCode(route: typeof REGISTER, recent: MockRow[]) {
    mockDB.pushResult(route.account); // classifyExistingAccount
    mockDB.pushResult(recent); // 최근 24시간 발급 이력
    mockDB.pushResult([], 1); // INSERT — 새 코드를 보낼 때만 닿는다
    const delivery = vi.fn(async () => new Response('{}'));
    globalThis.fetch = delivery as unknown as typeof fetch;

    const res = await buildApp().request(
      jsonReq('POST', route.path, { email: 'kim@test.com' }),
      undefined,
      DELIVERY_ENV,
    );

    // 보내든 안 보내든 답은 같다 — 앱은 둘을 구분하지 못한다.
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    return {
      delivery,
      insert: mockDB.calls.find((c) => c.sql.includes('INSERT INTO email_verification_codes')),
      recentQuery: mockDB.calls.find((c) => c.sql.includes("datetime('now', '-1 day')")),
    };
  }

  it.each(ROUTES)(
    '$name: 상한(5번)에 닿은 코드는 간격을 붙잡지 않는다 — 10초 만의 다시 받기도 새 코드를 보낸다',
    async (route) => {
      const { delivery, insert, recentQuery } = await requestCode(route, [
        issuedCode(10, { attempts: EMAIL_VERIFICATION_MAX_ATTEMPTS }),
      ]);

      expect(insert?.args[2]).toBe(route.purpose);
      expect(delivery).toHaveBeenCalledTimes(1);
      expect(delivery.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
      // 대역 DB 는 SELECT 가 무엇을 읽든 넣어 둔 줄을 그대로 돌려준다 — 두 열을 읽지 않는 SELECT 도 위
      // 단언은 통과한다(운영에서는 횟수가 비어 0 으로 읽히고 간격이 그대로 붙잡는다). 그래서 SQL 도 본다.
      expect(recentQuery?.sql).toContain('attempts');
      expect(recentQuery?.sql).toContain('consumed_at');
    },
  );

  it.each(ROUTES)(
    '$name: 아직 쓸 수 있는 코드(4번 틀림)는 간격을 붙잡는다 — 보내지 않고 성공으로 답한다',
    async (route) => {
      const { delivery, insert } = await requestCode(route, [
        issuedCode(10, { attempts: EMAIL_VERIFICATION_MAX_ATTEMPTS - 1 }),
      ]);

      expect(insert).toBeUndefined();
      expect(delivery).not.toHaveBeenCalled();
    },
  );

  // 재설정을 마치면 그 코드는 쓴 것이 된다(`consumed_at`) — 판정에서 빠지므로 간격도 붙잡지 않는다.
  // (가입 코드를 쓴 주소는 이미 가입돼 있어 간격까지 오기 전에 409 로 끝난다.)
  it('재설정: 이미 쓴 코드는 간격을 붙잡지 않는다', async () => {
    const { delivery, insert } = await requestCode(RESET, [
      issuedCode(10, { consumed_at: new Date(Date.now() - 5 * 1000).toISOString() }),
    ]);

    expect(insert?.args[2]).toBe('reset');
    expect(delivery).toHaveBeenCalledTimes(1);
  });

  // 간격을 풀어도 **하루 상한**은 그대로다 — 상한에 닿은 코드로 간격을 건너뛰며 메일을 끝없이 받게 두지 않는다.
  it.each(ROUTES)('$name: 상한에 닿은 코드라도 하루 발급 상한은 넘기지 않는다', async (route) => {
    const { delivery, insert } = await requestCode(route, [
      issuedCode(10, { attempts: EMAIL_VERIFICATION_MAX_ATTEMPTS }),
      ...Array.from({ length: EMAIL_VERIFICATION_DAILY_CAP - 1 }, (_, i) =>
        issuedCode((i + 1) * 15 * 60),
      ),
    ]);

    expect(insert).toBeUndefined();
    expect(delivery).not.toHaveBeenCalled();
  });
});

// ── 가장 새 코드만 된다 — **쓴 뒤에도**(스펙 session-and-auth 「이메일 인증 코드」) ──
//
// 판정은 쓰지 않은 코드 중 가장 새 것만 본다. 가입·재설정이 성공한 뒤 판정에 쓴 줄 하나만 소모하면, 바로
// 앞에 받은 코드가 '가장 새 것' 으로 올라와 제 수명(10분)까지 다시 통한다 — 메일은 "가장 최근에 받은
// 코드만 쓸 수 있어요" 라고 약속한다. 그래서 소모는 그 주소·그 용도의 쓰지 않은 줄 **전부**를 한 문장으로
// 적는다.
//
// 대역 DB 는 SQL 을 실행하지 않으므로 여기서는 문장의 대상과 인자를 본다. 앞 코드가 실제로 죽는지는 진짜
// SQLite 위에서 `auth-email-code-consume.test.ts` 가 본다.
describe('코드를 쓰면 그 주소·용도의 쓰지 않은 코드가 모두 죽는다(가입·재설정 공통)', () => {
  function consumeCalls() {
    return mockDB.calls.filter((c) => c.sql.includes('SET consumed_at'));
  }

  function expectConsumesEveryUnusedCode(email: string, purpose: string) {
    const consumes = consumeCalls();
    expect(consumes).toHaveLength(1);
    const sql = consumes[0]!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('WHERE email = ? AND purpose = ? AND consumed_at IS NULL');
    // 판정한 줄 하나(`id`)로 좁히지 않는다 — 좁히면 앞 코드가 '가장 새 것' 으로 되살아난다.
    expect(sql).not.toMatch(/\bid\s*=/);
    // 주소는 코드를 저장할 때와 같은 정규화된 값이다 — 친 그대로(대문자)면 한 줄도 닿지 않는다.
    expect(consumes[0]!.args).toEqual([email, purpose]);
  }

  it('가입: 성공하면 그 주소의 가입 코드를 전부 쓴 것으로 적는다', async () => {
    await pushValidEmailVerification('kim@test.com'); // 1) 코드 검증 SELECT
    mockDB.pushResult([]); // 2) 기존 이메일 SELECT (없음)
    mockDB.pushResult([], 1); // 3) INSERT users
    mockDB.pushResult([], 2); // 4) 소모 — 판정한 코드와 그 앞 코드

    const res = await buildApp().request(
      jsonReq('POST', '/auth/register', registerBody('KIM@Test.COM')),
      undefined,
      ENV,
    );

    expect(res.status).toBe(201);
    expectConsumesEveryUnusedCode('kim@test.com', 'register');
  });

  it('재설정 확정: 성공하면 그 주소의 재설정 코드를 전부 쓴 것으로 적는다', async () => {
    await pushValidEmailVerification('kim@test.com'); // 코드 검증 SELECT
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]); // classify → password
    mockDB.pushResult([], 1); // UPDATE users
    mockDB.pushResult([], 2); // 소모 — 판정한 코드와 그 앞 코드

    const res = await buildApp().request(
      jsonReq('POST', '/auth/password-reset/confirm', {
        email: 'KIM@Test.COM',
        code: EMAIL_CODE,
        password: 'newSecret1',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    expectConsumesEveryUnusedCode('kim@test.com', 'reset');
  });

  // 인증 확인은 코드를 쓰지 않는다 — 가입이 같은 코드를 한 번 더 판정한다.
  it('인증 확인: 통과해도 아무 코드도 쓰지 않는다', async () => {
    await pushValidEmailVerification('kim@test.com');

    const res = await buildApp().request(
      jsonReq('POST', '/auth/email-code/verify', { email: 'kim@test.com', code: EMAIL_CODE }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    expect(consumeCalls()).toHaveLength(0);
  });
});

describe('POST /auth/email-code/verify', () => {
  it('올바른 6자리 코드를 확인한다', async () => {
    await pushValidEmailVerification('kim@test.com');

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code/verify', {
        email: 'kim@test.com',
        code: EMAIL_CODE,
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('틀린 코드는 attempts를 증가시키고 400을 반환한다', async () => {
    await pushValidEmailVerification('kim@test.com');

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code/verify', {
        email: 'kim@test.com',
        code: '000000',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_CODE_INVALID');
    // 상한 확인과 세기는 한 문장이다 — 판정한 그 줄에, 상한 아래일 때만 +1.
    const gate = mockDB.calls[1]!;
    expect(gate.sql.replace(/\s+/g, ' ')).toContain(
      'SET attempts = attempts + ? WHERE id = ? AND attempts < ?',
    );
    expect(gate.args).toEqual([1, 'email-code-1', EMAIL_VERIFICATION_MAX_ATTEMPTS]);
  });

  // 상한 문장이 0행이면 읽은 뒤 그 사이에 상한이 찬 것이다 — 맞는 숫자도 통과시키지 않는다.
  it.each([
    ['맞는 코드', EMAIL_CODE],
    ['틀린 코드', '000000'],
  ])('읽은 뒤 상한이 찼으면(상한 문장 0행) %s도 429 AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED', async (_label, code) => {
    mockDB.pushResult([
      {
        id: 'email-code-1',
        code_hash: await hashEmailVerificationCode('kim@test.com', EMAIL_CODE, ENV.PASSWORD_PEPPER),
        attempts: EMAIL_VERIFICATION_MAX_ATTEMPTS - 1,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    ]);
    mockDB.pushResultFor(ATTEMPT_GATE_SQL, [], 0);

    const res = await buildApp().request(
      jsonReq('POST', '/auth/email-code/verify', { email: 'kim@test.com', code }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED');
  });

  // ── 서버 2차 정규화(스펙 session-and-auth 「코드는 ASCII 숫자 여섯 자다」) ──
  //
  // 형식 검사는 ASCII 숫자만 받는다. 아라비아-인도·페르시아·전각 숫자를 내는 키보드로 친 코드는
  // 값이 맞아도 `AUTH_VALIDATION_FAILED` 로 떨어져 **횟수도 세지 않고 영영 통과하지 못했다.**
  // shared 스키마가 형식을 보기 전에 ASCII 로 바꾸고, 라우트는 그 바뀐 값을 해시한다.
  it('아라비아-인도 숫자로 친 맞는 코드를 확인한다 — ASCII 로 바꾼 값을 해시한다', async () => {
    await pushValidEmailVerification('kim@test.com'); // 해시는 ASCII '123456' 으로 만든 것이다

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code/verify', {
        email: 'kim@test.com',
        code: toArabicIndicDigits(EMAIL_CODE),
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // 맞는 코드다 — 상한 문장은 지나되 틀린 횟수를 세지 않았다(+0).
    expect(countedIncrement()).toBe(0);
  });

  it('아라비아-인도 숫자로 친 틀린 코드는 횟수를 센다 — 형식 오류로 빠져나가지 않는다', async () => {
    await pushValidEmailVerification('kim@test.com');

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code/verify', {
        email: 'kim@test.com',
        code: toArabicIndicDigits('000000'),
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUTH_EMAIL_CODE_INVALID');
    expect(countedIncrement()).toBe(1);
  });

  it('가운데 공백이 낀 코드는 여전히 형식 오류다 — 판정까지 가지 않는다(횟수를 세지 않는다)', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code/verify', { email: 'kim@test.com', code: '123 456' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUTH_VALIDATION_FAILED');
    expect(mockDB.calls).toHaveLength(0);
  });
});

describe('POST /auth/register', () => {
  it('신규 가입 성공 → 201 + 토큰 반환', async () => {
    await pushValidEmailVerification('kim@test.com'); // 1) 코드 검증 SELECT
    mockDB.pushResult([]); // 2) 기존 이메일 SELECT (없음)
    mockDB.pushResult([], 1); // 3) INSERT users
    mockDB.pushResult([], 1); // 4) consume code UPDATE

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('kim@test.com')),
      undefined,
      ENV,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(body.user.email).toBe('kim@test.com');
    expect(body.user.plan).toBe('free');
    const insertCall = mockDB.calls.find((call) => call.sql.includes('INSERT INTO users'));
    expect(insertCall?.args[0]).toBe(body.user.id);
  });

  // 가입은 같은 코드를 **한 번 더** 판정한다 — 인증 확인만 고치면 인증은 통과하고 가입에서 막힌다.
  it('아라비아-인도 숫자로 친 코드로도 가입한다(인증 확인과 같은 스키마)', async () => {
    await pushValidEmailVerification('kim@test.com'); // 1) 코드 검증 SELECT
    mockDB.pushResult([]); // 2) 기존 이메일 SELECT (없음)
    mockDB.pushResult([], 1); // 3) INSERT users
    mockDB.pushResult([], 1); // 4) consume code UPDATE

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        ...registerBody('kim@test.com'),
        email_verification_code: toArabicIndicDigits(EMAIL_CODE),
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(201);
    expect(countedIncrement()).toBe(0);
  });

  it('중복 이메일(비밀번호 계정)은 409 AUTH_EMAIL_TAKEN 으로 막는다', async () => {
    await pushValidEmailVerification('kim@test.com'); // 코드 검증 통과
    mockDB.pushResult([{ password_hash: 'bcrypt-hash' }]); // 기존 비번 계정

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('kim@test.com')),
      undefined,
      ENV,
    );
    // 중복 이메일이면 회원가입을 막고 로그인으로 안내한다.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_TAKEN');
    const insertCall = mockDB.calls.find((call) => call.sql.includes('INSERT INTO users'));
    expect(insertCall).toBeUndefined();
  });

  it('약한 비밀번호 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        email: 'kim@test.com',
        password: 'short',
        name: '김규원',
        email_verification_code: EMAIL_CODE,
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
  });

  it('잘못된 이메일 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        email: 'not-email',
        password: 'superSecret1',
        name: '김규원',
        email_verification_code: EMAIL_CODE,
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('잘못된 JSON → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('올바른 자격증명으로 로그인 성공', async () => {
    const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
    mockDB.pushResult([
      {
        id: 'u-1',
        email: 'kim@test.com',
        password_hash: hash,
        name: '김규원',
        plan: 'plus',
      },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.plan).toBe('plus');
  });

  it('존재하지 않는 이메일 → 401', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'nouser@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
  });

  it('비밀번호 불일치 → 401', async () => {
    const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
    mockDB.pushResult([
      {
        id: 'u-1',
        email: 'kim@test.com',
        password_hash: hash,
        name: '김규원',
        plan: 'free',
      },
    ]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim@test.com',
        password: 'wrongPass1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
  });

  it('OAuth 전용 계정(비밀번호 없음) → 401 generic (가입 방식 비노출)', async () => {
    mockDB.pushResult([
      {
        id: 'u-1',
        email: 'kim@test.com',
        password_hash: null,
        name: '김규원',
        plan: 'free',
      },
    ]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    // 계정 열거 방지: AUTH_OAUTH_ONLY 로 가입 방식을 노출하지 않고 generic 응답.
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('존재하지 않는 사용자도 generic 응답 + 더미 bcrypt 비교 수행', async () => {
    mockDB.pushResult([]); // 사용자 없음
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'ghost@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    // 존재하지 않는 이메일과 비밀번호 불일치가 동일한 error_code 를 반환한다.
    expect(body.error_code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});

describe('POST /auth/google', () => {
  it('Google ID 토큰을 검증하고 앱 JWT를 발급한다', async () => {
    const googlePayload = {
      sub: 'google-user-1',
      email: 'user@gmail.com',
      name: 'Google User',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: ENV.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', {
        id_token: 'google-id-token',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    // users.id 는 서버 생성 UUID 다 — 더 이상 구글 sub 을 PK 로 쓰지 않는다.
    expect(body.user).toMatchObject({
      email: 'user@gmail.com',
      name: 'Google User',
      plan: 'free',
    });
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.id).not.toBe('google-user-1');
    const insertArgs = mockDB.calls[1]?.args ?? [];
    expect(insertArgs[0]).toBe(body.user.id); // id = 서버 생성 UUID
    expect(insertArgs[1]).toBe('google-user-1'); // google_id = 외부 식별자
    expect(insertArgs[2]).toBe('user@gmail.com');
  });

  it('같은 이메일의 기존 계정은 Google ID를 연결하고 기존 플랜을 유지한다', async () => {
    const googlePayload = {
      sub: 'google-user-2',
      email: 'linked@gmail.com',
      name: 'Linked User',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: ENV.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([
      {
        id: 'existing-user-id',
        google_id: null,
        email: 'linked@gmail.com',
        name: 'Old Name',
        plan: 'family',
      },
    ]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', {
        id_token: 'google-id-token',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(res.status).toBe(200);
    // **저장된 닉네임이 이긴다.** 예전엔 구글 프로필 이름이 덮어써서, 앱에서 고친 닉네임이
    // 다음 로그인마다 되돌아갔다. 응답·JWT·DB 가 같은 값을 쓰는지도 함께 본다 —
    // 갈라지면 로그인 직후에만 구글 이름이 보이다가 새로고침하면 바뀐다.
    expect(body.user).toMatchObject({
      id: 'existing-user-id',
      email: 'linked@gmail.com',
      name: 'Old Name',
      plan: 'family',
    });
    expect(mockDB.calls[1]?.args).toEqual([
      'google-user-2',
      'linked@gmail.com',
      'Old Name',
      'existing-user-id',
    ]);
  });

  it('저장된 이름이 없으면 구글 이름으로 채운다', async () => {
    const googlePayload = {
      sub: 'google-user-3',
      email: 'noname@gmail.com',
      name: 'Google Name',
      aud: ENV.GOOGLE_CLIENT_ID,
      iss: 'accounts.google.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([
      {
        id: 'noname-user-id',
        google_id: 'google-user-3',
        email: 'noname@gmail.com',
        name: null,
        plan: 'free',
      },
    ]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', { id_token: 'google-id-token' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('Google Name');
    expect(mockDB.calls[1]?.args?.[2]).toBe('Google Name');
  });

  it('옛 스키마로 저장된 이름도 규칙을 통과시킨다', async () => {
    // 가입이 max(64)·trim 없음이던 시절 행에는 공백뿐인 이름·보이지 않는 문자·64자가
    // 남아 있다. '저장된 이름이 이긴다' 를 그대로 적용하면 이 문으로 다시 실려 나간다.
    const googlePayload = {
      sub: 'google-user-5',
      email: 'legacy@gmail.com',
      name: 'Google Name',
      aud: ENV.GOOGLE_CLIENT_ID,
      iss: 'accounts.google.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([
      {
        id: 'legacy-user-id',
        google_id: 'google-user-5',
        email: 'legacy@gmail.com',
        // 공백뿐 + 제로폭 → 정리하면 아무것도 안 남는다.
        name: '  ​ ',
        plan: 'free',
      },
    ]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', { id_token: 'google-id-token' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 남는 게 없으면 구글 이름으로 고쳐 준다.
    expect(body.user.name).toBe('Google Name');
    expect(mockDB.calls[1]?.args?.[2]).toBe('Google Name');
  });

  it('저장된 이름이 규칙을 넘기면 다듬어서 쓴다', async () => {
    const googlePayload = {
      sub: 'google-user-6',
      email: 'long@gmail.com',
      name: 'Google Name',
      aud: ENV.GOOGLE_CLIENT_ID,
      iss: 'accounts.google.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([
      {
        id: 'long-user-id',
        google_id: 'google-user-6',
        email: 'long@gmail.com',
        name: `  ${'가'.repeat(40)}  `,
        plan: 'free',
      },
    ]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', { id_token: 'google-id-token' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 사용자가 고른 이름이라 유지하되, 30자로 잘라 규칙 안으로 들인다.
    expect(body.user.name).toBe('가'.repeat(30));
    expect(mockDB.calls[1]?.args?.[2]).toBe('가'.repeat(30));
  });

  it('구글이 준 이름도 우리 규칙(길이·보이지 않는 문자)을 통과시킨다', async () => {
    // 외부에서 온 값이라고 검증을 건너뛰면, 앱·PATCH 경로에만 있는 규칙이 이 문으로 샌다.
    const googlePayload = {
      sub: 'google-user-4',
      email: 'weird@gmail.com',
      name: `홍​길동${'가'.repeat(40)}`,
      aud: ENV.GOOGLE_CLIENT_ID,
      iss: 'accounts.google.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => googlePayload,
    }) as unknown as typeof fetch;
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', { id_token: 'google-id-token' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).not.toContain('​');
    expect(body.user.name.length).toBe(30);
  });

  it('Google 검증 실패 시 401을 반환한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_token' }),
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/google', {
        id_token: 'bad-google-id-token',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_GOOGLE_FAILED');
  });
});

describe('GET /auth/me', () => {
  it('Authorization 헤더 없음 → 401', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/auth/me'), undefined, ENV);
    expect(res.status).toBe(401);
  });

  it('가입 후 받은 토큰으로 /auth/me 호출 성공', async () => {
    await pushValidEmailVerification('kim@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('kim@test.com')),
      undefined,
      ENV,
    );
    const reg = await regRes.json();
    const token = reg.token as string;

    mockDB.pushResult([{ id: reg.user.id, email: 'kim@test.com', name: '김규원', plan: 'free' }]);

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.email).toBe('kim@test.com');
  });

  // 세션을 굴려 준다(rolling refresh). 앱을 열 때마다 만료가 뒤로 밀려야, 오래 안 열었다가
  // 연 사용자가 조용히 로그아웃돼 있는 일이 없다 — 그 로그아웃이 알람 재예약 소유자
  // 게이트에 걸리면 알람이 아예 안 울린다(AlarmRepository.reschedulePendingAlarms).
  it('/auth/me 는 만료가 더 뒤인 새 토큰을 함께 내려준다', async () => {
    await pushValidEmailVerification('roll@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('roll@test.com')),
      undefined,
      ENV,
    );
    const reg = await regRes.json();
    const token = reg.token as string;

    mockDB.pushResult([
      { id: reg.user.id, email: 'roll@test.com', name: '김규원', plan: 'free', token_epoch: 0 },
    ]);

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();

    expect(typeof meBody.token).toBe('string');
    expect(meBody.token).not.toBe('');

    const decodeExp = (jwt: string) =>
      JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).exp as number;
    // 같은 초에 발급되면 exp 가 같을 수 있으므로 '뒤로 밀리지 않았다'만 요구한다.
    expect(decodeExp(meBody.token)).toBeGreaterThanOrEqual(decodeExp(token));

    // sub 은 users.id 다 — sub 이 google_id 인 구 토큰을 들고 와도 여기서 정규화된다.
    const decodeSub = (jwt: string) =>
      JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).sub as string;
    expect(decodeSub(meBody.token)).toBe(reg.user.id);
  });

  // 폐기된 토큰(전 기기 로그아웃·비밀번호 재설정)은 갱신 대상이 아니다. 여기서 새 토큰을
  // 내주면 token_epoch 로 끊는 수단이 무력화된다.
  // 정규화가 **실제로 일어나는** 경우: 구 토큰의 sub 이 google_id 라 users.id 와 다르다.
  // 기존 테스트는 둘이 같은 계정만 써서, 구현을 payload.sub 로 되돌려도 통과했다.
  it('sub 이 google_id 인 구 토큰을 굴리면 users.id 로 정규화된다', async () => {
    const { signAppJwt } = await import('../src/lib/jwt');
    const legacyToken = await signAppJwt(
      { sub: 'google-oauth-id-999', email: 'legacy@test.com', epoch: 0 },
      ENV.JWT_SECRET,
    );

    // users 행은 id 와 google_id 가 다르다(계정 연동으로 갈라진 계정).
    mockDB.pushResult([
      {
        id: 'users-uuid-111',
        email: 'legacy@test.com',
        name: '김규원',
        plan: 'free',
        token_epoch: 0,
      },
    ]);

    const app = buildApp();
    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${legacyToken}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(200);
    const rolled = (await meRes.json()).token as string;
    const sub = JSON.parse(Buffer.from(rolled.split('.')[1]!, 'base64url').toString()).sub;
    expect(sub).toBe('users-uuid-111');
    expect(sub).not.toBe('google-oauth-id-999');
  });

  // TTL 은 이 PR 의 본체다 — 상수를 되돌리면 이 테스트가 잡는다.
  it('발급 토큰의 수명은 365일이다', async () => {
    await pushValidEmailVerification('ttl@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('ttl@test.com')),
      undefined,
      ENV,
    );
    const token = (await regRes.json()).token as string;
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    const ONE_YEAR = 60 * 60 * 24 * 365;
    expect(payload.exp - payload.iat).toBe(ONE_YEAR);
  });

  // DB 장애를 401 로 뭉개면 클라가 그걸 '세션 만료' 로 읽고 로그아웃시킨다. /auth/me 는
  // rolling refresh 때문에 앱을 열 때마다 도는 자리라 그 피해가 크다.
  it('DB 장애는 401 이 아니라 503 이다(세션을 지우지 않게)', async () => {
    await pushValidEmailVerification('infra@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('infra@test.com')),
      undefined,
      ENV,
    );
    const token = (await regRes.json()).token as string;

    mockDB.pushError(new Error('SQLITE_BUSY: database is locked'));

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(503);
    const body = await meRes.json();
    expect(body.error_code).toBe('ACCOUNT_STATUS_UNVERIFIED');
    // 내부 예외 메시지를 반사하지 않는다.
    expect(JSON.stringify(body)).not.toContain('SQLITE_BUSY');
  });

  // 문자열 휴리스틱으로 가르면 스키마 스큐(`no such column: token_epoch`)처럼 token/expired 가
  // 들어간 인프라 오류가 401 로 나가고, 클라가 멀쩡한 세션을 지운다.
  it('token/expired 가 들어간 인프라 오류도 401 이 아니라 503 이다', async () => {
    await pushValidEmailVerification('skew@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('skew@test.com')),
      undefined,
      ENV,
    );
    const token = (await regRes.json()).token as string;

    mockDB.pushError(new Error('SQLITE_ERROR: no such column: token_epoch (expired schema)'));

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(503);
    expect((await meRes.json()).error_code).toBe('ACCOUNT_STATUS_UNVERIFIED');
  });

  it('폐기된 토큰은 새 토큰을 받지 못한다(401)', async () => {
    await pushValidEmailVerification('revoked@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('revoked@test.com')),
      undefined,
      ENV,
    );
    const reg = await regRes.json();
    const token = reg.token as string;

    // 발급 토큰의 epoch 는 0 인데 서버 쪽은 1 로 올라가 있다(= 전 기기 로그아웃 이후).
    mockDB.pushResult([
      { id: reg.user.id, email: 'revoked@test.com', name: '김규원', plan: 'free', token_epoch: 1 },
    ]);

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(401);
    expect((await meRes.json()).error_code).toBe('TOKEN_REVOKED');
  });

  it('잘못된 토큰 → 401', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: 'Bearer garbage' },
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
  });

  it('Bearer 없이 토큰만 전송 → 401', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: 'some-token-without-bearer' },
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MISSING');
  });

  it('삭제된 사용자 토큰 → 404 AUTH_USER_NOT_FOUND', async () => {
    await pushValidEmailVerification('ghost@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq('POST', '/auth/register', registerBody('ghost@test.com', 'superSecret1', 'Ghost')),
      undefined,
      ENV,
    );
    const reg = await regRes.json();
    const token = reg.token as string;

    mockDB.pushResult([]);

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(404);
    const meBody = await meRes.json();
    expect(meBody.error_code).toBe('AUTH_USER_NOT_FOUND');
  });

  it('/me 응답의 null name/plan → 기본값 매핑', async () => {
    await pushValidEmailVerification('null-test@test.com');
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const regRes = await app.request(
      jsonReq(
        'POST',
        '/auth/register',
        registerBody('null-test@test.com', 'superSecret1', 'NullTest'),
      ),
      undefined,
      ENV,
    );
    const reg = await regRes.json();
    const token = reg.token as string;

    mockDB.pushResult([{ id: reg.user.id, email: 'null-test@test.com', name: null, plan: null }]);

    const meRes = await app.request(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      undefined,
      ENV,
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.name).toBe('');
    expect(meBody.user.plan).toBe('free');
  });
});

describe('POST /auth/register — 엣지 케이스', () => {
  it('이메일 대소문자 정규화 (KIM@Test.COM → kim@test.com)', async () => {
    await pushValidEmailVerification('kim@test.com'); // 1) 코드 검증 SELECT
    mockDB.pushResult([]); // 2) 기존 이메일 SELECT
    mockDB.pushResult([], 1); // 3) INSERT
    mockDB.pushResult([], 1); // 4) consume

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('KIM@Test.COM')),
      undefined,
      ENV,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('kim@test.com');

    const insertCall = mockDB.calls.find((call) => call.sql.includes('INSERT INTO users'));
    expect(insertCall?.args[1]).toBe('kim@test.com');
  });

  it('name 없이 가입 시도 → 400 검증 실패', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        email: 'noname@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
  });

  it('빈 문자열 이메일 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        email: '',
        password: 'superSecret1',
        name: 'Test',
        email_verification_code: EMAIL_CODE,
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('DB INSERT 실패 → 500 AUTH_REGISTER_FAILED', async () => {
    await pushValidEmailVerification('fail@test.com'); // 1) 코드 검증 SELECT
    mockDB.pushResult([]); // 2) 기존 이메일 SELECT (없음)

    const originalExecute = mockDB.client.execute;
    let callCount = 0;
    mockDB.client.execute = async (query: { sql: string; args: (string | number | null)[] }) => {
      callCount++;
      if (callCount === 3) {
        // 3) INSERT INTO users 단계에서 실패
        throw new Error('DB connection lost');
      }
      return originalExecute(query);
    };

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('fail@test.com', 'superSecret1', 'Fail')),
      undefined,
      ENV,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_REGISTER_FAILED');

    mockDB.client.execute = originalExecute;
  });

  it('password 필드 누락 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', {
        email: 'nopw@test.com',
        name: 'NoPW',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
  });

  it('빈 body {} → 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/auth/register', {}), undefined, ENV);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
  });
});

describe('POST /auth/login — 엣지 케이스', () => {
  it('이메일 대소문자 정규화 후 로그인 성공', async () => {
    const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
    mockDB.pushResult([
      { id: 'u-1', email: 'kim@test.com', password_hash: hash, name: '김규원', plan: 'free' },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'KIM@Test.COM',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('kim@test.com');
  });

  it('잘못된 JSON → 400 AUTH_INVALID_JSON', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{{invalid',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_JSON');
  });

  it('빈 body {} → 400 검증 실패', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/auth/login', {}), undefined, ENV);
    expect(res.status).toBe(400);
    const body = await res.json();
    // 이메일·비밀번호가 **둘 다** 빠졌으니 이메일만 지목하지 않는다.
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
  });

  // ⚠ 앞뒤 공백은 자동완성·복사붙여넣기가 실제로 붙이는 값이다. 정규화가 검증 **뒤에**
  // 있던 시절에는 이 요청이 DB 까지 가 보지도 못하고 400 으로 잘렸다.
  it('앞뒤 공백이 섞인 이메일도 정규화해 조회한다', async () => {
    const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
    mockDB.pushResult([
      { id: 'u-1', email: 'kim@test.com', password_hash: hash, name: '김규원', plan: 'free' },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: '  KIM@Test.COM  ',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(200);
    // 조회 키까지 정규화됐는지 본다 — 200 만 보면 스키마가 통과시키고 라우트가 공백
    // 붙은 값으로 조회하는 상태를 놓친다(그러면 실사용에선 401 이 난다).
    const select = mockDB.calls.find((call) => call.sql.includes('FROM users WHERE email = ?'));
    expect(select?.args).toEqual(['kim@test.com']);
  });

  it('이메일 형식만 틀리면 → 400 AUTH_EMAIL_INVALID', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim.test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    // ⚠ 401 이 아니라 400 이다 — 401 로 내리면 자격증명 불일치와 한 칸에 놓여,
    // 계정 열거를 막으려고 일부러 합쳐 둔 갈래와 뒤섞인다.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_INVALID');
    // 형식만 보고 답했으니 DB 는 건드리지 않는다.
    expect(mockDB.calls).toHaveLength(0);
  });

  it('이메일이 틀려도 비밀번호까지 비면 → AUTH_VALIDATION_FAILED + issues', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', { email: 'kim.test.com', password: '' }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // 이메일만 고쳐도 통과하지 못하므로 이메일을 지목하지 않는다.
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
    // 가입·비번재설정과 같게 `issues` 를 싣는다 — 로그인만 빠져 있어서 앱이 무엇이
    // 틀렸는지 알 길이 없었다.
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('null plan 사용자 → plan "free" 반환', async () => {
    const hash = await hashPassword('superSecret1', ENV.PASSWORD_PEPPER);
    mockDB.pushResult([
      { id: 'u-1', email: 'kim@test.com', password_hash: hash, name: null, plan: null },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('');
    expect(body.user.plan).toBe('free');
  });

  it('DB SELECT 실패 → 500 AUTH_LOGIN_FAILED', async () => {
    const originalExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB timeout');
    };

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/login', {
        email: 'kim@test.com',
        password: 'superSecret1',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_LOGIN_FAILED');

    mockDB.client.execute = originalExecute;
  });
});
