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

  it('문자열 숫자 — Number() 변환 정상', async () => {
    mockDB.pushResult([{ total: '7', active: '3' }]);
    mockDB.pushResult([{ total: '12' }]);
    mockDB.pushResult([{ total: '2' }]);
    mockDB.pushResult([{ total: '5' }]);
    mockDB.pushResult([{ total: '4', pending: '1' }]);
    mockDB.pushResult([{ total: '3' }]);
    for (let i = 0; i < 5; i++) {
      mockDB.pushResult([{ this_week: '3', last_week: '1' }]);
    }

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));
    const body = await res.json();

    expect(body.alarms).toEqual({ total: 7, active: 3 });
    expect(body.messages).toEqual({ total: 12 });
    expect(body.voices).toEqual({ total: 2 });
    expect(body.friends).toEqual({ total: 5 });
    expect(body.gifts).toEqual({ received: 4, receivedPending: 1, sent: 3 });
    expect(body.trends.alarms).toEqual({ thisWeek: 3, lastWeek: 1 });
  });

  it('각 카테고리별 독립 트렌드 값', async () => {
    mockDB.pushResult([{ total: 1, active: 1 }]);
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ total: 1, pending: 0 }]);
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ this_week: 10, last_week: 5 }]);
    mockDB.pushResult([{ this_week: 0, last_week: 3 }]);
    mockDB.pushResult([{ this_week: 1, last_week: 0 }]);
    mockDB.pushResult([{ this_week: 7, last_week: 7 }]);
    mockDB.pushResult([{ this_week: 2, last_week: 8 }]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));
    const body = await res.json();

    expect(body.trends.alarms).toEqual({ thisWeek: 10, lastWeek: 5 });
    expect(body.trends.messages).toEqual({ thisWeek: 0, lastWeek: 3 });
    expect(body.trends.voices).toEqual({ thisWeek: 1, lastWeek: 0 });
    expect(body.trends.friends).toEqual({ thisWeek: 7, lastWeek: 7 });
    expect(body.trends.gifts).toEqual({ thisWeek: 2, lastWeek: 8 });
  });

  it('트렌드 쿼리 args에 SQLite datetime 포맷(공백 구분) 날짜 바인딩', async () => {
    // created_at 은 DEFAULT datetime('now') 로 'YYYY-MM-DD HH:MM:SS'(공백 구분)로 저장되므로
    // 트렌드 임계값도 같은 포맷으로 바인딩해야 문자열 비교가 경계일에 뒤집히지 않는다.
    pushAllStatsResults();
    const app = buildApp('u-trend');
    await app.request(new Request('http://localhost/stats'));

    const trendCall = mockDB.calls[6];
    expect(trendCall.args).toHaveLength(5);
    expect(typeof trendCall.args[0]).toBe('string');
    const dateFmt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect((trendCall.args[0] as string)).toMatch(dateFmt);
    expect((trendCall.args[1] as string)).toMatch(dateFmt);
    expect((trendCall.args[2] as string)).toMatch(dateFmt);
    expect(trendCall.args[3]).toBe('u-trend');
    expect(trendCall.args[4]).toBe('u-trend');
  });

  it('alarms 쿼리 — user_id OR target_user_id 양쪽 검색', async () => {
    pushAllStatsResults();
    const app = buildApp('sender-user');
    await app.request(new Request('http://localhost/stats'));

    const alarmSql = mockDB.calls[0].sql;
    expect(alarmSql).toContain('user_id = ?');
    expect(alarmSql).toContain('target_user_id = ?');
    expect(mockDB.calls[0].args).toEqual(['sender-user', 'sender-user']);
  });

  it('friendships 쿼리 — accepted 상태만 카운트', async () => {
    pushAllStatsResults();
    const app = buildApp();
    await app.request(new Request('http://localhost/stats'));

    const friendSql = mockDB.calls[3].sql;
    expect(friendSql).toContain("status = 'accepted'");
  });

  it('gifts received vs sent 분리 카운트', async () => {
    pushAllStatsResults({
      giftsReceived: { total: 10, pending: 4 },
      giftsSent: 7,
    });

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));
    const body = await res.json();

    expect(body.gifts.received).toBe(10);
    expect(body.gifts.receivedPending).toBe(4);
    expect(body.gifts.sent).toBe(7);
    expect(mockDB.calls[4].sql).toContain('recipient_id');
    expect(mockDB.calls[5].sql).toContain('sender_id');
  });

  it('undefined 필드 — 0으로 폴백 (rows[0] 존재, 필드 누락)', async () => {
    mockDB.pushResult([{ total: 3 }]);
    mockDB.pushResult([{ total: 5 }]);
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ total: 2 }]);
    mockDB.pushResult([{ total: 6 }]);
    mockDB.pushResult([{ total: 1 }]);
    for (let i = 0; i < 5; i++) {
      mockDB.pushResult([{ this_week: 1 }]);
    }

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats'));
    const body = await res.json();

    expect(body.alarms.active).toBe(0);
    expect(body.gifts.receivedPending).toBe(0);
    expect(body.trends.alarms.lastWeek).toBe(0);
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

  it('메시지 text 정확히 50자 — 잘리지 않음 (경계)', async () => {
    const exact50 = 'A'.repeat(50);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'm1', text: exact50, created_at: '2026-04-24T09:00:00Z', type: 'message' },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.text).toBe(exact50);
    expect(body.activities[0].detail.text).toHaveLength(50);
  });

  it('메시지 text 51자 — 50자로 잘림 (경계)', async () => {
    const text51 = 'B'.repeat(51);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'm1', text: text51, created_at: '2026-04-24T09:00:00Z', type: 'message' },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.text).toHaveLength(50);
    expect(body.activities[0].detail.text).toBe('B'.repeat(50));
  });

  it('단일 타입만 있는 활동 (알람만 5개)', async () => {
    const alarms = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      time: `0${i + 1}:00`,
      created_at: `2026-04-24T0${i + 1}:00:00Z`,
      type: 'alarm',
    }));
    mockDB.pushResult(alarms);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities).toHaveLength(5);
    expect(body.activities.every((a: { type: string }) => a.type === 'alarm')).toBe(true);
    expect(body.activities[0].detail.time).toBe('05:00');
  });

  it('선물 note 빈 문자열 — falsy이므로 null로 변환', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'g1', note: '', status: 'pending', created_at: '2026-04-24T06:00:00Z', type: 'gift' },
    ]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.note).toBeNull();
    expect(body.activities[0].detail.status).toBe('pending');
  });

  it('activity userId 바인딩 — alarms/gifts는 양방향', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp('act-user-99');
    await app.request(new Request('http://localhost/stats/activity'));

    expect(mockDB.calls[0].args).toEqual(['act-user-99', 'act-user-99']);
    expect(mockDB.calls[1].args).toEqual(['act-user-99']);
    expect(mockDB.calls[2].args).toEqual(['act-user-99', 'act-user-99']);
    expect(mockDB.calls[3].args).toEqual(['act-user-99']);
  });

  it('activity SQL — ORDER BY + LIMIT 5 각 쿼리', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    await app.request(new Request('http://localhost/stats/activity'));

    for (let i = 0; i < 4; i++) {
      expect(mockDB.calls[i].sql).toContain('ORDER BY created_at DESC');
      expect(mockDB.calls[i].sql).toContain('LIMIT 5');
    }
  });

  it('정확히 10개 활동 — 모두 반환 (경계)', async () => {
    const alarms = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      time: `0${i}:00`,
      created_at: `2026-04-24T0${i}:00:00Z`,
      type: 'alarm',
    }));
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      text: `msg ${i}`,
      created_at: `2026-04-24T1${i}:00:00Z`,
      type: 'message',
    }));

    mockDB.pushResult(alarms);
    mockDB.pushResult(messages);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities).toHaveLength(10);
  });

  it('동일 timestamp 활동 — 모두 포함, 안정적 반환', async () => {
    const ts = '2026-04-24T12:00:00Z';
    mockDB.pushResult([
      { id: 'a1', time: '12:00', created_at: ts, type: 'alarm' },
    ]);
    mockDB.pushResult([
      { id: 'm1', text: '동시 메시지', created_at: ts, type: 'message' },
    ]);
    mockDB.pushResult([
      { id: 'g1', note: '동시 선물', status: 'pending', created_at: ts, type: 'gift' },
    ]);
    mockDB.pushResult([
      { id: 'v1', name: '동시 음성', status: 'ready', created_at: ts, type: 'voice' },
    ]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities).toHaveLength(4);
    const types = body.activities.map((a: { type: string }) => a.type).sort();
    expect(types).toEqual(['alarm', 'gift', 'message', 'voice']);
    expect(body.activities.every((a: { created_at: string }) => a.created_at === ts)).toBe(true);
  });

  it('메시지 text 숫자 타입 — String() 변환 후 slice', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([
      { id: 'm1', text: 12345, created_at: '2026-04-24T09:00:00Z', type: 'message' },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities[0].detail.text).toBe('12345');
  });

  it('4개 소스 모두 max 5개씩 (20개) → 10개만 반환', async () => {
    const make = (prefix: string, type: string, extra: Record<string, unknown>, hour: number) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: `${prefix}${i}`,
        ...extra,
        created_at: `2026-04-24T${String(hour + i).padStart(2, '0')}:00:00Z`,
        type,
      }));

    mockDB.pushResult(make('a', 'alarm', { time: '08:00' }, 0));
    mockDB.pushResult(make('m', 'message', { text: 'hi' }, 5));
    mockDB.pushResult(make('g', 'gift', { note: 'note', status: 'pending' }, 10));
    mockDB.pushResult(make('v', 'voice', { name: 'voice', status: 'ready' }, 15));

    const app = buildApp();
    const res = await app.request(new Request('http://localhost/stats/activity'));
    const body = await res.json();

    expect(body.activities).toHaveLength(10);
    expect(body.activities[0].type).toBe('voice');
    expect(body.activities[0].created_at).toBe('2026-04-24T19:00:00Z');
  });
});
