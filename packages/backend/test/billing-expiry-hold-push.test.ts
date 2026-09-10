// **결제 보류를 크론이 발견했을 때 사용자에게 보이는 안내가 나가는가**(코덱스 #732 P2).
//
// ⚠ 조용한 `plan_changed` 만으로는 부족하다. 그건 "스냅샷을 다시 읽어라" 는 신호일 뿐이라,
// 사용자는 어느 날 갑자기 유료 기능이 잠긴 이유를 모른다. 결제 실패는 **사용자가 직접
// 고쳐야** 풀리는 상태이므로 `docs/spec/billing-lifecycle.md` 가 별도 안내를 요구한다.
//
// RTDN 이 먼저 오면 그 경로가 같은 안내를 보낸다(`billing-google-rtdn.ts`). 여기는
// **RTDN 을 놓쳤을 때** 크론이 같은 상태를 발견하는 갈래다 — 같은 함수를 써야 한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => null,
  getGoogleAccessToken: vi.fn(),
}));

const sendPaymentFailedPush = vi.fn().mockResolvedValue(undefined);
const sendPlanChangedPush = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/fcm', () => ({
  sendPaymentFailedPush: (...args: unknown[]) => sendPaymentFailedPush(...args),
  sendPlanChangedPush: (...args: unknown[]) => sendPlanChangedPush(...args),
  sendVoiceDeletionWarningPush: vi.fn().mockResolvedValue(undefined),
  notifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
}));

import { processSubscriptionExpiry } from '../src/lib/billing-cancel';

const BUNDLE_ID = 'com.alarmtalk.app';
const ORIGINAL_ID = '2000000800000001';
const NOW = new Date('2026-07-18T00:00:00.000Z');
const PAST = '2026-07-17T23:00:00.000Z';

let ENV: Record<string, string>;

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jws(payload: Record<string, unknown>): string {
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })));
  const b = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${h}.${b}.c2ln`;
}

/** 애플 `/subscriptions/{id}` 응답 — status 3 = 결제 재시도(= 구글 ON_HOLD). */
function appleBillingRetryBody() {
  return {
    bundleId: BUNDLE_ID,
    data: [
      {
        lastTransactions: [
          {
            originalTransactionId: ORIGINAL_ID,
            status: 3,
            signedTransactionInfo: jws({
              transactionId: '2000000900000009',
              originalTransactionId: ORIGINAL_ID,
              bundleId: BUNDLE_ID,
              productId: 'com.alarmtalk.app.personal_monthly',
              purchaseDate: NOW.getTime() - 30 * 24 * 3600 * 1000,
              expiresDate: new Date('2026-08-17T00:00:00.000Z').getTime(),
              type: 'Auto-Renewable Subscription',
            }),
            signedRenewalInfo: jws({ autoRenewStatus: 1 }),
          },
        ],
      },
    ],
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    sub_id: 'sub-1',
    user_id: 'owner-pk',
    plan_id: 'plan-1',
    plan_group_id: null,
    next_plan_id: null,
    expires_at: PAST,
    plan_type: 'family',
    plan_key: 'family',
    ...over,
  };
}

beforeEach(async () => {
  mockDB.reset();
  sendPaymentFailedPush.mockClear();
  sendPlanChangedPush.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(appleBillingRetryBody()), { status: 200 })),
  );
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  ENV = {
    APPLE_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
    APPLE_KEY_ID: 'ABC123DEFG',
    APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`,
    APPLE_BUNDLE_ID: BUNDLE_ID,
    // 발송 게이트 — 하나라도 있어야 푸시 경로를 탄다.
    APNS_KEY_ID: 'K1',
    APNS_PRIVATE_KEY: 'pk',
    APPLE_TEAM_ID: 'T1',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 크론이 애플 보류를 발견하는 데까지 필요한 목 응답. */
function pushAppleHoldDue(dueRow: Record<string, unknown>) {
  mockDB.pushResult([dueRow]); // cancel_at_period_end=1 만기 도래
  mockDB.pushResult([]); // google 트랜잭션 없음
  mockDB.pushResult([{ provider_transaction_id: ORIGINAL_ID }]); // apple 트랜잭션
}

function pushSuspendWrites(memberPks: string[] = [], ownerPlanAfter = 'free') {
  // ⚠ 소유자도 **바뀐 회차에만** 알린다 — 보류는 구독 행을 남기므로 이 갈래가 5분마다
  //   다시 걸린다. 그래서 plan 을 강등 전후로 한 번씩 읽는다.
  mockDB.pushResult([{ plan: 'family' }]); // before
  // resolvePlanAfterSuspend(소유자) — 남은 활성 구독 조회 + UPDATE users.plan
  mockDB.pushResult([
    { sub_id: 'sub-1', user_id: 'owner-pk', plan_id: 'plan-1', plan_group_id: null, plan_type: 'family', plan_key: 'family' },
  ]);
  mockDB.pushResult([], 1);
  mockDB.pushResult([{ plan: ownerPlanAfter }]); // after

  if (memberPks.length > 0) {
    mockDB.pushResult(memberPks.map((user_id) => ({ user_id }))); // 그룹 멤버 목록
    for (const memberPk of memberPks) {
      // ⚠ 멤버는 **plan 이 실제로 바뀐 사람만** 통지 대상이다 — 강등 전후의 plan 을 둘 다 읽는다.
      mockDB.pushResult([{ plan: 'family' }]); // before
      mockDB.pushResult([{ id: 'msub-1' }]); // 이 그룹에 묶인 멤버 구독(제외 대상)
      mockDB.pushResult([
        { sub_id: 'msub-1', user_id: memberPk, plan_id: 'plan-1', plan_group_id: 'group-1', plan_type: 'family', plan_key: 'family' },
      ]); // resolvePlanAfterSuspend 의 남은 구독 조회 → 전부 제외되어 free
      mockDB.pushResult([], 1); // UPDATE users.plan
      mockDB.pushResult([{ plan: 'free' }]); // after
    }
  }

  mockDB.pushResult([]); // 일반 만료 대상 없음
  mockDB.pushResult([]); // sweep 대상 없음
}

