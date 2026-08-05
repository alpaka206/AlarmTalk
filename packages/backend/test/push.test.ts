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

  it('유효 토큰+플랫폼 → success, 쓰기 트랜잭션 안에서 DELETE+UPSERT 원자 재배정', async () => {
    mockDB.pushResult([], 0); // DELETE 다른 소유자 행
    mockDB.pushResult([], 1); // INSERT ... ON CONFLICT(user_id, token)
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/register', { token: 'fcm-token-abc', platform: 'android' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // 비트랜잭션 'DELETE 후 INSERT' 2문장은 동시 등록(빠른 계정 전환) 인터리빙에서 소유자 2행이
    // 남는 레이스가 있었다(Codex #567 P1) — 반드시 한 쓰기 트랜잭션으로 커밋돼야 한다.
    expect(mockDB.transactions.commits).toBe(1);
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeDefined();
    expect(del!.args).toEqual(['fcm-token-abc', 'user-1']);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO push_tokens'));
    expect(insert).toBeDefined();
    // 컨플릭트 타깃은 (user_id, token) 유지 — 배포가 마이그레이션(#71 token 전역 UNIQUE)보다
    // 먼저 나가는 창에서 ON CONFLICT(token) 은 매칭 제약이 없어 500 이 된다(Codex #568 P2).
    expect(insert!.sql).toContain('ON CONFLICT(user_id, token)');
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
      jsonReq('POST', '/push/register', { token: '   ', platform: 'android' }),
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

  // iOS 는 마이그레이션 #88 이 push_tokens.platform CHECK 에서 걷어냈다가 #94 가
  // 되돌린 값이다. 라우트 레벨에서 다시 막히면 iOS 기기가 가족 알람·목소리 공유·
  // 목소리 철회 신호를 하나도 못 받는다.
  it('ios platform 을 받아들인다 (#94)', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: 'apns-token-abc', platform: 'ios' }),
    );
    expect(res.status).toBe(200);
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
