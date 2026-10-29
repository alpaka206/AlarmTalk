import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  AppleTransactionNotFoundError,
  fetchAppleSubscriptionStatus,
} from '../src/lib/apple-storekit';
import {
  billingRetentionUntil,
  pseudonymizeBillingForRetention,
} from '../src/lib/account-deletion';
import {
  getPlaySubscriptionV2,
  googlePaymentAnchor,
  playRevokeSubscription,
} from '../src/lib/play-subscriptions';
import {
  BillingStateUnavailableError,
  expireSubscriptionIfDue,
  reconcileBillingPreflight,
  reconcileStoreSubscription,
} from '../src/lib/billing-reconciliation';
import {
  cancelSubscriptionImmediate,
  findActiveSubscriptionsByUserPk,
  processSubscriptionExpiry,
  repairOrphanedPaidPlan,
  resolvePlanAfterSuspend,
} from '../src/lib/billing-cancel';
import { applyStoreEntitlement, loadPlanByKey } from '../src/lib/store-billing';
import { withWriteTransaction } from '../src/lib/transactions';
import {
  sendPaymentFailedPush,
  sendPlanChangedPush,
  sendVoiceDeletionWarningPush,
} from '../src/lib/fcm';

vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  fetchAppleSubscriptionStatus: vi.fn(),
}));
vi.mock('../src/lib/play-subscriptions', async (original) => ({
  ...(await original<typeof import('../src/lib/play-subscriptions')>()),
  getPlaySubscriptionV2: vi.fn(),
  googlePaymentAnchor: vi.fn().mockResolvedValue(new Date(Date.now() - 86400_000)),
  playRevokeSubscription: vi.fn().mockResolvedValue(undefined),
}));
// 커밋 뒤 알림은 이제 `sendBillingStateSignals` 한 번이다(재조회 신호 + 유예 행이 있는 사람의
// 삭제 예고). 이 파일의 단언은 **누가 신호를 받고 누가 예고를 받는가** 를 본다 — 그 뜻을
// 그대로 지키려고, 합친 호출을 예전 두 발송부의 관찰값으로 나눠 기록한다. 실제 메시지 구성
// (안드로이드 중복 제거·예고 먼저)은 `billing-state-signals.test.ts` 가 따로 고정한다.
const pushMocks = vi.hoisted(() => {
  const sendPlanChangedPush = vi.fn().mockResolvedValue(undefined);
  const sendVoiceDeletionWarningPush = vi.fn().mockResolvedValue(undefined);
  const sendBillingStateSignals = vi.fn(
    async (
      db: unknown,
      env: unknown,
      p: { planChangedUserIds: readonly string[]; deletionWarningUserPks: readonly string[]; retentionDays: number },
    ) => {
      if (p.planChangedUserIds.length) await sendPlanChangedPush(db, env, [...p.planChangedUserIds]);
      if (p.deletionWarningUserPks.length) {
        await sendVoiceDeletionWarningPush(db, env, {
          userPks: [...p.deletionWarningUserPks],
          retentionDays: p.retentionDays,
        });
      }
    },
  );
  return { sendPlanChangedPush, sendVoiceDeletionWarningPush, sendBillingStateSignals };
});
vi.mock('../src/lib/fcm', () => ({
  sendPaymentFailedPush: vi.fn().mockResolvedValue(undefined),
  sendPlanChangedPush: pushMocks.sendPlanChangedPush,
  sendVoiceDeletionWarningPush: pushMocks.sendVoiceDeletionWarningPush,
  sendBillingStateSignals: pushMocks.sendBillingStateSignals,
  notifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => ({ client_email: 'billing@example.test', private_key: 'test' }),
  getGoogleAccessToken: vi.fn().mockResolvedValue('test'),
}));
import billingQuery from '../src/routes/billing-query';
import billingGoogleRtdn from '../src/routes/billing-google-rtdn';
import billingMutation from '../src/routes/billing-mutation';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-billing-reconciliation-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 3600_000).toISOString();
const PAID = new Date(NOW.getTime() - 86400_000).toISOString();
const FUTURE = new Date(NOW.getTime() + 30 * 86400_000).toISOString();
const ENV = {
  APPLE_ISSUER_ID: 'test',
  APPLE_KEY_ID: 'test',
  APPLE_PRIVATE_KEY: 'test',
  APPLE_BUNDLE_ID: 'com.alarmtalk.app',
  APNS_KEY_ID: 'test',
  APNS_PRIVATE_KEY: 'test',
  APPLE_TEAM_ID: 'test',
  ANDROID_PACKAGE_NAME: 'com.alarmtalk.app',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: 'test',
  GOOGLE_RTDN_VERIFICATION_TOKEN: 'test-rtdn',
};
const APPLE_PRODUCT = 'com.alarmtalk.app.personal_monthly';
const PLAY_PRODUCT = 'personal_monthly';
// 스토어 상품은 개인 하나뿐이라 실제 데이터로는 플랜 교체(스토어가 답한 상품 ≠ 구독의 플랜)가 일어나지 않는다.
// 교체 가드(다른 증빙 보호)를 계속 지키려고 이 시험 DB 에만 다른 유료 상품 행을 하나 둔다.
const OLD_PLAN_ID = 'test-old-paid-plan';
let personalPlanId: string;

async function rows(sql: string, args: string[] = []) {
  return (await db.execute({ sql, args })).rows;
}

function productOf(provider: 'apple' | 'google') {
  return provider === 'apple' ? APPLE_PRODUCT : PLAY_PRODUCT;
}

async function seed(provider: 'apple' | 'google' = 'apple', cancel = 0) {
  await db.execute(
    "INSERT INTO users (id, email, plan) VALUES ('owner', 'owner@example.test', 'plus')",
  );
  await db.execute({
    sql: `INSERT INTO subscriptions
      (id, user_id, plan_id, status, starts_at, expires_at, cancel_at_period_end)
      VALUES ('sub-owner', 'owner', ?, 'active', ?, ?, ?)`,
    args: [personalPlanId, PAID, PAST, cancel],
  });
  await db.execute({
    sql: `INSERT INTO store_transactions
    (id, user_id, provider, provider_transaction_id, product_id, plan_key, subscription_id, expires_at, last_paid_at)
    VALUES ('receipt', 'owner', ?, 'receipt-key', ?, 'personal', 'sub-owner', ?, ?)`,
    args: [provider, productOf(provider), PAST, PAID],
  });
}

/** 교체 가드용 — 구독을 시험용 옛 유료 상품으로 옮긴다. 스토어는 계속 개인 상품을 답한다. */
async function moveToOldPlan(subscriptionId = 'sub-owner') {
  await db.execute({
    sql: 'UPDATE subscriptions SET plan_id=? WHERE id=?',
    args: [OLD_PLAN_ID, subscriptionId],
  });
  await db.execute({
    sql: "UPDATE store_transactions SET plan_key='personal_old' WHERE subscription_id=?",
    args: [subscriptionId],
  });
}

function apple(overrides: Partial<Awaited<ReturnType<typeof fetchAppleSubscriptionStatus>>> = {}) {
  vi.mocked(fetchAppleSubscriptionStatus).mockResolvedValue({
    status: 1,
    expiresDate: Date.parse(FUTURE),
    purchaseDate: Date.parse(PAID),
    autoRenewStatus: 1,
    productId: APPLE_PRODUCT,
    ...overrides,
  });
}

function playState(state = 'SUBSCRIPTION_STATE_ACTIVE', productId = PLAY_PRODUCT) {
  vi.mocked(getPlaySubscriptionV2).mockResolvedValue({
    subscriptionState: state,
    lineItems: [
      {
        productId,
        expiryTime: state === 'SUBSCRIPTION_STATE_ACTIVE' ? FUTURE : PAST,
        latestSuccessfulOrderId: 'order-1',
        autoRenewingPlan: { autoRenewEnabled: false },
      },
    ],
  });
}

