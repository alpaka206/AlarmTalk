import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { createMockDB, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import authRoutes from '../src/routes/auth';
import { hashPassword } from '../src/lib/password';
import { hashEmailVerificationCode } from '../src/lib/email-verification';

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

async function pushValidEmailVerification(email: string) {
  mockDB.pushResult([
    {
      id: 'email-code-1',
      code_hash: await hashEmailVerificationCode(email, EMAIL_CODE, ENV.PASSWORD_PEPPER),
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  ]);
}

function registerBody(email: string, password = 'superSecret1', name = '김규원') {
  return {
    email,
    password,
    name,
    email_verification_code: EMAIL_CODE,
  };
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
    expect(mockDB.calls[1]?.sql).toContain('attempts = attempts + 1');
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
    expect(body.user).toMatchObject({
      id: 'existing-user-id',
      email: 'linked@gmail.com',
      name: 'Linked User',
      plan: 'family',
    });
    expect(mockDB.calls[1]?.args).toEqual([
      'google-user-2',
      'linked@gmail.com',
      'Linked User',
      'existing-user-id',
    ]);
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
    expect(body.error_code).toBe('AUTH_VALIDATION_FAILED');
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
