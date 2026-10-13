import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingMutation from '../src/routes/billing-mutation';

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware('google-admin', 'tester@example.com'));
  app.route('/billing', billingMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('billing checkout test-build guard', () => {
  // ⚠ **선물 결제는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1, 두 번째 반려 —
  //   `routes/code.ts` 머리말). 스텁이 켜진 빌드라도 `gift: true` 는 아무것도 읽거나 쓰기 전에 거절한다.
  it.each(['personal', 'family'])(
    'rejects gift checkout (plan %s) with INVALID_REQUEST before touching the DB',
    async (planKey) => {
      const res = await buildApp().request(
        jsonReq('POST', '/billing/checkout', { plan_key: planKey, gift: true }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error_code).toBe('INVALID_REQUEST');
      expect(mockDB.calls).toHaveLength(0);
    },
  );

  it('blocks mock checkout in production unless the server explicitly enables billing stubs', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
      undefined,
      { ENVIRONMENT: 'production' } as AppEnv['Bindings'],
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('CHECKOUT_DISABLED');
    // 막힌 결제 대신 코드를 넣으라고 하지 않는다(3.1.1 — 코드로 결제를 대신하라는 말).
    expect(body.error).not.toMatch(/code/i);
    expect(mockDB.calls).toHaveLength(0);
  });
});

describe('operator-issued test codes are gone', () => {
  // ⚠ **운영자가 코드를 찍어 내던 dev 라우트 `POST /billing/test-codes` 는 2026-10-14 에 지웠다 — 되살리지 말 것**
  //   (`routes/billing-mutation.ts` 의 같은 자리 주석). 개발 환경에서도 라우트 자체가 없다.
  it.each(['personal', 'couple', 'family'])('POST /billing/test-codes (plan %s) is not routed', async (planKey) => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: planKey }),
      undefined,
      { ENVIRONMENT: 'development', BILLING_STUB_ENABLED: 'true' } as AppEnv['Bindings'],
    );

    expect(res.status).toBe(404);
    expect(mockDB.calls).toHaveLength(0);
  });
});
