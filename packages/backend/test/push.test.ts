import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import pushRoutes from '../src/routes/push';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/push', pushRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /push/token — 푸시 토큰 등록', () => {
  it('JSON 바디 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/push/token', { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  it('token 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { platform: 'android' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('token');
  });

  it('token 빈 문자열이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: '', platform: 'android' }),
    );
    expect(res.status).toBe(400);
  });

  it('token 500자 초과이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'x'.repeat(501), platform: 'ios' }),
    );
    expect(res.status).toBe(400);
  });

  it('잘못된 platform이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'abc123', platform: 'windows' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('platform');
  });

  it('platform 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'abc123' }),
    );
    expect(res.status).toBe(400);
  });

  it.each(['ios', 'android', 'web'])('platform=%s 정상 등록 201', async (platform) => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'fcm-token-xyz', platform }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockDB.calls).toHaveLength(1);
    const sql = mockDB.calls[0].sql;
    expect(sql).toContain('INSERT INTO push_tokens');
    expect(sql).toContain('ON CONFLICT');
    expect(mockDB.calls[0].args).toContain('user-1');
    expect(mockDB.calls[0].args).toContain('fcm-token-xyz');
    expect(mockDB.calls[0].args).toContain(platform);
  });

  it('token 앞뒤 공백 trim', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: '  abc  ', platform: 'ios' }),
    );
    expect(res.status).toBe(201);
    expect(mockDB.calls[0].args).toContain('abc');
  });

  it('500자 토큰도 등록 가능', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const longToken = 'a'.repeat(500);
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: longToken, platform: 'android' }),
    );
    expect(res.status).toBe(201);
  });
});

describe('DELETE /push/token — 푸시 토큰 삭제', () => {
  it('JSON 바디 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/push/token', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  it('token 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('DELETE', '/push/token', {}),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('token');
  });

  it('token 빈 문자열이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('DELETE', '/push/token', { token: '   ' }),
    );
    expect(res.status).toBe(400);
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('DELETE', '/push/token', { token: 'fcm-token-xyz' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockDB.calls).toHaveLength(1);
    expect(mockDB.calls[0].sql).toContain('DELETE FROM push_tokens');
    expect(mockDB.calls[0].args).toContain('user-1');
    expect(mockDB.calls[0].args).toContain('fcm-token-xyz');
  });

  it('존재하지 않는 토큰도 200 (멱등성)', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(
      jsonReq('DELETE', '/push/token', { token: 'nonexistent' }),
    );
    expect(res.status).toBe(200);
  });

  it('다른 사용자 토큰 삭제 시도 시 자기 user_id만 사용', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp('user-42');
    const res = await app.request(
      jsonReq('DELETE', '/push/token', { token: 'some-token' }),
    );
    expect(res.status).toBe(200);
    expect(mockDB.calls[0].args[0]).toBe('user-42');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /push/token                                      */
/* ------------------------------------------------------------------ */
describe('POST /push/token — edge cases', () => {
  it('token이 숫자이면 빈 문자열로 처리 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 12345, platform: 'ios' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TOKEN_LENGTH');
  });

  it('platform이 null → 빈 문자열 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'valid-token', platform: null }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PLATFORM');
  });

  it('platform이 boolean → 빈 문자열 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'valid-token', platform: true }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PLATFORM');
  });

  it('빈 JSON body ({}) → token 빈 문자열 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', {}),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TOKEN_LENGTH');
  });

  it('token 500자 경계 — 정확히 500자 등록 가능', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/push/token', { token: 'b'.repeat(500), platform: 'web' }),
    );
    expect(res.status).toBe(201);
  });

  it('SQL에 ON CONFLICT upsert 포함', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    await app.request(
      jsonReq('POST', '/push/token', { token: 'tok', platform: 'ios' }),
    );
    expect(mockDB.calls[0].sql).toContain('ON CONFLICT');
    expect(mockDB.calls[0].sql).toContain("datetime('now')");
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — DELETE /push/token                                    */
/* ------------------------------------------------------------------ */
describe('DELETE /push/token — edge cases', () => {
  it('token이 숫자이면 빈 문자열로 처리 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('DELETE', '/push/token', { token: 999 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('TOKEN_REQUIRED');
  });

  it('token trim 후 값이 DELETE 쿼리에 전달', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    await app.request(
      jsonReq('DELETE', '/push/token', { token: '  trimmed  ' }),
    );
    expect(mockDB.calls[0].args).toContain('trimmed');
  });
});
