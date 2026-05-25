import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import userRoutes from '../src/routes/user';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/user', userRoutes);
  return app;
}

const originalExecute = mockDB.client.execute;

beforeEach(() => {
  mockDB.reset();
  mockDB.client.execute = originalExecute;
});

describe('GET /user/me', () => {
  it('기존 사용자 반환', async () => {
    mockDB.pushResult([
      {
        id: 'u-1',
        google_id: 'user-1',
        email: 'user@test.com',
        name: 'Test',
        plan: 'free',
        allow_family_alarms: 0,
        dynamic_prompt_settings_json: JSON.stringify({
          weather: { country: 'KR', city: 'Seoul' },
          fortune: { gender: '남성', birth_date: '1990-01-02', birth_time: '08:30' },
        }),
      },
    ]);
    mockDB.pushResult([{ count: 3 }]);
    mockDB.pushResult([{ count: 2 }]);

    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.google_id).toBe('user-1');
    expect(body.user.allow_family_alarms).toBe(false);
    expect(body.user.dynamic_prompt_settings).toEqual({
      weather: { country: 'KR', city: 'Seoul' },
      fortune: { gender: '남성', birth_date: '1990-01-02', birth_time: '08:30' },
    });
    expect(body.stats.voice_profiles).toBe(3);
    expect(body.stats.alarms).toBe(2);
  });

  it('allow_family_alarms=1 을 true 로 직렬화', async () => {
    mockDB.pushResult([
      {
        id: 'u-1',
        google_id: 'user-1',
        email: 'user@test.com',
        name: 'Test',
        plan: 'free',
        allow_family_alarms: 1,
      },
    ]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);

    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/me'));
    const body = await res.json();
    expect(body.user.allow_family_alarms).toBe(true);
  });

  it('신규 사용자 미존재 시 USER_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/me'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });
});

describe('PATCH /user/me', () => {
  it('allow_family_alarms=true 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.allow_family_alarms).toBe(true);
    expect(mockDB.calls[0].sql).toContain('UPDATE users SET allow_family_alarms');
    expect(mockDB.calls[0].args[0]).toBe(1);
  });

  it('allow_family_alarms=false 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allow_family_alarms).toBe(false);
    expect(mockDB.calls[0].args[0]).toBe(0);
  });

  it('필드 누락 → 400 NO_FIELDS_TO_UPDATE', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('NO_FIELDS_TO_UPDATE');
  });

  it('잘못된 타입 → 400 INVALID_BOOLEAN', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'yes' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_BOOLEAN');
  });

  it('존재하지 않는 사용자 → 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: true }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('toBoolFlag: 문자열 "1" → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: '1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
    expect(mockDB.calls[0].args[0]).toBe(1);
  });

  it('toBoolFlag: 문자열 "0" → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: '0' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
    expect(mockDB.calls[0].args[0]).toBe(0);
  });

  it('toBoolFlag: 문자열 "true" → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'true' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
  });

  it('toBoolFlag: 문자열 "false" → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'false' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
  });

  it('toBoolFlag: 숫자 1 → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
  });

  it('toBoolFlag: 숫자 0 → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 0 }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
  });

  it('잘못된 JSON 바디 → 400 NO_FIELDS_TO_UPDATE', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/user/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_FIELDS_TO_UPDATE');
  });

  it('dynamic_prompt_settings 저장 성공', async () => {
    mockDB.pushResult([], 1);
    const settings = {
      weather: { country: 'KR', city: 'Seoul' },
      fortune: { gender: '여성', birth_date: '1995-05-20', birth_time: '07:30' },
    };
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', '/user/me', { dynamic_prompt_settings: settings }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dynamic_prompt_settings).toEqual(settings);
    expect(mockDB.calls[0].sql).toContain('dynamic_prompt_settings_json = ?');
    expect(JSON.parse(String(mockDB.calls[0].args[0]))).toEqual(settings);
  });

  it('dynamic_prompt_settings 시간 형식 오류 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', '/user/me', {
        dynamic_prompt_settings: {
          fortune: { birth_time: '25:99' },
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DYNAMIC_PROMPT_SETTINGS');
  });
});

