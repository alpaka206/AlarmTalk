// 애플 결제 구독의 **만료 재조회**(reconciliation) 테스트.
//
// ⚠ 이게 없으면 **돈은 내는데 기능을 잃는다.** 애플에는 Play 의 RTDN 에 해당하는 서버
// 알림을 우리가 받는 라우트가 없어서(App Store Server Notifications 미구현), 구독 연장은
// iOS 앱이 **전경으로 올라올 때** `resyncEntitlements` 로 알려 주는 게 전부였다.
// 알람 앱은 안 열어도 울리므로 한 달 넘게 안 여는 사용자가 흔한데, 그 사이 5분마다 도는
// 만료 크론이 `expires_at` 을 지나 무료로 강등시킨다 — 목소리 알람이 잠기고 애플은
// 계속 청구한다. `reconcileGoogleBeforeExpiry` 만 있고 애플 갈래가 없었다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

// Play 쪽은 이 파일의 관심사가 아니다 — env 를 안 주면 재조회를 건너뛴다.
vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => null,
  getGoogleAccessToken: vi.fn(),
}));

import { processSubscriptionExpiry } from '../src/lib/billing-cancel';

const BUNDLE_ID = 'com.alarmtalk.app';
const ORIGINAL_ID = '2000000800000001';

const NOW = new Date('2026-07-18T00:00:00.000Z');
const PAST = '2026-07-17T23:00:00.000Z'; // 1시간 전 만료 (72h 이내)
const VERY_PAST = '2026-07-10T00:00:00.000Z'; // 8일 전 만료 (72h 초과)
const APPLE_FUTURE_MS = new Date('2026-08-17T00:00:00.000Z').getTime();

const DUE_ROW = {
  sub_id: 'sub-1',
  user_id: 'user-pk-1',
  plan_id: 'plan-1',
  plan_group_id: null,
  next_plan_id: null,
  expires_at: PAST,
  plan_type: 'personal',
};

let APPLE_ENV: Record<string, string>;

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

/** 애플 `/subscriptions/{id}` 응답 흉내. */
function appleStatusBody(over: { status?: number; expiresDate?: number; autoRenewStatus?: number } = {}) {
  return {
    bundleId: BUNDLE_ID,
    data: [
      {
        lastTransactions: [
          {
            originalTransactionId: ORIGINAL_ID,
            status: over.status ?? 1,
            signedTransactionInfo: jws({
              transactionId: '2000000900000009',
              originalTransactionId: ORIGINAL_ID,
              bundleId: BUNDLE_ID,
              productId: 'com.alarmtalk.app.personal_monthly',
              purchaseDate: NOW.getTime() - 30 * 24 * 3600 * 1000,
              expiresDate: over.expiresDate ?? APPLE_FUTURE_MS,
              type: 'Auto-Renewable Subscription',
            }),
            signedRenewalInfo: jws({ autoRenewStatus: over.autoRenewStatus ?? 1 }),
          },
        ],
      },
    ],
  };
}

