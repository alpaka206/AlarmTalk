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
  return (path: string, init?: RequestInit) => app.request(path, init);
}

describe('랜딩 이벤트 좋아요 (공개 카운터)', () => {
  beforeEach(() => mockDB.reset());

  it('GET 은 목록의 모든 목소리 수를 한 번에 돌려준다 — 행이 없으면 0, 목록 밖 행은 무시', async () => {
    mockDB.pushResultFor('FROM event_likes', [
      { subject_id: 'voice1', count: 12 },
      { subject_id: 'ghost', count: 99 },
    ]);
    const res = await buildApp()('/event/1/likes');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ likes: { voice1: 12 } });
    const q = mockDB.calls.find((c) => c.sql.includes('FROM event_likes'));
    // 값은 바인딩으로만 — SQL 문자열에 id 가 섞이지 않는다.
    expect(q!.args).toEqual(['1']);
    expect(q!.sql).not.toContain("'1'");
  });

  it('POST 는 목록의 목소리면 행을 만들거나 1 더하고 새 수를 돌려준다', async () => {
    mockDB.pushResultFor('INSERT INTO event_likes', [{ count: 13 }], 1);
    const res = await buildApp()('/event/1/likes/voice1', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 13 });
    const q = mockDB.calls.find((c) => c.sql.includes('INSERT INTO event_likes'));
    expect(q!.sql).toContain('ON CONFLICT(event_id, subject_id)');
    expect(q!.sql).toContain('count = count + 1');
    expect(q!.args).toEqual(['1', 'voice1']);
  });

  it('목록에 없는 대상·이벤트는 404 — DB 에 가지 않는다', async () => {
    const req = buildApp();
    expect((await req('/event/1/likes/nobody', { method: 'POST' })).status).toBe(404);
    expect((await req('/event/9/likes/voice1', { method: 'POST' })).status).toBe(404);
    expect((await req('/event/9/likes')).status).toBe(404);
    expect(mockDB.calls).toEqual([]);
  });

  it('슬러그가 아닌 id 는 400 — DB 에 가지 않는다', async () => {
    const res = await buildApp()('/event/1/likes/Voice%201', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(mockDB.calls).toEqual([]);
  });
});
