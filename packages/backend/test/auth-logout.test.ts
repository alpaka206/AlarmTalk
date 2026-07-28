// B5: POST /auth/logout 가 token_epoch 를 +1 하고, 이후 옛 epoch 토큰이
// authMiddleware 에서 TOKEN_REVOKED(401)로 거부되는지 검증.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';

const mockVerifyAppJwt = vi.fn();
vi.mock('../src/lib/jwt', () => ({
  verifyAppJwt: (...args: unknown[]) => mockVerifyAppJwt(...args),
  signAppJwt: vi.fn(),
  APP_JWT_ISSUER: 'voice-alarm',
}));

// 사용자 행 상태(token_epoch)를 변수로 제어한다. UPDATE 는 epoch 를 증가시킨다.
let userTokenEpoch = 0;
const dbCalls: Array<{ sql: string; args: unknown[] }> = [];
vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: async (q: { sql: string; args?: unknown[] }) => {
      dbCalls.push({ sql: q.sql, args: q.args ?? [] });
      if (/UPDATE users\s+SET token_epoch = token_epoch \+ 1/i.test(q.sql)) {
        userTokenEpoch += 1;
        return { rows: [], rowsAffected: 1 };
      }
      if (/SELECT id, deletion_status, token_epoch FROM users/i.test(q.sql)) {
        return {
          rows: [{ id: 'pk-1', deletion_status: 'active', token_epoch: userTokenEpoch }],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    },
  }),
}));

import authRoutes from '../src/routes/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route('/api/auth', authRoutes);
  return app;
}

function encodePart(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function token(): string {
  return `${encodePart({ alg: 'RS256', typ: 'JWT' })}.${encodePart({ iss: 'voice-alarm', sub: 'user-1' })}.sig`;
}
function call(method: string, path: string) {
  return buildApp().request(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${token()}` },
    }),
    undefined,
    ENV,
  );
}

beforeEach(() => {
  userTokenEpoch = 0;
  dbCalls.length = 0;
  mockVerifyAppJwt.mockReset();
});

describe('POST /auth/logout — 전 기기 로그아웃 (B5)', () => {
  it('authMiddleware 통과 후 token_epoch 를 +1 하고 success 반환', async () => {
    // logout 은 authMiddleware 를 거치므로 앱 JWT(epoch 0)를 검증 통과시킨다.
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'u@test.com',
      name: 'U',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      epoch: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await call('POST', '/api/auth/logout');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(userTokenEpoch).toBe(1);
    expect(
      dbCalls.some((c) => /UPDATE users\s+SET token_epoch = token_epoch \+ 1/i.test(c.sql)),
    ).toBe(true);
  });

  it('인증 헤더 없으면 401 (authMiddleware 차단)', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
    expect(userTokenEpoch).toBe(0);
  });
});

describe('authMiddleware — 로그아웃 후 옛 토큰 폐기 (B5)', () => {
  it('로그아웃으로 epoch 가 오르면 이전 epoch 토큰은 TOKEN_REVOKED', async () => {
    // 1) 로그아웃: epoch 0 토큰으로 통과 → users.token_epoch 1 로 증가.
    mockVerifyAppJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'u@test.com',
      iss: 'voice-alarm',
      aud: 'voice-alarm-clients',
      epoch: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const logoutRes = await call('POST', '/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(userTokenEpoch).toBe(1);

    // 2) 동일한 옛 토큰(epoch 0)으로 보호 라우트 진입 시도 → 폐기됨.
    const { authMiddleware } = await import('../src/middleware/auth');
    const guarded = new Hono<AppEnv>();
    guarded.use('*', authMiddleware);
    guarded.get('/api/alarm', (c) => c.json({ ok: true }));
    const res = await guarded.request(
      new Request('http://localhost/api/alarm', {
        headers: { Authorization: `Bearer ${token()}` },
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error_code).toBe('TOKEN_REVOKED');
  });
});
