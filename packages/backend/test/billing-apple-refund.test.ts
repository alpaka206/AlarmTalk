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

/** 애플이 말하는 **체인의 현재 상태**. 1=활성 2=만료 3=재시도 4=유예. */
let chainStatus: number | Error = 2;

vi.mock('../src/lib/apple-storekit', () => ({
  appleStoreKitConfigFromEnv: () => ({ issuerId: 'i', keyId: 'k', privateKeyPem: 'p', bundleId: 'b' }),
  applePlanKeyFromProductId: () => 'personal',
  isAppleGiftProductId: () => false,
  fetchAppleTransaction: vi.fn(async () => transactionInfo),
  fetchAppleSubscriptionStatus: vi.fn(async () => {
    if (chainStatus instanceof Error) throw chainStatus;
    return { status: chainStatus, productId: 'com.alarmtalk.app.personal_monthly' };
  }),
  APPLE_SUBSCRIPTION_STATUS: { ACTIVE: 1, EXPIRED: 2, IN_BILLING_RETRY: 3, IN_GRACE_PERIOD: 4, REVOKED: 5 },
  AppleTransactionNotFoundError: class extends Error {},
}));

const cancelSubscriptionImmediate = vi.fn(async () => ['owner-pk', 'member-1']);
const schedulePaidVoiceRetention = vi.fn(async () => undefined);
/** 환불 뒤에도 유료 권한이 남아 있는가(다른 스토어 구독·프로모). */
let stillPaid = false;
const notifyPlanChanged = vi.fn(async () => undefined);
const notifyVoiceDeletionScheduled = vi.fn(async () => undefined);

// ⚠ **조회 헬퍼는 진짜를 쓴다.** 라우트가 그걸로 SQL 을 날려야 아래 목 DB 시드가 뜻을
// 갖는다 — 전부 목으로 덮으면 "무엇을 조회하는가" 를 검증할 수 없다. 파괴적인 것
// (취소·보관 유예)과 네트워크(푸시)만 목으로 둔다.
vi.mock('../src/lib/billing-cancel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/billing-cancel')>()),
  cancelSubscriptionImmediate: (...a: unknown[]) => cancelSubscriptionImmediate(...(a as [])),
  schedulePaidVoiceRetention: (...a: unknown[]) => schedulePaidVoiceRetention(...(a as [])),
  notifyPlanChanged: (...a: unknown[]) => notifyPlanChanged(...(a as [])),
  notifyVoiceDeletionScheduled: (...a: unknown[]) => notifyVoiceDeletionScheduled(...(a as [])),
  hasActivePaidEntitlement: async () => stillPaid,
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
  chainStatus = 2;
  stillPaid = false; // 기본은 만료 — 체인이 끝났으니 회수해도 된다.
  cancelSubscriptionImmediate.mockClear();
  schedulePaidVoiceRetention.mockClear();
  notifyPlanChanged.mockClear();
  notifyVoiceDeletionScheduled.mockClear();
});

