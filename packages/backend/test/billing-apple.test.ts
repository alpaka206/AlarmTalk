import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingApple from '../src/routes/billing-apple';

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
  it('검증되지 않은 transaction confirm 은 501 로 fail-closed 하고 DB 를 변경하지 않는다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error_code).toBe('APPLE_TRANSACTION_VERIFICATION_REQUIRED');
    expect(body.plan_key).toBe('personal');
    expect(mockDB.calls).toHaveLength(0);
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

  it('필수 body 필드 누락 시 400 INVALID_REQUEST', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', {
        transaction_id: '',
        original_transaction_id: 'apple-orig-1',
        product_id: 'com.voicealarm.nativeapp.ios.personal_monthly',
      }),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_REQUEST');
  });
});
