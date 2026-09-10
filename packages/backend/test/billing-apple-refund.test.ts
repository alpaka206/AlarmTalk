// **환불된 애플 결제의 권한 회수**(코덱스 #730 3차).
//
// ⚠ 애플에는 우리가 받는 서버 알림 라우트가 없다(App Store Server Notifications 미구현).
// 기간 중 환불은 클라가 `Transaction.updates` 로 물어다 준 confirm 요청이 **유일한 통보**다.
// 거기서 400 만 돌려주면 만료 크론이 재조회할 때까지 — 저장된 `expires_at` 까지 —
// 환불받은 계정과 그 가족 멤버가 계속 유료로 남는다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({ getDB: () => mockDB.client }));

let transactionInfo: Record<string, unknown>;

vi.mock('../src/lib/apple-storekit', () => ({
  appleStoreKitConfigFromEnv: () => ({ issuerId: 'i', keyId: 'k', privateKeyPem: 'p', bundleId: 'b' }),
  applePlanKeyFromProductId: () => 'personal',
  isAppleGiftProductId: () => false,
  fetchAppleTransaction: vi.fn(async () => transactionInfo),
  AppleTransactionNotFoundError: class extends Error {},
}));

const cancelSubscriptionImmediate = vi.fn(async () => ['owner-pk', 'member-1']);
const schedulePaidVoiceRetention = vi.fn(async () => undefined);
const notifyPlanChanged = vi.fn(async () => undefined);
const notifyVoiceDeletionScheduled = vi.fn(async () => undefined);

vi.mock('../src/lib/billing-cancel', () => ({
  cancelSubscriptionImmediate: (...a: unknown[]) => cancelSubscriptionImmediate(...(a as [])),
  schedulePaidVoiceRetention: (...a: unknown[]) => schedulePaidVoiceRetention(...(a as [])),
  notifyPlanChanged: (...a: unknown[]) => notifyPlanChanged(...(a as [])),
  notifyVoiceDeletionScheduled: (...a: unknown[]) => notifyVoiceDeletionScheduled(...(a as [])),
}));

import billingApple from '../src/routes/billing-apple';

const ENV = { ENVIRONMENT: 'test' } as never;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware('caller-pk'));
  app.route('/billing', billingApple);
  return app;
}

const ORIGINAL_TX = '2000000800000001';

function revokedInfo(over: Record<string, unknown> = {}) {
  return {
    transactionId: '2000000900000009',
    originalTransactionId: ORIGINAL_TX,
    bundleId: 'com.alarmtalk.app',
    productId: 'com.alarmtalk.app.personal_monthly',
    purchaseDate: Date.now() - 10 * 24 * 3600 * 1000,
    expiresDate: Date.now() + 20 * 24 * 3600 * 1000,
    type: 'Auto-Renewable Subscription',
    revocationDate: Date.now(),
    ...over,
  };
}

/** 매핑된 구독이 있는 상태. */
function pushMappedSubscription() {
  mockDB.pushResult([{ id: 'caller-pk' }]); // resolveUserPk
  mockDB.pushResult([
    {
      user_id: 'owner-pk',
      subscription_id: 'sub-1',
      plan_id: 'plan-1',
      plan_group_id: 'group-1',
      plan_type: 'family',
      plan_key: 'family',
    },
  ]);
}

beforeEach(() => {
  mockDB.reset();
  transactionInfo = revokedInfo();
  cancelSubscriptionImmediate.mockClear();
  schedulePaidVoiceRetention.mockClear();
  notifyPlanChanged.mockClear();
  notifyVoiceDeletionScheduled.mockClear();
});

describe('POST /billing/apple/confirm — 환불된 트랜잭션', () => {
  it('여전히 400 으로 거절한다', async () => {
    pushMappedSubscription();

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('TRANSACTION_REVOKED');
  });

  it('매핑된 구독을 취소하고 목소리 보관 유예를 건다', async () => {
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(cancelSubscriptionImmediate).toHaveBeenCalledTimes(1);
    const mapped = cancelSubscriptionImmediate.mock.calls[0]![1] as Record<string, unknown>;
    // ⚠ 회수 대상은 **그 트랜잭션에 묶인 구독**이지 요청을 보낸 계정이 아니다.
    expect(mapped.userPk).toBe('owner-pk');
    expect(mapped.subscriptionId).toBe('sub-1');
    expect(mapped.planGroupId).toBe('group-1');
    expect(schedulePaidVoiceRetention).toHaveBeenCalledTimes(1);
  });

  it('강등된 당사자와 해체된 멤버에게 알린다', async () => {
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(notifyPlanChanged.mock.calls[0]![2]).toEqual(['owner-pk', 'member-1']);
    expect(notifyVoiceDeletionScheduled).toHaveBeenCalledTimes(1);
  });

  it('조회 키로 originalTransactionId 와 transactionId 를 둘 다 쓴다', async () => {
    // 구독은 originalTransactionId, 선물은 transactionId 로 기록된다.
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    const lookup = mockDB.calls.find((c) => c.sql.includes('FROM store_transactions'))!;
    expect(lookup.sql).toContain("st.provider = 'apple'");
    expect(lookup.sql).toContain("s.status = 'active'");
    expect(lookup.args).toEqual([ORIGINAL_TX, '2000000900000009']);
  });

  it('매핑된 구독이 없으면(선물·이미 정리됨) 아무것도 하지 않는다', async () => {
    mockDB.pushResult([{ id: 'caller-pk' }]); // resolveUserPk
    mockDB.pushResult([]); // 매핑 없음

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect(cancelSubscriptionImmediate).not.toHaveBeenCalled();
    expect(notifyPlanChanged).not.toHaveBeenCalled();
  });

  it('환불이 아니면 회수 경로를 타지 않는다', async () => {
    transactionInfo = revokedInfo({ revocationDate: undefined });
    mockDB.pushResult([{ id: 'caller-pk' }]);
    mockDB.pushResult([]); // 이후 흐름은 이 테스트의 관심사가 아니다

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(cancelSubscriptionImmediate).not.toHaveBeenCalled();
  });
});
