import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingMutation from '../src/routes/billing-mutation';

const PLAN_PERSONAL = {
  id: '70000000-0000-4000-8000-000000000002',
  key: 'personal',
  name: 'Personal',
  plan_type: 'personal',
  period_days: 30,
  max_members: 1,
  price_krw: 4900,
  is_active: 1,
};

const PLAN_COUPLE = {
  id: '70000000-0000-4000-8000-000000000004',
  key: 'couple',
  name: 'Couple',
  plan_type: 'family',
  period_days: 30,
  max_members: 2,
  price_krw: 7900,
  is_active: 1,
};

const PLAN_FAMILY = {
  id: '70000000-0000-4000-8000-000000000003',
  key: 'family',
  name: 'Family',
  plan_type: 'family',
  period_days: 30,
  max_members: 6,
  price_krw: 9900,
  is_active: 1,
};

function buildApp(email = 'issuer@example.com') {
  const app = new Hono<AppEnv>();
  // 발급자 화이트리스트는 이제 하드코딩 폴백 없이 TEST_CODE_ISSUER_EMAILS 로만 지정되므로
  // 테스트도 env 를 명시 설정한다(미설정 시 fail-closed → 403).
  app.use('*', async (c, next) => {
    (c as unknown as { env: Record<string, unknown> }).env = {
      ...((c.env as Record<string, unknown>) ?? {}),
      TEST_CODE_ISSUER_EMAILS: 'issuer@example.com',
    };
    await next();
  });
  app.use('*', fakeAuthMiddleware('google-admin', email));
  app.route('/billing', billingMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /billing/test-codes', () => {
  it('is unavailable in production even for an allowlisted issuer', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'personal' }),
      undefined,
      { ENVIRONMENT: 'production' } as AppEnv['Bindings'],
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('NOT_FOUND');
    expect(mockDB.calls).toHaveLength(0);
  });

  it('allows issuer@example.com to issue a personal test code', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);
    mockDB.pushResult([PLAN_PERSONAL]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'personal' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.first_redeemer_becomes_owner).toBe(false);
    expect(body.codes).toHaveLength(1);
    expect(body.codes[0].code).toMatch(/^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO voucher_codes'));
    expect(insert?.args[3]).toBe(PLAN_PERSONAL.id);
    expect(insert?.args[4]).toBe('admin-pk');
    expect(insert?.args[5]).toBeNull();
    expect(insert?.args[8]).toBe(1);
  });

  it('issues couple codes as first-redeemer-owned invite codes', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);
    mockDB.pushResult([PLAN_COUPLE]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'couple', count: 2, days: 14 }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.first_redeemer_becomes_owner).toBe(true);
    expect(body.codes).toHaveLength(2);
    expect(body.codes[0].code).toMatch(/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.codes[0].plan_key).toBe('couple');
    expect(body.codes[0].max_uses).toBe(1);
  });

  it('issues family codes without binding them to the issuer group', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'family' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.first_redeemer_becomes_owner).toBe(true);
    expect(body.codes[0].code).toMatch(/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO voucher_codes'));
    expect(insert?.args[5]).toBeNull();
  });

  it('rejects non-issuer emails', async () => {
    const res = await buildApp('other@example.com').request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'family' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FORBIDDEN');
    expect(mockDB.calls).toHaveLength(0);
  });

  it('validates count and days limits', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'family', count: 0, days: 366 }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_COUNT');
  });
});

describe('billing checkout test-build guard', () => {
  it('blocks mock checkout in production unless the server explicitly enables billing stubs', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
      undefined,
      { ENVIRONMENT: 'production' } as AppEnv['Bindings'],
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CHECKOUT_DISABLED');
    expect(mockDB.calls).toHaveLength(0);
  });
});
