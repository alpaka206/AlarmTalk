import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import statsRoutes from '../src/routes/stats';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/stats', statsRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('GET /stats — 대시보드 통계', () => {
  function pushAllStatsResults(overrides?: {
    alarms?: { total: number; active: number };
    messages?: number;
    voices?: number;
    friends?: number;
    giftsReceived?: { total: number; pending: number };
    giftsSent?: number;
  }) {
    const a = overrides?.alarms ?? { total: 5, active: 3 };
    const m = overrides?.messages ?? 10;
    const v = overrides?.voices ?? 2;
    const f = overrides?.friends ?? 4;
    const gr = overrides?.giftsReceived ?? { total: 3, pending: 1 };
    const gs = overrides?.giftsSent ?? 2;

    mockDB.pushResult([{ total: a.total, active: a.active }]);
    mockDB.pushResult([{ total: m }]);
    mockDB.pushResult([{ total: v }]);
    mockDB.pushResult([{ total: f }]);
    mockDB.pushResult([{ total: gr.total, pending: gr.pending }]);
    mockDB.pushResult([{ total: gs }]);

    for (let i = 0; i < 5; i++) {
      mockDB.pushResult([{ this_week: 2, last_week: 1 }]);
    }
  }

  it('정상 응답 200 — 전체 통계 반환', async () => {
    pushAllStatsResults();
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.alarms).toEqual({ total: 5, active: 3 });
    expect(body.messages).toEqual({ total: 10 });
    expect(body.voices).toEqual({ total: 2 });
    expect(body.friends).toEqual({ total: 4 });
    expect(body.gifts).toEqual({ received: 3, receivedPending: 1, sent: 2 });
    expect(body.trends.alarms).toEqual({ thisWeek: 2, lastWeek: 1 });
    expect(body.trends.messages).toEqual({ thisWeek: 2, lastWeek: 1 });
    expect(body.trends.voices).toEqual({ thisWeek: 2, lastWeek: 1 });
    expect(body.trends.friends).toEqual({ thisWeek: 2, lastWeek: 1 });
    expect(body.trends.gifts).toEqual({ thisWeek: 2, lastWeek: 1 });
  });

  it('빈 데이터 — 0으로 반환', async () => {
    mockDB.pushResult([{ total: 0, active: 0 }]);
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([{ total: 0, pending: 0 }]);
    mockDB.pushResult([{ total: 0 }]);
    for (let i = 0; i < 5; i++) {
      mockDB.pushResult([{ this_week: 0, last_week: 0 }]);
    }

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms.total).toBe(0);
    expect(body.alarms.active).toBe(0);
    expect(body.messages.total).toBe(0);
    expect(body.friends.total).toBe(0);
    expect(body.gifts.sent).toBe(0);
  });

  it('null 값 처리 — 0으로 폴백', async () => {
    mockDB.pushResult([{ total: null, active: null }]);
    mockDB.pushResult([{ total: null }]);
    mockDB.pushResult([{ total: null }]);
    mockDB.pushResult([{ total: null }]);
    mockDB.pushResult([{ total: null, pending: null }]);
    mockDB.pushResult([{ total: null }]);
    for (let i = 0; i < 5; i++) {
      mockDB.pushResult([{ this_week: null, last_week: null }]);
    }

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms).toEqual({ total: 0, active: 0 });
    expect(body.messages).toEqual({ total: 0 });
    expect(body.trends.alarms).toEqual({ thisWeek: 0, lastWeek: 0 });
  });

  it('11개 DB 쿼리 실행 확인', async () => {
    pushAllStatsResults();
    const app = buildApp();
    await app.request(new Request('http://localhost/stats'));

    expect(mockDB.calls).toHaveLength(11);
    expect(mockDB.calls[0].sql).toContain('alarms');
    expect(mockDB.calls[1].sql).toContain('messages');
    expect(mockDB.calls[2].sql).toContain('voice_profiles');
    expect(mockDB.calls[3].sql).toContain('friendships');
    expect(mockDB.calls[6].sql).toContain('alarms');
  });

  it('userId 바인딩 확인', async () => {
    pushAllStatsResults();
    const app = buildApp('test-user-42');
    await app.request(new Request('http://localhost/stats'));

    expect(mockDB.calls[0].args).toContain('test-user-42');
    expect(mockDB.calls[1].args).toContain('test-user-42');
    expect(mockDB.calls[2].args).toContain('test-user-42');
  });

  it('DB 에러 시 500 + error_code', async () => {
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB connection lost');
    };

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch stats');
    expect(body.error_code).toBe('FETCH_STATS_FAILED');

    mockDB.client.execute = origExecute;
  });

  it('빈 rows 배열 반환 시 0으로 폴백', async () => {
    for (let i = 0; i < 6; i++) mockDB.pushResult([]);
    for (let i = 0; i < 5; i++) mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms).toEqual({ total: 0, active: 0 });
    expect(body.messages).toEqual({ total: 0 });
    expect(body.voices).toEqual({ total: 0 });
    expect(body.friends).toEqual({ total: 0 });
    expect(body.gifts).toEqual({ received: 0, receivedPending: 0, sent: 0 });
    expect(body.trends.alarms).toEqual({ thisWeek: 0, lastWeek: 0 });
  });

  it('큰 숫자 정상 반환', async () => {
    pushAllStatsResults({ alarms: { total: 99999, active: 50000 }, messages: 100000 });

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms.total).toBe(99999);
    expect(body.alarms.active).toBe(50000);
    expect(body.messages.total).toBe(100000);
  });
});

