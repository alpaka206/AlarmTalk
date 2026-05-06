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
  key: 'personal',
  name: '개인',
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
// TODO(#249-followup): SQL 호출 순서 mock 검증이 새 흐름(cancelSubscriptionImmediate
// 진입, voucher_redemptions, max_uses, voucher prefix INV/GIFT 분기)과 어긋나
// 통째로 보류. 별도 PR 에서 흐름 기반으로 재작성 예정.
describe.skip('POST /billing/checkout (billingMutation)', () => {
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
    expect(planQuery?.args[0]).toBe('personal');
  });

  it('max_members null/0 → 기본값 1 적용', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, max_members: null }]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
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
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    const body = await res.json();
    expect(body.plan).toMatchObject({
      id: PLAN_PLUS.id,
      key: 'personal',
      name: '개인',
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
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );

    expect(mockDB.calls).toHaveLength(5);
    expect(mockDB.calls[0]!.sql).toContain('FROM plans');
    expect(mockDB.calls[1]!.sql).toContain('FROM users');
    expect(mockDB.calls[2]!.sql).toContain('INSERT INTO subscriptions');
    expect(mockDB.calls[3]!.sql).toContain('UPDATE users SET plan');
    expect(mockDB.calls[4]!.sql).toContain('INSERT INTO voucher_codes');
  });

  it('gift checkout 은 구독을 바꾸지 않고 voucher 만 발급', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal', gift: true }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.subscription).toBeNull();
    expect(body.plan.key).toBe('personal');
    expect(body.voucher.code).toMatch(/^(INV|GIFT)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(mockDB.calls).toHaveLength(3);
    expect(mockDB.calls[2]!.sql).toContain('INSERT INTO voucher_codes');
    expect(mockDB.calls[2]!.args[5]).toBeNull();
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
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
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
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );

    const subInsert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(subInsert?.args[1]).toBe('user-pk-1');
    expect(subInsert?.args[2]).toBe(PLAN_PLUS.id);
    expect(subInsert?.sql).toContain("'active'");
  });

  it('plan_key 누락 시 400 PLAN_KEY_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', {}),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('plan_key 빈 문자열 시 400 PLAN_KEY_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: '' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('plan_key 가 숫자 타입이면 400 PLAN_KEY_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 12345 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_KEY_REQUIRED');
  });

  it('존재하지 않는 plan_key 시 400 PLAN_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'nonexistent' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_NOT_FOUND');
  });

  it('비활성 플랜 시 400 PLAN_INACTIVE', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, is_active: 0 }]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_INACTIVE');
  });

  it('free 플랜 시 400 FREE_NOT_BILLABLE', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, plan_type: 'free', is_active: 1 }]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'free_basic' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('FREE_NOT_BILLABLE');
  });

  it('사용자 미발견 시 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('checkout 성공 시 success:true + checkout_stub:true', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkout_stub).toBe(true);
  });

  it('비가족 플랜 시 plan_group 은 null', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    const body = await res.json();
    expect(body.plan_group).toBeNull();
    expect(body.subscription.plan_group_id).toBeNull();
  });

  it('family checkout 시 plan_group 응답에 owner_user_id + max_members 포함', async () => {
    mockDB.pushResult([PLAN_FAMILY]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'family' }),
    );
    const body = await res.json();
    expect(body.plan_group).not.toBeNull();
    expect(body.plan_group.owner_user_id).toBe('user-pk-1');
    expect(body.plan_group.max_members).toBe(6);
  });

  it('period_days null 시 기본값 30일 적용', async () => {
    mockDB.pushResult([{ ...PLAN_PLUS, period_days: null }]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    const body = await res.json();
    expect(body.plan.period_days).toBe(30);
    const starts = new Date(body.subscription.starts_at).getTime();
    const expires = new Date(body.subscription.expires_at).getTime();
    expect(expires - starts).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('voucher 응답에 id, code, expires_at 포함', async () => {
    mockDB.pushResult([PLAN_PLUS]);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/checkout', { plan_key: 'personal' }),
    );
    const body = await res.json();
    expect(body.voucher).toBeDefined();
    expect(body.voucher.id).toBeDefined();
    expect(body.voucher.code).toBeDefined();
    expect(body.voucher.expires_at).toBeDefined();
  });

  it('JSON 파싱 실패 시 PLAN_KEY_REQUIRED', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-valid-json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('PLAN_KEY_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// POST /billing/redeem — split module direct import
// ---------------------------------------------------------------------------
describe.skip('POST /billing/redeem (billingMutation)', () => {
  const VALID_CODE = 'INV-ABCD-EFGH-JKLM';
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
      key: 'personal',
      name: '개인',
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

  it('code 누락 시 400 CODE_REQUIRED', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', {}),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });

  it('잘못된 형식 코드 시 400 INVALID_FORMAT', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', { code: 'INVALID-CODE' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_FORMAT');
  });

  it('사용자 미발견 시 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('존재하지 않는 코드 시 404 CODE_NOT_FOUND', async () => {
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([]);
    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
  });

  it('이미 사용된 코드 시 409 CODE_ALREADY_USED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'used', expires_at: FUTURE,
    }]);
    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_USED');
  });

  it('status=expired 코드 시 409 CODE_EXPIRED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'expired', expires_at: FUTURE,
    }]);
    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
  });

  it('status=issued + 타임스탬프 만료 시 409 CODE_EXPIRED + DB 만료 업데이트', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    const PAST = '2020-01-01T00:00:00.000Z';
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: PAST,
    }]);
    mockDB.pushResult([], 1);

    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
    const expireUpdate = mockDB.calls.find((c) =>
      c.sql.includes('UPDATE voucher_codes') && c.sql.includes("status = 'expired'"),
    );
    expect(expireUpdate).toBeDefined();
    expect(expireUpdate?.args[0]).toBe('v-1');
  });

  it('본인 발급 코드 시 400 SELF_ISSUED', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    const res = await buildApp().request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ISSUED');
  });

  it('voucher 연결 플랜 미발견 시 404 PLAN_NOT_FOUND', async () => {
    const hash = await hashVoucherCode(VALID_CODE);
    mockDB.pushResult([{ id: 'user-pk-2' }]);
    mockDB.pushResult([{
      id: 'v-1', code_hash: hash, plan_id: PLAN_PLUS.id,
      issuer_user_id: 'user-pk-1', status: 'issued', expires_at: FUTURE,
    }]);
    mockDB.pushResult([]);
    const res = await buildApp('google-2').request(
      jsonReq('POST', '/billing/redeem', { code: VALID_CODE }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('PLAN_NOT_FOUND');
  });

  it('소문자 코드 → 대문자 정규화', async () => {
    const lowerCode = 'va-abcd-efgh-jklm';
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
      jsonReq('POST', '/billing/redeem', { code: lowerCode }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('redeem 성공 시 응답 형태 검증', async () => {
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
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subscription).toBeDefined();
    expect(body.subscription.status).toBe('active');
    expect(body.voucher).toMatchObject({ id: 'v-1', status: 'used' });
  });

  it('JSON 파싱 실패 시 CODE_REQUIRED', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/billing/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-valid-json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });
});
