import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingApple from '../src/routes/billing-apple';

const PLAN_PERSONAL = {
  id: '70000000-0000-4000-8000-000000000002',
  key: 'personal',
  plan_type: 'personal',
  period_days: 30,
  is_active: 1,
};

const ENV: Env = {
  PERSO_API_KEY: 'x',
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  APPLE_SHARED_SECRET: 'shared-secret-test',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

const ENV_NO_SECRET: Env = { ...ENV, APPLE_SHARED_SECRET: undefined };

function buildApp(userId = 'google-1', withAuth = true) {
  const app = new Hono<AppEnv>();
  if (withAuth) app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingApple);
  return app;
}

const VALID_BODY = {
  transaction_id: 'apple-tx-1',
  original_transaction_id: 'apple-orig-1',
  product_id: 'com.voicealarm.nativeapp.ios.personal_monthly',
};

beforeEach(() => {
  mockDB.reset();
});

describe('POST /billing/apple/confirm', () => {
  it('정상 confirm 시 200, plan/expires_at/subscription_id 반환', async () => {
    // 호출 순서: resolveUserPk → 멱등 lookup → plan lookup → UPDATE old → INSERT → UPDATE users.
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([]); // idempotent lookup empty
    mockDB.pushResult([PLAN_PERSONAL]); // plan lookup
    mockDB.pushResult([], 1); // UPDATE old subs → expired
    mockDB.pushResult([], 1); // INSERT subscriptions
    mockDB.pushResult([], 1); // UPDATE users SET plan

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('personal');
    expect(typeof body.subscription_id).toBe('string');
    expect(typeof body.expires_at).toBe('string');

    // INSERT subscriptions 호출에 apple_* 컬럼이 채워져야 함.
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insert).toBeDefined();
    expect(insert!.args).toContain('apple-tx-1');
    expect(insert!.args).toContain('apple-orig-1');
    expect(insert!.args).toContain('com.voicealarm.nativeapp.ios.personal_monthly');

    // users.plan 이 'plus' (personal → plus) 로 업데이트.
    const userUpdate = mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan'));
    expect(userUpdate?.args[0]).toBe('plus');
  });

  it('알 수 없는 product_id 시 400 UNKNOWN_PRODUCT', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', {
        ...VALID_BODY,
        product_id: 'com.voicealarm.nativeapp.ios.bogus_plan',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNKNOWN_PRODUCT');
  });

  it('인증된 사용자가 DB 에 없으면 404 USER_NOT_FOUND', async () => {
    // billingApple 자체에 auth 가 없으므로 resolveUserPk 가 fakeAuth 의 userId 로 DB 조회 → 미일치.
    mockDB.pushResult([]); // resolveUserPk: users row 없음

    const res = await buildApp('unknown-user').request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('APPLE_SHARED_SECRET 미설정 시 503', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV_NO_SECRET,
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error_code).toBe('APPLE_BILLING_UNCONFIGURED');
  });

  it('동일 transaction_id 재호출 시 멱등 (200, 같은 응답)', async () => {
    // 1차: 정상 confirm.
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([]); // idempotent lookup empty
    mockDB.pushResult([PLAN_PERSONAL]); // plan lookup
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const first = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    // 2차: 같은 transaction_id 가 이미 존재한다고 mock.
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([
      {
        sub_id: firstBody.subscription_id,
        expires_at: firstBody.expires_at,
        plan_key: 'personal',
      },
    ]); // idempotent lookup → 기존 row

    const second = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.subscription_id).toBe(firstBody.subscription_id);
    expect(secondBody.plan).toBe('personal');
    expect(secondBody.expires_at).toBe(firstBody.expires_at);
  });

  it('DB 미초기화 등 plan 조회 실패 시 graceful 에러 응답', async () => {
    // plan 시드가 빠진 환경에선 PLAN_NOT_FOUND 400 으로 graceful 거부.
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([]); // idempotent lookup empty
    mockDB.pushResult([]); // plan lookup empty (DB 시드 미적용)

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('PLAN_NOT_FOUND');
  });
});
