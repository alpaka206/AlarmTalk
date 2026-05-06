import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingQuery from '../src/routes/billing-query';

const PLAN_PLUS_ID = '70000000-0000-4000-8000-000000000002';
const PLAN_FAMILY_ID = '70000000-0000-4000-8000-000000000003';

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingQuery);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// ---------------------------------------------------------------------------
// GET /billing/vouchers — split module direct import
// ---------------------------------------------------------------------------
describe('GET /billing/vouchers (billingQuery)', () => {
  it('resolveUserPk 로 google_id → user.id 조회 후 issuer 필터링', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);

    await buildApp('google-1').request(jsonReq('GET', '/billing/vouchers'));

    const userQuery = mockDB.calls[0]!;
    expect(userQuery.sql).toContain('FROM users');
    expect(userQuery.args[0]).toBe('google-1');
    const voucherQuery = mockDB.calls[1]!;
    expect(voucherQuery.args[0]).toBe('user-pk-1');
  });

  it('voucher JOIN plans — plan_key, plan_name, plan_type 포함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([{
      id: 'v1', code: 'INV-AAAA-BBBB-CCCC', plan_id: PLAN_PLUS_ID,
      issuer_subscription_id: 'sub-1', redeemed_by_user_id: null,
      status: 'issued', issued_at: '2026-04-21T00:00:00.000Z',
      used_at: null, expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers[0]).toMatchObject({
      id: 'v1',
      code: 'INV-AAAA-BBBB-CCCC',
      plan_key: 'personal',
      plan_name: '개인',
      plan_type: 'personal',
      subscription_id: 'sub-1',
      redeemed_by_user_id: null,
      used_at: null,
    });
  });

  it('SQL 에 JOIN plans + issuer_user_id 필터 + ORDER BY issued_at DESC 포함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/vouchers'));

    const sql = mockDB.calls[1]!.sql;
    expect(sql).toContain('JOIN plans p ON p.id = v.plan_id');
    expect(sql).toContain('v.issuer_user_id = ?');
    expect(sql).toContain('ORDER BY v.issued_at DESC');
  });

  it('사용자 없으면 DB 조회 없이 빈 배열 반환', async () => {
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers).toEqual([]);
    expect(mockDB.calls).toHaveLength(1);
  });

  it('used 상태 voucher 의 redeemed_by_user_id, used_at 정상 매핑', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([{
      id: 'v1', code: 'INV-AAAA-BBBB-CCCC', plan_id: PLAN_PLUS_ID,
      issuer_subscription_id: 'sub-1', redeemed_by_user_id: 'user-pk-2',
      status: 'used', issued_at: '2026-04-21T00:00:00.000Z',
      used_at: '2026-04-22T10:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers[0].status).toBe('used');
    expect(body.vouchers[0].redeemed_by_user_id).toBe('user-pk-2');
    expect(body.vouchers[0].used_at).toBe('2026-04-22T10:00:00.000Z');
  });

  it('여러 voucher 반환 시 순서 유지 (DB 결과 순서대로)', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([
      { id: 'v1', code: 'INV-AAAA-2222-2222', plan_id: PLAN_PLUS_ID, issuer_subscription_id: null, redeemed_by_user_id: null, status: 'issued', issued_at: '2026-04-22T00:00:00.000Z', used_at: null, expires_at: '2026-05-22T00:00:00.000Z', plan_key: 'personal', plan_name: '플러스', plan_type: 'personal' },
      { id: 'v2', code: 'INV-BBBB-2222-2222', plan_id: PLAN_FAMILY_ID, issuer_subscription_id: null, redeemed_by_user_id: null, status: 'issued', issued_at: '2026-04-21T00:00:00.000Z', used_at: null, expires_at: '2026-05-21T00:00:00.000Z', plan_key: 'family', plan_name: '가족', plan_type: 'family' },
    ]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers).toHaveLength(2);
    expect(body.vouchers[0].id).toBe('v1');
    expect(body.vouchers[1].id).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// GET /billing/subscription — split module direct import
// ---------------------------------------------------------------------------
describe('GET /billing/subscription (billingQuery)', () => {
  it('subscription 쿼리는 c.get(userId) (google_id) 를 직접 사용 (resolveUserPk 미사용)', async () => {
    mockDB.pushResult([]);

    await buildApp('my-google-id').request(jsonReq('GET', '/billing/subscription'));

    expect(mockDB.calls).toHaveLength(1);
    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('u.google_id = ?');
    expect(mockDB.calls[0]!.args[0]).toBe('my-google-id');
  });

  it('활성 구독 없으면 { subscription: null, plan: null }', async () => {
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription).toBeNull();
    expect(body.plan).toBeNull();
  });

  it('SQL 에 LIMIT 1 + ORDER BY starts_at DESC (최신 구독만)', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('ORDER BY s.starts_at DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('SQL 에 active 상태 + 만료되지 않은 조건 포함', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.expires_at > datetime('now')");
  });

  it('personal 구독 시 plan_group_id null 반환', async () => {
    mockDB.pushResult([{
      sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID,
      plan_group_id: null, status: 'active',
      starts_at: '2026-04-21T00:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
      period_days: 30, max_members: 1, price_krw: 4900,
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription.plan_group_id).toBeNull();
    expect(body.plan.plan_type).toBe('personal');
  });

  it('family 구독 시 plan_group_id 포함 + plan 필드 전체 정확성', async () => {
    mockDB.pushResult([{
      sub_id: 'sub-fam', user_id: 'user-pk-1', plan_id: PLAN_FAMILY_ID,
      plan_group_id: 'group-1', status: 'active',
      starts_at: '2026-04-21T00:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'family', plan_name: '가족', plan_type: 'family',
      period_days: 30, max_members: 6, price_krw: 9900,
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription).toMatchObject({
      id: 'sub-fam',
      user_id: 'user-pk-1',
      plan_id: PLAN_FAMILY_ID,
      plan_group_id: 'group-1',
      status: 'active',
    });
    expect(body.plan).toMatchObject({
      id: PLAN_FAMILY_ID,
      key: 'family',
      name: '가족',
      plan_type: 'family',
      period_days: 30,
      max_members: 6,
      price_krw: 9900,
    });
  });

  it('SQL JOIN 구조: subscriptions → users → plans', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('JOIN users u ON u.id = s.user_id');
    expect(sql).toContain('JOIN plans p ON p.id = s.plan_id');
  });

  it('DB 에러 → 500', async () => {
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => { throw new Error('DB read failed'); };

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});
