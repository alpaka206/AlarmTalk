import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingRoutes from '../src/routes/billing';
import { hashVoucherCode } from '../src/lib/vouchers';

const PLAN_PLUS = {
  id: '70000000-0000-4000-8000-000000000002',
  key: 'plus_personal',
  name: '플러스 개인',
  plan_type: 'personal',
  period_days: 30,
  max_members: 1,
  price_krw: 4900,
  is_active: 1,
};

const PLAN_FAMILY = {
  id: '70000000-0000-4000-8000-000000000003',
  key: 'family',
  name: '가족',
  plan_type: 'family',
  period_days: 30,
  max_members: 6,
  price_krw: 9900,
  is_active: 1,
};

const PLAN_FREE = {
  id: '70000000-0000-4000-8000-000000000001',
  key: 'free',
  name: '무료',
  plan_type: 'free',
  period_days: 36500,
  max_members: 1,
  price_krw: 0,
  is_active: 1,
};

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /billing/checkout', () => {
  it('plus_personal → 200, subscription 생성 + users.plan=plus + voucher 발급', async () => {
    mockDB.pushResult([PLAN_PLUS]); // SELECT plan
    mockDB.pushResult([{ id: 'user-pk-1' }]); // SELECT user
    mockDB.pushResult([], 1); // INSERT subscription
    mockDB.pushResult([], 1); // UPDATE users.plan
    mockDB.pushResult([], 1); // INSERT voucher_code

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkout_stub).toBe(true);
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.user_id).toBe('user-pk-1');
    expect(body.plan.key).toBe('plus_personal');
    expect(body.plan.price_krw).toBe(4900);
    expect(body.voucher.code).toMatch(/^VA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.voucher.expires_at).toBe(body.subscription.expires_at);

    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateCall?.args[0]).toBe('plus');
    expect(updateCall?.args[1]).toBe('user-pk-1');

    const insertVoucher = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voucher_codes'));
    expect(insertVoucher).toBeDefined();
    expect(insertVoucher?.args[1]).toBe(body.voucher.code);
    // code_hash 는 SHA-256 hex
    expect(String(insertVoucher?.args[2])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('family → 200, users.plan=family, voucher 는 family plan_id 로 발급', async () => {
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'family' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.plan_type).toBe('family');
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateCall?.args[0]).toBe('family');
    const insertVoucher = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voucher_codes'));
    expect(insertVoucher?.args[3]).toBe(PLAN_FAMILY.id);
  });

  it('family → plan_groups + owner 멤버 자동 생성, subscription.plan_group_id 연결', async () => {
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1); // INSERT plan_groups
    mockDB.pushResult([], 1); // INSERT plan_group_members
    mockDB.pushResult([], 1); // INSERT subscription
    mockDB.pushResult([], 1); // UPDATE users.plan
    mockDB.pushResult([], 1); // INSERT voucher_code

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'family' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const insertGroup = mockDB.calls.find((c) => c.sql.includes('INSERT INTO plan_groups'));
    expect(insertGroup).toBeDefined();
    expect(insertGroup?.args[1]).toBe('user-pk-1'); // owner_user_id
    expect(insertGroup?.args[2]).toBe(PLAN_FAMILY.id); // plan_id
    expect(insertGroup?.args[3]).toBe(6); // max_members

    const insertMember = mockDB.calls.find((c) =>
      c.sql.includes('INSERT INTO plan_group_members'),
    );
    expect(insertMember).toBeDefined();
    expect(insertMember?.args[1]).toBe(insertGroup?.args[0]); // plan_group_id
    expect(insertMember?.args[2]).toBe('user-pk-1'); // user_id
    expect(insertMember?.sql).toContain("'owner'");

    const insertSub = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insertSub).toBeDefined();
    expect(insertSub?.args[3]).toBe(insertGroup?.args[0]); // plan_group_id
    expect(body.subscription.plan_group_id).toBe(insertGroup?.args[0]);
    expect(body.plan_group).toMatchObject({
      owner_user_id: 'user-pk-1',
      max_members: 6,
    });
    expect(body.plan_group.id).toBe(insertGroup?.args[0]);
  });

  it('plus_personal 결제는 plan_groups/plan_group_members INSERT 를 호출하지 않고 plan_group_id 도 null', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();

    const insertGroup = mockDB.calls.find((c) => c.sql.includes('INSERT INTO plan_groups'));
    expect(insertGroup).toBeUndefined();
    const insertMember = mockDB.calls.find((c) =>
      c.sql.includes('INSERT INTO plan_group_members'),
    );
    expect(insertMember).toBeUndefined();

    const insertSub = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insertSub?.args[3]).toBeNull(); // plan_group_id
    expect(body.subscription.plan_group_id).toBeNull();
    expect(body.plan_group).toBeNull();
  });

  it('subscription.expires_at 는 starts_at + period_days 후', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    const starts = new Date(body.subscription.starts_at).getTime();
    const expires = new Date(body.subscription.expires_at).getTime();
    expect(expires - starts).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('없는 plan_key → 400', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'nonexistent' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('존재하지 않는');
  });

  it('free plan_key → 400 (결제 대상 아님)', async () => {
    mockDB.pushResult([PLAN_FREE]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'free' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('free');
  });

  it('plan_key 미지정 → 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('plan_key');
  });

  it('비활성(is_active=0) 플랜 → 400', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, is_active: 0 }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('비활성');
  });

  it('사용자 행 없음 → 404', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([]); // no user
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    expect(res.status).toBe(404);
  });

  it('plan_key 미지정 → 400 + error_code PLAN_KEY_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('없는 plan_key → error_code PLAN_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'nonexistent' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_NOT_FOUND');
  });

  it('비활성 플랜 → error_code PLAN_INACTIVE', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, is_active: 0 }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_INACTIVE');
  });

  it('free 플랜 → error_code FREE_NOT_BILLABLE', async () => {
    mockDB.pushResult([PLAN_FREE]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'free' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('FREE_NOT_BILLABLE');
  });

  it('사용자 없음 → error_code USER_NOT_FOUND', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('malformed JSON body → plan_key 빈 문자열 → 400', async () => {
    const app = buildApp();
    const req = new Request('http://localhost/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('plan_key 가 문자열이 아닌 경우 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 12345 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('period_days 가 0 또는 null 이면 기본값 30일 적용', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, period_days: 0 }]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    expect(body.plan.period_days).toBe(30);
    const starts = new Date(body.subscription.starts_at).getTime();
    const expires = new Date(body.subscription.expires_at).getTime();
    expect(expires - starts).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('DB 에러 → 500', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    // subscription INSERT 가 에러를 발생시킴
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    let callCount = 0;
    mockDB.client.execute = async (query: { sql: string; args: (string | number | null)[] }) => {
      callCount++;
      if (callCount === 3) throw new Error('DB write failed');
      return origExecute(query);
    };
    const res = await app.request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});

describe('GET /billing/subscription', () => {
  it('활성 구독 있을 때 subscription + plan 반환', async () => {
    mockDB.pushResult([
      {
        sub_id: 'sub-1',
        user_id: 'user-pk-1',
        plan_id: PLAN_PLUS.id,
        plan_group_id: null,
        status: 'active',
        starts_at: '2026-04-21T00:00:00.000Z',
        expires_at: '2026-05-21T00:00:00.000Z',
        plan_key: 'plus_personal',
        plan_name: '플러스 개인',
        plan_type: 'personal',
        period_days: 30,
        max_members: 1,
        price_krw: 4900,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.id).toBe('sub-1');
    expect(body.subscription.status).toBe('active');
    expect(body.plan.key).toBe('plus_personal');
    expect(body.plan.max_members).toBe(1);
  });

  it('활성 구독 없을 때 { subscription: null, plan: null }', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription).toBeNull();
    expect(body.plan).toBeNull();
  });

  it('SQL 에 expires_at > datetime(now) 와 status active 조건 포함', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/billing/subscription'));
    const sql = mockDB.calls[0].sql;
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.expires_at > datetime('now')");
  });

  it('family 구독이면 plan_group_id 가 non-null', async () => {
    mockDB.pushResult([
      {
        sub_id: 'sub-fam',
        user_id: 'user-pk-1',
        plan_id: PLAN_FAMILY.id,
        plan_group_id: 'group-1',
        status: 'active',
        starts_at: '2026-04-21T00:00:00.000Z',
        expires_at: '2026-05-21T00:00:00.000Z',
        plan_key: 'family',
        plan_name: '가족',
        plan_type: 'family',
        period_days: 30,
        max_members: 6,
        price_krw: 9900,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.plan_group_id).toBe('group-1');
    expect(body.plan.plan_type).toBe('family');
    expect(body.plan.max_members).toBe(6);
    expect(body.plan.price_krw).toBe(9900);
  });

  it('DB 에러 → 500', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => { throw new Error('DB read failed'); };
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});

describe('GET /billing/vouchers', () => {
  it('발급한 코드 목록을 반환 (평문 포함, 발급자 본인)', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // SELECT user
    mockDB.pushResult([
      {
        id: 'v1',
        code: 'VA-ABCD-EFGH-JKLM',
        plan_id: PLAN_PLUS.id,
        issuer_subscription_id: 'sub-1',
        redeemed_by_user_id: null,
        status: 'issued',
        issued_at: '2026-04-21T00:00:00.000Z',
        used_at: null,
        expires_at: '2026-05-21T00:00:00.000Z',
        plan_key: 'plus_personal',
        plan_name: '플러스 개인',
        plan_type: 'personal',
      },
      {
        id: 'v2',
        code: 'VA-NPQR-STUV-WXYZ',
        plan_id: PLAN_FAMILY.id,
        issuer_subscription_id: 'sub-2',
        redeemed_by_user_id: 'user-pk-2',
        status: 'used',
        issued_at: '2026-04-15T00:00:00.000Z',
        used_at: '2026-04-16T00:00:00.000Z',
        expires_at: '2026-05-15T00:00:00.000Z',
        plan_key: 'family',
        plan_name: '가족',
        plan_type: 'family',
      },
    ]);

    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vouchers).toHaveLength(2);
    expect(body.vouchers[0].code).toBe('VA-ABCD-EFGH-JKLM');
    expect(body.vouchers[0].status).toBe('issued');
    expect(body.vouchers[0].plan_key).toBe('plus_personal');
    expect(body.vouchers[1].status).toBe('used');
    expect(body.vouchers[1].redeemed_by_user_id).toBe('user-pk-2');

    const listCall = mockDB.calls.find((c) => c.sql.includes('FROM voucher_codes'));
    expect(listCall?.args[0]).toBe('user-pk-1');
    expect(listCall?.sql).toContain('v.issuer_user_id = ?');
  });

  it('사용자 없으면 빈 배열', async () => {
    mockDB.pushResult([]); // no user
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vouchers).toEqual([]);
  });

  it('발급한 코드가 없으면 빈 배열', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vouchers).toEqual([]);
  });

  it('응답 필드 매핑 정확성 (subscription_id, used_at null 처리)', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([
      {
        id: 'v1',
        code: 'VA-TEST-CODE-0001',
        plan_id: PLAN_PLUS.id,
        issuer_subscription_id: 'sub-99',
        redeemed_by_user_id: null,
        status: 'issued',
        issued_at: '2026-04-21T00:00:00.000Z',
        used_at: null,
        expires_at: '2026-05-21T00:00:00.000Z',
        plan_key: 'plus_personal',
        plan_name: '플러스 개인',
        plan_type: 'personal',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers[0].subscription_id).toBe('sub-99');
    expect(body.vouchers[0].redeemed_by_user_id).toBeNull();
    expect(body.vouchers[0].used_at).toBeNull();
    expect(body.vouchers[0].plan_type).toBe('personal');
  });

  it('SQL 에 issuer_user_id + ORDER BY issued_at DESC 포함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(jsonReq('GET', '/billing/vouchers'));
    const voucherQuery = mockDB.calls.find((c) => c.sql.includes('voucher_codes'));
    expect(voucherQuery?.sql).toContain('v.issuer_user_id = ?');
    expect(voucherQuery?.sql).toContain('ORDER BY v.issued_at DESC');
  });

  it('DB 에러 → 500', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => { throw new Error('DB read failed'); };
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});

describe('POST /billing/redeem', () => {
  const VALID_CODE = 'VA-ABCD-EFGH-JKLM';
  const FUTURE = '2027-12-31T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';

  it('유효 코드 → 200, voucher status=used, 새 subscription, users.plan=plus', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]); // SELECT user
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'issued',
        expires_at: FUTURE,
      },
    ]); // SELECT voucher
    mockDB.pushResult([PLAN_PLUS]); // SELECT plan
    mockDB.pushResult([], 1); // INSERT subscription
    mockDB.pushResult([], 1); // UPDATE voucher
    mockDB.pushResult([], 1); // UPDATE users.plan

    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subscription.user_id).toBe('user-pk-2');
    expect(body.subscription.plan_id).toBe(PLAN_PLUS.id);
    expect(body.voucher.status).toBe('used');

    const updateVoucher = mockDB.calls.find((c) =>
      c.sql.includes("UPDATE voucher_codes") && c.sql.includes("status = 'used'"),
    );
    expect(updateVoucher?.args[0]).toBe('user-pk-2');

    const updateUser = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateUser?.args[0]).toBe('plus');
  });

  it('family 코드 등록 → users.plan=family', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      {
        id: 'v-2',
        code_hash: hash,
        plan_id: PLAN_FAMILY.id,
        issuer_user_id: 'user-pk-1',
        status: 'issued',
        expires_at: FUTURE,
      },
    ]);
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(200);
    const updateUser = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateUser?.args[0]).toBe('family');
  });

  it('code 누락 → 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/redeem', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('code');
  });

  it('잘못된 포맷 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: 'INVALID-123' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('형식');
  });

  it('존재하지 않는 코드 → 404', async () => {
    mockDB.pushResult([{ id: 'user-pk-2' }]); // user
    mockDB.pushResult([]); // voucher not found
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('찾을 수 없');
  });

  it('이미 사용된 코드 → 409', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'used',
        expires_at: FUTURE,
      },
    ]);
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('이미 사용');
  });

  it('만료된 코드(status=expired) → 409', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'expired',
        expires_at: PAST,
      },
    ]);
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('만료');
  });

  it('expires_at 지났지만 status=issued 인 경우 → 409 + expired 전환', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'issued',
        expires_at: PAST,
      },
    ]);
    mockDB.pushResult([], 1); // UPDATE voucher → expired

    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    const expireUpdate = mockDB.calls.find((c) =>
      c.sql.includes("UPDATE voucher_codes SET status = 'expired'"),
    );
    expect(expireUpdate).toBeDefined();
  });

  it('본인이 발급한 코드 등록 시도 → 400', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'issued',
        expires_at: FUTURE,
      },
    ]);
    const app = buildApp('google-1');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('본인');
  });

  it('code 누락 → error_code CODE_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/redeem', {}));
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REQUIRED');
  });

  it('잘못된 포맷 → error_code INVALID_FORMAT', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: 'BAD' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_FORMAT');
  });

  it('존재하지 않는 코드 → error_code CODE_NOT_FOUND', async () => {
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([]);
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('CODE_NOT_FOUND');
  });

  it('이미 사용된 코드 → error_code CODE_ALREADY_USED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      { id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id, issuer_user_id: 'user-pk-1', status: 'used', expires_at: FUTURE },
    ]);
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('CODE_ALREADY_USED');
  });

  it('만료 status → error_code CODE_EXPIRED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      { id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id, issuer_user_id: 'user-pk-1', status: 'expired', expires_at: PAST },
    ]);
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('CODE_EXPIRED');
  });

  it('본인 발급 코드 → error_code SELF_ISSUED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([
      { id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id, issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE },
    ]);
    const app = buildApp('google-1');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('SELF_ISSUED');
  });

  it('사용자 없음(google_id 매칭 실패) → 404 + USER_NOT_FOUND', async () => {
    mockDB.pushResult([]); // no user
    const app = buildApp('ghost');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('voucher 에 연결된 플랜이 DB 에 없으면 → 404 + PLAN_NOT_FOUND', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      { id: 'v-1', code_hash: hash, plan_id: 'deleted-plan', issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE },
    ]);
    mockDB.pushResult([]); // plan not found
    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_NOT_FOUND');
  });

  it('redeem 성공 시 subscription.expires_at 는 plan.period_days 만큼 연장', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      { id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id, issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE },
    ]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    const starts = new Date(body.subscription.starts_at).getTime();
    const expires = new Date(body.subscription.expires_at).getTime();
    expect(expires - starts).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('malformed JSON body → code 빈 문자열 → 400', async () => {
    const app = buildApp();
    const req = new Request('http://localhost/billing/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REQUIRED');
  });

  it('DB 에러 → 500', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => { throw new Error('DB write failed'); };
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });

  it('소문자 입력도 대문자로 정규화하여 동작', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([
      {
        id: 'v-1',
        code_hash: hash,
        plan_id: PLAN_PLUS.id,
        issuer_user_id: 'user-pk-1',
        status: 'issued',
        expires_at: FUTURE,
      },
    ]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp('google-2');
    const res = await app.request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE.toLowerCase() }),
    );
    expect(res.status).toBe(200);
  });
});