beforeAll(async () => {
  await runMigrations(db);
  personalPlanId = String((await rows("SELECT id FROM plans WHERE key = 'personal'"))[0]!.id);
  await db.execute({
    sql: `INSERT INTO plans (id, key, name, plan_type, period_days, price_krw)
          VALUES (?, 'personal_old', '옛 개인', 'personal', 30, 3300)`,
    args: [OLD_PLAN_ID],
  });
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(fetchAppleSubscriptionStatus).mockReset();
  vi.mocked(getPlaySubscriptionV2).mockReset();
  vi.mocked(playRevokeSubscription).mockReset().mockResolvedValue(undefined);
  vi.mocked(googlePaymentAnchor).mockResolvedValue(new Date(PAID));
  // 테스트 DB 안에서만 초기화한다. FK 의존 순서대로 지운다.
  await db.execute("DELETE FROM messages WHERE id='orphan-message'");
  await db.execute("DELETE FROM voice_profiles WHERE id='orphan-voice'");
  await db.execute("DELETE FROM pending_external_deletions WHERE ref='orphan-provider'");
  for (const table of [
    'store_transactions',
    'subscriptions',
    'paid_voice_retention',
    'retained_billing_records',
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM users WHERE id='owner'");
  apple();
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('추가 리뷰 — 플랜 교체 가드·예약 전환·복수 증빙', () => {
  async function expiredMixedReceipts() {
    await seed('apple', 1);
    await db.execute({
      sql: `INSERT INTO store_transactions
        (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
        VALUES ('google-receipt','owner','google','google-key',?,'personal','sub-owner',?,?)`,
      args: [PLAY_PRODUCT, PAST, PAID],
    });
    await db.execute({
      sql: 'UPDATE subscriptions SET expires_at=?',
      args: [new Date(NOW.getTime() - 73 * 3600_000).toISOString()],
    });
  }
  async function schedulePersonal() {
    const plan = await loadPlanByKey(db, 'personal');
    await db.execute({
      sql: "UPDATE subscriptions SET next_plan_id=? WHERE id='sub-owner'",
      args: [plan!.id],
    });
  }
  async function replacementReceipts(
    provider: 'apple' | 'google',
    otherProvider: 'apple' | 'google',
    other: 'active' | 'hold' | 'expired',
  ) {
    // 로컬 해지 예약값으로 교차 스토어 가드가 통과해도 증빙 연결은 별도로 보호해야 한다.
    await seed(provider, 1);
    await db.execute({
      sql: `INSERT INTO store_transactions
        (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
        VALUES ('other-receipt','owner',?,'other-key',?,'personal','sub-owner',?,?)`,
      args: [otherProvider, productOf(otherProvider), PAST, PAID],
    });
    await moveToOldPlan();
    await db.execute({
      sql: 'UPDATE subscriptions SET expires_at=?',
      args: [new Date(NOW.getTime() - 73 * 3600_000).toISOString()],
    });
    const otherExpiry = new Date(Date.parse(FUTURE) - 86400_000).toISOString();
    vi.mocked(fetchAppleSubscriptionStatus).mockImplementation(async (key) => ({
      status: key !== 'other-key' ? 1 : other === 'hold' ? 3 : other === 'expired' ? 2 : 1,
      expiresDate: Date.parse(key === 'other-key' ? otherExpiry : FUTURE),
      purchaseDate: Date.parse(PAID),
      autoRenewStatus: 0,
      productId: APPLE_PRODUCT,
    }));
    vi.mocked(getPlaySubscriptionV2).mockImplementation(async (_env, key) => ({
      subscriptionState:
        key === 'other-key' && other === 'hold'
          ? 'SUBSCRIPTION_STATE_ON_HOLD'
          : key === 'other-key' && other === 'expired'
            ? 'SUBSCRIPTION_STATE_EXPIRED'
            : 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [
        {
          productId: PLAY_PRODUCT,
          expiryTime:
            key !== 'other-key'
              ? FUTURE
              : other === 'hold' || other === 'expired'
                ? PAST
                : otherExpiry,
          latestSuccessfulOrderId: 'order-1',
          autoRenewingPlan: { autoRenewEnabled: false },
        },
      ],
    }));
  }

  // 구매 전 조회는 구독 id 순으로 본다 — 교체할 `sub-owner` 를 먼저 보도록 형제 행 id 를 그 뒤에 둔다.
  async function splitOtherReceiptToSibling(expiresAt = FUTURE) {
    await db.execute({
      sql: `INSERT INTO subscriptions
        (id,user_id,plan_id,status,starts_at,expires_at,cancel_at_period_end)
        VALUES ('sub-sibling','owner',?,'active',?,?,1)`,
      args: [OLD_PLAN_ID, PAID, expiresAt],
    });
    await db.execute(
      "UPDATE store_transactions SET subscription_id='sub-sibling' WHERE id='other-receipt'",
    );
  }

  const billingSnapshot = () =>
    Promise.all(
      ['users', 'subscriptions', 'store_transactions', 'paid_voice_retention'].map((table) =>
        rows(`SELECT * FROM ${table} ORDER BY 1`),
      ),
    );

  it.each([
    ['apple', 'apple', 'active', FUTURE],
    ['google', 'google', 'active', FUTURE],
    ['apple', 'google', 'active', FUTURE],
    ['google', 'apple', 'active', FUTURE],
    ['apple', 'apple', 'hold', PAST],
    ['google', 'google', 'hold', PAST],
    ['apple', 'google', 'expired', PAST],
    ['google', 'apple', 'expired', PAST],
  ] as const)(
    '%s 교체는 다른 활성 행의 %s %s 증빙도 별도 종료 전까지 보호한다(%s)',
    async (provider, otherProvider, other, expiry) => {
      await replacementReceipts(provider, otherProvider, other);
      await splitOtherReceiptToSibling(expiry);
      const before = await billingSnapshot();
      await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toMatchObject({
        message: 'Plan replacement needs sibling store subscriptions to be terminated',
        allowForcedExpiry: false,
      });
      expect(await billingSnapshot()).toEqual(before);
      // 다른 행은 이번 조회의 states 밖이다. 만료 상태도 실제로 조회/반영하기 전엔 못 버린다.
      const fetched = [
        ...vi.mocked(fetchAppleSubscriptionStatus).mock.calls.map(([key]) => key),
        ...vi.mocked(getPlaySubscriptionV2).mock.calls.map(([, key]) => key),
      ];
      expect(fetched).toEqual(['receipt-key']);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
    },
  );

  it('다른 행의 증빙으로 거절한 교체는 72시간 크론으로도 강제 종료하지 않는다', async () => {
    await replacementReceipts('google', 'google', 'active');
    await splitOtherReceiptToSibling();
    const before = await billingSnapshot();
    // sub-owner는 이미 73시간 만료, sub-sibling은 미래라 이번 크론 조회 대상이 아니다.
    await processSubscriptionExpiry(db, ENV, NOW);
    expect(await billingSnapshot()).toEqual(before);
    expect(sendPlanChangedPush).not.toHaveBeenCalled();
    expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
  });

  it.each(['apple', 'google'] as const)(
    '%s 조회 중 다른 활성 구독/증빙이 추가돼도 교체 직전에 발견한다',
    async (provider) => {
      await seed(provider, 1);
      await moveToOldPlan();
      const insertSibling = async () => {
        await splitOtherReceiptToSibling();
        await db.execute({
          sql: `INSERT INTO store_transactions
            (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
            VALUES ('other-receipt','owner',?,'other-key',?,'personal_old','sub-sibling',?,?)`,
          args: [provider, productOf(provider), FUTURE, PAID],
        });
      };
      let afterConcurrentWrite: Awaited<ReturnType<typeof billingSnapshot>> | undefined;
      if (provider === 'apple') {
        vi.mocked(fetchAppleSubscriptionStatus).mockImplementationOnce(async () => {
          await insertSibling();
          afterConcurrentWrite = await billingSnapshot();
          return {
            status: 1,
            productId: APPLE_PRODUCT,
            expiresDate: Date.parse(FUTURE),
            purchaseDate: Date.parse(PAID),
            autoRenewStatus: 0,
          };
        });
      } else {
        vi.mocked(getPlaySubscriptionV2).mockImplementationOnce(async () => {
          await insertSibling();
          afterConcurrentWrite = await billingSnapshot();
          return {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            lineItems: [
              {
                productId: PLAY_PRODUCT,
                expiryTime: FUTURE,
                latestSuccessfulOrderId: 'order-1',
                autoRenewingPlan: { autoRenewEnabled: false },
              },
            ],
          };
        });
      }
      await expect(reconcileStoreSubscription(db, ENV, 'sub-owner', NOW)).rejects.toMatchObject({
        message: 'Plan replacement needs sibling store subscriptions to be terminated',
        allowForcedExpiry: false,
      });
      expect(afterConcurrentWrite).toBeDefined();
      expect(await billingSnapshot()).toEqual(afterConcurrentWrite);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
    },
  );

  it.each(['apple', 'google'] as const)(
    '%s 다른 구독의 권위 종료를 별도로 반영한 뒤에는 교체를 허용한다',
    async (provider) => {
      await replacementReceipts(provider, provider, 'expired');
      await splitOtherReceiptToSibling(PAST);
      await expect(reconcileStoreSubscription(db, ENV, 'sub-owner', NOW)).rejects.toMatchObject({
        allowForcedExpiry: false,
      });
      await reconcileStoreSubscription(db, ENV, 'sub-sibling', NOW);
      expect(
        (await rows("SELECT status FROM subscriptions WHERE id='sub-sibling'"))[0]!.status,
      ).toBe('cancelled');
      await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        await rows(`SELECT t.provider_transaction_id FROM store_transactions t
        JOIN subscriptions s ON s.id=t.subscription_id WHERE s.status='active'`),
      ).toEqual([{ provider_transaction_id: 'receipt-key' }]);
      expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
    },
  );

  it('다른 활성 구독의 증빙은 플랜 교체 없는 갱신을 막지 않는다', async () => {
    await seed('apple', 1);
    await db.execute({
      sql: `INSERT INTO store_transactions
        (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
        VALUES ('other-receipt','owner','apple','other-key',?,'personal','sub-owner',?,?)`,
      args: [APPLE_PRODUCT, PAST, PAID],
    });
    await splitOtherReceiptToSibling();
    apple();
    await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
    expect(await rows('SELECT id,status FROM subscriptions ORDER BY id')).toEqual([
      { id: 'sub-owner', status: 'active' },
      { id: 'sub-sibling', status: 'active' },
    ]);
    expect(await rows('SELECT id,subscription_id FROM store_transactions ORDER BY id')).toEqual([
      { id: 'other-receipt', subscription_id: 'sub-sibling' },
      { id: 'receipt', subscription_id: 'sub-owner' },
    ]);
  });

  it('스토어 증빙 없는 다른 로컬 이용권은 기존 교체 규칙을 유지한다', async () => {
    await replacementReceipts('google', 'google', 'active');
    await splitOtherReceiptToSibling();
    await db.execute("DELETE FROM store_transactions WHERE id='other-receipt'");
    await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    expect(
      (await rows("SELECT status FROM subscriptions WHERE id='sub-sibling'"))[0]!.status,
    ).toBe('cancelled');
  });

  it.each([
    ['apple', 'google', 'active'],
    ['google', 'apple', 'active'],
    ['apple', 'apple', 'active'],
    ['google', 'google', 'active'],
    ['apple', 'google', 'hold'],
    ['google', 'apple', 'hold'],
  ] as const)(
    '%s 플랜 교체는 조회 성공한 다른 %s %s 증빙을 취소된 구독에 버리지 않는다',
    async (provider, otherProvider, other) => {
      await replacementReceipts(provider, otherProvider, other);
      const before = await billingSnapshot();
      await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toMatchObject({
        message: 'Plan replacement needs every other receipt to be terminated',
        allowForcedExpiry: false,
      });
      expect(await billingSnapshot()).toEqual(before);
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(await billingSnapshot()).toEqual(before);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
      expect(sendPaymentFailedPush).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['apple', 'google'],
    ['google', 'apple'],
  ] as const)(
    '%s 플랜 교체는 다른 %s 증빙이 종료됐으면 허용한다',
    async (provider, otherProvider) => {
      await replacementReceipts(provider, otherProvider, 'expired');
      await reconcileBillingPreflight(db, ENV, 'owner', NOW);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      const liveReceipts = await rows(`SELECT t.provider_transaction_id FROM store_transactions t
        JOIN subscriptions s ON s.id=t.subscription_id WHERE s.status='active'`);
      expect(liveReceipts).toEqual([{ provider_transaction_id: 'receipt-key' }]);
      expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
    },
  );
  it('플랜 교체 없는 복수 정상 영수증 갱신은 연결을 모두 보존한다', async () => {
    await expiredMixedReceipts();
    playState();
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(await rows('SELECT DISTINCT subscription_id FROM store_transactions')).toEqual([
      { subscription_id: 'sub-owner' },
    ]);
    expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
    expect(
      (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
    ).toBe(FUTURE);
  });

  it.each([
    ['apple', 2, 'preflight'],
    ['apple', 5, 'preflight'],
    ['apple', 2, 'cron'],
    ['apple', 5, 'cron'],
    ['google', 'SUBSCRIPTION_STATE_EXPIRED', 'preflight'],
    ['google', 'SUBSCRIPTION_STATE_CANCELED', 'preflight'],
    ['google', 'SUBSCRIPTION_STATE_EXPIRED', 'cron'],
    ['google', 'SUBSCRIPTION_STATE_CANCELED', 'cron'],
  ] as const)(
    '%s %s 종료의 예약 플랜은 %s에서도 한 번만 생성된다',
    async (provider, state, entry) => {
      await seed(provider, 1);
      await schedulePersonal();
      if (provider === 'apple') apple({ status: Number(state) });
      else playState(String(state));
      const reconcile = () =>
        entry === 'cron'
          ? processSubscriptionExpiry(db, ENV, NOW)
          : reconcileBillingPreflight(db, ENV, 'owner', NOW);
      await reconcile();
      await reconcile();
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        await rows("SELECT * FROM subscriptions WHERE user_id='owner' AND status='active'"),
      ).toHaveLength(1);
      expect(await rows("SELECT * FROM paid_voice_retention WHERE user_id='owner'")).toHaveLength(
        0,
      );
    },
  );
  it('만기 전 환불은 다음 플랜을 조기에 지급하지 않는다', async () => {
    await seed('apple', 1);
    await schedulePersonal();
    await db.execute({
      sql: "UPDATE subscriptions SET expires_at=? WHERE id='sub-owner'",
      args: [FUTURE],
    });
    apple({ status: 5 });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
  });
  it('예약 플랜 생성 실패는 종료도 롤백한다', async () => {
    await seed('apple', 1);
    await schedulePersonal();
    apple({ status: 2 });
    await db.execute(`CREATE TRIGGER fail_next_plan BEFORE INSERT ON subscriptions
      BEGIN SELECT RAISE(ABORT, 'scheduled creation failed'); END`);
    try {
      await expect(processSubscriptionExpiry(db, ENV, NOW)).rejects.toThrow(
        'scheduled creation failed',
      );
      expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner' },
      ]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
    } finally {
      await db.execute('DROP TRIGGER fail_next_plan');
    }
  });
  it.each(['apple', 'google'] as const)(
    '%s 유효 증빙은 다른 조회의 실패와 72시간 경계를 이긴다',
    async (valid) => {
      await expiredMixedReceipts();
      if (valid === 'apple') {
        apple({ autoRenewStatus: 0 });
        vi.mocked(getPlaySubscriptionV2).mockRejectedValue(new Error('old Play unavailable'));
      } else {
        playState();
        vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(
          new Error('old Apple unavailable'),
        );
      }
      await processSubscriptionExpiry(db, ENV, NOW);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
      ).toBe(FUTURE);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      // 모르는 쪽의 자동갱신까지 꺼졌다고 답하면 교차 스토어 결제를 열어 주므로 보수적으로 유지.
      expect(
        (await rows("SELECT cancel_at_period_end FROM subscriptions WHERE id='sub-owner'"))[0]!
          .cancel_at_period_end,
      ).toBe(0);
    },
  );
  it.each(['apple', 'google'] as const)(
    '%s 보류 증빙도 다른 조회 실패만으로 구독을 끝내지 않는다',
    async (valid) => {
      await expiredMixedReceipts();
      if (valid === 'apple') {
        apple({ status: 3 });
        vi.mocked(getPlaySubscriptionV2).mockRejectedValue(new Error('Play unavailable'));
      } else {
        playState('SUBSCRIPTION_STATE_ON_HOLD');
        vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('Apple unavailable'));
      }
      await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toMatchObject({
        allowForcedExpiry: false,
      });
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner' },
      ]);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
    },
  );
  it.each(['apple', 'google'] as const)(
    '%s만 확인된 플랜 교체는 미확인 증빙을 버리거나 강제 만료하지 않는다',
    async (valid) => {
      await expiredMixedReceipts();
      await moveToOldPlan();
      if (valid === 'apple') {
        apple();
        vi.mocked(getPlaySubscriptionV2).mockRejectedValue(new Error('Play unavailable'));
      } else {
        playState();
        vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('Apple unavailable'));
      }
      await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toMatchObject({
        message: 'Plan replacement needs every other receipt to be terminated',
        allowForcedExpiry: false,
      });
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner' },
      ]);
      expect(await rows('SELECT DISTINCT subscription_id FROM store_transactions')).toEqual([
        { subscription_id: 'sub-owner' },
      ]);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
    },
  );
  it('권한은 유효하지만 주문 날짜 조회가 실패하면 72시간 강제 만료하지 않는다', async () => {
    await seed('google');
    await db.execute({
      sql: 'UPDATE subscriptions SET expires_at=?',
      args: [new Date(NOW.getTime() - 73 * 3600_000).toISOString()],
    });
    playState();
    vi.mocked(googlePaymentAnchor).mockRejectedValue(new Error('Orders unavailable'));
    await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toBeInstanceOf(
      BillingStateUnavailableError,
    );
    await processSubscriptionExpiry(db, ENV, NOW);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
    expect((await rows('SELECT last_paid_at FROM store_transactions'))[0]!.last_paid_at).toBe(PAID);
  });
  it.each(['apple', 'google'] as const)(
    '%s 플랜 교체는 커밋한 뒤 구매자에게 알린다',
    async (provider) => {
      await seed(provider);
      await moveToOldPlan();
      if (provider === 'apple') apple();
      else playState();
      let notified: { ids: string[]; active: unknown[] } | undefined;
      vi.mocked(sendPlanChangedPush).mockImplementationOnce(async (_db, _env, ids) => {
        // 별도 DB 읽기로 커밋 후 통지임을 확인한다.
        notified = {
          ids: [...ids],
          active: await rows("SELECT plan_id FROM subscriptions WHERE status='active'"),
        };
      });
      await reconcileBillingPreflight(db, ENV, 'owner', NOW);
      expect(sendPlanChangedPush).toHaveBeenCalledTimes(1);
      // 푸시 오류는 호출부가 삼키므로 커밋 시점의 단언은 콜백 밖에서 한다.
      expect(notified).toEqual({ ids: ['owner'], active: [{ plan_id: personalPlanId }] });
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    },
  );

  it('옛 유예 해제 실패는 플랜 교체 전체를 롤백하고 통지하지 않는다', async () => {
    await seed();
    await moveToOldPlan();
    await db.execute({
      sql: "INSERT INTO paid_voice_retention(user_id,delete_after) VALUES ('owner',?)",
      args: [FUTURE],
    });
    apple();
    const before = await billingSnapshot();
    await db.execute(`CREATE TRIGGER fail_owner_retention_clear BEFORE DELETE ON paid_voice_retention
      WHEN OLD.user_id='owner' BEGIN SELECT RAISE(ABORT, 'retention clear failed'); END`);
    try {
      await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toThrow(
        'retention clear failed',
      );
      expect(await billingSnapshot()).toEqual(before);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
    } finally {
      await db.execute('DROP TRIGGER fail_owner_retention_clear');
    }
  });
});

