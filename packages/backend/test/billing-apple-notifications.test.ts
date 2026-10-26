// **App Store Server Notifications V2 수신**(`routes/billing-apple-notifications.ts`) — 실제 SQLite 에 마이그레이션을
// 전부 돌리고, 애플 서명은 자체 체인(`support/apple-jws-fixtures.ts`)으로, 애플 상태 조회만 목으로 둔다.
//
// 지키는 것(`docs/spec/billing-lifecycle.md` 「애플 서버 알림 V2」):
//  - 서명·체인·번들·환경이 하나라도 틀리면 거절하고 **아무것도 적지 않는다.**
//  - `notificationUUID` 로 거른다 — 끝난 알림은 다시 처리하지 않고, 실패한 알림은 재전송 때 다시 처리한다.
//  - 알림의 상태를 그대로 쓰지 않는다 — 언제나 애플에 다시 묻는다(순서가 뒤바뀌어도 같은 답).
//  - 환불·회수는 확정 라우트와 같은 회수 갈래를 탄다. 남은 권한(관리자 기간 지급)이 있으면 보관을 걸지 않는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { fetchAppleSubscriptionStatus } from '../src/lib/apple-storekit';
import { expectedAppleEnvironment } from '../src/lib/apple-server-notifications';
import {
  makeTestAppleChain,
  signTestAppleJws,
  type TestAppleChain,
} from './support/apple-jws-fixtures';

vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  fetchAppleSubscriptionStatus: vi.fn(),
}));
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import { createBillingAppleNotificationsRoutes } from '../src/routes/billing-apple-notifications';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-apple-notifications-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });

const BUNDLE_ID = 'com.alarmtalk.app';
const PRODUCT = 'com.alarmtalk.app.personal_monthly';
const ORIGINAL = '2000000800000001';
const NOW = Date.now();
const PAID = NOW - 86400_000;
const CURRENT_EXPIRY = new Date(NOW + 2 * 86400_000).toISOString();
const RENEWED_EXPIRY = NOW + 32 * 86400_000;
const ENV = {
  ENVIRONMENT: 'production',
  APPLE_ISSUER_ID: 'test',
  APPLE_KEY_ID: 'test',
  APPLE_PRIVATE_KEY: 'test',
  APPLE_BUNDLE_ID: BUNDLE_ID,
} as never;

let chain: TestAppleChain;
let app: Hono<AppEnv>;
let personalPlanId: string;
let uuidCounter = 0;

function nextUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}

function appleSays(status: number, expiresDate = RENEWED_EXPIRY) {
  vi.mocked(fetchAppleSubscriptionStatus).mockResolvedValue({
    status,
    expiresDate,
    purchaseDate: PAID,
    autoRenewStatus: 1,
    productId: PRODUCT,
    latest: {
      transactionId: '2000000900000002',
      originalTransactionId: ORIGINAL,
      bundleId: BUNDLE_ID,
      productId: PRODUCT,
      purchaseDate: PAID,
      expiresDate,
      type: 'Auto-Renewable Subscription',
    },
  });
}

interface NotifyOptions {
  uuid?: string;
  subtype?: string;
  bundleId?: string;
  environment?: string;
  /** null = 트랜잭션 없는 알림(TEST 등). */
  transaction?: Record<string, unknown> | null;
  signer?: TestAppleChain;
}

