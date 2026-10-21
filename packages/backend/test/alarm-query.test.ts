import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmQuery from '../src/routes/alarm-query';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/alarms', alarmQuery);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// 옛 앱 호환 — 받은 가족 알람을 가져오던 원격 pull 이었다(가족 알람은 2026-10-20 에 없앴다). 옛 앱 둘은 주기·앱 시작·
// 알람 저장마다 이 요청을 보내고, 실패하면 재시도·경고를 띄운다. 그 pull 은 받은 알람만 가져오므로 내 알람을 실을 이유가
// 없다. 인증 미들웨어를 지나 탈퇴 신청 계정이 403 을 받는 것은 `old-app-compat.test.ts` 가 실제 워커로 확인한다.
describe('GET /alarms — 옛 앱 호환(빈 커서 페이지)', () => {
  const EMPTY_PAGE = { alarms: [], has_more: false, next_cursor: null };

  it.each([
    '',
    '?pagination=cursor&limit=50',
    '?pagination=cursor&limit=50&after=12345',
    '?limit=20&offset=40',
    // 예전 라우트가 400 으로 거절하던 조합도 같은 답이다 — 옛 앱은 이런 값을 보내지 않고, 보내도 잃을 것이 없다.
    '?pagination=unknown',
    "?pagination=cursor&after=id'%20OR%201%3D1%20--",
  ])('GET /alarms%s → 200 빈 페이지, DB 를 보지 않는다', async (query) => {
    const res = await buildApp().request(`/alarms${query}`);
    expect(res.status).toBe(200);
    // `has_more` 가 있어야 옛 앱이 옛 offset 계약으로 넘어가지 않고, `next_cursor` 는 끝이라 null 이다.
    expect(await res.json()).toEqual(EMPTY_PAGE);
    expect(mockDB.calls).toHaveLength(0);
  });
});

describe('GET /alarms/declined — 옛 앱 호환', () => {
  it('세 키를 모두 싣는다 — 옛 iOS 디코더가 셋 다 요구한다', async () => {
    const res = await buildApp().request('/alarms/declined?since=2026-10-01T00:00:00Z');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alarm_ids: [], revoked_alarm_ids: [], has_more: false });
    expect(mockDB.calls).toHaveLength(0);
  });
});