describe('processSubscriptionExpiry — 결제 보류 안내', () => {
  it('예약해지 갈래에서 보류를 발견해도 보이는 안내를 보낸다', async () => {
    // ⚠ 이 갈래에는 예전에 통지가 **아예 없었다.** 아래 만료 갈래에만 넣고 여기를
    //   빠뜨려, 예약해지 상태에서 보류가 겹치면 권한만 조용히 잠겼다.
    pushAppleHoldDue(row());
    pushSuspendWrites();

    await processSubscriptionExpiry(mockDB.client as never, ENV as never, NOW);

    expect(sendPaymentFailedPush).toHaveBeenCalledTimes(1);
    expect(sendPaymentFailedPush.mock.calls[0]![2]).toEqual({
      ownerUserPk: 'owner-pk',
      memberUserPks: [],
    });
  });

  it('그룹이면 함께 잠긴 멤버도 안내 대상이다', async () => {
    pushAppleHoldDue(row({ plan_group_id: 'group-1' }));
    pushSuspendWrites(['member-1', 'member-2']);

    await processSubscriptionExpiry(mockDB.client as never, ENV as never, NOW);

    const params = sendPaymentFailedPush.mock.calls[0]![2] as {
      ownerUserPk: string;
      memberUserPks: string[];
    };
    expect(params.ownerUserPk).toBe('owner-pk');
    expect(params.memberUserPks).toEqual(['member-1', 'member-2']);
  });

  it('보류자를 조용한 plan_changed 에 또 넣지 않는다 — 같은 data-only 가 두 번 간다', async () => {
    // `sendPaymentFailedPush` 는 표시용과 워커 기동용 두 통을 함께 보낸다(`fcm.ts`).
    pushAppleHoldDue(row());
    pushSuspendWrites();

    await processSubscriptionExpiry(mockDB.client as never, ENV as never, NOW);

    expect(sendPlanChangedPush).not.toHaveBeenCalled();
  });

  it('같은 보류가 다음 회차에 또 걸려도 다시 알리지 않는다 — 5분마다 오는 알림이 된다', async () => {
    // ⚠ 보류는 구독 행을 `active` 로 **남긴다**(회복형). 이미 지난 expires_at 을 든 그
    //   행이 5분 크론에 매번 다시 걸리므로, 무조건 보내면 결제가 복구될 때까지 사용자는
    //   "결제가 확인되지 않았어요" 를 5분마다 받는다.
    pushAppleHoldDue(row());
    pushSuspendWrites([], 'free'); // 이미 free — 바뀐 것이 없다
    // before 를 free 로 덮어쓴다: 앞 회차에 이미 강등된 상태.
    mockDB.reset();
    mockDB.pushResult([row()]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ provider_transaction_id: ORIGINAL_ID }]);
    mockDB.pushResult([{ plan: 'free' }]); // before = free
    mockDB.pushResult([]); // 남은 유료 구독 없음
    mockDB.pushResult([], 1); // UPDATE users.plan → free (그대로)
    mockDB.pushResult([{ plan: 'free' }]); // after = free
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, ENV as never, NOW);

    expect(sendPaymentFailedPush).not.toHaveBeenCalled();
  });

  it('푸시 키가 없으면 발송을 건너뛰되 보류 처리는 그대로 끝난다', async () => {
    pushAppleHoldDue(row());
    pushSuspendWrites();

    const noKeys = { ...ENV };
    delete noKeys.APNS_KEY_ID;
    delete noKeys.APNS_PRIVATE_KEY;
    delete noKeys.APPLE_TEAM_ID;

    await processSubscriptionExpiry(mockDB.client as never, noKeys as never, NOW);

    expect(sendPaymentFailedPush).not.toHaveBeenCalled();
    // 권한 회수는 푸시와 무관하게 일어난다.
    expect(mockDB.calls.find((c) => c.sql.includes('UPDATE users SET plan = ?'))?.args).toEqual([
      'free',
      'owner-pk',
    ]);
  });

  it('한 사람의 발송이 실패해도 나머지 처리를 멈추지 않는다', async () => {
    sendPaymentFailedPush.mockRejectedValueOnce(new Error('APNs down'));
    pushAppleHoldDue(row());
    pushSuspendWrites();

    await expect(
      processSubscriptionExpiry(mockDB.client as never, ENV as never, NOW),
    ).resolves.toBeUndefined();
  });
});
