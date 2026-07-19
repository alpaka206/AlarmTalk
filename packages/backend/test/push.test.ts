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

  it('유효 토큰+플랫폼 → success, ON CONFLICT(token) 단일 원자 UPSERT 로 재배정', async () => {
    mockDB.pushResult([], 1); // INSERT ... ON CONFLICT(token) push_tokens
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/register', { token: 'fcm-token-abc', platform: 'android' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // 재배정은 별도 DELETE 없이 단일 UPSERT 여야 한다 — 'DELETE 후 INSERT' 2문장은 동시 등록
    // (빠른 계정 전환) 인터리빙에서 소유자 2행이 남는 레이스가 있었다(Codex #567 P1).
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeUndefined();
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO push_tokens'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('ON CONFLICT(token)');
    // 충돌 시 소유자까지 갈아탄다 — 마지막 등록이 유일 승자.
    expect(insert!.sql).toContain('user_id = excluded.user_id');
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
