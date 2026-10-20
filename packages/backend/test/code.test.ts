import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import codeRoutes from '../src/routes/code';

// 옛 앱 호환 — 받는 코드가 없다(`routes/code.ts` 머리말). 옛 앱의 더보기 → 코드 등록이 아직 부르므로, 라우트를
// 지우면 코드 없는 404 가 나가 시도마다 Sentry 이슈가 된다. `CODE_NOT_FOUND` 는 두 앱이 예상된 거절로 읽는다.

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/code', codeRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /code/register — 옛 앱 호환', () => {
  const bodies: Array<[string, Record<string, unknown> | undefined]> = [
    ['코드 없음', {}],
    ['빈 코드', { code: '   ' }],
    ['문자열이 아닌 코드', { code: 123 }],
    ['초대 코드 형식(INV-)', { code: 'INV-AAAA-BBBB-CCCC' }],
    ['폐지된 선물 코드 형식(GIFT-)', { code: 'GIFT-AAAA-BBBB-CCCC' }],
    ['폐지된 프로모 코드', { code: 'WELCOME2026' }],
    ['아주 긴 코드', { code: 'X'.repeat(10_000) }],
    ['본문 없음', undefined],
  ];

  it.each(bodies)('%s → 404 CODE_NOT_FOUND', async (_label, body) => {
    const res = await buildApp().request(jsonReq('POST', '/code/register', body));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Code not found', error_code: 'CODE_NOT_FOUND' });
  });

  it('깨진 JSON 도 같은 답이다 — 본문을 읽지 않는다', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/code/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('CODE_NOT_FOUND');
  });

  it('DB 를 보지 않는다 — 계정 행이 없어도 USER_NOT_FOUND 가 아니라 같은 답이다', async () => {
    const res = await buildApp('no-such-user').request(
      jsonReq('POST', '/code/register', { code: 'INV-AAAA-BBBB-CCCC' }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('CODE_NOT_FOUND');
    expect(mockDB.calls).toHaveLength(0);
  });
});
