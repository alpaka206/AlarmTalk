import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';

const mockVerifyAppJwt = vi.fn();
vi.mock('../src/lib/jwt', () => ({
  verifyAppJwt: (...args: unknown[]) => mockVerifyAppJwt(...args),
  APP_JWT_ISSUER: 'voice-alarm',
}));

import { authMiddleware } from '../src/middleware/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  APPLE_CLIENT_ID: 'com.voicealarm.nativeapp.ios',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware);
  app.get('/protected', (c) =>
    c.json({
      userId: c.get('userId'),
      userEmail: c.get('userEmail'),
      userName: c.get('userName'),
      userPicture: c.get('userPicture'),
    }),
  );
  return app;
}

function req(token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) {
    headers['Authorization'] = token;
  }
  return new Request('http://localhost/protected', { headers });
}

function reqWithEnv(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function encodeJwtPart(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fakeToken(payload: Record<string, unknown>): string {
  const header = encodeJwtPart({ alg: 'RS256', typ: 'JWT' });
  const body = encodeJwtPart(payload);
  return `${header}.${body}.fakesignature`;
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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockVerifyAppJwt.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('authMiddleware — Authorization header 검증', () => {
  it('Authorization 헤더 없으면 401 AUTH_MISSING', async () => {
    const app = buildApp();
    const res = await reqWithEnv(app, req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MISSING');
  });

  it('Bearer 스킴이 아니면 401 AUTH_INVALID_SCHEME', async () => {
    const app = buildApp();
    const res = await reqWithEnv(app, req('Basic abc123'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_SCHEME');
  });

  it('Bearer 뒤 공백만 있으면 401 (헤더 trim으로 AUTH_INVALID_SCHEME)', async () => {
    const app = buildApp();
    const res = await reqWithEnv(app, req('Bearer '));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_SCHEME');
  });

  it('토큰이 3파트가 아니면 401 AUTH_MALFORMED_TOKEN', async () => {
    const app = buildApp();
    const res = await reqWithEnv(app, req('Bearer not-a-jwt'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MALFORMED_TOKEN');
  });

  it('토큰이 2파트만 있으면 401 AUTH_MALFORMED_TOKEN', async () => {
    const app = buildApp();
    const res = await reqWithEnv(app, req('Bearer part1.part2'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MALFORMED_TOKEN');
  });
});

describe('authMiddleware — App JWT (voice-alarm issuer)', () => {
  it('유효한 앱 JWT 시 context에 사용자 정보 설정', async () => {
    const token = fakeToken({
      iss: 'voice-alarm',
      sub: 'user-1',
      email: 'test@test.com',
      name: 'Test',
    });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-1');
    expect(body.userEmail).toBe('test@test.com');
    expect(body.userName).toBe('Test');
    expect(body.userPicture).toBe('');
    expect(mockVerifyAppJwt).toHaveBeenCalledWith(token, ENV.JWT_SECRET);
  });

  it('앱 JWT 검증 실패 시 401', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockRejectedValue(new Error('Signature verification failed'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VERIFICATION_FAILED');
  });

  it('앱 JWT 만료 시 AUTH_TOKEN_EXPIRED', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockRejectedValue(new Error('Token expired'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('앱 JWT audience 불일치 시 AUTH_AUDIENCE_MISMATCH', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockRejectedValue(new Error('Token audience mismatch'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_AUDIENCE_MISMATCH');
  });

  it('앱 JWT issuer 불일치 시 AUTH_INVALID_ISSUER', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockRejectedValue(new Error('Invalid issuer'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_ISSUER');
  });

  it('name 없는 앱 JWT도 정상 처리 (userName="")', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-2', email: 'no-name@test.com' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-2',
      email: 'no-name@test.com',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userName).toBe('');
  });
});

describe('authMiddleware — Google token', () => {
  it('유효한 Google 토큰 시 context에 사용자 정보 설정', async () => {
    const payload = {
      sub: 'google-user-123',
      email: 'user@gmail.com',
      name: 'Google User',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = fakeToken(payload);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('google-user-123');
    expect(body.userEmail).toBe('user@gmail.com');
    expect(body.userName).toBe('Google User');
    expect(body.userPicture).toBe('https://lh3.googleusercontent.com/photo.jpg');
  });

  it('Google API가 에러 반환하면 401', async () => {
    const token = fakeToken({
      sub: 'g-user',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid token' }),
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_VERIFICATION_FAILED');
  });

  it('Google 토큰 audience 불일치 시 AUTH_AUDIENCE_MISMATCH', async () => {
    const payload = {
      sub: 'g-user',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: 'wrong-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = fakeToken(payload);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_AUDIENCE_MISMATCH');
  });

  it('Google 토큰 만료 시 AUTH_TOKEN_EXPIRED', async () => {
    const payload = {
      sub: 'g-user',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = fakeToken(payload);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('fetch 네트워크 에러 시 401', async () => {
    const token = fakeToken({
      sub: 'g-user',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
  });
});

describe('authMiddleware — Apple token', () => {
  it('유효한 Apple 토큰 시 context에 사용자 정보 설정', async () => {
    const payload = {
      sub: 'apple-user-001',
      email: 'user@privaterelay.appleid.com',
      iss: 'https://appleid.apple.com',
      email_verified: true,
      aud: ENV.APPLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signedAppleToken(payload);

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('apple-user-001');
    expect(body.userEmail).toBe('user@privaterelay.appleid.com');
    expect(body.userName).toBe('');
    expect(body.userPicture).toBe('');
  });

  it('Apple 토큰 만료 시 AUTH_TOKEN_EXPIRED', async () => {
    const payload = {
      sub: 'apple-user-001',
      email: 'user@apple.com',
      iss: 'https://appleid.apple.com',
      email_verified: true,
      aud: ENV.APPLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = await signedAppleToken(payload);

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('Apple 토큰 email 없으면 빈 문자열', async () => {
    const payload = {
      sub: 'apple-user-002',
      iss: 'https://appleid.apple.com',
      email_verified: true,
      aud: ENV.APPLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signedAppleToken(payload);

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('apple-user-002');
    expect(body.userEmail).toBe('');
  });

  // 회귀: Authorization 헤더로 직접 Apple id_token 을 들고 오는 경로는
  // nonce 비교가 불가능하므로 (raw nonce 가 없음) 기존 동작이 유지되어야 한다.
  // 즉 토큰에 nonce 클레임이 있어도 미들웨어는 통과시킨다.
  it('토큰에 nonce 클레임이 있어도 미들웨어는 nonce 검사 없이 통과한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const payload = {
        sub: 'apple-user-mw-nonce',
        email: 'mw-nonce@apple.com',
        iss: 'https://appleid.apple.com',
      email_verified: true,
        aud: ENV.APPLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'a'.repeat(64),
      };
      const token = await signedAppleToken(payload);

      const app = buildApp();
      const res = await reqWithEnv(app, req(`Bearer ${token}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('apple-user-mw-nonce');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('authMiddleware — 토큰 발급자 분기', () => {
  it('알 수 없는 issuer는 거부한다', async () => {
    const payload = {
      sub: 'user-unknown',
      iss: 'https://unknown-issuer.example.com',
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = fakeToken(payload);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_ISSUER');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockVerifyAppJwt).not.toHaveBeenCalled();
  });

  it('voice-alarm issuer는 앱 JWT 경로', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'u1', email: 'e@t.com' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'u1',
      email: 'e@t.com',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    expect(mockVerifyAppJwt).toHaveBeenCalled();
  });

  it('appleid.apple.com issuer는 Apple JWKS 검증 경로', async () => {
    const payload = {
      sub: 'apple-u',
      iss: 'https://appleid.apple.com',
      email_verified: true,
      aud: ENV.APPLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signedAppleToken(payload);

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(mockVerifyAppJwt).not.toHaveBeenCalled();
  });
});

describe('authMiddleware — base64url 디코딩 엣지 케이스', () => {
  it('payload에 패딩 없는 base64url 인코딩도 정상 디코딩', async () => {
    const payload = {
      sub: 'apple-user',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.sig`;
    mockVerifyAppJwt.mockResolvedValue(payload);

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
  });

  it('payload JSON 파싱 실패 시 401', async () => {
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const body = btoa('not-json{{{');
    const token = `${header}.${body}.sig`;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
  });
});