async function notify(notificationType: string, options: NotifyOptions = {}) {
  const signer = options.signer ?? chain;
  const environment = options.environment ?? 'Production';
  const bundleId = options.bundleId ?? BUNDLE_ID;
  const signedTransactionInfo =
    options.transaction === null
      ? undefined
      : await signTestAppleJws(
          {
            transactionId: '2000000900000002',
            originalTransactionId: ORIGINAL,
            bundleId,
            productId: PRODUCT,
            purchaseDate: PAID,
            expiresDate: RENEWED_EXPIRY,
            type: 'Auto-Renewable Subscription',
            environment,
            signedDate: NOW,
            ...options.transaction,
          },
          signer,
        );
  const payload = {
    notificationType,
    ...(options.subtype ? { subtype: options.subtype } : {}),
    notificationUUID: options.uuid ?? nextUuid(),
    version: '2.0',
    signedDate: NOW,
    data: { bundleId, environment, signedTransactionInfo, signedRenewalInfo: undefined },
  };
  const signedPayload = await signTestAppleJws(payload, signer);
  const res = await app.request(
    '/api/billing/apple/notifications',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedPayload }),
    },
    ENV,
  );
  return {
    res,
    body: (await res.json()) as Record<string, unknown>,
    uuid: payload.notificationUUID,
  };
}

async function rows(sql: string, args: string[] = []) {
  return (await db.execute({ sql, args })).rows;
}

async function recorded(uuid: string) {
  return (
    await rows('SELECT * FROM apple_server_notifications WHERE notification_uuid = ?', [uuid])
  )[0];
}

