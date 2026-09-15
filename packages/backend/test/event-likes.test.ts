import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventRoutes from '../src/routes/event';

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route('/event', eventRoutes);
  return app;
}

describe('랜딩 이벤트 좋아요 (공개 카운터)', () => {
  beforeEach(() => mockDB.reset());

  it('GET 은 이벤트의 모든 대상 수를 한 번에 돌려준다', async () => {
    mockDB.pushResultFor('FROM event_likes', [
      { subject_id: 'nanami', count: 3 },
      { subject_id: 'winter', count: 12 },
    ]);
    const res = await buildApp().request('/event/1/likes');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ likes: { nanami: 3, winter: 12 } });
    const q = mockDB.calls.find((c) => c.sql.includes('FROM event_likes'));
    // 값은 바인딩으로만 — SQL 문자열에 id 가 섞이지 않는다.
    expect(q!.args).toEqual(['1']);
    expect(q!.sql).not.toContain("'1'");
  });

  it('POST 는 있는 행만 1 더하고 새 수를 돌려준다', async () => {
    mockDB.pushResultFor('UPDATE event_likes', [{ count: 13 }], 1);
    const res = await buildApp().request('/event/1/likes/winter', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 13 });
    const q = mockDB.calls.find((c) => c.sql.includes('UPDATE event_likes'));
    expect(q!.sql).toContain('count = count + 1');
    expect(q!.args).toEqual(['1', 'winter']);
  });

  it('모르는 대상은 404 — 아무 id 로나 행을 만들어 내지 못한다', async () => {
    mockDB.pushResultFor('UPDATE event_likes', [], 0);
    const res = await buildApp().request('/event/1/likes/nobody', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('슬러그가 아닌 id 는 400 — DB 에 가지 않는다', async () => {
    const res = await buildApp().request('/event/1/likes/Win%20ter', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(mockDB.calls).toEqual([]);
  });
});
