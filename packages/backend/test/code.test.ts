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

/** 폐지된 선물 코드 형식 — 2026-10-14 부터 받지 않는다(`routes/code.ts` 머리말). */
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
    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('returns CODE_NOT_FOUND for anything that is not an INV- code, without any DB lookup', async () => {
    // 프로모 코드는 2026-10-12 에 없앴다(App Store 3.1.1 — routes/code.ts 머리말). 예전에는 여기서
    // 프로모 조회로 넘어갔다 — 지금은 사용자 확인 뒤 곧바로 404 이고 promo_codes 를 보지 않는다.
    // ⚠ 선물 코드(GIFT-)도 2026-10-14 에 없앴다(3.1.1 두 번째 반려 — 되살리지 말 것). 형식이 맞아도
    //   voucher_codes 를 찾지 않는다 — 소문자·앞뒤 공백도 같다(라우트가 다듬은 뒤 본다).
    for (const code of ['123456', 'WELCOME', 'PROMO_EXAMPLE', GIFT_CODE, ' gift-aaaa-bbbb-cccc ']) {
      mockDB.reset();
      pushUser();
      const res = await buildApp().request(jsonReq('POST', '/code/register', { code }));
      expect(res.status).toBe(404);
      expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
      expect(mockDB.calls).toHaveLength(1);
      expect(mockDB.calls.some((call) => call.sql.includes('promo_code'))).toBe(false);
    }
  });
});

describe('POST /code/register voucher redemption', () => {
  it('returns CODE_NOT_FOUND when voucher code hash is missing', async () => {
    pushUser();
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
    expect(mockDB.calls[1]!.args[0]).toBe(`hash:${INV_CODE}`);
  });

  it('does not fall through to a promo lookup for an INV-format code missing as a voucher', async () => {
    // 예전에는 이용권 형식이라도 voucher 에 없으면 프로모 조회로 넘어갔다. 프로모 코드는
    // 2026-10-12 에 없앴다(App Store 3.1.1) — 이용권에 없으면 그걸로 끝이다.
    pushUser();
    mockDB.pushResult([]); // voucher hash 조회 → 없음

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
    const sqls = mockDB.calls.map((call) => call.sql).join('\n');
    expect(sqls).not.toMatch(/promo_code/i);
  });

  it('returns CODE_ALREADY_USED when voucher has no remaining uses', async () => {
    pushUser();
    pushVoucher({ status: 'used' });

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_USED');
  });

  it('expires stale issued voucher before returning CODE_EXPIRED', async () => {
    pushUser();
    pushVoucher({ expires_at: '2020-01-01T00:00:00.000Z' });
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
    expect(mockDB.calls[2]!.sql).toContain("SET status = 'expired'");
  });

  it('rejects self-issued voucher codes', async () => {
    pushUser('pk1');
    pushVoucher({ issuer_user_id: 'pk1' });

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ISSUED');
  });

  it('rejects duplicate redemption by the same user', async () => {
    pushUser('pk1');
    pushVoucher();
    mockDB.pushResult([{ id: 'redemption-1' }]);

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_REDEEMED_BY_YOU');
  });

  it('cancels the user existing active subscription before applying a redeemed code', async () => {
    // 예전에는 선물(GIFT-) 개인 코드로 봤다 — 선물은 2026-10-14 에 없앴다. 정리는 초대 코드도 같다.
    pushUser('pk1');
    pushVoucher({ issuer_subscription_id: 'owner-sub', max_uses: 5, use_count: 1 });
    mockDB.pushResult([]);
    pushFamilyPlan();
    mockDB.pushResult([{ entitlement_state: 'entitled' }]); // 발급자 구독 활성 확인(INV 무효화 가드)
    mockDB.pushResult([{ max_members: 6, member_count: 2 }]); // capacity precheck
    mockDB.pushResult([{ other_members: 0 }]); // owned-group guard
    mockDB.pushResult([], 1); // claim voucher use
    // 발급자 그룹 조회는 정리 경로가 쓰는 쿼리 수와 무관하게 짝짓는다(FIFO 위치에 묶지 않는다).
    mockDB.pushResultFor('SELECT pg.id, pg.max_members', [{ id: 'group-1', max_members: 6 }]);
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

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: INV_CODE }));

    expect(res.status).toBe(200);
    expect((await res.json()).subscription.plan_group_id).toBe('group-1');
    const cancelIndex = mockDB.calls.findIndex((c) =>
      c.sql.includes('UPDATE subscriptions') && c.sql.includes("status = 'cancelled'"),
    );
    expect(mockDB.calls[cancelIndex]?.args[2]).toBe('old-sub');
    // 옛 구독을 끊은 **뒤에** 새 구독을 넣는다.
    const insertIndex = mockDB.calls.findIndex((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(cancelIndex);
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
    mockDB.pushResult([{ entitlement_state: 'entitled' }]); // 발급자 구독 활성 확인(INV 무효화 가드)
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
    mockDB.pushResult([{ entitlement_state: 'entitled' }]); // 발급자 구독 활성 확인(INV 무효화 가드)
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

  it('does not look up a GIFT- code even when a matching voucher row would be returned', async () => {
    // ⚠ **선물 코드는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1, 두 번째 반려).
    //   예전에는 이 코드가 개인 이용권을 열었다. 지금은 형식 검사에서 끝나 voucher_codes 를 읽지도 쓰지도
    //   않는다 — 아래 큐에 넣어 둔 '있는 행' 은 끝까지 소비되지 않는다(실제 DB 판은 gift-codes-retired.test.ts).
    pushUser();
    pushVoucher(); // 옛 선물 행이 남아 있다면 돌려줄 결과
    pushPersonalPlan();

    const res = await buildApp().request(jsonReq('POST', '/code/register', { code: GIFT_CODE }));

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
    expect(mockDB.calls).toHaveLength(1);
    expect(mockDB.calls[0]!.sql).toContain('FROM users');
    expect(mockDB.calls.some((call) => /voucher|subscriptions/i.test(call.sql))).toBe(false);
  });
});
