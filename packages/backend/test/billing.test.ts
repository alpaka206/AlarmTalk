import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingRoutes from '../src/routes/billing';

const PLAN_PLUS = {
  id: '70000000-0000-4000-8000-000000000002',
  key: 'personal',
  name: '개인',
  plan_type: 'personal',
  period_days: 30,
  price_krw: 4900,
  is_active: 1,
};

/** 2026-10-20 에 없앤 가족 이용권 — #131 전(배포 창)의 DB 에는 행이 남아 있을 수 있다. */
const PLAN_FAMILY = {
  id: '70000000-0000-4000-8000-000000000003',
  key: 'family',
  name: '가족',
  plan_type: 'family',
  period_days: 30,
  price_krw: 9900,
  is_active: 1,
};

const PLAN_FREE = {
  id: '70000000-0000-4000-8000-000000000001',
  key: 'free',
  name: '무료',
  plan_type: 'free',
  period_days: 36500,
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
  it('plus_personal → 200, subscription 생성 + users.plan=plus — 코드는 발급하지 않는다', async () => {
    mockDB.pushResult([PLAN_PLUS]); // SELECT plan
    mockDB.pushResult([{ id: 'user-pk-1' }]); // SELECT user
    mockDB.pushResult([]); // 활성 구독 없음(취소할 것 없음)
    mockDB.pushResult([], 1); // INSERT subscription
    mockDB.pushResult([], 1); // UPDATE users.plan

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkout_stub).toBe(true);
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.user_id).toBe('user-pk-1');
    expect(body.plan.key).toBe('personal');
    expect(body.plan.price_krw).toBe(4900);
    expect(body).not.toHaveProperty('voucher');
    expect(body).not.toHaveProperty('plan_group');

    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(updateCall?.args[0]).toBe('plus');
    expect(updateCall?.args[1]).toBe('user-pk-1');

    // 그룹·초대 코드 표는 없다 — 어떤 문장도 그 표를 부르지 않는다.
    expect(mockDB.calls.some((c) => /voucher_codes|plan_group/.test(c.sql))).toBe(false);
    const insertSub = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insertSub?.args).toHaveLength(5);
    expect(body.subscription).not.toHaveProperty('plan_group_id');
  });

  it('옛 그룹 플랜(family)은 결제 대상이 아니다 — 400 FREE_NOT_BILLABLE, 아무것도 쓰지 않는다', async () => {
    mockDB.pushResult([PLAN_FAMILY]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'family' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('FREE_NOT_BILLABLE');
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });

  it('subscription.expires_at 는 starts_at + period_days 후', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
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
    expect(body.error_code).toBe('PLAN_NOT_FOUND');
  });

  it('free plan_key → 400 (결제 대상 아님)', async () => {
    mockDB.pushResult([PLAN_FREE]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'free' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('FREE_NOT_BILLABLE');
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
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_INACTIVE');
  });

  it('사용자 행 없음 → 404', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([]); // no user
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
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
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_INACTIVE');
  });

  it('free 플랜 → error_code FREE_NOT_BILLABLE', async () => {
    mockDB.pushResult([PLAN_FREE]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'free' }));
    const body = await res.json();
    expect(body.error_code).toBe('FREE_NOT_BILLABLE');
  });

  it('사용자 없음 → error_code USER_NOT_FOUND', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
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
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 12345 }));
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
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
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
    const res = await app.request(jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});

describe('GET /billing/subscription', () => {
  it('활성 구독 있을 때 subscription + plan 반환', async () => {
    mockDB.pushResult([
      {
        sub_id: 'sub-1',
        entitlement_state: 'entitled',
        user_id: 'user-pk-1',
        plan_id: PLAN_PLUS.id,
        status: 'active',
        starts_at: '2026-04-21T00:00:00.000Z',
        expires_at: '2026-05-21T00:00:00.000Z',
        plan_key: 'personal',
        plan_name: '개인',
        plan_type: 'personal',
        period_days: 30,
        price_krw: 4900,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.id).toBe('sub-1');
    expect(body.subscription.status).toBe('active');
    expect(body.plan.key).toBe('personal');
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
    expect(sql).toContain("datetime(s.expires_at) > datetime('now')");
  });

  it('DB 에러 → 500', async () => {
    const app = buildApp();
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => {
      throw new Error('DB read failed');
    };
    const res = await app.request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});

// 옛 앱 호환 — 초대 코드는 커플·가족 이용권과 함께 없앴다. 옛 앱은 이 목록을 구독 조회와 함께 받는다.
describe('GET /billing/vouchers', () => {
  it('언제나 빈 목록 — DB 를 보지 않는다', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/billing/vouchers'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ vouchers: [] });
    expect(mockDB.calls).toHaveLength(0);
  });
});
