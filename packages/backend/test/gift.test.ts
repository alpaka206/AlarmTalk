import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import giftRoutes from '../src/routes/gift';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/gift', giftRoutes);
  return app;
}

beforeEach(() => {
  mockDB.calls.length = 0;
});

describe('POST /gift — 선물 보내기', () => {
  it('이메일 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/gift', { message_id: ID.message }));
    expect(res.status).toBe(400);
  });

  it('message_id 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/gift', { recipient_email: 'b@test.com' }));
    expect(res.status).toBe(400);
  });

  it('메모 200자 초과면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', {
        recipient_email: 'b@test.com',
        message_id: ID.message,
        note: 'x'.repeat(201),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('받는 사람이 존재하지 않으면 404', async () => {
    mockDB.pushResult([]); // recipient lookup
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'nobody@test.com', message_id: ID.message }),
    );
    expect(res.status).toBe(404);
  });

  it('자기 자신에게 선물하면 400', async () => {
    mockDB.pushResult([{ google_id: 'user-1' }]);
    const app = buildApp('user-1');
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'me@test.com', message_id: ID.message }),
    );
    expect(res.status).toBe(400);
  });

  it('친구가 아니면 403', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]); // recipient exists
    mockDB.pushResult([]); // areFriends returns false
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'b@test.com', message_id: ID.message }),
    );
    expect(res.status).toBe(403);
  });

  it('메시지가 존재하지 않으면 404', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]); // recipient
    mockDB.pushResult([{ id: ID.friendship }]); // areFriends
    mockDB.pushResult([]); // message lookup
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'b@test.com', message_id: ID.messageBad }),
    );
    expect(res.status).toBe(404);
  });

  it('정상 선물이면 201', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]); // recipient
    mockDB.pushResult([{ id: ID.friendship }]); // areFriends
    mockDB.pushResult([{ id: ID.message }]); // message exists
    mockDB.pushResult([], 1); // insert gift
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'b@test.com', message_id: ID.message }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gift.status).toBe('pending');
    expect(body.gift.message_id).toBe(ID.message);
  });
});

describe('GET /gift/received — 받은 선물', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]); // count
    mockDB.pushResult([]); // data
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/received'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gifts).toEqual([]);
  });
});

describe('GET /gift/sent — 보낸 선물', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]); // count
    mockDB.pushResult([]); // data
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/sent'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gifts).toEqual([]);
  });
});

describe('PATCH /gift/:id/accept — 수락', () => {
  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/gift/${ID.gift404}/accept`));
    expect(res.status).toBe(404);
  });

  it('정상 수락 — 라이브러리에도 추가', async () => {
    mockDB.pushResult([{ id: ID.gift, message_id: ID.message }]); // existing pending
    mockDB.pushResult([], 1); // update gift status
    mockDB.pushResult([], 1); // insert message_library
    mockDB.pushResult([{ id: ID.gift, status: 'accepted', message_id: ID.message }]); // select updated
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/gift/${ID.gift}/accept`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const libInsert = mockDB.calls.find((c) => c.sql.includes('message_library'));
    expect(libInsert).toBeDefined();
  });
});

describe('PATCH /gift/:id/reject — 거절', () => {
  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/gift/${ID.gift404}/reject`));
    expect(res.status).toBe(404);
  });

  it('정상 거절', async () => {
    mockDB.pushResult([{ id: ID.gift }]); // existing pending
    mockDB.pushResult([], 1); // update
    mockDB.pushResult([{ id: ID.gift, status: 'rejected' }]); // select updated
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/gift/${ID.gift}/reject`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('pending 상태 + 수신자 확인 SQL 검증', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('PATCH', `/gift/${ID.gift}/reject`));
    expect(mockDB.calls[0].sql).toContain("status = 'pending'");
    expect(mockDB.calls[0].sql).toContain('recipient_id = ?');
    expect(mockDB.calls[0].args).toContain('user-1');
  });
});

describe('POST /gift — 응답 상세', () => {
  it('메모 200자 경계값 허용', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]);
    mockDB.pushResult([{ id: ID.friendship }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', {
        recipient_email: 'b@test.com',
        message_id: ID.message,
        note: 'x'.repeat(200),
      }),
    );
    expect(res.status).toBe(201);
  });

  it('메모 미제공 시 null 저장', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]);
    mockDB.pushResult([{ id: ID.friendship }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', { recipient_email: 'b@test.com', message_id: ID.message }),
    );
    expect(res.status).toBe(201);
    const insertArgs = mockDB.calls[3].args;
    expect(insertArgs[5]).toBeNull();
  });

  it('선물 생성 시 전체 응답 형태 검증', async () => {
    mockDB.pushResult([{ google_id: 'user-2' }]);
    mockDB.pushResult([{ id: ID.friendship }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/gift', {
        recipient_email: 'b@test.com',
        message_id: ID.message,
        note: 'hello!',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gift.id).toBeDefined();
    expect(body.gift.message_id).toBe(ID.message);
    expect(body.gift.status).toBe('pending');
  });
});

describe('GET /gift/received — 페이지네이션', () => {
  it('페이지네이션 메타데이터 반환', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: ID.gift, sender_email: 'a@b.com', message_text: 'hi' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/received'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gifts).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('limit/offset 적용', async () => {
    mockDB.pushResult([{ total: 50 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/received?limit=5&offset=10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
  });

  it('limit 최대 100으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/received?limit=999'));
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('검색 쿼리 SQL LIKE로 전달', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/received?q=hello'));
    expect(res.status).toBe(200);
    expect(mockDB.calls[0].args).toContain('%hello%');
  });
});

describe('GET /gift/sent — 페이지네이션', () => {
  it('페이지네이션 메타데이터 반환', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: ID.gift, recipient_email: 'a@b.com' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/sent'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gifts).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('빈 보낸 목록', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/sent'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gifts).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('검색 쿼리 LIKE (이름/이메일/텍스트)', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/gift/sent?q=test'));
    expect(res.status).toBe(200);
    const countSql = mockDB.calls[0].sql;
    expect(countSql).toContain('LIKE');
  });
});

describe('PATCH /gift/:id/accept — 상세', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/gift/bad-id/accept'));
    expect(res.status).toBe(400);
  });

  it('수락 시 message_library 삽입 확인', async () => {
    mockDB.pushResult([{ id: ID.gift, message_id: ID.message }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ id: ID.gift, status: 'accepted', message_id: ID.message }]);
    const app = buildApp();
    await app.request(jsonReq('PATCH', `/gift/${ID.gift}/accept`));
    const libInsert = mockDB.calls.find((c) => c.sql.includes('message_library'));
    expect(libInsert).toBeDefined();
    expect(libInsert!.args[2]).toBe(ID.message);
  });
});

describe('PATCH /gift/:id/reject — 상세', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/gift/bad-id/reject'));
    expect(res.status).toBe(400);
  });
});
