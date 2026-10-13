// ⚠ **선물 코드는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1, 두 번째 반려).
//
// iOS 1.2.12(빌드 9)가 "선물 코드로 디지털 기능을 연다" 로 다시 반려됐다(1.2.11 은 프로모 코드).
// 선물은 보낸 사람이 스토어로 샀어도 **받는 사람은 코드를 쳐서** 유료 기능을 연다 — 애플이 막는 것이
// 그 '코드로 해제' 다. 1.2.11 때는 사례(프로모)만 지우고 종류(코드 입력으로 여는 것)를 남겼다. 그래서
// 이번에는 발급·등록·스토어 확정을 **서버에서 전부** 닫는다 — 이미 깔린 옛 앱(선물 화면이 남아 있다)
// 으로도 못 연다. 할인·무료 이용은 스토어 오퍼 코드로 준다. 초대 코드(INV-)는 남는다(`routes/code.ts`
// 머리말).
//
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고 실제 라우트를 부른다. 지키는 것:
//   1. 등록: GIFT- 코드는 그 해시의 발급 행이 `voucher_codes` 에 남아 있어도 404 `CODE_NOT_FOUND` 이고,
//      행은 미사용(issued) 그대로다 — 사용 기록·구독·등급 변화가 없다.
//   2. 애플 확정: 선물 상품 id 는 모르는 상품(400 `UNKNOWN_PRODUCT`)이다 — 환불 통보여도 회수 갈래에
//      닿지 않고, 체인 조회도 바우처·원장·`apple_gift_deliveries` 행도 없다.
//   3. 구글 확정: `personal_gift_1m` 은 구글 호출(OAuth 토큰·구매 조회·확인·소비)을 하나도 하기 전에
//      400 `UNKNOWN_PRODUCT` 다 — 확인하지 않으니 Play 가 3일 뒤 자동 환불한다. 바우처·원장 행도 없다.
//   4. 목록·공유: `GET /billing/vouchers` 는 초대 코드(INV-)만 돌려준다 — 남아 있는 선물 행이 앱(옛 버전
//      포함)의 코드 목록에 뜨지 않는다. 공유할 코드를 내주는 `POST /billing/vouchers/family-share` 도
//      같은 경계다. 행은 숨길 뿐 지우지 않는다(이력).
// (dev 스텁 `/billing/checkout` 의 `gift: true` 거절과 `/billing/test-codes` 가 없다는 것은
//  `billing-checkout-stub.test.ts`, 형식 검사는 `vouchers.test.ts`.)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { hashVoucherCode } from '../src/lib/vouchers';

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
  // 선물 상품은 체인 조회까지 가면 안 된다 — 불리면 아래 단언이 잡는다.
  fetchAppleSubscriptionStatus: vi.fn(async () => {
    throw new Error('subscription status must not be requested for a retired gift product');
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
import billingMutation from '../src/routes/billing-mutation';
import billingQuery from '../src/routes/billing-query';
import codeRoutes from '../src/routes/code';

const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';
const APPLE_GIFT_PRODUCT = 'com.alarmtalk.app.personal_gift_1m';
const GOOGLE_GIFT_PRODUCT = 'personal_gift_1m';
const GIFT_CODE = 'GIFT-AAAA-BBBB-CCCC';
const INVITE_CODE = 'INV-DDDD-EEEE-FFFF';
const ISSUER = '11111111-1111-4111-8111-111111111111';
const RECEIVER = '22222222-2222-4222-8222-222222222222';
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
  app.route('/code', codeRoutes);
  app.route('/billing', billingApple);
  app.route('/billing', billingGoogle);
  app.route('/billing', billingQuery);
  app.route('/billing', billingMutation);
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

async function get(caller: string, path: string) {
  const res = await appFor(caller).request(
    new Request(`http://localhost${path}`),
    undefined,
    {} as Env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const rows = async (sql: string) => (await db.execute(sql)).rows;

/** 아직 쓰이지 않았고 기한이 남은 발급 행 하나 — 해시는 등록이 조회하는 방식 그대로다. */
async function insertVoucher(voucher: {
  id: string;
  code: string;
  planId: string;
  issuedAt: string;
  maxUses: number;
  subscriptionId?: string;
}) {
  await db.execute({
    sql: `INSERT INTO voucher_codes
            (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id,
             status, issued_at, expires_at, max_uses)
          VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, '2099-01-01T00:00:00.000Z', ?)`,
    args: [
      voucher.id,
      voucher.code,
      await hashVoucherCode(voucher.code),
      voucher.planId,
      ISSUER,
      voucher.subscriptionId ?? null,
      voucher.issuedAt,
      voucher.maxUses,
    ],
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute(
    `INSERT INTO users (id, email, name) VALUES
       ('${ISSUER}', 'issuer@example.test', 'issuer'),
       ('${RECEIVER}', 'receiver@example.test', 'receiver'),
       ('${BUYER}', 'buyer@example.test', 'buyer')`,
  );
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of [
    'apple_gift_deliveries',
    'voucher_redemptions',
    'voucher_codes',
    'store_transactions',
    'subscriptions',
    'plan_group_members',
    'plan_groups',
  ]) {
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

describe('선물 상품은 어느 스토어 목록에도 없다', () => {
  it('애플·구글 상품 매핑이 선물 id 를 모른다', () => {
    expect(applePlanKeyFromProductId(APPLE_GIFT_PRODUCT)).toBeNull();
    expect(googlePlanKeyFromProductId(GOOGLE_GIFT_PRODUCT)).toBeNull();
    // 구독 상품은 그대로다.
    expect(applePlanKeyFromProductId('com.alarmtalk.app.personal_monthly')).toBe('personal');
    expect(googlePlanKeyFromProductId('personal_monthly')).toBe('personal');
  });
});

describe('POST /code/register — 남아 있는 선물 행도 열리지 않는다', () => {
  it.each([GIFT_CODE, GIFT_CODE.toLowerCase(), `  ${GIFT_CODE}  `])(
    '%j → 404 CODE_NOT_FOUND, 행은 미사용 그대로이고 구독·등급이 생기지 않는다',
    async (input) => {
      // 폐지 전에 발급된 선물 행 — 해시가 정확히 맞고, 아직 쓰이지 않았고, 기한도 남았다.
      await insertVoucher({
        id: 'v-gift',
        code: GIFT_CODE,
        planId: PERSONAL,
        issuedAt: '2026-10-01T00:00:00.000Z',
        maxUses: 1,
      });

      const res = await post(RECEIVER, '/code/register', { code: input });

      expect(res.status).toBe(404);
      expect(res.body.error_code).toBe('CODE_NOT_FOUND');
      expect(await rows(`SELECT status, used_at, redeemed_by_user_id FROM voucher_codes`)).toEqual([
        { status: 'issued', used_at: null, redeemed_by_user_id: null },
      ]);
      expect(await rows(`SELECT * FROM voucher_redemptions`)).toEqual([]);
      expect(await rows(`SELECT * FROM subscriptions WHERE user_id = '${RECEIVER}'`)).toEqual([]);
      expect(await rows(`SELECT plan FROM users WHERE id = '${RECEIVER}'`)).toEqual([{ plan: 'free' }]);
    },
  );
});

// 등록만 막고 목록에 남겨 두면, 선물을 샀던 사람의 앱이 그 코드를 '공유할 코드' 로 계속 띄운다 — 화면이
// 코드로 여는 이용권을 내보이는 것 자체가 반려 사유다(옛 앱에는 선물 문구까지 남아 있다).
describe('GET /billing/vouchers — 남아 있는 선물 행은 목록에 나오지 않는다', () => {
  it('INV- 하나와 옛 GIFT- 하나를 가진 발급자에게 INV- 하나만 돌려준다', async () => {
    await insertVoucher({
      id: 'v-invite',
      code: INVITE_CODE,
      planId: FAMILY,
      issuedAt: '2026-10-01T00:00:00.000Z',
      maxUses: 5,
    });
    // 선물 행이 더 최근이다 — 정렬(issued_at DESC)상 맨 앞 자리라, 첫 줄만 보는 화면에서도 숨지 못한다.
    await insertVoucher({
      id: 'v-gift',
      code: GIFT_CODE,
      planId: PERSONAL,
      issuedAt: '2026-10-10T00:00:00.000Z',
      maxUses: 1,
    });

    const res = await get(ISSUER, '/billing/vouchers');

    expect(res.status).toBe(200);
    expect(res.body.vouchers).toEqual([
      expect.objectContaining({
        id: 'v-invite',
        code: INVITE_CODE,
        plan_key: 'family',
        status: 'issued',
      }),
    ]);
    // 숨길 뿐 지우지 않는다 — 이력 행은 그대로다.
    expect(await rows(`SELECT id, status FROM voucher_codes ORDER BY id`)).toEqual([
      { id: 'v-gift', status: 'issued' },
      { id: 'v-invite', status: 'issued' },
    ]);
  });
});

describe('POST /billing/vouchers/family-share — 공유할 코드도 초대 코드뿐이다', () => {
  it('같은 구독에 묶인 GIFT- 행이 더 최근이어도 기존 INV- 코드를 돌려준다', async () => {
    // ISSUER 가 주인인 가족 그룹과, 그 그룹을 받치는 활성 구독.
    await db.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g-issuer', ?, ?, 6)`,
      args: [ISSUER, FAMILY],
    });
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-issuer', 'g-issuer', ?, 'owner')`,
      args: [ISSUER],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
            VALUES ('sub-issuer', ?, ?, 'g-issuer', 'active', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`,
      args: [ISSUER, FAMILY],
    });
    await insertVoucher({
      id: 'v-invite',
      code: INVITE_CODE,
      planId: FAMILY,
      issuedAt: '2026-10-01T00:00:00.000Z',
      maxUses: 5,
      subscriptionId: 'sub-issuer',
    });
    // 옛 발급 경로는 선물 행을 구독에 묶지 않았다(issuer_subscription_id NULL) — 실제로는 생기지 않는
    // 행이다. 그래도 공유 경로가 목록과 같은 경계를 지키는지 본다. 정렬상 먼저 오는 자리에 둔다.
    await insertVoucher({
      id: 'v-gift',
      code: GIFT_CODE,
      planId: PERSONAL,
      issuedAt: '2026-10-10T00:00:00.000Z',
      maxUses: 1,
      subscriptionId: 'sub-issuer',
    });

    const res = await post(ISSUER, '/billing/vouchers/family-share', {});

    expect(res.status).toBe(200);
    expect(res.body.voucher).toMatchObject({
      id: 'v-invite',
      code: INVITE_CODE,
      subscription_id: 'sub-issuer',
    });
    // 새 코드를 찍지도, 선물 행을 건드리지도 않는다.
    expect(await rows(`SELECT id, status FROM voucher_codes ORDER BY id`)).toEqual([
      { id: 'v-gift', status: 'issued' },
      { id: 'v-invite', status: 'issued' },
    ]);
  });
});

describe('POST /billing/apple/confirm — 선물 상품은 모르는 상품이다', () => {
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
    ['구매 확정', {}],
    // 환불 통보여도 회수 갈래(표식·원장 쓰기)에 닿지 않는다 — 모르는 상품으로 먼저 끝난다.
    ['환불 통보', { revocationDate: purchasedAt + 1000 }],
  ])('%s → 400 UNKNOWN_PRODUCT, 바우처·원장·선물 연결 행이 없고 체인 조회도 없다', async (_label, extra) => {
    info = giftTransaction(extra);

    const res = await post(BUYER, '/billing/apple/confirm', { transaction_id: 'apple-gift-tx-1' });

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('UNKNOWN_PRODUCT');
    expect(res.body).not.toHaveProperty('voucher');
    expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual([]);
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
  });
});

describe('POST /billing/google/confirm — 선물 상품은 구글을 부르기 전에 끝난다', () => {
  it('personal_gift_1m → 400 UNKNOWN_PRODUCT, OAuth·Play 조회·확인·소비 없음, 바우처 없음', async () => {
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
    expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
  });

  it('다른 모르는 상품도 같은 자리에서 같은 답이다(선물만의 갈래가 없다)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await post(
      BUYER,
      '/billing/google/confirm',
      { purchase_token: 'play-token-unknown', product_id: 'lifetime_unlock' },
      PLAY_ENV,
    );

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('UNKNOWN_PRODUCT');
    expect(getGoogleAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
