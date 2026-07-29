import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';

const mockVerifyAppJwt = vi.fn();
vi.mock('../src/lib/jwt', () => ({
  verifyAppJwt: (...args: unknown[]) => mockVerifyAppJwt(...args),
  APP_JWT_ISSUER: 'voice-alarm',
}));

// 사용자 해석 쿼리를 모킹한다. 기본은 'active' 계정 1행 반환(정상 흐름).
// 미들웨어는 해석 실패 시 fail-closed(503) 하므로 테스트도 DB 를 모킹해야 한다.
const mockDbExecute = vi.fn();
vi.mock('../src/lib/db', () => ({
  getDB: () => ({ execute: (...args: unknown[]) => mockDbExecute(...args) }),
}));

import { authMiddleware } from '../src/middleware/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
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
      userIdPK: c.get('userIdPK'),
      userLoginId: c.get('userLoginId'),
      userEmail: c.get('userEmail'),
      userName: c.get('userName'),
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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockVerifyAppJwt.mockReset();
  mockDbExecute.mockReset();
  // 기본: 'active' 계정 1행을 반환해 사용자 해석이 성공하도록 한다.
  mockDbExecute.mockResolvedValue({
    rows: [{ id: 'pk-1', deletion_status: 'active' }],
    rowsAffected: 0,
  });
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
    // 실서버의 verifyAppJwt 는 파트 수가 3 이 아니면 "Invalid token format" 을 던진다.
    mockVerifyAppJwt.mockRejectedValue(new Error('Invalid token format'));
    const app = buildApp();
    const res = await reqWithEnv(app, req('Bearer not-a-jwt'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MALFORMED_TOKEN');
  });

  it('토큰이 2파트만 있으면 401 AUTH_MALFORMED_TOKEN', async () => {
    mockVerifyAppJwt.mockRejectedValue(new Error('Invalid token format'));
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
    // userId 는 토큰의 sub 이 아니라 DB 에서 해석한 users.id 다. 이 브랜치 배포 전에
    // 발급돼 sub 이 google_id 인 구 토큰도 여기서 PK 로 맞춰야, users.id 로만 조회하는
    // 하류 경로(구독·가족 그룹·코드 등록)에서 자기 데이터를 찾을 수 있다.
    expect(body.userId).toBe('pk-1');
    expect(body.userIdPK).toBe('pk-1');
    // 토큰이 담고 있던 로그인 식별자는 레거시 행 보조 매칭용으로 따로 남는다.
    expect(body.userLoginId).toBe('user-1');
  });

  it('구글 계정이면 호환 식별자로 DB 의 google_id 를 쓴다', async () => {
    // sub 은 이제 항상 users.id 라, 재로그인한 구글 사용자는 sub 만으로 옛 google_id 를
    // 알 수 없다. 그러면 user_id 에 google_id 가 저장된 과거 행을 영영 못 찾는다.
    const token = fakeToken({ iss: 'voice-alarm', sub: 'pk-1', email: 'g@test.com', name: 'G' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'pk-1',
      email: 'g@test.com',
      name: 'G',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockDbExecute.mockResolvedValue({
      rows: [{ id: 'pk-1', google_id: 'google-123', deletion_status: 'active', token_epoch: 0 }],
      rowsAffected: 0,
    });

    const res = await reqWithEnv(buildApp(), req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('pk-1');
    expect(body.userLoginId).toBe('google-123');
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

  it('사용자 해석 쿼리 실패 시 fail-closed(503) — 탈퇴 유예 우회 차단', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // 토큰 검증은 통과하지만 사용자 해석 쿼리가 던지는 상황 → deletion_status 확인 불가.
    mockDbExecute.mockRejectedValue(new Error('db unreachable'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('ACCOUNT_STATUS_UNVERIFIED');
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

// B5: provider(Google) ID 토큰을 Bearer 로 직접 들고 오는 경로는 제거됐다.
// 이제 authMiddleware 는 자체 발급 앱 JWT 만 받으며, 모든 토큰은 verifyAppJwt 로만
// 검증된다. provider 토큰 교환은 /auth/google 에서만 이뤄진다.
describe('authMiddleware — provider ID 토큰 직접 수용 거부 (app-JWT-only)', () => {
  it('Google ID 토큰을 직접 들고 오면 verifyAppJwt 가 거부 → 401', async () => {
    const token = fakeToken({
      sub: 'google-user-123',
      iss: 'accounts.google.com',
      aud: 'test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // 앱 JWT 가 아니므로 서명 검증 실패를 흉내낸다(실서버의 verifyAppJwt 와 동일 결과).
    mockVerifyAppJwt.mockRejectedValue(new Error('Signature verification failed'));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    // provider 검증 경로가 사라졌으므로 외부 JWKS fetch 는 호출되지 않는다.
    expect(fetchSpy).not.toHaveBeenCalled();
    // 모든 토큰은 앱 JWT 검증으로만 흐른다.
    expect(mockVerifyAppJwt).toHaveBeenCalledWith(token, ENV.JWT_SECRET);
  });

it('알 수 없는 issuer 토큰도 앱 JWT 검증 실패로 401', async () => {
    const token = fakeToken({
      sub: 'user-unknown',
      iss: 'https://unknown-issuer.example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockVerifyAppJwt.mockRejectedValue(new Error('Invalid issuer'));

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_INVALID_ISSUER');
  });

  it('voice-alarm issuer(앱 JWT)는 정상 통과', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'u1', email: 'e@t.com' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'u1',
      email: 'e@t.com',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      epoch: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
    expect(mockVerifyAppJwt).toHaveBeenCalled();
  });
});

describe('authMiddleware — 토큰 폐기(token_epoch) 검사 (B5)', () => {
  it('JWT epoch < users.token_epoch 이면 401 TOKEN_REVOKED', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      epoch: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // 사용자의 현재 token_epoch 가 토큰의 epoch(0)보다 크다 → 폐기된 토큰.
    mockDbExecute.mockResolvedValue({
      rows: [{ id: 'pk-1', deletion_status: 'active', token_epoch: 1 }],
      rowsAffected: 0,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(401);
    expect((await res.json()).error_code).toBe('TOKEN_REVOKED');
  });

  it('JWT epoch >= users.token_epoch 이면 통과', async () => {
    const token = fakeToken({ iss: 'voice-alarm', sub: 'user-1' });
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      epoch: 2,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockDbExecute.mockResolvedValue({
      rows: [{ id: 'pk-1', deletion_status: 'active', token_epoch: 2 }],
      rowsAffected: 0,
    });

    const app = buildApp();
    const res = await reqWithEnv(app, req(`Bearer ${token}`));
    expect(res.status).toBe(200);
  });
});

describe('authMiddleware — base64url 디코딩 엣지 케이스', () => {
  it('payload에 패딩 없는 base64url 인코딩도 정상 디코딩', async () => {
    const payload = {
      sub: 'legacy-user',
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
