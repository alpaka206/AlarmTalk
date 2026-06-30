import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/vouchers', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/vouchers')>();
  return {
    ...orig,
    hashVoucherCode: async (code: string) => `hash:${code}`,
  };
});

import codeRoutes from '../src/routes/code';

const GIFT_CODE = 'GIFT-AAAA-BBBB-CCCC';
const INV_CODE = 'INV-AAAA-BBBB-CCCC';
const FUTURE = '2099-12-31T00:00:00.000Z';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/code', codeRoutes);
  return app;
}

function pushUser(pk = 'pk1') {
  mockDB.pushResult([{ id: pk }]);
}

function pushVoucher(overrides: Record<string, string | number | null> = {}) {
  mockDB.pushResult([
    {
      id: 'v1',
      plan_id: 'p1',
      issuer_user_id: 'issuer-pk',
      issuer_subscription_id: null,
      status: 'issued',
      expires_at: FUTURE,
      max_uses: 1,
      use_count: 0,
      ...overrides,
    },
  ]);
}

function pushPersonalPlan(overrides: Record<string, string | number | null> = {}) {
  mockDB.pushResult([
    {
      id: 'p1',
      key: 'personal',
      name: 'Personal',
      plan_type: 'personal',
      period_days: 30,
      max_members: 1,
      price_krw: 4900,
      ...overrides,
    },
  ]);
}

