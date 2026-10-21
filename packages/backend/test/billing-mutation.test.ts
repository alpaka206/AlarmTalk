import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingMutation from '../src/routes/billing-mutation';

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// 결제 변경 라우트는 `/checkout`(dev 스텁 — billing.test.ts·billing-checkout-stub.test.ts)과 `/cancel`
// (billing-cancel-play.test.ts) 둘뿐이다. 코드를 발급·사용하던 라우트는 남아 있지 않다 — 되살리지 말 것
// (App Store 심사 지침 3.1.1, `routes/code.ts` 머리말).
describe('코드를 발급·사용하던 결제 라우트는 없다', () => {
  it.each([
    '/billing/vouchers/family-share',
    '/billing/vouchers/family-share/regenerate',
    '/billing/redeem',
  ])('POST %s → 404, DB 를 보지 않는다', async (path) => {
    const res = await buildApp().request(
      jsonReq('POST', path, { code: 'INV-AAAA-BBBB-CCCC' }),
      undefined,
      { ENVIRONMENT: 'development', BILLING_STUB_ENABLED: 'true' } as AppEnv['Bindings'],
    );
    expect(res.status).toBe(404);
    expect(mockDB.calls).toHaveLength(0);
  });
});