describe('경계값·재시도·독립 이용권 보존', () => {
  it('애플이 양쪽 환경에서 체인 없음을 확인한 경우는 최종 만료다', async () => {
    await seed();
    vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValueOnce(
      new AppleTransactionNotFoundError(),
    );
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
  });
  it.each([0, 1])(
    '예약해지 %i 의 보류 통지는 한 번이고 무음 통지를 중복하지 않는다',
    async (cancel) => {
      await seed('apple', cancel);
      apple({ status: 3 });
      await processSubscriptionExpiry(db, ENV, NOW);
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(sendPaymentFailedPush).toHaveBeenCalledTimes(1);
      expect(sendPaymentFailedPush).toHaveBeenCalledWith(db, ENV, { ownerUserPk: 'owner' });
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
    },
  );
  it('푸시 키가 없어도 보류를 적용하고 발송은 생략한다', async () => {
    await seed();
    apple({ status: 3 });
    await processSubscriptionExpiry(db, { ...ENV, APNS_KEY_ID: undefined }, NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
    expect(sendPaymentFailedPush).not.toHaveBeenCalled();
  });
  it('푸시 실패는 커밋된 보류와 다음 회차를 실패시키지 않는다', async () => {
    await seed();
    apple({ status: 3 });
    vi.mocked(sendPaymentFailedPush).mockRejectedValueOnce(new Error('push unavailable'));
    await expect(processSubscriptionExpiry(db, ENV, NOW)).resolves.toBeUndefined();
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
  });
  it('보류 시 같은 사람의 다른 개인 이용권을 보존한다', async () => {
    await seed();
    apple({ status: 3 });
    await db.execute({
      sql: `INSERT INTO subscriptions(id,user_id,plan_id,status,starts_at,expires_at)
      VALUES ('independent', 'owner', ?, 'active', ?, ?)`,
      args: [personalPlanId, NOW.toISOString(), FUTURE],
    });
    await processSubscriptionExpiry(db, ENV, NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    expect((await rows("SELECT status FROM subscriptions WHERE id='independent'"))[0]!.status).toBe(
      'active',
    );
    // 등급이 그대로이니 결제 실패 안내도 없다.
    expect(sendPaymentFailedPush).not.toHaveBeenCalled();
  });
  it.each(['apple', 'google'] as const)(
    '%s 조회 실패는 72시간 후에만 최종 만료한다',
    async (provider) => {
      await seed(provider);
      const oldExpiry = new Date(NOW.getTime() - 73 * 3600_000).toISOString();
      await db.execute({ sql: 'UPDATE subscriptions SET expires_at=?', args: [oldExpiry] });
      vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValueOnce(new Error('unavailable'));
      vi.mocked(getPlaySubscriptionV2).mockRejectedValueOnce(new Error('unavailable'));
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
      expect(await rows('SELECT user_id FROM paid_voice_retention')).toEqual([
        { user_id: 'owner' },
      ]);
    },
  );
  it.each(['apple', 'google'] as const)(
    '%s 자격 누락도 최근 만료를 삭제할 근거가 아니다',
    async (provider) => {
      await seed(provider);
      vi.mocked(getPlaySubscriptionV2).mockRejectedValueOnce(new Error('unconfigured'));
      await expect(reconcileBillingPreflight(db, {}, 'owner', NOW)).rejects.toThrow();
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(1);
    },
  );
  it('해지 예약 해제와 활성 복원은 둘 다 상태 조회로 반영한다', async () => {
    await seed('apple', 1);
    apple({ autoRenewStatus: 1 });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(
      (await rows("SELECT cancel_at_period_end FROM subscriptions WHERE id='sub-owner'"))[0]!
        .cancel_at_period_end,
    ).toBe(0);
    apple({ autoRenewStatus: 0 });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(
      (await rows("SELECT cancel_at_period_end FROM subscriptions WHERE id='sub-owner'"))[0]!
        .cancel_at_period_end,
    ).toBe(1);
  });
  it('조회 뒤 기간이 갱신됐으면 이전 만료를 적용하지 않는다', async () => {
    await seed();
    await db.execute({
      sql: "UPDATE subscriptions SET expires_at=? WHERE id='sub-owner'",
      args: [FUTURE],
    });
    expect(await expireSubscriptionIfDue(db, 'sub-owner', PAST, NOW, false)).toEqual([]);
    expect(await rows("SELECT status,expires_at FROM subscriptions WHERE id='sub-owner'")).toEqual(
      [{ status: 'active', expires_at: FUTURE }],
    );
  });
  it('스토어 없는 예약 플랜 전환도 크론과 구매 전 조회가 같은 결과를 만든다', async () => {
    await seed('apple', 1);
    await db.execute('DELETE FROM store_transactions');
    const personal = await loadPlanByKey(db, 'personal');
    await db.execute({
      sql: "UPDATE subscriptions SET next_plan_id=? WHERE id='sub-owner'",
      args: [personal!.id],
    });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    expect(await rows("SELECT plan_id FROM subscriptions WHERE status='active'")).toEqual([
      { plan_id: personal!.id },
    ]);
    expect(await rows("SELECT * FROM paid_voice_retention WHERE user_id='owner'")).toHaveLength(0);
  });
  it('결제일 없는 ACTIVE 는 현재 시각을 결제일로 지어내지 않는다', async () => {
    await seed();
    apple({ purchaseDate: undefined });
    await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toThrow();
    expect((await rows('SELECT last_paid_at FROM store_transactions'))[0]!.last_paid_at).toBe(PAID);
  });
  it('같은 주문의 재전송이나 유예 연장은 결제일을 바꾸지 않는다', async () => {
    await seed();
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    const graceEnd = new Date(Date.parse(FUTURE) + 7 * 86400_000).getTime();
    apple({ status: 4, gracePeriodExpiresDate: graceEnd });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect((await rows('SELECT last_paid_at FROM store_transactions'))[0]!.last_paid_at).toBe(PAID);
  });
});

describe('결제 증빙 보존도 실제 원장으로 검증한다', () => {
  it('같은 구독의 여러 스토어 증빙 중 최신 한 건만 남기지 않는다', async () => {
    await seed();
    await db.execute({
      sql: `INSERT INTO store_transactions
      (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,last_paid_at)
      VALUES ('receipt-2','owner','google','receipt-second',?,'personal','sub-owner',?)`,
      args: [PLAY_PRODUCT, PAID],
    });
    await withWriteTransaction(db, (tx) =>
      pseudonymizeBillingForRetention(tx, 'owner', 'test-salt', NOW),
    );
    expect(
      await rows(
        'SELECT provider_transaction_id FROM retained_billing_records ORDER BY provider_transaction_id',
      ),
    ).toEqual([
      { provider_transaction_id: 'receipt-key' },
      { provider_transaction_id: 'receipt-second' },
    ]);
  });
  // 선물은 2026-10-14 에 없앴다(App Store 3.1.1) — 그 전에 쓰인 일회성 결제 행은 이력으로 남아 같은 규칙을 탄다.
  it('옛 선물 결제 기록도 서버 수신일이 아니라 실제 구매일부터 보존한다', async () => {
    await seed();
    await db.execute({
      sql: `INSERT INTO store_transactions
      (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,last_paid_at)
      VALUES ('gift-receipt','owner','google','gift-order','personal_gift_1m','personal',NULL,?)`,
      args: [PAID],
    });
    await withWriteTransaction(db, (tx) =>
      pseudonymizeBillingForRetention(tx, 'owner', 'test-salt', NOW),
    );
    const gift = (
      await rows(
        "SELECT starts_at,retain_until FROM retained_billing_records WHERE provider_transaction_id='gift-order'",
      )
    )[0]!;
    expect(gift.starts_at).toBe(PAID);
    expect(gift.retain_until).toBe(billingRetentionUntil(new Date(PAID)).toISOString());
  });
});

describe('RTDN 도 동일한 실제 DB 상태 전이를 사용한다', () => {
  function play(state: string, expiryTime = FUTURE) {
    const status = {
      subscriptionState: state,
      lineItems: [{ productId: PLAY_PRODUCT, expiryTime, latestSuccessfulOrderId: 'order-1' }],
    };
    vi.mocked(getPlaySubscriptionV2).mockResolvedValue(status);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(status))),
    );
  }
  async function notify(purchaseToken = 'receipt-key') {
    const app = new Hono<AppEnv>();
    app.route('/billing/google', billingGoogleRtdn);
    return app.request(
      '/billing/google/rtdn?token=test-rtdn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            data: Buffer.from(
              JSON.stringify({
                packageName: ENV.ANDROID_PACKAGE_NAME,
                subscriptionNotification: {
                  purchaseToken,
                  subscriptionId: PLAY_PRODUCT,
                  notificationType: 2,
                },
              }),
            ).toString('base64'),
          },
        }),
      },
      ENV,
    );
  }
  async function linkedPurchase(state: string, expiryTime = FUTURE) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('owner'));
    const accountId = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const next = {
      subscriptionState: state,
      linkedPurchaseToken: 'receipt-key',
      externalAccountIdentifiers: { obfuscatedExternalAccountId: accountId },
      lineItems: [{ productId: PLAY_PRODUCT, expiryTime, latestSuccessfulOrderId: 'new-order' }],
    };
    vi.mocked(getPlaySubscriptionV2).mockImplementation(async (_env, token) =>
      token === 'new-key'
        ? next
        : {
            subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
            lineItems: [{ productId: PLAY_PRODUCT, expiryTime: PAST }],
          },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(next))),
    );
    return next;
  }
  it('새 토큰의 첫 CANCELED도 남은 기간을 보존하고 늦은 옛 RTDN을 견딘다', async () => {
    await seed('google', 1);
    await linkedPurchase('SUBSCRIPTION_STATE_CANCELED');
    expect((await notify('new-key')).status).toBe(200);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    expect(
      (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
    ).toBe(FUTURE);
    expect(
      await rows(
        "SELECT subscription_id,last_paid_at FROM store_transactions WHERE provider_transaction_id='new-key'",
      ),
    ).toEqual([{ subscription_id: 'sub-owner', last_paid_at: PAID }]);
    // 옛 토큰의 직접 조회는 EXPIRED이지만 공통 정합화에는 새 토큰도 포함된다.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
              lineItems: [{ productId: PLAY_PRODUCT, expiryTime: PAST }],
            }),
          ),
      ),
    );
    expect((await notify()).status).toBe(200);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
  });
  it.each(['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED'])(
    '새 토큰의 첫 %s는 이전 토큰 만료와 구분하고 복구 때 같은 구독을 살린다',
    async (state) => {
      await seed('google', 1);
      await linkedPurchase(state, PAST);
      expect((await notify('new-key')).status).toBe(200);
      expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner' },
      ]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
      expect(
        (await rows("SELECT cancel_at_period_end FROM subscriptions WHERE id='sub-owner'"))[0]!
          .cancel_at_period_end,
      ).toBe(0);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      const recovered = await linkedPurchase('SUBSCRIPTION_STATE_ACTIVE');
      // 앱 confirm 없이 크론이 새 토큰을 다시 읽어도 복구해야 한다.
      await processSubscriptionExpiry(db, ENV, NOW);
      expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner' },
      ]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
      ).toBe(recovered.lineItems[0]!.expiryTime);
    },
  );
  it.each(['SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_CANCELED'])(
    '새 토큰도 %s로 실제 만료된 경우에만 구독을 종료한다',
    async (state) => {
      await seed('google');
      await linkedPurchase(state, PAST);
      expect((await notify('new-key')).status).toBe(200);
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
      expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
      expect(await rows('SELECT user_id FROM paid_voice_retention')).toEqual([
        { user_id: 'owner' },
      ]);
    },
  );
  it('연결 기록 뒤 재조회 실패에도 새 토큰을 남겨 다음 재시도가 옛 토큰만 보지 않는다', async () => {
    await seed('google');
    const next = await linkedPurchase('SUBSCRIPTION_STATE_ON_HOLD', PAST);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        vi.mocked(getPlaySubscriptionV2).mockRejectedValue(new Error('temporary outage'));
        return new Response(JSON.stringify(next));
      }),
    );
    expect((await notify('new-key')).status).toBe(502);
    expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    await linkedPurchase('SUBSCRIPTION_STATE_ON_HOLD', PAST);
    expect((await notify('new-key')).status).toBe(200);
    expect(await rows('SELECT * FROM store_transactions')).toHaveLength(2);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
  });
  it('마지막 새 토큰 응답의 계정 바인딩이 다르면 연결과 이전 구독을 바꾸지 않는다', async () => {
    await seed('google');
    const next = await linkedPurchase('SUBSCRIPTION_STATE_CANCELED');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...next,
              externalAccountIdentifiers: { obfuscatedExternalAccountId: 'different-account' },
            }),
          ),
      ),
    );
    expect((await notify('new-key')).status).toBe(502);
    expect(await rows('SELECT * FROM store_transactions')).toHaveLength(1);
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    expect(sendPlanChangedPush).not.toHaveBeenCalled();
  });
  it('주문 조회 중 confirm이 새 토큰을 연결하면 그 최신 기록을 덮지 않는다', async () => {
    await seed('google');
    await linkedPurchase('SUBSCRIPTION_STATE_CANCELED');
    vi.mocked(googlePaymentAnchor).mockImplementationOnce(async () => {
      await db.execute({
        sql: `INSERT INTO store_transactions
          (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
          VALUES ('confirmed','owner','google','new-key',?,'personal','sub-owner',?,?)`,
        args: [PLAY_PRODUCT, FUTURE, NOW.toISOString()],
      });
      return new Date(PAID);
    });
    expect((await notify('new-key')).status).toBe(502);
    expect(
      (await rows("SELECT last_paid_at FROM store_transactions WHERE id='confirmed'"))[0]!
        .last_paid_at,
    ).toBe(NOW.toISOString());
    expect(await rows("SELECT id FROM subscriptions WHERE status='active'")).toEqual([
      { id: 'sub-owner' },
    ]);
    expect(sendPlanChangedPush).not.toHaveBeenCalled();
  });
  it.each([
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED',
  ])('%s 는 소유자의 등급과 기간을 복구한다', async (state) => {
    await seed('google');
    play(state);
    await db.execute("UPDATE users SET plan='free' WHERE id='owner'");
    expect((await notify()).status).toBe(200);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    expect(
      (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
    ).toBe(FUTURE);
  });
  it.each(['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED'])(
    '%s 는 구독 보존·권한 회수·중복 안내 방지를 적용한다',
    async (state) => {
      await seed('google');
      play(state);
      expect((await notify()).status).toBe(200);
      expect((await notify()).status).toBe(200);
      expect(await rows("SELECT id,entitlement_state FROM subscriptions WHERE status='active'")).toEqual([
        { id: 'sub-owner', entitlement_state: 'suspended' },
      ]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
      expect(sendPaymentFailedPush).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_CANCELED'])(
    '%s + 지난 만료만 실제 종료한다',
    async (state) => {
      await seed('google');
      play(state, PAST);
      expect((await notify()).status).toBe(200);
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
      expect(await rows('SELECT user_id FROM paid_voice_retention')).toEqual([
        { user_id: 'owner' },
      ]);
    },
  );
  it.each(['', 'SUBSCRIPTION_STATE_UNKNOWN', 'SUBSCRIPTION_STATE_PENDING'])(
    '미확정 상태 %s 는 종료로 바꾸지 않고 재시도한다',
    async (state) => {
      await seed('google');
      play(state);
      expect((await notify()).status).toBe(502);
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(1);
    },
  );
});

describe('스토어 정합화 — 실제 DB 상태 전이', () => {
  it.each([0, 1])('갱신은 구독 기간을 연장한다 (예약해지=%i)', async (cancel) => {
    await seed('apple', cancel);
    await processSubscriptionExpiry(db, ENV, NOW);
    expect(await rows('SELECT expires_at, status FROM subscriptions')).toEqual([
      expect.objectContaining({ expires_at: FUTURE, status: 'active' }),
    ]);
    expect((await rows('SELECT last_paid_at FROM store_transactions'))[0]!.last_paid_at).toBe(PAID);
  });

  it.each([2, 5])(
    '애플 종료 상태 %i 는 미래 expiresDate 가 있어도 권한을 회수한다',
    async (status) => {
      await seed();
      apple({ status });
      await reconcileBillingPreflight(db, ENV, 'owner', NOW);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
      expect(await rows("SELECT * FROM subscriptions WHERE status='active'")).toHaveLength(0);
    },
  );

  it('애플 유예는 결제기간 만료가 지난 뒤에도 gracePeriodExpiresDate 까지 유지한다', async () => {
    await seed();
    apple({ status: 4, expiresDate: Date.parse(PAST), gracePeriodExpiresDate: Date.parse(FUTURE) });
    await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
    expect(
      (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
    ).toBe(FUTURE);
  });

  it('보류는 구독을 보존하고 한 번만 알리며, 복구하면 권한이 돌아온다', async () => {
    await seed();
    apple({ status: 3 });
    await processSubscriptionExpiry(db, ENV, NOW);
    await processSubscriptionExpiry(db, ENV, NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
    expect(await rows("SELECT status,entitlement_state FROM subscriptions WHERE id='sub-owner'")).toEqual([
      { status: 'active', entitlement_state: 'suspended' },
    ]);
    expect(sendPaymentFailedPush).toHaveBeenCalledTimes(1);
    expect(sendPaymentFailedPush).toHaveBeenCalledWith(db, ENV, { ownerUserPk: 'owner' });
    apple();
    await processSubscriptionExpiry(db, ENV, NOW);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
    expect(vi.mocked(sendPlanChangedPush).mock.calls.flatMap((call) => call[2])).toContain('owner');
  });

  it.each(['apple', 'google'] as const)(
    '%s 같은 상품의 복구·갱신은 등급이 실제로 바뀐 경우에만 구매자를 알린다',
    async (provider) => {
      await seed(provider);
      await db.execute({
        sql: "UPDATE subscriptions SET expires_at=? WHERE id='sub-owner'",
        args: [FUTURE],
      });
      await db.execute({
        sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,entitlement_state,starts_at,expires_at)
              VALUES ('personal-recovery','owner',?,'active','suspended',?,?)`,
        args: [personalPlanId, NOW.toISOString(), PAST],
      });
      await db.execute({
        sql: `INSERT INTO store_transactions
              (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
              VALUES ('personal-receipt','owner',?,'personal-token',?,'personal','personal-recovery',?,?)`,
        args: [provider, productOf(provider), PAST, PAID],
      });
      const personal = (await loadPlanByKey(db, 'personal'))!;
      const input = {
        userPk: 'owner',
        provider,
        providerTransactionId: 'personal-token',
        productId: productOf(provider),
        plan: personal,
        startsAt: new Date(PAID),
        expiresAt: new Date(FUTURE),
        lastPaidAt: new Date(PAID),
        promoCoversFree: false,
      };
      // 다른 구독으로 이미 유료라 등급이 그대로다 — 다시 읽으라고 알릴 이유가 없다.
      const recovered = await withWriteTransaction(db, (tx) => applyStoreEntitlement(tx, input));
      expect(recovered.ok && recovered.planChangedUserIds).toEqual([]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT entitlement_state FROM subscriptions WHERE id='personal-recovery'"))[0]!
          .entitlement_state,
      ).toBe('entitled');

      // 이미 옛 경로가 잘못 내린 스냅샷도 갱신 때 복구하고 구매자에게 알려야 한다.
      await db.execute("UPDATE users SET plan='free' WHERE id='owner'");
      const repaired = await withWriteTransaction(db, (tx) => applyStoreEntitlement(tx, input));
      expect(repaired.ok && repaired.planChangedUserIds).toEqual(['owner']);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      const replayed = await withWriteTransaction(db, (tx) => applyStoreEntitlement(tx, input));
      expect(replayed.ok && replayed.planChangedUserIds).toEqual([]);
    },
  );

  it.each(['apple', 'google'] as const)(
    '%s 보류는 다른 개인 구독 종료 뒤에도 유지되고 스토어 복구만 해제한다',
    async (provider) => {
      await seed(provider);
      await db.execute({
        sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
              VALUES ('independent','owner',?,'active',?,?)`,
        args: [personalPlanId, NOW.toISOString(), FUTURE],
      });
      if (provider === 'apple') apple({ status: 3 });
      else playState('SUBSCRIPTION_STATE_ON_HOLD');
      await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
      // 다른 개인 구독이 살아 있어 등급은 그대로다.
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      const independent = (await findActiveSubscriptionsByUserPk(db, 'owner')).find(
        (sub) => sub.subscriptionId === 'independent',
      )!;
      await withWriteTransaction(db, (tx) =>
        cancelSubscriptionImmediate(tx, independent, NOW, { deleteVoiceData: false }),
      );
      // 별도 요청의 재계산에도 지난 보류가 남아 있어야 한다.
      await withWriteTransaction(db, (tx) => resolvePlanAfterSuspend(tx, 'owner', []));
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('free');
      expect(
        await rows("SELECT status,entitlement_state FROM subscriptions WHERE id='sub-owner'"),
      ).toEqual([{ status: 'active', entitlement_state: 'suspended' }]);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);

      vi.clearAllMocks();
      if (provider === 'apple') apple();
      else playState();
      await reconcileStoreSubscription(db, ENV, 'sub-owner', NOW);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT entitlement_state FROM subscriptions WHERE id='sub-owner'"))[0]!
          .entitlement_state,
      ).toBe('entitled');
      expect(vi.mocked(sendPlanChangedPush).mock.calls.flatMap((call) => call[2])).toContain(
        'owner',
      );
    },
  );

  it('보류 적용 실패는 구독의 보류 표식까지 함께 롤백한다', async () => {
    await seed();
    apple({ status: 3 });
    // 보류 표식을 적은 뒤 등급을 내리는 자리에서 실패시킨다.
    await db.execute(`CREATE TRIGGER fail_owner_hold BEFORE UPDATE OF plan ON users
      WHEN NEW.id='owner' BEGIN SELECT RAISE(ABORT, 'hold update failed'); END`);
    try {
      await expect(reconcileStoreSubscription(db, ENV, 'sub-owner', NOW)).rejects.toThrow(
        'hold update failed',
      );
      expect(await rows('SELECT entitlement_state FROM subscriptions')).toEqual([
        { entitlement_state: 'entitled' },
      ]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendPaymentFailedPush).not.toHaveBeenCalled();
    } finally {
      await db.execute('DROP TRIGGER fail_owner_hold');
    }
  });

  it.each([undefined, 99])('알 수 없는 애플 상태 %s 는 무료 강등 근거가 아니다', async (status) => {
    await seed();
    apple({ status: status as number });
    await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toThrow();
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
  });

  it('스토어 장애는 preflight 를 실패시키고, 크론도 72시간 이내에는 보류한다', async () => {
    await seed();
    vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('unavailable'));
    await expect(reconcileBillingPreflight(db, ENV, 'owner', NOW)).rejects.toThrow();
    await processSubscriptionExpiry(db, ENV, NOW);
    expect((await rows("SELECT status FROM subscriptions WHERE id='sub-owner'"))[0]!.status).toBe(
      'active',
    );
    expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
  });

  it('트랜잭션 중 오류는 구독·증빙의 일부 갱신을 남기지 않는다', async () => {
    await seed();
    await db.execute(`CREATE TRIGGER fail_receipt BEFORE UPDATE ON store_transactions
      BEGIN SELECT RAISE(ABORT, 'test write failure'); END`);
    try {
      await expect(reconcileStoreSubscription(db, ENV, 'sub-owner', NOW)).rejects.toThrow();
      expect(
        (await rows("SELECT expires_at FROM subscriptions WHERE id='sub-owner'"))[0]!.expires_at,
      ).toBe(PAST);
      expect((await rows('SELECT expires_at FROM store_transactions'))[0]!.expires_at).toBe(PAST);
    } finally {
      await db.execute('DROP TRIGGER fail_receipt');
    }
  });

  it('조회 중 새 구독으로 교체되면 이전 응답이 새 구독을 끝내지 않는다', async () => {
    await seed();
    vi.mocked(fetchAppleSubscriptionStatus).mockImplementationOnce(async () => {
      await withWriteTransaction(db, async (tx) => {
        const plan = await loadPlanByKey(tx, 'personal');
        await applyStoreEntitlement(tx, {
          userPk: 'owner',
          provider: 'apple',
          providerTransactionId: 'new-receipt',
          productId: APPLE_PRODUCT,
          plan: plan!,
          startsAt: NOW,
          expiresAt: new Date(FUTURE),
          promoCoversFree: false,
        });
      });
      return {
        status: 5,
        productId: APPLE_PRODUCT,
        expiresDate: Date.parse(FUTURE),
      };
    });
    await expect(reconcileStoreSubscription(db, ENV, 'sub-owner', NOW)).rejects.toThrow('changed');
    expect(
      await rows(`SELECT t.provider_transaction_id FROM subscriptions s
        JOIN store_transactions t ON t.subscription_id = s.id WHERE s.status='active'`),
    ).toEqual([{ provider_transaction_id: 'new-receipt' }]);
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
  });

  it('Play 자동갱신 해제도 조회로 반영하고 기간을 연장한다', async () => {
    await seed('google');
    vi.mocked(getPlaySubscriptionV2).mockResolvedValue({
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
      startTime: PAID,
      lineItems: [
        {
          productId: PLAY_PRODUCT,
          expiryTime: FUTURE,
          autoRenewingPlan: { autoRenewEnabled: false },
        },
      ],
    });
    await reconcileBillingPreflight(db, ENV, 'owner', NOW);
    expect(
      await rows("SELECT cancel_at_period_end,expires_at FROM subscriptions WHERE id='sub-owner'"),
    ).toEqual([{ cancel_at_period_end: 1, expires_at: FUTURE }]);
  });
});