function stubAppleFetch(bodyOrStatus: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(typeof bodyOrStatus === 'string' ? bodyOrStatus : JSON.stringify(bodyOrStatus), {
      status,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 크론이 만료 대상을 훑는 순서대로 목 응답을 쌓는다. */
function pushAppleSubscriptionDue() {
  mockDB.pushResult([DUE_ROW]); // cancel_at_period_end=1 만기 도래
  mockDB.pushResult([]); // google 트랜잭션 없음
  mockDB.pushResult([{ provider_transaction_id: ORIGINAL_ID }]); // apple 트랜잭션
}

function pushExtensionWrites() {
  mockDB.pushResult([], 1); // UPDATE subscriptions
  mockDB.pushResult([], 1); // UPDATE voucher_codes
  mockDB.pushResult([], 1); // UPDATE users.plan
  mockDB.pushResult([], 1); // UPDATE store_transactions
  mockDB.pushResult([]); // 일반 만료 대상 없음
  mockDB.pushResult([]); // sweep 대상 없음
}

function findCall(fragment: string) {
  return mockDB.calls.find((c) => c.sql.includes(fragment));
}

beforeEach(async () => {
  mockDB.reset();
  // 실제 P-256 키로 서버 JWT 서명 경로를 진짜로 태운다(유료 계정 불필요).
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  APPLE_ENV = {
    APPLE_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
    APPLE_KEY_ID: 'ABC123DEFG',
    APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`,
    APPLE_BUNDLE_ID: BUNDLE_ID,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('processSubscriptionExpiry — Apple reconciliation', () => {
  it('DB 만료가 지났어도 애플이 유효하다고 하면 강등 대신 연장한다', async () => {
    stubAppleFetch(appleStatusBody());
    pushAppleSubscriptionDue();
    pushExtensionWrites();

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    // 강등·목소리 보관 예약이 일어나면 안 된다 — 그게 "돈 내는데 잠긴다" 의 실체다.
    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();

    const extend = findCall('UPDATE subscriptions');
    expect(extend?.args[0]).toBe(new Date(APPLE_FUTURE_MS).toISOString());
    expect(extend?.args[1]).toBe(0); // 자동갱신 켜짐 → 해지 예약 아님
    expect(extend?.args[2]).toBe('sub-1');
    // 유료 플랜 유지 (personal → plus)
    expect(findCall('UPDATE users SET plan')?.args[0]).toBe('plus');
  });

  // ⚠ **재시도(3)와 유예(4)는 다르다.**
  //  - 4(유예): 애플이 **명시적으로 접근을 허용**하는 기간 → 유료 유지.
  //  - 3(재시도): 유예가 끝났거나 애초에 없는 상태로 결제가 실패한 채 카드만 다시 긁는다.
  //    구글의 ON_HOLD 에 해당하고, 정책상 **보류 기간에는 free** 다.
  it('유예 기간(4)은 아직 권한이 있다 — 연장한다', async () => {
    stubAppleFetch(appleStatusBody({ status: 4 }));
    pushAppleSubscriptionDue();
    pushExtensionWrites();

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('UPDATE subscriptions')?.args[0]).toBe(new Date(APPLE_FUTURE_MS).toISOString());
  });

  // ⚠ **재시도는 종료가 아니다.** 권한만 회수하고 그룹·구독 행은 남겨야 한다 —
  //    'expire' 로 보내면 그룹이 해체돼 카드가 며칠 막힌 것으로 가족 전원이
  //    재초대 대상이 된다.
  it('결제 재시도(3)는 free 로 내리되 그룹·구독은 보존한다', async () => {
    stubAppleFetch(appleStatusBody({ status: 3 }));
    pushAppleSubscriptionDue();
    // 소유자 재계산
    mockDB.pushResult([
      { sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
    ]);
    mockDB.pushResult([], 1); // UPDATE users SET plan → free
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    // 권한은 회수된다.
    expect(findCall('UPDATE users SET plan = ?')?.args).toEqual(['free', 'user-pk-1']);
    // ⚠ 종료 처리(그룹 해체·구독 취소·음성 보관 예약)는 하지 않는다.
    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('DELETE FROM plan_group_members')).toBeUndefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();
  });

  it('사용자가 App Store 에서 해지했으면(autoRenewStatus=0) 연장하되 기간종료 해지로 표시한다', async () => {
    stubAppleFetch(appleStatusBody({ autoRenewStatus: 0 }));
    pushAppleSubscriptionDue();
    pushExtensionWrites();

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall('UPDATE subscriptions')?.args[1]).toBe(1);
  });

  it('애플도 만료(2)라고 하면 정상 강등한다', async () => {
    stubAppleFetch(appleStatusBody({ status: 2, expiresDate: new Date(PAST).getTime() }));
    pushAppleSubscriptionDue();
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
  });

  it('애플에 구독이 아예 없으면 만료가 맞다 — 강등한다', async () => {
    stubAppleFetch('', 404);
    pushAppleSubscriptionDue();
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall("status = 'cancelled'")).toBeDefined();
  });

  // 일시 장애로 판정 못 하는데 강등하면, 애플 API 가 5분 삐끗한 값으로 유료 사용자가
  // 무료가 된다. 만료가 아직 최근이면 보류하고 다음 run 에 다시 묻는다.
  it('일시 장애 + 만료가 최근이면 이번 회차는 보류한다', async () => {
    stubAppleFetch('', 500);
    pushAppleSubscriptionDue();
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();
  });

  // 반대로 영원히 보류하면 좀비 구독이 남는다 — 72시간 넘으면 강행.
  it('일시 장애라도 만료가 72시간 넘게 지났으면 강행한다', async () => {
    stubAppleFetch('', 500);
    mockDB.pushResult([{ ...DUE_ROW, expires_at: VERY_PAST }]);
    mockDB.pushResult([]); // google 없음
    mockDB.pushResult([{ provider_transaction_id: ORIGINAL_ID }]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    await processSubscriptionExpiry(mockDB.client as never, APPLE_ENV as never, NOW);

    expect(findCall("status = 'cancelled'")).toBeDefined();
  });

  it('애플 env 미설정(dev)이면 재조회 없이 현행대로 만료한다', async () => {
    const fetchMock = stubAppleFetch(appleStatusBody());
    pushAppleSubscriptionDue();
    mockDB.pushResult([]);
    mockDB.pushResult([]);

    await processSubscriptionExpiry(mockDB.client as never, undefined, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findCall("status = 'cancelled'")).toBeDefined();
  });
});
