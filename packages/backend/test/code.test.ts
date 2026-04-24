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

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/code', codeRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /code/register — 공통', () => {
  it('코드 누락 시 400 CODE_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REQUIRED');
  });

  it('빈 문자열 코드 시 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('CODE_REQUIRED');
  });

  it('인식 불가 형식 시 400 INVALID_FORMAT', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'ABCDEF' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_FORMAT');
  });

  it('사용자 조회 실패 시 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('JSON 파싱 실패 시 CODE_REQUIRED 400', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/code/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /code/register — 이용권 코드 (VA-XXXX-XXXX-XXXX)', () => {
  function setupUserLookup() {
    mockDB.pushResult([{ id: 'pk1' }]);
  }

  it('존재하지 않는 코드 404', async () => {
    setupUserLookup();
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
  });

  it('이미 사용된 코드 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'used', expires_at: '2099-12-31' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_USED');
  });

  it('만료된 코드 (status=expired) 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'expired', expires_at: '2020-01-01' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
  });

  it('만료 날짜 지남 → expired 업데이트 후 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'issued', expires_at: '2020-01-01' }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
    const updateSql = mockDB.calls[2].sql;
    expect(updateSql).toContain("SET status = 'expired'");
  });

  it('본인 발급 코드 400 SELF_ISSUED', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk1', status: 'issued', expires_at: '2099-12-31' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ISSUED');
  });

  it('연결된 플랜 없으면 404 PLAN_NOT_FOUND', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'issued', expires_at: '2099-12-31' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('PLAN_NOT_FOUND');
  });

  it('정상 이용권 등록 성공', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'issued', expires_at: '2099-12-31' }]);
    mockDB.pushResult([{ id: 'p1', key: 'plus_monthly', name: 'Plus Monthly', plan_type: 'personal', period_days: 30, max_members: 1, price_krw: 4900 }]);
    mockDB.pushResult([], 1); // INSERT subscription
    mockDB.pushResult([], 1); // UPDATE voucher_codes
    mockDB.pushResult([], 1); // UPDATE users plan
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.type).toBe('voucher');
    expect(body.subscription.status).toBe('active');
    expect(body.plan.key).toBe('plus_monthly');
    expect(body.plan.plan_type).toBe('personal');

    const insertSql = mockDB.calls[3].sql;
    expect(insertSql).toContain('INSERT INTO subscriptions');
    const updateVoucher = mockDB.calls[4].sql;
    expect(updateVoucher).toContain("SET status = 'used'");
    const updateUser = mockDB.calls[5].sql;
    expect(updateUser).toContain('UPDATE users SET plan');
  });

  it('family 플랜 타입 → user plan "family"로 업데이트', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'v1', plan_id: 'p1', issuer_user_id: 'pk2', status: 'issued', expires_at: '2099-12-31' }]);
    mockDB.pushResult([{ id: 'p1', key: 'family_yearly', name: 'Family Yearly', plan_type: 'family', period_days: 365, max_members: 6, price_krw: 49000 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: 'VA-AAAA-BBBB-CCCC' }));
    const body = await res.json();
    expect(body.plan.plan_type).toBe('family');

    const updateUserArgs = mockDB.calls[5].args;
    expect(updateUserArgs[0]).toBe('family');
  });
});

describe('POST /code/register — 가족 초대 코드 (6자리 숫자)', () => {
  function setupUserLookup() {
    mockDB.pushResult([{ id: 'pk1' }]);
  }

  it('존재하지 않는 초대 코드 404', async () => {
    setupUserLookup();
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('CODE_NOT_FOUND');
  });

  it('사용 완료된 초대 코드 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'used', expires_at: '2099-12-31' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_ALREADY_USED');
  });

  it('취소된 초대 코드 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'revoked', expires_at: '2099-12-31' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_REVOKED');
  });

  it('만료 날짜 지남 → expired 업데이트 후 409', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'pending', expires_at: '2020-01-01' }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CODE_EXPIRED');
  });

  it('본인 발급 초대 400 SELF_ISSUED', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk1', status: 'pending', expires_at: '2099-12-31' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ISSUED');
  });

  it('이미 그룹 멤버이면 409 ALREADY_MEMBER', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'pending', expires_at: '2099-12-31' }]);
    mockDB.pushResult([{ id: 'm1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('ALREADY_MEMBER');
  });

  it('그룹 미존재 시 404', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'pending', expires_at: '2099-12-31' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('GROUP_NOT_FOUND');
  });

  it('정원 초과 시 409 GROUP_FULL', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'pending', expires_at: '2099-12-31' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ max_members: 2 }]);
    mockDB.pushResult([{ c: 2 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('GROUP_FULL');
  });

  it('정상 가족 초대 수락 성공', async () => {
    setupUserLookup();
    mockDB.pushResult([{ id: 'i1', plan_group_id: 'g1', inviter_user_id: 'pk2', status: 'pending', expires_at: '2099-12-31' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ max_members: 6 }]);
    mockDB.pushResult([{ c: 2 }]);
    mockDB.pushResult([], 1); // INSERT plan_group_members
    mockDB.pushResult([], 1); // UPDATE plan_group_invites
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/code/register', { code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.type).toBe('invite');
    expect(body.membership.plan_group_id).toBe('g1');
    expect(body.membership.role).toBe('member');

    const insertSql = mockDB.calls[5].sql;
    expect(insertSql).toContain('INSERT INTO plan_group_members');
    const updateSql = mockDB.calls[6].sql;
    expect(updateSql).toContain("SET status = 'used'");
  });
});
