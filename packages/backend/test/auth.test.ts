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
  PERSO_API_KEY: 'x',
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

function encodeJwtPart(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signedAppleToken(payload: Record<string, unknown>): Promise<string> {
  const kid = crypto.randomUUID();
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const header = encodeJwtPart({ alg: 'RS256', kid, typ: 'JWT' });
  const body = encodeJwtPart(payload);
  const unsigned = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    keyPair.privateKey,
    new TextEncoder().encode(unsigned),
  );

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }),
  }) as unknown as typeof fetch;

  return `${unsigned}.${encodeBytes(new Uint8Array(signature))}`;
}

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

describe('POST /auth/email-code', () => {
  it('신규 이메일에 6자리 인증 코드를 발급한다', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);

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
    expect(mockDB.calls[1]?.args[1]).toBe('kim@test.com');
  });

  it('이미 가입된 이메일에는 인증 코드를 보내지 않는다', async () => {
    mockDB.pushResult([{ id: 'u-1' }]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/email-code', { email: 'kim@test.com' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_TAKEN');
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
    mockDB.pushResult([]);
    await pushValidEmailVerification('kim@test.com');
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

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

  it('중복 이메일 → 409', async () => {
    mockDB.pushResult([{ id: 'u-1' }]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('kim@test.com')),
      undefined,
      ENV,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_EMAIL_TAKEN');
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

  it('OAuth 전용 계정(비밀번호 없음) → 401 OAUTH_ONLY', async () => {
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
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_OAUTH_ONLY');
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
    expect(body.user).toMatchObject({
      id: 'google-user-1',
      email: 'user@gmail.com',
      name: 'Google User',
      plan: 'free',
    });
    expect(mockDB.calls[1]?.args.slice(0, 3)).toEqual([
      'google-user-1',
      'google-user-1',
      'user@gmail.com',
    ]);
  });

  it('같은 이메일의 기존 계정은 Google ID를 연결하고 기존 플랜을 유지한다', async () => {
    const googlePayload = {
      sub: 'google-user-2',
      email: 'linked@gmail.com',
      name: 'Linked User',
      iss: 'accounts.google.com',
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
      null,
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

describe('POST /auth/apple', () => {
  it('Apple ID token으로 앱 JWT를 발급한다', async () => {
    const appleToken = await signedAppleToken({
      sub: 'apple-user-1',
      email: 'user@privaterelay.appleid.com',
      name: 'Apple User',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
        name: 'Apple User',
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(body.user).toMatchObject({
      id: 'apple-user-1',
      email: 'user@privaterelay.appleid.com',
      name: 'Apple User',
      plan: 'free',
    });
    expect(mockDB.calls[1]?.sql).toContain('INSERT INTO users');
    expect(mockDB.calls[1]?.args.slice(0, 5)).toEqual([
      'apple-user-1',
      'apple-user-1',
      'apple-user-1',
      'user@privaterelay.appleid.com',
      'Apple User',
    ]);
  });

  it('기존 이메일 계정에 Apple ID를 연결한다', async () => {
    const appleToken = await signedAppleToken({
      sub: 'apple-user-2',
      email: 'linked@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockDB.pushResult([
      {
        id: 'existing-user-id',
        google_id: null,
        apple_id: null,
        email: 'linked@icloud.com',
        name: 'Linked User',
        plan: 'plus',
      },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      id: 'existing-user-id',
      email: 'linked@icloud.com',
      name: 'Linked User',
      plan: 'plus',
    });
    expect(mockDB.calls[1]?.args).toEqual([
      'apple-user-2',
      'apple-user-2',
      'linked@icloud.com',
      '',
      'existing-user-id',
    ]);
  });

  it('Apple token audience 불일치 시 401을 반환한다', async () => {
    const appleToken = await signedAppleToken({
      sub: 'apple-user-3',
      email: 'bad@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'other.bundle',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_APPLE_FAILED');
  });

  it('rejects a tampered Apple token signature', async () => {
    const appleToken = await signedAppleToken({
      sub: 'apple-user-4',
      email: 'tampered@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tamperedToken = appleToken.replace(/\.[^.]+$/, '.badsignature');

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: tamperedToken,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_APPLE_FAILED');
  });

  it('requires APPLE_CLIENT_ID for Apple login', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: 'header.payload.signature',
      }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_APPLE_CONFIG_MISSING');
  });

  it('nonce 일치 시 200을 반환한다', async () => {
    const rawNonce = 'nonce-replay-defense-1234';
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rawNonce),
    );
    const nonceHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const appleToken = await signedAppleToken({
      sub: 'apple-user-nonce-ok',
      email: 'nonce-ok@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: nonceHash,
    });

    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
        nonce: rawNonce,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe('apple-user-nonce-ok');
  });

  it('nonce 불일치 시 401 AUTH_APPLE_NONCE_MISMATCH 를 반환한다', async () => {
    const rawNonce = 'client-nonce-AAAA-1234567890';
    const otherDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('SOMETHING-ELSE-1234567890'),
    );
    const wrongNonceHash = Array.from(new Uint8Array(otherDigest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const appleToken = await signedAppleToken({
      sub: 'apple-user-nonce-bad',
      email: 'nonce-bad@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: wrongNonceHash,
    });

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
        nonce: rawNonce,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_APPLE_NONCE_MISMATCH');
  });

  it('nonce 미전달 + 토큰에도 nonce 없음 → 200 + console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const appleToken = await signedAppleToken({
        sub: 'apple-user-no-nonce',
        email: 'no-nonce@icloud.com',
        iss: 'https://appleid.apple.com',
        aud: 'com.voicealarm.nativeapp.ios',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockDB.pushResult([]);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);

      const app = buildApp();
      const res = await app.request(
        jsonReq('POST', '/auth/apple', {
          id_token: appleToken,
        }),
        undefined,
        { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
      );

      expect(res.status).toBe(200);
      const warnCalls = warnSpy.mock.calls.map((call) => String(call[0] ?? ''));
      expect(warnCalls.some((msg) => msg.includes('nonce'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('토큰엔 nonce 클레임 있는데 요청 nonce 없으면 401 mismatch', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('some-raw-nonce-1234567890'),
    );
    const nonceHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const appleToken = await signedAppleToken({
      sub: 'apple-user-token-has-nonce',
      email: 'token-nonce@icloud.com',
      iss: 'https://appleid.apple.com',
      aud: 'com.voicealarm.nativeapp.ios',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: nonceHash,
    });

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/apple', {
        id_token: appleToken,
      }),
      undefined,
      { ...ENV, APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_APPLE_NONCE_MISMATCH');
  });
});

describe('GET /auth/me', () => {
  it('Authorization 헤더 없음 → 401', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/auth/me'), undefined, ENV);
    expect(res.status).toBe(401);
  });

  it('가입 후 받은 토큰으로 /auth/me 호출 성공', async () => {
    mockDB.pushResult([]);
    await pushValidEmailVerification('kim@test.com');
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
    mockDB.pushResult([]);
    await pushValidEmailVerification('ghost@test.com');
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
    mockDB.pushResult([]);
    await pushValidEmailVerification('null-test@test.com');
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
    mockDB.pushResult([]);
    await pushValidEmailVerification('kim@test.com');
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/auth/register', registerBody('KIM@Test.COM')),
      undefined,
      ENV,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('kim@test.com');

    const insertCall = mockDB.calls[2];
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
    mockDB.pushResult([]);
    await pushValidEmailVerification('fail@test.com');

    const originalExecute = mockDB.client.execute;
    let callCount = 0;
    mockDB.client.execute = async (query: { sql: string; args: (string | number | null)[] }) => {
      callCount++;
      if (callCount === 3) {
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