describe('GET /stats/activity — 최근 활동', () => {
  it('빈 활동 — 빈 배열 반환', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toEqual([]);
  });

  it('혼합 활동 — 최신순 정렬 + 최대 10개', async () => {
    mockDB.pushResult([
      { id: 'a1', time: '08:00', created_at: '2026-04-24T08:00:00Z', type: 'alarm' },
      { id: 'a2', time: '07:00', created_at: '2026-04-24T07:00:00Z', type: 'alarm' },
    ]);
    mockDB.pushResult([
      { id: 'm1', text: '좋은 아침이야!', created_at: '2026-04-24T09:00:00Z', type: 'message' },
    ]);
    mockDB.pushResult([
      { id: 'g1', note: '선물 메모', status: 'pending', created_at: '2026-04-24T06:00:00Z', type: 'gift' },
    ]);
    mockDB.pushResult([
      { id: 'v1', name: '엄마 목소리', status: 'ready', created_at: '2026-04-24T10:00:00Z', type: 'voice' },
    ]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toHaveLength(5);
    expect(body.activities[0].type).toBe('voice');
    expect(body.activities[0].id).toBe('v1');
    expect(body.activities[1].type).toBe('message');
    expect(body.activities[4].type).toBe('gift');
  });

  it('알람 활동 detail 형식', async () => {
    mockDB.pushResult([
      { id: 'a1', time: '08:30', created_at: '2026-04-24T08:00:00Z', type: 'alarm' },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail).toEqual({ time: '08:30' });
    expect(body.activities[0].type).toBe('alarm');
  });

  it('메시지 detail.text 50자 초과 시 자름', async () => {
    const longText = '가'.repeat(60);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'm1', text: longText, created_at: '2026-04-24T09:00:00Z', type: 'message' },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.text).toHaveLength(50);
  });

  it('선물 note가 null이면 detail.note null', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'g1', note: null, status: 'accepted', created_at: '2026-04-24T06:00:00Z', type: 'gift' },
    ]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail).toEqual({ note: null, status: 'accepted' });
  });

  it('음성 detail 형식', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'v1', name: '아빠', status: 'processing', created_at: '2026-04-24T10:00:00Z', type: 'voice' },
    ]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail).toEqual({ name: '아빠', status: 'processing' });
  });

  it('4개 DB 쿼리 실행 확인', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    await app.request(new Request('http://localhost/stats/activity'));

    expect(mockDB.calls).toHaveLength(4);
    expect(mockDB.calls[0].sql).toContain('alarms');
    expect(mockDB.calls[1].sql).toContain('messages');
    expect(mockDB.calls[2].sql).toContain('gifts');
    expect(mockDB.calls[3].sql).toContain('voice_profiles');
  });

  it('DB 에러 시 500 + error_code', async () => {
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('timeout');
    };

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch activity');
    expect(body.error_code).toBe('FETCH_ACTIVITY_FAILED');

    mockDB.client.execute = origExecute;
  });

  it('10개 초과 활동 → 최대 10개 반환', async () => {
    const alarms = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      time: `0${i}:00`,
      created_at: `2026-04-24T0${i}:00:00Z`,
      type: 'alarm',
    }));
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      text: `메시지 ${i}`,
      created_at: `2026-04-24T1${i}:00:00Z`,
      type: 'message',
    }));
    const gifts = Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`,
      note: `선물 ${i}`,
      status: 'pending',
      created_at: `2026-04-23T0${i}:00:00Z`,
      type: 'gift',
    }));

    mockDB.pushResult(alarms);
    mockDB.pushResult(messages);
    mockDB.pushResult(gifts);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities).toHaveLength(10);
    expect(body.activities[0].type).toBe('message');
  });

  it('선물 note 50자 초과 시 잘림', async () => {
    const longNote = '나'.repeat(60);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'g1', note: longNote, status: 'pending', created_at: '2026-04-24T06:00:00Z', type: 'gift' },
    ]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.note).toHaveLength(50);
  });
});