function pushFamilyPlan(overrides: Record<string, string | number | null> = {}) {
  mockDB.pushResult([
    {
      id: 'p1',
      key: 'family',
      name: 'Family',
      plan_type: 'family',
      period_days: 30,
      max_members: 6,
      price_krw: 9900,
      ...overrides,
    },
  ]);
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /code/register common validation', () => {
  it('returns CODE_REQUIRED when code is missing', async () => {
    const res = await buildApp().request(jsonReq('POST', '/code/register', {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });

  it('returns CODE_REQUIRED when code is blank', async () => {
    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });

  it('returns CODE_REQUIRED when code is not a string', async () => {
    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: 12345 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });

  it('returns USER_NOT_FOUND when authenticated user row is missing', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('rejects legacy numeric invite codes because code registration is voucher_codes only', async () => {
    pushUser();
    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_FORMAT');
  });
});

describe('POST /code/register voucher redemption', () => {
  it('returns CODE_NOT_FOUND when voucher code hash is missing', async () => {
    pushUser();
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
    expect(mockDB.calls[1]!.args[0]).toBe(`hash:${GIFT_CODE}`);
  });

  it('returns CODE_ALREADY_USED when voucher has no remaining uses', async () => {
    pushUser();
    pushVoucher({ status: 'used' });

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_USED');
  });

  it('expires stale issued voucher before returning CODE_EXPIRED', async () => {
    pushUser();
    pushVoucher({ expires_at: '2020-01-01T00:00:00.000Z' });
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
    expect(mockDB.calls[2]!.sql).toContain("SET status = 'expired'");
  });

  it('rejects self-issued voucher codes', async () => {
    pushUser('pk1');
    pushVoucher({ issuer_user_id: 'pk1' });

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ISSUED');
  });

  it('rejects duplicate redemption by the same user', async () => {
    pushUser('pk1');
    pushVoucher();
    mockDB.pushResult([{ id: 'redemption-1' }]);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_REDEEMED_BY_YOU');
  });

  it('redeems GIFT personal code and creates a personal subscription', async () => {
    pushUser('pk1');
    pushVoucher();
    mockDB.pushResult([]); // duplicate redemption lookup
    pushPersonalPlan();
    mockDB.pushResult([{ other_members: 0 }]); // owned-group guard
    mockDB.pushResult([], 1); // claim voucher use
    mockDB.pushResult([]); // existing active subscription
    mockDB.pushResult([], 1); // insert subscription
    mockDB.pushResult([], 1); // update voucher_codes
    mockDB.pushResult([], 1); // update users.plan

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.type).toBe('voucher');
    expect(body.subscription.plan_group_id).toBeNull();
    expect(body.plan.plan_type).toBe('personal');
    expect(body.voucher.status).toBe('used');

    const insertSub = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insertSub?.args[1]).toBe('pk1');
    expect(insertSub?.args[3]).toBeNull();
    const updateUser = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateUser?.args[0]).toBe('plus');
  });

  it('cancels the user existing active subscription before applying a redeemed code', async () => {
    pushUser('pk1');
    pushVoucher();
    mockDB.pushResult([]);
    pushPersonalPlan();
    mockDB.pushResult([{ other_members: 0 }]); // owned-group guard
    mockDB.pushResult([], 1); // claim voucher use
    mockDB.pushResult([
      {
        sub_id: 'old-sub',
        user_id: 'pk1',
        plan_id: 'old-plan',
        plan_group_id: null,
        plan_type: 'personal',
      },
    ]);
    mockDB.pushResult([], 1); // cancel old subscription
    mockDB.pushResult([], 1); // downgrade users.plan
    mockDB.pushResult([], 1); // disable shared voices
    mockDB.pushResult([], 1); // expire old vouchers
    mockDB.pushResult([], 1); // insert new subscription
    mockDB.pushResult([], 1); // update voucher
    mockDB.pushResult([], 1); // update users.plan

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(200);
    const cancelCall = mockDB.calls.find((c) =>
      c.sql.includes('UPDATE subscriptions') && c.sql.includes("status = 'cancelled'"),
    );
    expect(cancelCall?.args[2]).toBe('old-sub');
  });

  it('redeems INV family code into the issuer group and keeps the code issued until capacity is used', async () => {
    pushUser('member-pk');
    pushVoucher({
      issuer_subscription_id: 'owner-sub',
      max_uses: 5,
      use_count: 1,
    });
    mockDB.pushResult([]);
    pushFamilyPlan();
    mockDB.pushResult([{ max_members: 6, member_count: 2 }]); // capacity precheck
    mockDB.pushResult([{ other_members: 0 }]); // owned-group guard
    mockDB.pushResult([], 1); // claim voucher use
    mockDB.pushResult([]); // existing active subscription
    mockDB.pushResult([{ id: 'group-1', max_members: 6 }]); // issuer group
    mockDB.pushResult([]); // existing group member
    mockDB.pushResult([{ c: 2 }]); // group count
    mockDB.pushResult([], 1); // insert group member
    mockDB.pushResult([], 1); // insert subscription
    mockDB.pushResult([], 1); // update voucher
    mockDB.pushResult([], 1); // update users.plan

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.plan_group_id).toBe('group-1');
    expect(body.voucher).toMatchObject({ max_uses: 5, use_count: 2, status: 'issued' });

    const insertMember = mockDB.calls.find((c) => c.sql.includes('INSERT INTO plan_group_members'));
    expect(insertMember?.args[1]).toBe('group-1');
    expect(insertMember?.args[2]).toBe('member-pk');
  });

  it('rejects full family group before claiming the INV code', async () => {
    pushUser('member-pk');
    pushVoucher({
      issuer_subscription_id: 'owner-sub',
      max_uses: 5,
      use_count: 4,
    });
    mockDB.pushResult([]);
    pushFamilyPlan();
    mockDB.pushResult([{ max_members: 6, member_count: 6 }]);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('GROUP_FULL');
    const claimCall = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voucher_redemptions'));
    expect(claimCall).toBeUndefined();
  });

  it('rejects INV code when it is attached to a personal plan', async () => {
    pushUser();
    pushVoucher();
    mockDB.pushResult([]);
    pushPersonalPlan();

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_INVITE_PLAN');
  });

  it('rejects GIFT code when it is attached to a family plan', async () => {
    pushUser();
    pushVoucher();
    mockDB.pushResult([]);
    pushFamilyPlan();

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_GIFT_PLAN');
  });
});
