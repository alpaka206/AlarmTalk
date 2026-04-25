import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import friendRoutes from '../src/routes/friend';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/friend', friendRoutes);
  return app;
}

beforeEach(() => {
  mockDB.calls.length = 0;
});

describe('POST /friend — 친구 요청', () => {
  it('유효하지 않은 이메일이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('이메일 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', {}));
    expect(res.status).toBe(400);
  });

  it('존재하지 않는 사용자이면 404', async () => {
    mockDB.pushResult([]); // user lookup returns empty
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'nobody@test.com' }));
    expect(res.status).toBe(404);
  });

  it('자기 자신에게 요청하면 400', async () => {
    mockDB.pushResult([{ google_id: 'user-1', email: 'me@test.com', name: 'Me' }]);
    const app = buildApp('user-1');
    const res = await app.request(jsonReq('POST', '/friend', { email: 'me@test.com' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('자기 자신');
  });

  it('이미 친구이면 409', async () => {
    mockDB.pushResult([{ google_id: 'user-2', email: 'b@test.com', name: 'B' }]);
    mockDB.pushResult([{ id: ID.friendship, status: 'accepted' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'b@test.com' }));
    expect(res.status).toBe(409);
  });

  it('이미 대기 중이면 409', async () => {
    mockDB.pushResult([{ google_id: 'user-2', email: 'b@test.com', name: 'B' }]);
    mockDB.pushResult([{ id: ID.friendship, status: 'pending' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'b@test.com' }));
    expect(res.status).toBe(409);
  });

  it('정상 요청이면 201', async () => {
    mockDB.pushResult([{ google_id: 'user-2', email: 'b@test.com', name: 'B' }]);
    mockDB.pushResult([]); // no existing friendship
    mockDB.pushResult([], 1); // insert
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'b@test.com' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.friendship.status).toBe('pending');
    expect(body.friendship.user_a).toBe('user-1');
    expect(body.friendship.user_b).toBe('user-2');
  });
});

describe('GET /friend/list — 친구 목록', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]); // count
    mockDB.pushResult([]); // data
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.friends).toEqual([]);
  });

  it('친구 목록 반환', async () => {
    mockDB.pushResult([{ total: 1 }]); // count
    mockDB.pushResult([
      {
        id: ID.friendship,
        user_a: 'user-1',
        user_b: 'user-2',
        friend_email: 'b@test.com',
        friend_name: 'B',
        friend_picture: null,
        created_at: '2026-01-01',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.friends).toHaveLength(1);
    expect(body.friends[0].friend_email).toBe('b@test.com');
  });
});

