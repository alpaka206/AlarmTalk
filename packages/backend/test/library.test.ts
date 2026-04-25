import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

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
  mockDB.reset();
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

describe('GET /library — 엣지 케이스', () => {
  it('voice 필터에 잘못된 UUID 시 400 INVALID_VOICE_PROFILE_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?filter=voice:not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('date 필터에 잘못된 형식 시 400 INVALID_DATE_FORMAT', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?filter=date:25-04-2026'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_DATE_FORMAT');
  });

  it('date 필터에 비날짜 문자열 시 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?filter=date:abc'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_DATE_FORMAT');
  });

  it('limit=0 시 falsy이므로 기본값 20 적용', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?limit=0'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
  });

  it('limit=-1 시 음수 → Math.max(…, 1)=1', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?limit=-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(1);
  });

  it('offset 음수 시 0으로 클램프', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?offset=-5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it('limit이 NaN 문자열이면 기본값 20', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library?limit=abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
  });

  it('countRes.rows가 비어있으면 total=0', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/library'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
  });

  it('알 수 없는 필터 키워드는 무시 (전체 목록 반환)', async () => {
    mockDB.pushResult([{ total: 5 }]);
    mockDB.pushResult([{ id: 'x' }]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/library?filter=unknown'));
    const countSql = mockDB.calls[0]!.sql;
    expect(countSql).not.toContain('is_favorite');
    expect(countSql).not.toContain('voice_profile_id');
    expect(countSql).not.toContain('date(ml.received_at)');
  });

  it('DB 에러 시 500 FETCH_LIBRARY_FAILED', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB connection failed');
    };
    const res = await app.request(jsonReq('GET', '/library'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('FETCH_LIBRARY_FAILED');
    mockDB.client.execute = origExecute;
  });

  it('date 필터 SQL에 date() 함수 사용', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/library?filter=date:2026-01-15'));
    const countSql = mockDB.calls[0]!.sql;
    expect(countSql).toContain('date(ml.received_at)');
    expect(mockDB.calls[0]!.args).toContain('2026-01-15');
  });

  it('voice 필터 SQL에 voice_profile_id 조건 추가', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('GET', `/library?filter=voice:${ID.alarm}`));
    const countSql = mockDB.calls[0]!.sql;
    expect(countSql).toContain('voice_profile_id');
    expect(mockDB.calls[0]!.args).toContain(ID.alarm);
  });
});

describe('PATCH /library/:id/favorite — 엣지 케이스', () => {
  it('error_code 검증: 잘못된 ID → INVALID_LIBRARY_ITEM_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/library/invalid-id/favorite'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_LIBRARY_ITEM_ID');
  });

  it('error_code 검증: 미존재 → LIBRARY_ITEM_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/library/${ID.alarm}/favorite`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('LIBRARY_ITEM_NOT_FOUND');
  });

  it('DB 에러 시 500 TOGGLE_FAVORITE_FAILED', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB error');
    };
    const res = await app.request(jsonReq('PATCH', `/library/${ID.alarm}/favorite`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('TOGGLE_FAVORITE_FAILED');
    mockDB.client.execute = origExecute;
  });

  it('다른 사용자의 항목은 조회되지 않음 (user_id 검증)', async () => {
    mockDB.pushResult([]);
    const app = buildApp('other-user');
    const res = await app.request(jsonReq('PATCH', `/library/${ID.alarm}/favorite`));
    expect(res.status).toBe(404);
    expect(mockDB.calls[0]!.args).toContain('other-user');
  });

  it('SELECT SQL에 user_id 조건 포함', async () => {
    mockDB.pushResult([{ is_favorite: 0 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    await app.request(jsonReq('PATCH', `/library/${ID.alarm}/favorite`));
    expect(mockDB.calls[0]!.sql).toContain('user_id');
  });
});

describe('DELETE /library/:id — 엣지 케이스', () => {
  it('error_code 검증: 잘못된 ID → INVALID_LIBRARY_ITEM_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/library/bad-id'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_LIBRARY_ITEM_ID');
  });

  it('error_code 검증: 미존재 → LIBRARY_ITEM_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/library/${ID.alarm}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('LIBRARY_ITEM_NOT_FOUND');
  });

  it('DB 에러 시 500 DELETE_LIBRARY_ITEM_FAILED', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB error');
    };
    const res = await app.request(jsonReq('DELETE', `/library/${ID.alarm}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('DELETE_LIBRARY_ITEM_FAILED');
    mockDB.client.execute = origExecute;
  });

  it('삭제 SQL에 user_id 포함 (권한 검증)', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp('my-user');
    await app.request(jsonReq('DELETE', `/library/${ID.alarm}`));
    expect(mockDB.calls[0]!.sql).toContain('user_id');
    expect(mockDB.calls[0]!.args).toContain('my-user');
  });
});
