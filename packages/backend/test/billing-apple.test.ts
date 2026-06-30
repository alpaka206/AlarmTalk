import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingApple from '../src/routes/billing-apple';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  APPLE_ISSUER_ID: 'issuer-1',
  APPLE_KEY_ID: 'key-1',
  APPLE_IAP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  APPLE_BUNDLE_ID: 'com.voicealarm.nativeapp.ios',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

const ENV_NO_SECRET: Env = { ...ENV, APPLE_IAP_PRIVATE_KEY: undefined };

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

function base64Url(json: object): string {
  return btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Apple App Store Server API 의 signedTransactionInfo JWS 응답을 모킹한다. */
function stubAppleLookup(payload: Record<string, unknown>, status = 200) {
  const jws = `${base64Url({ alg: 'ES256' })}.${base64Url(payload)}.sig`;
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toContain('/inApps/v1/transactions/');
    if (status !== 200) return new Response('{}', { status });
    return new Response(JSON.stringify({ signedTransactionInfo: jws }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  // 가짜 .p8 키로는 실제 서명이 불가하므로 서명 경로를 우회.
  vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
  vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2]).buffer);
  return fetchMock;
}

beforeEach(() => {
  mockDB.reset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /billing/apple/confirm', () => {
  it('Apple 검증 성공 시 entitlement 를 반영하고 plan_key 를 반환한다', async () => {
    stubAppleLookup({
      bundleId: 'com.voicealarm.nativeapp.ios',
      productId: VALID_BODY.product_id,
      originalTransactionId: 'apple-orig-1',
      transactionId: 'apple-tx-1',
      expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // 호출 순서대로 결과 큐잉:
    // resolveUserPk → plans 조회 → (tx) store_transactions 조회 → 활성 구독 조회 → INSERT 들…
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([
      {
        id: 'plan-1',
        key: 'personal',
        name: '개인',
        plan_type: 'personal',
        period_days: 30,
        max_members: 1,
        price_krw: 4900,
      },
    ]); // loadPlanByKey
    mockDB.pushResult([]); // store_transactions 중복 조회 — 없음
    mockDB.pushResult([]); // findActiveSubscriptionsByUserPk — 없음
    // 이후 INSERT/UPDATE 는 기본 빈 결과로 통과.

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.plan_key).toBe('personal');
    expect(body.subscription.status).toBe('active');

    const insertedSub = mockDB.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
    expect(insertedSub).toBeDefined();
    const insertedTx = mockDB.calls.find((c) => c.sql.includes('store_transactions'));
    expect(insertedTx).toBeDefined();
  });

  it('만료된 트랜잭션은 400 SUBSCRIPTION_EXPIRED 로 거절하고 구독을 만들지 않는다', async () => {
    stubAppleLookup({
      bundleId: 'com.voicealarm.nativeapp.ios',
      productId: VALID_BODY.product_id,
      originalTransactionId: 'apple-orig-1',
      expiresDate: Date.now() - 1000,
    });
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('SUBSCRIPTION_EXPIRED');
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO subscriptions'))).toBe(false);
  });

  it('bundleId 가 다르면 400 BUNDLE_MISMATCH', async () => {
    stubAppleLookup({
      bundleId: 'com.attacker.app',
      productId: VALID_BODY.product_id,
      expiresDate: Date.now() + 1000000,
    });
    mockDB.pushResult([{ id: 'user-pk-1' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', VALID_BODY),
      undefined,
      ENV,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('BUNDLE_MISMATCH');
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

  it('Apple 자격 미설정 시 503', async () => {
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