describe('#730 즉시 해지 중 새 결제의 보관 유예', () => {
  function cancel() {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', 'owner');
      await next();
    });
    app.route('/billing', billingMutation);
    return app.request(
      '/billing/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'immediate' }),
      },
      ENV,
    );
  }

  async function confirmConcurrentPurchase() {
    await withWriteTransaction(db, async (tx) => {
      await tx.execute({
        sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          SELECT 'new-sub','owner',id,'active',?,? FROM plans WHERE key='personal'`,
        args: [NOW.toISOString(), FUTURE],
      });
      await tx.execute({
        sql: `INSERT INTO store_transactions
          (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
          VALUES ('new-receipt','owner','google','new-token','personal_monthly','personal','new-sub',?,?)`,
        args: [FUTURE, NOW.toISOString()],
      });
      await tx.execute("UPDATE users SET plan='plus' WHERE id='owner'");
    });
  }

  async function snapshot() {
    return Promise.all([
      rows('SELECT * FROM users ORDER BY id'),
      rows('SELECT * FROM subscriptions ORDER BY id'),
      rows('SELECT * FROM paid_voice_retention ORDER BY user_id'),
    ]);
  }

  for (const retained of [false, true]) {
    it(`Play 대기 중 새 유료 권한에는 삭제 예고와 기한을 붙이지 않는다(기존 유예=${retained})`, async () => {
      await seed('google');
      vi.mocked(playRevokeSubscription).mockImplementationOnce(async () => {
        await confirmConcurrentPurchase();
        // 옛 버전에서 남은 유예도 즉시 해지 트랜잭션이 지워야 한다.
        if (retained)
          await db.execute({
            sql: "INSERT INTO paid_voice_retention (user_id,delete_after) VALUES ('owner',?)",
            args: [FUTURE],
          });
      });
      let pushedSnapshot: Awaited<ReturnType<typeof snapshot>> | undefined;
      vi.mocked(sendPlanChangedPush).mockImplementationOnce(async () => {
        pushedSnapshot = await snapshot();
      });

      const response = await cancel();

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, voice_retention_until: null });
      expect(vi.mocked(playRevokeSubscription).mock.calls.map((call) => call[1])).toEqual([
        'receipt-key',
      ]);
      expect(await rows("SELECT status FROM subscriptions WHERE id='new-sub'")).toEqual([
        { status: 'active' },
      ]);
      expect(await rows("SELECT status FROM subscriptions WHERE id='sub-owner'")).toEqual([
        { status: 'cancelled' },
      ]);
      // 전체 마이그레이션이 만든 시스템 계정이 아니라 해지 영향 계정을 검증한다.
      expect(await rows('SELECT id,plan FROM users WHERE id = ?', ['owner'])).toEqual([
        { id: 'owner', plan: 'plus' },
      ]);
      expect(await rows('SELECT user_id FROM paid_voice_retention')).toEqual([]);
      expect(sendPlanChangedPush).toHaveBeenCalledWith(db, ENV, ['owner']);
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
      expect(pushedSnapshot).toBeDefined();
      expect(pushedSnapshot).toEqual(await snapshot());
    });
  }

  it('다른 유료 권한이 없으면 기한과 삭제 예고를 유지한다', async () => {
    await seed('google');
    const response = await cancel();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { voice_retention_until: string };
    expect(
      await rows('SELECT user_id,delete_after FROM paid_voice_retention ORDER BY user_id'),
    ).toEqual([{ user_id: 'owner', delete_after: body.voice_retention_until }]);
    expect(Date.parse(body.voice_retention_until)).toBeGreaterThan(NOW.getTime());
    expect(sendVoiceDeletionWarningPush).toHaveBeenCalledWith(db, ENV, {
      userPks: ['owner'],
      retentionDays: 3,
    });
  });

  it('유료 계정의 옛 유예 제거 실패는 해지까지 롤백하고 통지하지 않는다', async () => {
    await seed('google');
    let beforeCancel: Awaited<ReturnType<typeof snapshot>> | undefined;
    vi.mocked(playRevokeSubscription).mockImplementationOnce(async () => {
      await confirmConcurrentPurchase();
      await db.execute({
        sql: "INSERT INTO paid_voice_retention (user_id,delete_after) VALUES ('owner',?)",
        args: [FUTURE],
      });
      beforeCancel = await snapshot();
    });
    await db.execute(`CREATE TRIGGER fail_cancel_retention BEFORE DELETE ON paid_voice_retention
      WHEN OLD.user_id='owner' BEGIN SELECT RAISE(ABORT, 'retention failed'); END`);
    try {
      expect((await cancel()).status).toBe(500);
      expect(beforeCancel).toBeDefined();
      expect(await snapshot()).toEqual(beforeCancel);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
    } finally {
      await db.execute('DROP TRIGGER fail_cancel_retention');
    }
  });

  it('Play revoke 실패는 보관 상태와 DB를 바꾸거나 예고하지 않는다', async () => {
    await seed('google');
    const before = await snapshot();
    vi.mocked(playRevokeSubscription).mockRejectedValueOnce(new Error('store unavailable'));
    expect((await cancel()).status).toBe(502);
    expect(await snapshot()).toEqual(before);
    expect(sendPlanChangedPush).not.toHaveBeenCalled();
    expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
  });
});

describe('결제 전 HTTP 응답', () => {
  function app() {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', 'owner');
      await next();
    });
    app.route('/billing', billingQuery);
    return app;
  }
  async function orphanedPlan() {
    await seed();
    await db.execute("UPDATE subscriptions SET status='cancelled' WHERE id='sub-owner'");
    await db.execute(`INSERT INTO voice_profiles (id,user_id,name,elevenlabs_voice_id)
      VALUES ('orphan-voice','owner','남길 목소리','orphan-provider')`);
    await db.execute(`INSERT INTO messages (id,user_id,voice_profile_id,text)
      VALUES ('orphan-message','owner','orphan-voice','보관할 문구')`);
  }
  it('고아 유료 등급도 강등 전체를 커밋하고 통지하며 재조회로 유예를 늘리지 않는다', async () => {
    await orphanedPlan();
    let notified: { ids: string[]; plan: unknown; queued: number } | undefined;
    vi.mocked(sendPlanChangedPush).mockImplementationOnce(async (_db, _env, ids) => {
      // 별도 DB 읽기로 커밋 후 통지임을 확인한다.
      notified = {
        ids: [...ids],
        plan: (await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan,
        queued: (await rows("SELECT * FROM pending_external_deletions WHERE ref='orphan-provider'"))
          .length,
      };
    });
    const res = await app().request('/billing/subscription?refresh_store=1', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subscription: null, user_plan: 'free' });
    // 푸시 오류는 호출부가 삼키므로 커밋 시점의 단언은 콜백 밖에서 한다.
    expect(notified).toEqual({ ids: ['owner'], plan: 'free', queued: 1 });
    const voice = (await rows("SELECT * FROM voice_profiles WHERE id='orphan-voice'"))[0]!;
    expect(voice.elevenlabs_voice_id).toBeNull();
    expect(voice.evicted_provider_voice_id).toBe('orphan-provider');
    expect(voice.evicted_at).not.toBeNull();
    expect(await rows("SELECT * FROM messages WHERE id='orphan-message'")).toHaveLength(1);
    const retention = await rows('SELECT * FROM paid_voice_retention ORDER BY user_id');
    expect(retention.map((row) => row.user_id)).toEqual(['owner']);
    expect(sendPlanChangedPush).toHaveBeenCalledTimes(1);
    expect(sendVoiceDeletionWarningPush).toHaveBeenCalledTimes(1);
    expect((await app().request('/billing/subscription?refresh_store=1', {}, ENV)).status).toBe(
      200,
    );
    expect(await rows('SELECT * FROM paid_voice_retention ORDER BY user_id')).toEqual(retention);
    expect(sendPlanChangedPush).toHaveBeenCalledTimes(1);
    expect(sendVoiceDeletionWarningPush).toHaveBeenCalledTimes(1);
  });
  it('고아 등급 복구 중 실패는 plan·클론 반납까지 롤백하고 재시도한다', async () => {
    await orphanedPlan();
    await db.execute(`CREATE TRIGGER fail_orphan_retention BEFORE INSERT ON paid_voice_retention
      WHEN NEW.user_id='owner' BEGIN SELECT RAISE(ABORT, 'retention failed'); END`);
    try {
      expect((await app().request('/billing/subscription?refresh_store=1', {}, ENV)).status).toBe(
        500,
      );
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT elevenlabs_voice_id FROM voice_profiles WHERE id='orphan-voice'"))[0],
      ).toEqual({ elevenlabs_voice_id: 'orphan-provider' });
      expect(
        await rows("SELECT * FROM pending_external_deletions WHERE ref='orphan-provider'"),
      ).toHaveLength(0);
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
      expect(sendPlanChangedPush).not.toHaveBeenCalled();
      expect(sendVoiceDeletionWarningPush).not.toHaveBeenCalled();
    } finally {
      await db.execute('DROP TRIGGER fail_orphan_retention');
    }
    expect((await app().request('/billing/subscription?refresh_store=1', {}, ENV)).status).toBe(
      200,
    );
    expect(await rows('SELECT user_id FROM paid_voice_retention')).toEqual([{ user_id: 'owner' }]);
  });
  it.each([FUTURE, PAST])(
    '활성 근거가 있으면 만료값 %s와 무관하게 고아 등급 복구를 건너뛴다',
    async (expiry) => {
      await orphanedPlan();
      // 새 결제가 먼저 반영됐거나 회복형 보류가 남은 상태는 고아가 아니다.
      await db.execute({
        sql: "UPDATE subscriptions SET status='active',expires_at=? WHERE id='sub-owner'",
        args: [expiry],
      });
      expect(
        await withWriteTransaction(db, (tx) => repairOrphanedPaidPlan(tx, 'owner', NOW, false)),
      ).toEqual([]);
      expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
      expect(
        (await rows("SELECT elevenlabs_voice_id FROM voice_profiles WHERE id='orphan-voice'"))[0]!
          .elevenlabs_voice_id,
      ).toBe('orphan-provider');
      expect(await rows('SELECT * FROM paid_voice_retention')).toHaveLength(0);
    },
  );
  it('해지 직후 응답은 정합화된 null 구독과 free plan 을 함께 준다', async () => {
    await seed();
    apple({ status: 2 });
    const res = await app().request('/billing/subscription?refresh_store=1', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      subscription: null,
      user_plan: 'free',
      store_renewal_providers: [],
    });
  });
  it('확인 실패는 성공 응답이나 무료 plan 으로 변환하지 않는다', async () => {
    await seed();
    vi.mocked(fetchAppleSubscriptionStatus).mockRejectedValue(new Error('offline'));
    expect((await app().request('/billing/subscription?refresh_store=1', {}, ENV)).status).toBe(
      503,
    );
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
  });
  it('일상 조회는 외부 API 나 권한 쓰기를 수행하지 않는다', async () => {
    await seed();
    expect((await app().request('/billing/subscription', {}, ENV)).status).toBe(200);
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
    expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
  });
});
