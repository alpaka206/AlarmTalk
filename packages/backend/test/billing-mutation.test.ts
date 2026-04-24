import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingMutation from '../src/routes/billing-mutation';
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

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// ---------------------------------------------------------------------------
// POST /billing/checkout — split module direct import
// ---------------------------------------------------------------------------
describe('POST /billing/checkout (billingMutation)', () => {
  it('plan_key 앞뒤 공백 trim 처리', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: '  plus_personal  ' }),
    );
    expect(res.status).toBe(200);
    const planQuery = mockDB.calls.find((c) => c.sql.includes('FROM plans WHERE key'));
    expect(planQuery?.args[0]).toBe('plus_personal');
  });

  it('max_members null/0 → 기본값 1 적용', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, max_members: null }]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    expect(body.plan.max_members).toBe(1);
  });

  it('checkout 응답 plan 필드에 모든 속성이 포함됨', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    expect(body.plan).toMatchObject({
      id: PLAN_PLUS.id,
      key: 'plus_personal',
      name: '플러스 개인',
      plan_type: 'personal',
      period_days: 30,
      max_members: 1,
      price_krw: 4900,
    });
  });

  it('checkout DB 쿼리 순서: plan → user → subscription → users.plan → voucher', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );

    expect(mockDB.calls).toHaveLength(5);
    expect(mockDB.calls[0]!.sql).toContain('FROM plans');
    expect(mockDB.calls[1]!.sql).toContain('FROM users');
    expect(mockDB.calls[2]!.sql).toContain('INSERT INTO subscriptions');
    expect(mockDB.calls[3]!.sql).toContain('UPDATE users SET plan');
    expect(mockDB.calls[4]!.sql).toContain('INSERT INTO voucher_codes');
  });

  it('family checkout DB 쿼리 순서: plan → user → plan_groups → plan_group_members → subscription → users.plan → voucher', async () => {
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'family' }),
    );

    expect(mockDB.calls).toHaveLength(7);
    expect(mockDB.calls[2]!.sql).toContain('INSERT INTO plan_groups');
    expect(mockDB.calls[3]!.sql).toContain('INSERT INTO plan_group_members');
    expect(mockDB.calls[4]!.sql).toContain('INSERT INTO subscriptions');
    expect(mockDB.calls[5]!.sql).toContain('UPDATE users SET plan');
    expect(mockDB.calls[6]!.sql).toContain('INSERT INTO voucher_codes');
  });

  it('voucher code_hash 는 코드 SHA-256 해시와 일치', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );
    const body = await res.json();
    const voucherInsert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voucher_codes'));
    const storedCode = String(voucherInsert?.args[1]);
    const storedHash = String(voucherInsert?.args[2]);
    const expectedHash = await hashVoucherCode(storedCode);
    expect(storedHash).toBe(expectedHash);
    expect(storedCode).toBe(body.voucher.code);
  });

  it('subscription INSERT 에 올바른 user_id, plan_id, status 전달', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'plus_personal' }),
    );

    const subInsert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(subInsert?.args[1]).toBe('user-pk-1');
    expect(subInsert?.args[2]).toBe(PLAN_PLUS.id);
    expect(subInsert?.sql).toContain("'active'");
  });
});

// ---------------------------------------------------------------------------
// POST /billing/redeem — split module direct import
// ---------------------------------------------------------------------------
describe('POST /billing/redeem (billingMutation)', () => {
  const VALID_CODE = 'VA-ABCD-EFGH-JKLM';
  const FUTURE = '2027-12-31T00:00:00.000Z';

  it('redeem 성공 시 DB 쿼리 순서: user → voucher → plan → subscription → voucher update → users.plan', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );

    expect(mockDB.calls).toHaveLength(6);
    expect(mockDB.calls[0]!.sql).toContain('FROM users');
    expect(mockDB.calls[1]!.sql).toContain('FROM voucher_codes');
    expect(mockDB.calls[2]!.sql).toContain('FROM plans');
    expect(mockDB.calls[3]!.sql).toContain('INSERT INTO subscriptions');
    expect(mockDB.calls[4]!.sql).toContain('UPDATE voucher_codes');
    expect(mockDB.calls[5]!.sql).toContain('UPDATE users SET plan');
  });

  it('redeem 시 voucher UPDATE 에 status=used + redeemed_by_user_id + used_at 설정', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );

    const voucherUpdate = mockDB.calls.find((c) =>
      c.sql.includes('UPDATE voucher_codes') && c.sql.includes("status = 'used'"),
    );
    expect(voucherUpdate).toBeDefined();
    expect(voucherUpdate?.args[0]).toBe('user-pk-2');
    expect(voucherUpdate?.args[2]).toBe('v-1');
    expect(voucherUpdate?.sql).toContain("AND status = 'issued'");
  });

  it('redeem 시 period_days null/0 → 기본값 30일 적용', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    mockDB.pushResult([{ ...PLAN_PLUS, period_days: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.plan.period_days).toBe(30);
    const starts = new Date(body.subscription.starts_at).getTime();
    const expires = new Date(body.subscription.expires_at).getTime();
    expect(expires - starts).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('redeem 응답에 plan 전체 필드 포함', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    const body = await res.json();
    expect(body.plan).toMatchObject({
      id: PLAN_PLUS.id,
      key: 'plus_personal',
      name: '플러스 개인',
      plan_type: 'personal',
      period_days: 30,
      max_members: 1,
      price_krw: 4900,
    });
  });

  it('code 가 숫자 타입이면 → 400 CODE_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', { code: 12345 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REQUIRED');
  });

  it('code 공백만 → 400 CODE_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', { code: '   ' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REQUIRED');
  });

  it('expires_at 가 유효하지 않은 날짜 문자열이면 만료 처리하지 않고 정상 진행', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: 'not-a-date',
    }]);
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('voucher lookup 은 code_hash 로 수행 (평문 코드가 아닌 해시)', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([]);

    await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );

    const voucherQuery = mockDB.calls.find((c) => c.sql.includes('FROM voucher_codes'));
    expect(voucherQuery?.sql).toContain('code_hash = ?');
    expect(voucherQuery?.args[0]).toBe(hash);
  });
});
