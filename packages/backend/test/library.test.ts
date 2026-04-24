import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import libraryRoutes from '../src/routes/library';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/library', libraryRoutes);
  return app;
}

beforeEach(() => {
  mockDB.calls.length = 0;
});

describe('GET /library', () => {
  it('빈 라이브러리 반환', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('페이지네이션 파라미터 전달', async () => {
    mockDB.pushResult([{ total: 50 }]);
    mockDB.pushResult([{ id: 'lib-1', message_id: 'm-1', text: 'hello' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?limit=10&offset=5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
  });

  it('favorite 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: 'lib-1', is_favorite: 1, text: 'fav' }]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/library?filter=favorite'));
    expect(mockDB.calls[0].sql).toContain('is_favorite = 1');
  });
});

describe('PATCH /library/:id/favorite', () => {
  it('즐겨찾기 토글 (off → on)', async () => {
    mockDB.pushResult([{ is_favorite: 0 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/library/550e8400-e29b-41d4-a716-446655440000/favorite'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_favorite).toBe(true);
  });

  it('즐겨찾기 토글 (on → off)', async () => {
    mockDB.pushResult([{ is_favorite: 1 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/library/550e8400-e29b-41d4-a716-446655440000/favorite'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_favorite).toBe(false);
  });

  it('존재하지 않는 항목 → 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/library/550e8400-e29b-41d4-a716-446655440000/favorite'));
    expect(res.status).toBe(404);
  });

  it('잘못된 UUID → 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/library/invalid-id/favorite'));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /library/:id', () => {
  it('항목 삭제 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/library/550e8400-e29b-41d4-a716-446655440000'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('존재하지 않는 항목 → 404', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/library/550e8400-e29b-41d4-a716-446655440000'));
    expect(res.status).toBe(404);
  });

  it('잘못된 UUID → 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/library/bad-id'));
    expect(res.status).toBe(400);
  });
});

describe('GET /library — 필터 상세', () => {
  it('limit 최대 100으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?limit=999'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('voice 필터 적용', async () => {
    const vpId = '50000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: 'lib-1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/library?filter=voice:${vpId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it('date 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: 'lib-1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?filter=date:2026-04-10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});
