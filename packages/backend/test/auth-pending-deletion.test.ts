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
let tokenEpoch = 0;
vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: async () => ({ rows: [{ id: 'pk-1', deletion_status: deletionStatus, token_epoch: tokenEpoch }] }),
  }),
}));

import { authMiddleware } from '../src/middleware/auth';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'g',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
} as Env;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware);
  app.get('/api/alarm', (c) => c.json({ ok: true }));
  app.delete('/api/user/me/deletion', (c) => c.json({ ok: 'cancelled' }));
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
  tokenEpoch = 0;
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

  // 탈퇴 신청은 token_epoch 를 올려 모든 기기의 세션을 끊는다(2026-10-15). 다른 기기가 401(자동 만료)로 읽으면
  // 알람 예약을 남긴 채 로그아웃한다 — 유예 코드를 받아야 알람까지 정리하고 떠난다(코덱스 #904).
  it('유예 계정의 폐기된 토큰은 401 이 아니라 403 ACCOUNT_PENDING_DELETION', async () => {
    deletionStatus = 'pending_deletion';
    tokenEpoch = 1;
    mockVerifyAppJwt.mockResolvedValueOnce({ sub: 'user-1', iss: 'voice-alarm', epoch: 0 });
    const res = await call(buildApp(), 'GET', '/api/alarm');
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('ACCOUNT_PENDING_DELETION');
  });

  it('폐기된 토큰으로는 탈퇴를 철회할 수 없다 — 허용 경로도 폐기 검사를 지난다', async () => {
    deletionStatus = 'pending_deletion';
    tokenEpoch = 1;
    mockVerifyAppJwt.mockResolvedValueOnce({ sub: 'user-1', iss: 'voice-alarm', epoch: 0 });
    const res = await call(buildApp(), 'DELETE', '/api/user/me/deletion');
    expect(res.status).toBe(401);
    expect((await res.json()).error_code).toBe('TOKEN_REVOKED');
  });

  it('active 계정의 폐기된 토큰은 그대로 401 TOKEN_REVOKED', async () => {
    deletionStatus = 'active';
    tokenEpoch = 1;
    mockVerifyAppJwt.mockResolvedValueOnce({ sub: 'user-1', iss: 'voice-alarm', epoch: 0 });
    const res = await call(buildApp(), 'GET', '/api/alarm');
    expect(res.status).toBe(401);
    expect((await res.json()).error_code).toBe('TOKEN_REVOKED');
  });
});