describe('PATCH /user/plan', () => {
  it('유효한 플랜 변경', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/plan', { plan: 'plus' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('plus');
  });

  it('잘못된 플랜 → 400 INVALID_PLAN', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/plan', { plan: 'enterprise' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PLAN');
  });

  it('존재하지 않는 사용자 → 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/plan', { plan: 'free' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('family 플랜 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/plan', { plan: 'family' }));
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBe('family');
  });

  it('잘못된 JSON → 500 UPDATE_PLAN_FAILED', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/user/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('UPDATE_PLAN_FAILED');
  });
});

describe('GET /user/search', () => {
  it('검색어 2자 미만이면 빈 배열', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/search?q=a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
  });

  it('검색어 없으면 빈 배열', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/search'));
    expect(res.status).toBe(200);
    expect((await res.json()).users).toEqual([]);
  });

  it('이메일 검색 결과 반환', async () => {
    mockDB.pushResult([
      { google_id: 'u-2', email: 'friend@test.com', name: 'Friend', picture: '' },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/search?q=friend'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe('friend@test.com');
  });

  it('자기 자신은 제외', async () => {
    mockDB.pushResult([
      { google_id: 'u-2', email: 'other@test.com', name: 'Other', picture: '' },
    ]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/user/search?q=test'));
    expect(mockDB.calls[0].args[0]).toBe('user-1');
  });

  it('DB 에러 → 500 SEARCH_FAILED', async () => {
    const app = buildApp();
    mockDB.client.execute = async () => {
      throw new Error('DB down');
    };
    const res = await app.request(jsonReq('GET', '/user/search?q=friend'));
    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('SEARCH_FAILED');
  });
});

describe('DELETE /user/me', () => {
  it('모든 관련 데이터 삭제 후 성공', async () => {
    mockDB.pushResult([{ id: 'pk-1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/user/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const sqls = mockDB.calls.map((c) => c.sql);
    const indexOf = (pattern: string) => sqls.findIndex((sql) => sql.includes(pattern));
    expect(indexOf('SELECT id FROM users')).toBe(0);
    expect(indexOf('DELETE FROM voucher_redemptions')).toBeLessThan(indexOf('DELETE FROM voucher_codes'));
    expect(indexOf('DELETE FROM voucher_codes')).toBeLessThan(indexOf('DELETE FROM subscriptions'));
    expect(indexOf('DELETE FROM plan_group_invites')).toBeLessThan(indexOf('DELETE FROM plan_groups'));
    expect(indexOf('DELETE FROM gifts')).toBeLessThan(indexOf('DELETE FROM messages'));
    expect(indexOf('DELETE FROM message_library')).toBeLessThan(indexOf('DELETE FROM messages'));
    expect(indexOf('DELETE FROM messages')).toBeLessThan(indexOf('DELETE FROM voice_profiles'));
    expect(indexOf('DELETE FROM users')).toBeGreaterThan(indexOf('DELETE FROM voice_profiles'));
  });

  it('friendships/gifts는 양방향 삭제 (OR 조건)', async () => {
    mockDB.pushResult([{ id: 'pk-1' }]);
    const app = buildApp();
    await app.request(jsonReq('DELETE', '/user/me'));
    const friendshipCall = mockDB.calls.find((c) => c.sql.includes('DELETE FROM friendships'));
    expect(friendshipCall?.args).toEqual(['pk-1', 'user-1', 'pk-1', 'user-1']);
    const giftCall = mockDB.calls.find((c) => c.sql.includes('DELETE FROM gifts'));
    expect(giftCall?.args).toEqual(['pk-1', 'user-1', 'pk-1', 'user-1', 'pk-1', 'user-1']);
  });

  it('DB 에러 → 500 DELETE_ACCOUNT_FAILED', async () => {
    const app = buildApp();
    mockDB.client.execute = async () => {
      throw new Error('DB down');
    };
    const res = await app.request(jsonReq('DELETE', '/user/me'));
    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('DELETE_ACCOUNT_FAILED');
  });
});

describe('GET /user/me — edge cases', () => {
  it('allow_family_alarms null → false 반환', async () => {
    mockDB.pushResult([
      {
        id: 'u-1',
        google_id: 'user-1',
        email: 'user@test.com',
        name: 'Test',
        plan: 'free',
        allow_family_alarms: null,
      },
    ]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);

    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/user/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.allow_family_alarms).toBe(false);
  });

  it('DB 에러 → 500 FETCH_USER_FAILED', async () => {
    const app = buildApp();
    mockDB.client.execute = async () => {
      throw new Error('DB down');
    };
    const res = await app.request(jsonReq('GET', '/user/me'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('FETCH_USER_FAILED');
  });
});
