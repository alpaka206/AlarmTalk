// ⚠ **선물 코드는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1, 두 번째 반려).
//
// iOS 1.2.12(빌드 9)가 "선물 코드로 디지털 기능을 연다" 로 다시 반려됐다(1.2.11 은 프로모 코드).
// 선물은 보낸 사람이 스토어로 샀어도 **받는 사람은 코드를 쳐서** 유료 기능을 연다 — 애플이 막는 것이
// 그 '코드로 해제' 다. 그래서 발급·등록·스토어 확정을 **서버에서 전부** 닫았다 — 이미 깔린 옛 앱(선물 화면이
// 남아 있다)으로도 못 연다. 할인·무료 이용은 스토어 오퍼 코드로 준다. 커플·가족 이용권과 초대 코드도
// 2026-10-20 에 없앴다 — 받는 코드가 하나도 없다(`code.test.ts`).
//
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고 실제 라우트를 부른다. 지키는 것:
//   1. 애플 확정: 선물·커플·가족 상품 id 는 모르는 상품(400 `UNKNOWN_PRODUCT`)이다 — 환불 통보여도 회수 갈래에
//      닿지 않고, 체인 조회도 원장·구독 행도 없다.
//   2. 구글 확정: `personal_gift_1m`·커플·가족 상품은 구글 호출(OAuth 토큰·구매 조회·확인·소비)을 하나도 하기
//      전에 400 `UNKNOWN_PRODUCT` 다 — 확인하지 않으니 Play 가 3일 뒤 자동 환불한다.
// (dev 스텁 `/billing/checkout` 의 `gift: true` 거절과 `/billing/test-codes` 가 없다는 것은
//  `billing-checkout-stub.test.ts`.)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-gift-retired-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
let info: Record<string, unknown>;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({
    issuerId: 't',
    keyId: 't',
    privateKeyPem: 't',
    bundleId: 'com.alarmtalk.app',
  }),
  fetchAppleTransaction: vi.fn(async () => info),
  // 없앤 상품은 체인 조회까지 가면 안 된다 — 불리면 아래 단언이 잡는다.
  fetchAppleSubscriptionStatus: vi.fn(async () => {
    throw new Error('subscription status must not be requested for a retired product');
  }),
}));
// OAuth 토큰은 진짜로 받지 않는다 — 대신 불렸는지만 본다(불리면 그 뒤 Play 호출이 fetch 로 잡힌다).
vi.mock('../src/lib/google-oauth', async (original) => ({
  ...(await original<typeof import('../src/lib/google-oauth')>()),
  getGoogleAccessToken: vi.fn(async () => 'play-access-token'),
}));

import { applePlanKeyFromProductId, fetchAppleSubscriptionStatus } from '../src/lib/apple-storekit';
import { getGoogleAccessToken } from '../src/lib/google-oauth';
import { googlePlanKeyFromProductId } from '../src/lib/play-subscriptions';
import billingApple from '../src/routes/billing-apple';
import billingGoogle from '../src/routes/billing-google';

const APPLE_GIFT_PRODUCT = 'com.alarmtalk.app.personal_gift_1m';
const GOOGLE_GIFT_PRODUCT = 'personal_gift_1m';
const BUYER = '33333333-3333-4333-8333-333333333333';
const purchasedAt = Date.now();

const PLAY_ENV = {
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'svc@play.test',
    private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  }),
  ANDROID_PACKAGE_NAME: 'com.alarmtalk.app',
} as unknown as Env;

function appFor(caller: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', caller);
    c.set('userIdPK', caller);
    c.set('userLoginId', caller);
    await next();
  });
  app.route('/billing', billingApple);
  app.route('/billing', billingGoogle);
  return app;
}

