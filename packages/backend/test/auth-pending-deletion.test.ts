// 탈퇴 유예(pending_deletion) 계정이 인증 API 에서 차단되는지 검증.
// getDB 를 스텁으로 갈아끼워 사용자 행의 deletion_status 를 제어한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';

const mockVerifyAppJwt = vi.fn();
vi.mock('../src/lib/jwt', () => ({
  verifyAppJwt: (...args: unknown[]) => mockVerifyAppJwt(...args),
  APP_JWT_ISSUER: 'voice-alarm',
}));

let deletionStatus = 'active';
vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: async () => ({ rows: [{ id: 'pk-1', deletion_status: deletionStatus }] }),
  }),
}));

import { authMiddleware } from '../src/middleware/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'g',
  APPLE_CLIENT_ID: 'a',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
} as Env;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware);
  app.get('/api/alarm', (c) => c.json({ ok: true }));
  app.delete('/api/user/me/deletion', (c) => c.json({ ok: 'cancelled' }));
  app.get('/api/user/me', (c) => c.json({ ok: 'me' }));
  return app;
}

function encodePart(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function token(): string {
  return `${encodePart({ alg: 'RS256', typ: 'JWT' })}.${encodePart({ iss: 'voice-alarm', sub: 'user-1' })}.sig`;
}

function call(app: Hono<AppEnv>, method: string, path: string) {
  return app.request(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${token()}` },
    }),
    undefined,
    ENV,
  );
}

beforeEach(() => {
  mockVerifyAppJwt.mockReset();
  mockVerifyAppJwt.mockResolvedValue({
    sub: 'user-1',
    email: 'u@test.com',
    name: 'U',
    iss: 'voice-alarm',
    aud: 'voice-alarm-clients',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
});

describe('authMiddleware — pending_deletion 차단', () => {
  it('active 계정은 일반 인증 API 통과', async () => {
    deletionStatus = 'active';
    const res = await call(buildApp(), 'GET', '/api/alarm');
    expect(res.status).toBe(200);
  });

  it('pending_deletion 계정은 일반 인증 API 403 ACCOUNT_PENDING_DELETION', async () => {
    deletionStatus = 'pending_deletion';
    const res = await call(buildApp(), 'GET', '/api/alarm');
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('ACCOUNT_PENDING_DELETION');
  });

  it('pending_deletion 이어도 탈퇴 철회(DELETE /user/me/deletion)는 허용', async () => {
    deletionStatus = 'pending_deletion';
    const res = await call(buildApp(), 'DELETE', '/api/user/me/deletion');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe('cancelled');
  });

  it('pending_deletion 이어도 본인정보 조회(GET /user/me)는 허용', async () => {
    deletionStatus = 'pending_deletion';
    const res = await call(buildApp(), 'GET', '/api/user/me');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe('me');
  });
});