async function seedOwner() {
  await db.execute(
    "INSERT INTO users (id, email, name, plan) VALUES ('owner', 'owner@example.test', 'owner', 'plus')",
  );
  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, cancel_at_period_end)
          VALUES ('sub-owner', 'owner', ?, 'active', ?, ?, 0)`,
    args: [personalPlanId, new Date(PAID).toISOString(), CURRENT_EXPIRY],
  });
  await db.execute({
    sql: `INSERT INTO store_transactions
            (id, user_id, provider, provider_transaction_id, product_id, plan_key, subscription_id, expires_at, last_paid_at)
          VALUES ('receipt', 'owner', 'apple', ?, ?, 'personal', 'sub-owner', ?, ?)`,
    args: [ORIGINAL, PRODUCT, CURRENT_EXPIRY, new Date(PAID).toISOString()],
  });
}

beforeAll(async () => {
  await runMigrations(db);
  personalPlanId = String((await rows("SELECT id FROM plans WHERE key = 'personal'"))[0]!.id);
  chain = await makeTestAppleChain();
  app = new Hono<AppEnv>();
  app.route(
    '/api/billing/apple',
    createBillingAppleNotificationsRoutes({ trustedRootSha256: [chain.rootSha256] }),
  );
});

beforeEach(async () => {
  vi.mocked(fetchAppleSubscriptionStatus).mockReset();
  for (const table of [
    'apple_server_notifications',
    'store_transactions',
    'subscriptions',
    'paid_voice_retention',
    'plan_grants',
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM users WHERE id = 'owner'");
  await seedOwner();
  appleSays(1);
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('검증 — 하나라도 틀리면 거절하고 적지 않는다', () => {
  it('믿지 않는 루트로 서명한 알림은 400 이다', async () => {
    const forger = await makeTestAppleChain();
    const { res, body, uuid } = await notify('REFUND', { signer: forger });
    expect(res.status).toBe(400);
    expect(body.error_code).toBe('APPLE_NOTIFICATION_INVALID');
    expect(await recorded(uuid)).toBeUndefined();
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('안에 실린 트랜잭션의 서명이 틀려도 400 이다', async () => {
    const forger = await makeTestAppleChain();
    const signedTransactionInfo = await signTestAppleJws(
      { originalTransactionId: ORIGINAL, bundleId: BUNDLE_ID },
      forger,
    );
    const payload = {
      notificationType: 'REFUND',
      notificationUUID: nextUuid(),
      version: '2.0',
      signedDate: NOW,
      data: { bundleId: BUNDLE_ID, environment: 'Production', signedTransactionInfo },
    };
    const res = await app.request(
      '/api/billing/apple/notifications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signedPayload: await signTestAppleJws(payload, chain) }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'APPLE_NOTIFICATION_INVALID',
    );
    expect(await recorded(payload.notificationUUID)).toBeUndefined();
  });

  it('본문이 없거나 signedPayload 가 문자열이 아니면 400 이다', async () => {
    const res = await app.request(
      '/api/billing/apple/notifications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signedPayload: 1 }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('다른 앱(번들 ID)의 알림은 400 BUNDLE_MISMATCH 다', async () => {
    const { res, body, uuid } = await notify('DID_RENEW', { bundleId: 'com.example.other' });
    expect(res.status).toBe(400);
    expect(body.error_code).toBe('APPLE_NOTIFICATION_BUNDLE_MISMATCH');
    expect(await recorded(uuid)).toBeUndefined();
  });

  it('운영 워커는 샌드박스 알림을 받지 않는다(400 ENVIRONMENT_MISMATCH)', async () => {
    const { res, body, uuid } = await notify('DID_RENEW', { environment: 'Sandbox' });
    expect(res.status).toBe(400);
    expect(body.error_code).toBe('APPLE_NOTIFICATION_ENVIRONMENT_MISMATCH');
    expect(await recorded(uuid)).toBeUndefined();
  });

  it('운영은 Production, 그 밖(dev·테스트)은 Sandbox 를 받는다', () => {
    expect(expectedAppleEnvironment('production')).toBe('Production');
    expect(expectedAppleEnvironment('development')).toBe('Sandbox');
    expect(expectedAppleEnvironment(undefined)).toBe('Sandbox');
  });
});

describe('갱신 계열 — 알림이 아니라 애플의 현재 상태로 맞춘다', () => {
  it('DID_RENEW 는 체인을 다시 물어 만료를 늘린다', async () => {
    const { res, body, uuid } = await notify('DID_RENEW');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'processed', outcome: 'reconciled' });
    expect(fetchAppleSubscriptionStatus).toHaveBeenCalledWith(ORIGINAL, expect.anything());
    const [sub] = await rows(
      "SELECT status, expires_at FROM subscriptions WHERE user_id = 'owner' AND status = 'active'",
    );
    expect(Date.parse(String(sub!.expires_at))).toBe(RENEWED_EXPIRY);
    expect(await recorded(uuid)).toMatchObject({
      status: 'processed',
      outcome: 'reconciled',
      user_id: 'owner',
      original_transaction_id: ORIGINAL,
      notification_type: 'DID_RENEW',
      environment: 'Production',
      attempts: 1,
    });
  });

  it('늦게 온 EXPIRED 라도 애플이 아직 활성이면 끊지 않는다(순서가 뒤바뀌어도 같은 답)', async () => {
    const { res, body } = await notify('EXPIRED', { subtype: 'VOLUNTARY' });
    expect(res.status).toBe(200);
    expect(body.outcome).toBe('reconciled');
    const active = await rows(
      "SELECT id FROM subscriptions WHERE user_id = 'owner' AND status = 'active'",
    );
    expect(active).toHaveLength(1);
    expect((await rows("SELECT plan FROM users WHERE id = 'owner'"))[0]!.plan).toBe('plus');
  });

  it('같은 notificationUUID 는 다시 처리하지 않는다', async () => {
    const first = await notify('DID_RENEW');
    expect(first.res.status).toBe(200);
    const second = await notify('DID_RENEW', { uuid: first.uuid });
    expect(second.res.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(fetchAppleSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect((await recorded(first.uuid))!.attempts).toBe(1);
  });

  it('처리가 실패하면 failed 로 적고 5xx — 애플의 재전송 때 다시 처리한다', async () => {
    vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('apple down'));
    const failed = await notify('DID_RENEW');
    expect(failed.res.status).toBe(502);
    expect(failed.body.error_code).toBe('APPLE_NOTIFICATION_PROCESSING_FAILED');
    expect(await recorded(failed.uuid)).toMatchObject({
      status: 'failed',
      attempts: 1,
      processed_at: null,
    });
    // 구독은 그대로다 — 장애로 끊지 않는다.
    expect(await rows("SELECT id FROM subscriptions WHERE status = 'active'")).toHaveLength(1);

    appleSays(1);
    const retried = await notify('DID_RENEW', { uuid: failed.uuid });
    expect(retried.res.status).toBe(200);
    expect(retried.body.outcome).toBe('reconciled');
    expect(await recorded(failed.uuid)).toMatchObject({
      status: 'processed',
      attempts: 2,
      last_error: null,
    });
  });

  it('주인 없는 거래는 적고 200 — 할 일이 없다(확정이 묶는다)', async () => {
    const { res, body, uuid } = await notify('SUBSCRIBED', {
      subtype: 'INITIAL_BUY',
      transaction: { originalTransactionId: '2000000899999999' },
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ignored', outcome: 'unknown_transaction' });
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
    expect(await recorded(uuid)).toMatchObject({ status: 'ignored', user_id: null });
  });

  it('TEST 알림은 적고 200 이다', async () => {
    const { res, body, uuid } = await notify('TEST', { transaction: null });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ignored', outcome: 'test' });
    expect(await recorded(uuid)).toMatchObject({
      status: 'ignored',
      original_transaction_id: null,
    });
  });
});

describe('환불·회수 — 확정 라우트와 같은 회수 갈래', () => {
  it('REFUND 는 애플이 끝났다고 하면 매핑된 구독을 끊는다', async () => {
    appleSays(5);
    const { res, body, uuid } = await notify('REFUND', {
      transaction: { revocationDate: NOW, revocationReason: 0 },
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'processed', outcome: 'refund_revoked' });
    expect(
      await rows("SELECT id FROM subscriptions WHERE user_id = 'owner' AND status = 'active'"),
    ).toHaveLength(0);
    expect((await rows("SELECT plan FROM users WHERE id = 'owner'"))[0]!.plan).toBe('free');
    // 목소리는 바로 지우지 않고 보관을 건다(회수 갈래의 규칙).
    expect(
      await rows("SELECT user_id FROM paid_voice_retention WHERE user_id = 'owner'"),
    ).toHaveLength(1);
    expect(await recorded(uuid)).toMatchObject({ status: 'processed', user_id: 'owner' });
  });

  it('옛 갱신의 환불이면(체인은 살아 있다) 손대지 않는다', async () => {
    appleSays(1);
    const { res, body } = await notify('REFUND', { transaction: { revocationDate: NOW } });
    expect(res.status).toBe(200);
    expect(body.outcome).toBe('refund_chain_live');
    expect(await rows("SELECT id FROM subscriptions WHERE status = 'active'")).toHaveLength(1);
  });

  it('관리자 기간 지급이 남아 있으면 보관을 걸지 않는다 — 다른 권한이 있는 사람을 강등하지 않는다', async () => {
    await db.execute({
      sql: `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, granted_by, request_key)
            VALUES ('grant-owner', 'owner', ?, ?, 'support', 'admin', 'grant-key-owner')`,
      args: [new Date(NOW - 86400_000).toISOString(), new Date(NOW + 30 * 86400_000).toISOString()],
    });
    appleSays(5);
    const { res } = await notify('REVOKE', { transaction: { revocationDate: NOW } });
    expect(res.status).toBe(200);
    expect(await rows("SELECT id FROM subscriptions WHERE status = 'active'")).toHaveLength(0);
    expect(
      await rows("SELECT user_id FROM paid_voice_retention WHERE user_id = 'owner'"),
    ).toHaveLength(0);
  });

  it('애플에 못 물어보면 끊지 않고 5xx — 재전송을 받는다', async () => {
    vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('apple down'));
    const { res, uuid } = await notify('REFUND', { transaction: { revocationDate: NOW } });
    expect(res.status).toBe(502);
    expect(await rows("SELECT id FROM subscriptions WHERE status = 'active'")).toHaveLength(1);
    expect((await recorded(uuid))!.status).toBe('failed');
  });
});
