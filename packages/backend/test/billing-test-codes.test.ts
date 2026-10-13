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

  // ⚠ **개인 플랜 테스트 코드는 2026-10-14 에 없앴다 — 되살리지 말 것.** 개인 플랜을 코드로 여는 길은
  //   선물 코드(GIFT-)였고, App Store 심사 지침 3.1.1 두 번째 반려로 선물을 통째로 없앴다
  //   (`routes/code.ts` 머리말). 발급자 허용 목록에 있어도 코드 행을 하나도 만들지 않는다.
  it('refuses personal test codes with INVALID_REQUEST and writes no voucher', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);
    mockDB.pushResult([PLAN_PERSONAL]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'personal' }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REQUEST');
    expect(mockDB.calls.some((c) => /voucher_codes/i.test(c.sql))).toBe(false);
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });

  it('issues couple and family test codes as INV- invite codes only', async () => {
    mockDB.pushResult([{ id: 'admin-pk' }]);
    mockDB.pushResult([PLAN_COUPLE]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/test-codes', { plan_key: 'couple' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.codes).toHaveLength(1);
    expect(body.codes[0].code).toMatch(/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO voucher_codes'));
    expect(String(insert?.args[1])).toMatch(/^INV-/);
    expect(insert?.args[3]).toBe(PLAN_COUPLE.id);
    expect(insert?.args[4]).toBe('admin-pk');
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
    expect((await res.json()).error_code).toBe('CHECKOUT_DISABLED');
    expect(mockDB.calls).toHaveLength(0);
  });
});
