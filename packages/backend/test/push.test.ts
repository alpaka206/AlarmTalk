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

describe('POST /push/register — FCM 토큰 등록', () => {
  beforeEach(() => mockDB.reset());

  it('유효 토큰+플랫폼 → success, 재배정 DELETE 후 upsert', async () => {
    mockDB.pushResult([], 0); // DELETE 다른 소유자 행
    mockDB.pushResult([], 1); // INSERT ... ON CONFLICT push_tokens
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/register', { token: 'fcm-token-abc', platform: 'android' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // 이 토큰의 다른 소유자 행을 먼저 제거(전역 단일 소유자) — A→B 로그인 시 오배달 방지.
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeDefined();
    expect(del!.sql).toContain('token = ?');
    expect(del!.sql).toContain('user_id != ?');
    expect(del!.args).toEqual(['fcm-token-abc', 'user-1']);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO push_tokens'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('ON CONFLICT(user_id, token)');
    // args = [uuid, userPk, token, platform] — 소유자 스코프(userPk)로 저장.
    expect(insert!.args).toContain('user-1');
    expect(insert!.args).toContain('fcm-token-abc');
    expect(insert!.args).toContain('android');
  });

  it('token 누락 → 400 INVALID_PUSH_TOKEN', async () => {
    const res = await buildApp().request(jsonReq('POST', '/push/register', { platform: 'android' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });

  it('공백 token → 400', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: '   ', platform: 'ios' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });

  it('허용되지 않은 platform → 400 INVALID_PLATFORM', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: 'tok', platform: 'windows' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PLATFORM');
  });

  it('잘못된 JSON → 400 INVALID_JSON', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_JSON');
  });
});

describe('POST /push/unregister — 토큰 해제(로그아웃)', () => {
  beforeEach(() => mockDB.reset());

  it('토큰 전역 제거 → success', async () => {
    mockDB.pushResult([], 1); // DELETE FROM push_tokens WHERE token = ?
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/unregister', { token: 'fcm-token-abc' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeDefined();
    expect(del!.sql).toContain('WHERE token = ?');
    expect(del!.args).toEqual(['fcm-token-abc']);
  });

  it('token 누락 → 400', async () => {
    const res = await buildApp().request(jsonReq('POST', '/push/unregister', {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });
});