describe('GET /friend/pending — 대기 중인 요청', () => {
  it('대기 중인 요청 반환', async () => {
    mockDB.pushResult([{ total: 1 }]); // count
    mockDB.pushResult([
      {
        id: ID.friendship,
        user_a: 'user-2',
        requester_email: 'b@test.com',
        requester_name: 'B',
        requester_picture: null,
        created_at: '2026-01-01',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/pending'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending).toHaveLength(1);
  });
});

describe('PATCH /friend/:id/accept — 수락', () => {
  it('존재하지 않는 요청이면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/friend/${ID.friendship404}/accept`));
    expect(res.status).toBe(404);
  });

  it('정상 수락이면 success', async () => {
    mockDB.pushResult([{ id: ID.friendship }]); // existing pending
    mockDB.pushResult([], 1); // update
    mockDB.pushResult([{ id: ID.friendship, user_a: 'user-2', user_b: 'user-1', status: 'accepted' }]); // select updated
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/friend/${ID.friendship}/accept`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('DELETE /friend/:id — 삭제', () => {
  it('존재하지 않는 친구관계면 404', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/friend/${ID.friendship404}`));
    expect(res.status).toBe(404);
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/friend/${ID.friendship}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('현재 사용자가 참여한 관계만 삭제', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    await app.request(jsonReq('DELETE', `/friend/${ID.friendship}`));
    expect(mockDB.calls[0].sql).toContain('user_a = ?');
    expect(mockDB.calls[0].sql).toContain('user_b = ?');
    expect(mockDB.calls[0].args).toContain('user-1');
  });
});

describe('GET /friend/list — 페이지네이션 상세', () => {
  it('limit/offset 파라미터 적용', async () => {
    mockDB.pushResult([{ total: 50 }]);
    mockDB.pushResult([{ id: ID.friendship, friend_email: 'a@b.com' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?limit=5&offset=10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
    expect(mockDB.calls[1].args).toContain(5);
    expect(mockDB.calls[1].args).toContain(10);
  });

  it('limit 최대 100으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?limit=999'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('limit 최소 1로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?limit=-5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(1);
  });

  it('검색 쿼리 SQL LIKE로 전달', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: ID.friendship, friend_name: 'Alice' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?q=alice'));
    expect(res.status).toBe(200);
    expect(mockDB.calls[0].args).toContain('%alice%');
    expect(mockDB.calls[1].args).toContain('%alice%');
  });

  it('공백만 있는 검색어 무시', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?q=  '));
    expect(res.status).toBe(200);
    expect(mockDB.calls[0].sql).not.toContain('LIKE');
  });
});

describe('GET /friend/pending — 상세', () => {
  it('빈 대기 목록', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/pending'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('limit/offset 적용', async () => {
    mockDB.pushResult([{ total: 30 }]);
    mockDB.pushResult([{ id: ID.friendship }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/pending?limit=10&offset=20'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
  });
});

describe('POST /friend — 엣지 케이스', () => {
  it('거절된 관계가 있어도 새 요청 가능 (status 가 accepted/pending 아님)', async () => {
    mockDB.pushResult([{ google_id: 'user-2', email: 'b@test.com', name: 'B' }]);
    mockDB.pushResult([{ id: ID.friendship, status: 'rejected' }]);
    mockDB.pushResult([], 1); // insert
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'b@test.com' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.friendship.status).toBe('pending');
  });

  it('역방향 friendship 이 이미 pending 이면 409', async () => {
    mockDB.pushResult([{ google_id: 'user-2', email: 'b@test.com', name: 'B' }]);
    mockDB.pushResult([{ id: ID.friendship, status: 'pending' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'b@test.com' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('ALREADY_PENDING');
    const sql = mockDB.calls[1].sql;
    expect(sql).toContain('user_a = ? AND user_b = ?');
  });

  it('target_email 과 target_name 이 응답에 포함', async () => {
    mockDB.pushResult([{ google_id: 'user-3', email: 'c@test.com', name: 'Charlie' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/friend', { email: 'c@test.com' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.friendship.target_email).toBe('c@test.com');
    expect(body.friendship.target_name).toBe('Charlie');
  });
});

describe('PATCH /friend/:id/accept — UUID 검증', () => {
  it('유효하지 않은 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/friend/not-a-valid-uuid/accept'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid friendship ID format');
  });
});

describe('DELETE /friend/:id — UUID 검증', () => {
  it('유효하지 않은 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/friend/bad-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid friendship ID format');
  });
});

describe('GET /friend/list — 파라미터 엣지 케이스', () => {
  it('limit 가 비숫자 문자열이면 기본값 20으로 폴백', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?limit=abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
  });

  it('offset 이 음수이면 0으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list?offset=-10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it('total 이 null 이면 0으로 처리', async () => {
    mockDB.pushResult([{ total: null }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/friend/list'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
  });
});

describe('PATCH /friend/:id/accept — SQL 검증', () => {
  it('현재 사용자의 pending 요청만 조회', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('PATCH', `/friend/${ID.friendship}/accept`));
    expect(mockDB.calls[0].sql).toContain("status = 'pending'");
    expect(mockDB.calls[0].args).toContain('user-1');
    expect(mockDB.calls[0].args).toContain(ID.friendship);
  });

  it('수락 후 요청자 상세 정보 반환', async () => {
    mockDB.pushResult([{ id: ID.friendship }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.friendship,
      user_a: 'user-2',
      user_b: 'user-1',
      status: 'accepted',
      name: 'Other User',
      email: 'other@e.com',
      picture: 'https://pic.example.com/other.jpg',
    }]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/friend/${ID.friendship}/accept`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.friendship.status).toBe('accepted');
    expect(body.friendship.name).toBe('Other User');
    expect(body.friendship.email).toBe('other@e.com');
  });
});