describe('POST /billing/apple/confirm — 다른 스토어가 갱신 중', () => {
  it('Play 구독이 살아 있으면 409 로 거절한다 — 앱 스냅샷만 믿을 수 없다', async () => {
    // ⚠ 앱도 막지만 그 판정은 캐시된 스냅샷이라, 같은 계정이 **다른 기기에서 방금**
    //   Play 구독을 시작한 경우를 못 본다(구매자 본인은 plan_changed 대상도 아니다).
    //   그대로 확정하면 우리 DB 의 Play 행만 취소되고 Play 는 계속 갱신한다.
    transactionInfo = revokedInfo({ revocationDate: undefined });
    mockDB.pushResult([{ id: 'caller-pk' }]); // resolveUserPk
    // 계정 식별자가 없는 트랜잭션이라 라우트가 '이미 묶인 것인가' 를 먼저 본다.
    mockDB.pushResult([{ user_id: 'caller-pk' }]);
    mockDB.pushResult([{ sub_id: 'sub-play', user_id: 'caller-pk', plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([{ provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('CROSS_STORE_RENEWAL_ACTIVE');
  });

  it('애플만 살아 있으면 막지 않는다', async () => {
    transactionInfo = revokedInfo({ revocationDate: undefined });
    mockDB.pushResult([{ id: 'caller-pk' }]);
    mockDB.pushResult([{ user_id: 'caller-pk' }]); // 이미 묶인 트랜잭션
    mockDB.pushResult([{ sub_id: 'sub-a', user_id: 'caller-pk', plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([{ provider: 'apple', provider_transaction_id: 'tx-1', product_id: 'p1' }]);
    mockDB.pushResult([]); // 이후 흐름은 이 테스트의 관심사가 아니다

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).not.toBe(409);
  });

  it('환불 갈래는 이 가드보다 먼저다 — 환불 통보는 언제나 받아 준다', async () => {
    // 환불은 회수 통보이지 구매가 아니다. 여기서 409 로 막으면 회수가 영영 안 된다.
    chainStatus = 5;
    pushMappedSubscription();

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('TRANSACTION_REVOKED');
  });
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

  // -------------------------------------------------------------------------
  // 옛 갱신이 뒤늦게 환불된 경우 (코덱스 #733 2차 P1)
  //
  // ⚠ 자동갱신 구독은 갱신마다 트랜잭션이 새로 나지만 `originalTransactionId` 는 **체인
  //   전체가 공유**한다. 그래서 옛 갱신 한 건이 환불되면 조회가 그 id 로 **지금 살아 있는
  //   구독 행**을 집는다 — 그대로 취소하면 이어받은 그룹까지 해체되고 되돌릴 수 없다.
  // -------------------------------------------------------------------------
  it('체인이 아직 활성이면 취소하지 않는다', async () => {
    chainStatus = 1; // ACTIVE — 더 최근 갱신이 살아 있다
    // ⚠ **매핑된 구독을 넣어 둔다.** 안 넣으면 가드가 없어도 조회가 비어 취소가 안 불려,
    //   테스트가 엉뚱한 이유로 통과한다(실제로 그렇게 썼다가 잡았다).
    pushMappedSubscription();

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect(cancelSubscriptionImmediate).not.toHaveBeenCalled();
  });

  it('지금 구독이 환불되면 애플은 5(REVOKED)를 준다 — 그것도 회수한다', async () => {
    // ⚠ **주 경로다.** 예전에는 `!== EXPIRED` 로 판정해서, 만료(2)가 아닌 5 가 오면
    //   "살아 있다" 로 읽고 회수를 통째로 건너뛰었다(코덱스 #733 3차).
    chainStatus = 5;
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(cancelSubscriptionImmediate).toHaveBeenCalledTimes(1);
  });

  it('모르는 상태값은 살아 있는 것으로 본다 — 애플이 나중에 늘릴 수 있다', async () => {
    chainStatus = 99;
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(cancelSubscriptionImmediate).not.toHaveBeenCalled();
  });

  it('재시도·유예도 살아 있는 것으로 본다 — 그건 만료 크론의 보류 갈래가 다룬다', async () => {
    for (const status of [3, 4]) {
      mockDB.reset();
      cancelSubscriptionImmediate.mockClear();
      chainStatus = status;
      pushMappedSubscription();

      await buildApp().request(
        jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
        undefined,
        ENV,
      );

      expect(cancelSubscriptionImmediate, `status=${status}`).not.toHaveBeenCalled();
    }
  });

  it('애플에 못 물어보면 취소하지 않는다 — 잘못 끊는 쪽이 되돌릴 수 없다', async () => {
    chainStatus = new Error('Apple down');
    pushMappedSubscription();

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect(cancelSubscriptionImmediate).not.toHaveBeenCalled();
  });

  it('통지가 실패해도 400 을 그대로 돌려준다 — 정리는 이미 커밋됐다', async () => {
    // ⚠ 여기서 던지면 라우트가 500 이 되고, 앱은 TRANSACTION_REVOKED 를 못 받아
    //   권위 상태를 다시 읽는 경로를 놓친다 — 회수가 끝났는데 유료 상태가 남는다.
    notifyPlanChanged.mockRejectedValueOnce(new Error('FCM down'));
    pushMappedSubscription();

    const res = await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('TRANSACTION_REVOKED');
    expect(cancelSubscriptionImmediate).toHaveBeenCalledTimes(1);
  });

  it('아직 유료면 목소리 보관 유예를 걸지 않는다 — 삭제 예고도 안 보낸다', async () => {
    // ⚠ 환불된 애플 구독이 **여러 활성 구독 중 하나**일 수 있다(구글 구독·프로모가 남은
    //   경우). `cancelSubscriptionImmediate` 는 살아남은 유료 플랜을 일부러 보존하는데,
    //   유예 행을 무조건 깔면 **돈을 내고 있는 사용자에게 "3일 뒤 삭제" 가 나간다**
    //   (코덱스 #733 6차).
    stillPaid = true;
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(cancelSubscriptionImmediate).toHaveBeenCalledTimes(1); // 회수 자체는 한다
    expect(schedulePaidVoiceRetention).not.toHaveBeenCalled();
    expect(notifyVoiceDeletionScheduled).not.toHaveBeenCalled();
    expect(notifyPlanChanged).toHaveBeenCalledTimes(1); // 스냅샷 갱신은 여전히 알린다
  });

  it('유료가 남지 않으면 예전대로 유예를 걸고 예고한다', async () => {
    stillPaid = false;
    pushMappedSubscription();

    await buildApp().request(
      jsonReq('POST', '/billing/apple/confirm', { transaction_id: 'tx' }),
      undefined,
      ENV,
    );

    expect(schedulePaidVoiceRetention).toHaveBeenCalledTimes(1);
    expect(notifyVoiceDeletionScheduled).toHaveBeenCalledTimes(1);
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