async function post(caller: string, path: string, body: Record<string, unknown>, env = {} as Env) {
  const res = await appFor(caller).request(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const rows = async (sql: string) => (await db.execute(sql)).rows;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute(`INSERT INTO users (id, email, name) VALUES ('${BUYER}', 'buyer@example.test', 'buyer')`);
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of ['store_transactions', 'subscriptions']) {
    await db.execute(`DELETE FROM ${table}`);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('없앤 상품은 어느 스토어 목록에도 없다', () => {
  it('애플·구글 상품 매핑이 선물·커플·가족 id 를 모른다', () => {
    expect(applePlanKeyFromProductId(APPLE_GIFT_PRODUCT)).toBeNull();
    expect(googlePlanKeyFromProductId(GOOGLE_GIFT_PRODUCT)).toBeNull();
    for (const retired of ['couple_monthly', 'family_monthly']) {
      expect(applePlanKeyFromProductId(`com.alarmtalk.app.${retired}`), retired).toBeNull();
      expect(googlePlanKeyFromProductId(retired), retired).toBeNull();
    }
    // 개인 구독 상품은 그대로다.
    expect(applePlanKeyFromProductId('com.alarmtalk.app.personal_monthly')).toBe('personal');
    expect(googlePlanKeyFromProductId('personal_monthly')).toBe('personal');
  });
});

describe('POST /billing/apple/confirm — 없앤 상품은 모르는 상품이다', () => {
  function giftTransaction(extra: Record<string, unknown> = {}) {
    return {
      transactionId: 'apple-gift-tx-1',
      originalTransactionId: 'apple-gift-tx-1',
      productId: APPLE_GIFT_PRODUCT,
      purchaseDate: purchasedAt,
      bundleId: 'com.alarmtalk.app',
      // 표식이 호출자 본인이다 — 예전이면 그대로 선물 코드가 나갔다.
      appAccountToken: BUYER,
      ...extra,
    };
  }

  it.each([
    ['선물 구매 확정', {}],
    // 환불 통보여도 회수 갈래(표식·원장 쓰기)에 닿지 않는다 — 모르는 상품으로 먼저 끝난다.
    ['선물 환불 통보', { revocationDate: purchasedAt + 1000 }],
    // 판매를 내리기 전에 옛 앱이 산 커플·가족 — 개인으로 바꿔 붙이지 않는다(값이 다른 상품이다).
    ['가족 구독 확정', { productId: 'com.alarmtalk.app.family_monthly', expiresDate: purchasedAt + 30 * 86_400_000 }],
    ['커플 구독 확정', { productId: 'com.alarmtalk.app.couple_monthly', expiresDate: purchasedAt + 30 * 86_400_000 }],
  ])('%s → 400 UNKNOWN_PRODUCT, 원장·구독 행이 없고 체인 조회도 없다', async (_label, extra) => {
    info = giftTransaction(extra);

    const res = await post(BUYER, '/billing/apple/confirm', { transaction_id: 'apple-gift-tx-1' });

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('UNKNOWN_PRODUCT');
    expect(res.body).not.toHaveProperty('voucher');
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
    expect(await rows('SELECT * FROM subscriptions')).toEqual([]);
    expect(await rows(`SELECT plan FROM users WHERE id = '${BUYER}'`)).toEqual([{ plan: 'free' }]);
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
  });
});

describe('POST /billing/google/confirm — 없앤 상품은 구글을 부르기 전에 끝난다', () => {
  it('personal_gift_1m → 400 UNKNOWN_PRODUCT, OAuth·Play 조회·확인·소비 없음', async () => {
    // 불리면 예전처럼 '완료된 1회성 구매' 를 돌려주는 Play — 호출이 하나라도 있으면 아래 단언이 잡는다.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            purchaseState: 0,
            orderId: 'GPA.0000-0000-0000-00000',
            purchaseTimeMillis: String(purchasedAt),
            obfuscatedExternalAccountId: await sha256Hex(BUYER),
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await post(
      BUYER,
      '/billing/google/confirm',
      { purchase_token: 'play-gift-token-1', product_id: GOOGLE_GIFT_PRODUCT },
      PLAY_ENV,
    );

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('UNKNOWN_PRODUCT');
    expect(res.body).not.toHaveProperty('voucher');
    expect(getGoogleAccessToken).not.toHaveBeenCalled();
    // 확인(acknowledge)·소비(:consume)가 없다 — Play 가 3일 뒤 자동 환불한다.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
  });

  // 커플·가족은 판매를 내린 상품이다 — 옛 앱으로 산 결제는 확인하지 않아 Play 가 3일 뒤 자동 환불한다.
  it.each(['lifetime_unlock', 'couple_monthly', 'family_monthly'])(
    '다른 모르는 상품(%s)도 같은 자리에서 같은 답이다(선물만의 갈래가 없다)',
    async (productId) => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const res = await post(
        BUYER,
        '/billing/google/confirm',
        { purchase_token: 'play-token-unknown', product_id: productId },
        PLAY_ENV,
      );

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('UNKNOWN_PRODUCT');
      expect(getGoogleAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
