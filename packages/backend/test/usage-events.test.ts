import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventsRoutes from '../src/routes/events';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/events', eventsRoutes);
  return app;
}

const ALARM_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'alarm_created',
    occurred_at: '2026-09-06T21:00:00.000Z',
    alarm_id: ALARM_ID,
    ...overrides,
  };
}

describe('POST /events — 사용 기록 배치 수집', () => {
  beforeEach(() => mockDB.reset());

  it('배치를 한 트랜잭션에서 INSERT OR IGNORE 로 넣는다(재전송 멱등)', async () => {
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/events', { events: [event(), event({ type: 'alarm_rang' })] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBe(2);
    expect(mockDB.transactions.commits).toBe(1);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO usage_events'));
    expect(insert).toBeDefined();
    // 소유자는 **토큰의 사용자**다 — 클라가 보낸 값을 쓰지 않는다.
    expect(insert!.args).toContain('user-1');
  });

  it('울림 이벤트도 그대로 받는다 — 기기가 오프라인에 쌓았다가 나중에 보낸 것이다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'alarm_rang', occurred_at: '2026-09-01T21:00:00.000Z' })],
      }),
    );
    expect(res.status).toBe(200);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO usage_events'));
    // 도착 시각이 아니라 **일어난 시각**이 그대로 저장돼야 한다(며칠 늦게 와도).
    expect(insert!.args).toContain('2026-09-01T21:00:00.000Z');
  });

  it('문구를 붙이면 보관함 행을 사용중으로 표시한다 — 본인 행만', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
      }),
    );
    const update = mockDB.calls.find((c) => c.sql.includes('SET in_use = 1'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('user_id = ?');
    expect(update!.args).toEqual([
      '2026-09-06T21:00:00.000Z',
      '2026-09-06T21:00:00.000Z',
      MESSAGE_ID,
      'user-1',
    ]);
  });

  it('해제는 더 최근 사실을 덮지 않는다 — 늦게 도착한 큐가 사용중을 되돌리면 안 된다', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_released', message_id: MESSAGE_ID })],
      }),
    );
    const update = mockDB.calls.find((c) => c.sql.includes('SET in_use = 0'));
    expect(update).toBeDefined();
    // 시각 비교 가드가 있어야 한다(오프라인 큐는 며칠 밀릴 수 있다).
    expect(update!.sql).toContain('in_use_updated_at <= ?');
  });

  it('모르는 종류는 400 — 앱이 서버보다 앞서 나가도 조용히 버려지지 않는다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', { events: [event({ type: 'something_new' })] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_USAGE_EVENTS');
  });

  it('빈 배열·상한 초과는 400', async () => {
    const app = buildApp();
    const empty = await app.request(jsonReq('POST', '/events', { events: [] }));
    expect(empty.status).toBe(400);
    const tooMany = await app.request(
      jsonReq('POST', '/events', { events: Array.from({ length: 101 }, () => event()) }),
    );
    expect(tooMany.status).toBe(400);
  });

  it('자유 문자열은 길이를 막는다 — 이벤트는 식별자만 나른다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', { events: [event({ detail: 'x'.repeat(121) })] }),
    );
    expect(res.status).toBe(400);
  });
});
