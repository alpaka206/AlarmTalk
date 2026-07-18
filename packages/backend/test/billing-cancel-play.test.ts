import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

// Play API 는 글로벌 fetch 로만 검증한다 — OAuth(JWT 서명)는 실 키가 필요하므로 모듈 목.
vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: (raw?: string) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      return parsed.client_email && parsed.private_key ? parsed : null;
    } catch {
      return null;
    }
  },
  getGoogleAccessToken: vi.fn().mockResolvedValue('play-access-token'),
}));

import billingMutation from '../src/routes/billing-mutation';
import billingGoogle from '../src/routes/billing-google';
import {
  processSubscriptionExpiry,
  sweepPaidVoiceRetention,
} from '../src/lib/billing-cancel';
import { applyStoreEntitlement } from '../src/lib/store-billing';

const PLAY_ENV = {
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'svc@play.test',
    private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  }),
  ANDROID_PACKAGE_NAME: 'com.alarmtalk.app',
};

const SUB_ROW = {
  sub_id: 'sub-1',
  user_id: 'user-pk-1',
  plan_id: 'plan-1',
  plan_group_id: null,
  plan_type: 'personal',
};

const GOOGLE_TXN_ROW = {
  provider: 'google',
  provider_transaction_id: 'play-token-1',
  product_id: 'personal_monthly',
};

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingMutation);
  return app;
}

function stubPlayFetch(status = 200, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function findCall(sqlFragment: string) {
  return mockDB.calls.find((c) => c.sql.includes(sqlFragment));
}

beforeEach(() => {
  mockDB.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// POST /billing/cancel — Google Play 결제 구독
// ---------------------------------------------------------------------------
describe('POST /billing/cancel (google 결제)', () => {
  it('at_period_end: Play :cancel 성공 시에만 cancel_at_period_end=1', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([SUB_ROW]); // 활성 구독
    mockDB.pushResult([GOOGLE_TXN_ROW]); // store_transactions
    mockDB.pushResult([], 1); // scheduleCancelAtPeriodEnd

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, mode: 'at_period_end', subscription_id: 'sub-1' });

    // Play 호출 검증: subscriptionsv2 :cancel + USER_REQUESTED_STOP_RENEWALS
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/purchases/subscriptionsv2/tokens/play-token-1:cancel');
    expect(url).toContain('applications/com.alarmtalk.app');
    expect(JSON.parse(String(init.body))).toEqual({
      cancellationContext: { cancellationType: 'USER_REQUESTED_STOP_RENEWALS' },
    });

    const scheduleCall = findCall('cancel_at_period_end = 1');
    expect(scheduleCall).toBeDefined();
    expect(scheduleCall?.args).toContain('sub-1');
  });

  it('at_period_end: Play :cancel 실패 시 502 PLAY_CANCEL_FAILED + DB 무변경', async () => {
    stubPlayFetch(500, { error: 'boom' });
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error_code).toBe('PLAY_CANCEL_FAILED');
    expect(body.manage_url).toBe(
      'https://play.google.com/store/account/subscriptions?sku=personal_monthly&package=com.alarmtalk.app',
    );
    // 조회(SELECT) 외 어떤 쓰기도 없어야 한다.
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('immediate: Play :revoke 성공 → 구독 cancelled·음성 보존·30일 보관 예약', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([SUB_ROW]); // 활성 구독 (라우트)
    mockDB.pushResult([GOOGLE_TXN_ROW]); // store_transactions
    mockDB.pushResult([SUB_ROW]); // cancelActiveSubscriptionsForUser 내부 재조회

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe('immediate');
    // 30일 보관 만료 시각이 응답에 내려온다.
    const retentionMs = new Date(body.voice_retention_until).getTime();
    expect(retentionMs).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(':revoke');
    expect(JSON.parse(String(init.body))).toEqual({
      revocationContext: { proratedRefund: {} },
    });

    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
    // 음성 데이터 하드삭제는 없어야 한다 (30일 보관으로 대체).
    expect(findCall('DELETE FROM voice_profiles')).toBeUndefined();
    expect(findCall('DELETE FROM messages')).toBeUndefined();
  });

  it('immediate: Play :revoke 실패 시 502 PLAY_REVOKE_FAILED + DB 무변경', async () => {
    stubPlayFetch(409, { error: 'not allowed' });
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PLAY_REVOKE_FAILED');
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('Play env 미설정이면 google 결제 해지는 502 (스텁 폴백으로 로컬만 해지하지 않는다)', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      {},
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PLAY_CANCEL_FAILED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /billing/cancel — mode 화이트리스트 (C1)
// ---------------------------------------------------------------------------
describe('POST /billing/cancel — mode 검증', () => {
  it('mode 누락은 400 INVALID_CANCEL_MODE (immediate 로 폴백하지 않는다)', async () => {
    const fetchMock = stubPlayFetch(200, {});

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', {}),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_CANCEL_MODE');
    expect(fetchMock).not.toHaveBeenCalled();
    // 검증이 DB 접근보다 먼저다 — 어떤 쿼리도 나가지 않는다.
    expect(mockDB.calls.length).toBe(0);
  });

  it('오타/미지원 mode 도 400 (예: atperiodend)', async () => {
    const fetchMock = stubPlayFetch(200, {});

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'atperiodend' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_CANCEL_MODE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDB.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /billing/cancel — 다중 활성 구독 · 다중 Play 토큰 (C2)
// ---------------------------------------------------------------------------
describe('POST /billing/cancel — 다중 구독 토큰', () => {
  const SUB_ROW_2 = { ...SUB_ROW, sub_id: 'sub-2' };
  const GOOGLE_TXN_ROW_2 = { ...GOOGLE_TXN_ROW, provider_transaction_id: 'play-token-2' };

  it('활성 2구독·2토큰: 두 토큰 모두 Play :cancel 호출 + 두 구독 모두 예약취소', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([SUB_ROW, SUB_ROW_2]); // 활성 구독 2개
    mockDB.pushResult([GOOGLE_TXN_ROW, GOOGLE_TXN_ROW_2]); // store_transactions (IN 조회)
    mockDB.pushResult([], 1); // scheduleCancelAtPeriodEnd sub-1
    mockDB.pushResult([], 1); // scheduleCancelAtPeriodEnd sub-2

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/tokens/play-token-1:cancel');
    expect(urls[1]).toContain('/tokens/play-token-2:cancel');

    const scheduleCalls = mockDB.calls.filter((c) => c.sql.includes('cancel_at_period_end = 1'));
    expect(scheduleCalls.map((c) => c.args[0])).toEqual(['sub-1', 'sub-2']);
  });

  it('다중 토큰 중 하나 실패 시 502 + DB 무변경 (성공분은 C5 수렴으로 재시도 안전)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // token-1 :cancel 성공
      .mockResolvedValue(new Response('{}', { status: 500 })); // token-2 :cancel 실패(5xx)
    vi.stubGlobal('fetch', fetchMock);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW, SUB_ROW_2]);
    mockDB.pushResult([GOOGLE_TXN_ROW, GOOGLE_TXN_ROW_2]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PLAY_CANCEL_FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // token-1 은 Play 에서 이미 취소됐지만 DB 는 건드리지 않는다 — 재시도 시
    // 이미 취소된 토큰은 성공 처리(C5 수렴)되므로 전체가 성공으로 수렴한다.
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('immediate 도 모든 토큰에 :revoke 를 호출한다', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW, SUB_ROW_2]);
    mockDB.pushResult([GOOGLE_TXN_ROW, GOOGLE_TXN_ROW_2]);
    mockDB.pushResult([SUB_ROW, SUB_ROW_2]); // cancelActiveSubscriptionsForUser 내부 재조회

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((u) => u.includes(':revoke')).length).toBe(2);
    expect(urls[0]).toContain('/tokens/play-token-1:revoke');
    expect(urls[1]).toContain('/tokens/play-token-2:revoke');
  });
});

// ---------------------------------------------------------------------------
// Play cancel/revoke 재시도 수렴 (C5)
// ---------------------------------------------------------------------------
describe('POST /billing/cancel — 이미 취소/철회된 토큰 수렴 (C5)', () => {
  it(':cancel 400 이어도 재조회로 이미 autoRenew=false 면 성공으로 수렴한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'already canceled' }), { status: 400 }),
      ) // :cancel 4xx
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
            lineItems: [{ autoRenewingPlan: { autoRenewEnabled: false } }],
          }),
          { status: 200 },
        ),
      ); // 실상태 재조회
    vi.stubGlobal('fetch', fetchMock);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);
    mockDB.pushResult([], 1); // scheduleCancelAtPeriodEnd

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      '/purchases/subscriptionsv2/tokens/play-token-1',
    );
    expect(findCall('cancel_at_period_end = 1')).toBeDefined();
  });

  it(':cancel 4xx 인데 재조회 결과 여전히 자동갱신 중이면 502 유지 + DB 무변경', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            lineItems: [{ autoRenewingPlan: { autoRenewEnabled: true } }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'at_period_end' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PLAY_CANCEL_FAILED');
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });

  it(':revoke 4xx 이어도 재조회로 이미 REVOKED(=entitled 아님)면 성공으로 수렴한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 })) // :revoke 4xx
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscriptionState: 'SUBSCRIPTION_STATE_REVOKED' }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([GOOGLE_TXN_ROW]);
    mockDB.pushResult([SUB_ROW]); // cancelActiveSubscriptionsForUser 내부 재조회

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /billing/cancel — Apple / 스토어 미연결(스텁) 구독
// ---------------------------------------------------------------------------
describe('POST /billing/cancel (apple·스텁)', () => {
  it('apple 결제 구독은 409 STORE_CANCEL_UNSUPPORTED + DB 무변경', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([{ ...GOOGLE_TXN_ROW, provider: 'apple' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('STORE_CANCEL_UNSUPPORTED');
    expect(body.manage_url).toBe('https://apps.apple.com/account/subscriptions');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });

  it('스토어 트랜잭션 없는 구독(dev 스텁/프로모) immediate: Play 호출 없이 해지 + 보관 예약', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);
    mockDB.pushResult([]); // store_transactions 없음
    mockDB.pushResult([SUB_ROW]); // cancelActiveSubscriptionsForUser 내부 재조회

    const res = await buildApp().request(
      jsonReq('POST', '/billing/cancel', { mode: 'immediate' }),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voice_retention_until).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
    expect(findCall('DELETE FROM voice_profiles')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /billing/voice-data/delete-now
// ---------------------------------------------------------------------------
describe('POST /billing/voice-data/delete-now', () => {
  it('활성 유료 구독이 있으면 409 SUBSCRIPTION_STILL_ACTIVE', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([SUB_ROW]);

    const res = await buildApp().request(
      jsonReq('POST', '/billing/voice-data/delete-now'),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('SUBSCRIPTION_STILL_ACTIVE');
    expect(mockDB.calls.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });

  it('구독이 없으면 즉시 삭제 + 보관 행 제거', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]); // 활성 구독 없음

    const res = await buildApp().request(
      jsonReq('POST', '/billing/voice-data/delete-now'),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(findCall('DELETE FROM voice_profiles')).toBeDefined();
    expect(findCall('DELETE FROM paid_voice_retention')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 보관 만료 sweep
// ---------------------------------------------------------------------------
describe('sweepPaidVoiceRetention', () => {
  it('delete_after 경과 행: 음성 삭제 + 보관 행 제거', async () => {
    mockDB.pushResult([{ user_id: 'user-pk-9' }]); // 만기 도래 행
    mockDB.pushResult([], 1); // 보관 행 선점 삭제(claim) 성공
    mockDB.pushResult([]); // 활성 유료 구독 없음 (재구독 안전망)
    mockDB.pushResult([{ google_id: 'google-9' }]); // resolveUserLoginId

    await sweepPaidVoiceRetention(mockDB.client as never, new Date());

    expect(findCall('DELETE FROM voice_profiles')).toBeDefined();
    const retentionDelete = findCall('DELETE FROM paid_voice_retention');
    expect(retentionDelete).toBeDefined();
    expect(retentionDelete?.args[0]).toBe('user-pk-9');
    expect(mockDB.transactions.commits).toBe(1);
  });

  it('재구독 안전망: 활성 유료 구독이 있으면 음성은 남기고 행만 거둔다', async () => {
    mockDB.pushResult([{ user_id: 'user-pk-9' }]);
    mockDB.pushResult([], 1); // claim 성공
    mockDB.pushResult([{ id: 'sub-new' }]); // 활성 유료 구독 존재

    await sweepPaidVoiceRetention(mockDB.client as never, new Date());

    expect(findCall('DELETE FROM voice_profiles')).toBeUndefined();
    expect(findCall('DELETE FROM paid_voice_retention')).toBeDefined();
  });

  it('C6 경합 하드닝: 목록 조회 후 유예가 연장됐으면(claim rowsAffected=0) 음성을 삭제하지 않는다', async () => {
    mockDB.pushResult([{ user_id: 'user-pk-9' }]); // 목록 시점엔 만기 도래
    mockDB.pushResult([], 0); // 그 사이 재해지/연장으로 delete_after 가 미래로 밀림 → claim 실패

    await sweepPaidVoiceRetention(mockDB.client as never, new Date());

    expect(findCall('DELETE FROM voice_profiles')).toBeUndefined();
    expect(findCall('DELETE FROM messages')).toBeUndefined();
    // 트랜잭션은 정상 커밋(스킵일 뿐 에러 아님) — 다음 run 에 재평가된다.
    expect(mockDB.transactions.commits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 재구독 시 보관 해제 (applyStoreEntitlement)
// ---------------------------------------------------------------------------
describe('applyStoreEntitlement — paid_voice_retention 해제', () => {
  const PLAN = {
    id: 'plan-1',
    key: 'personal',
    name: '개인',
    plan_type: 'personal',
    period_days: 30,
    max_members: 1,
    price_krw: 4900,
  };

  it('갱신(같은 트랜잭션 재전송) 분기에서 보관 행을 삭제한다', async () => {
    mockDB.pushResult([{ user_id: 'user-pk-1', subscription_id: 'sub-1' }]); // 기존 트랜잭션
    mockDB.pushResult([{ plan_id: 'plan-1' }]); // currentSubscriptionPlanId — 동일 plan

    const result = await applyStoreEntitlement(mockDB.client as never, {
      userPk: 'user-pk-1',
      provider: 'google',
      providerTransactionId: 'play-token-1',
      productId: 'personal_monthly',
      plan: PLAN,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    expect(result.ok).toBe(true);
    const retentionDelete = findCall('DELETE FROM paid_voice_retention');
    expect(retentionDelete).toBeDefined();
    expect(retentionDelete?.args).toEqual(['user-pk-1']);
  });

  it('신규 트랜잭션(재구독) 분기에서도 보관 행을 삭제한다', async () => {
    mockDB.pushResult([]); // 기존 트랜잭션 없음
    mockDB.pushResult([]); // 활성 구독 없음

    const result = await applyStoreEntitlement(mockDB.client as never, {
      userPk: 'user-pk-1',
      provider: 'google',
      providerTransactionId: 'play-token-2',
      productId: 'personal_monthly',
      plan: PLAN,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    expect(result.ok).toBe(true);
    expect(findCall('DELETE FROM paid_voice_retention')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// processSubscriptionExpiry — Play reconciliation (RTDN 유실 대비)
// ---------------------------------------------------------------------------
describe('processSubscriptionExpiry — Play reconciliation', () => {
  const NOW = new Date('2026-07-18T00:00:00.000Z');
  const PAST = '2026-07-17T23:00:00.000Z'; // 1시간 전 만료 (72h 이내)
  const VERY_PAST = '2026-07-10T00:00:00.000Z'; // 8일 전 만료 (72h 초과)
  const PLAY_FUTURE = '2026-08-01T00:00:00.000Z';

  const DUE_ROW = {
    sub_id: 'sub-1',
    user_id: 'user-pk-1',
    plan_id: 'plan-1',
    plan_group_id: null,
    next_plan_id: null,
    expires_at: PAST,
    plan_type: 'personal',
  };

  it('DB 만료가 지났어도 Play 가 미래 expiryTime 을 반환하면 만료 대신 연장한다', async () => {
    stubPlayFetch(200, {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [
        {
          productId: 'personal_monthly',
          expiryTime: PLAY_FUTURE,
          autoRenewingPlan: { autoRenewEnabled: false },
        },
      ],
    });
    mockDB.pushResult([DUE_ROW]); // cancel_at_period_end=1 만기 도래
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]); // google 트랜잭션
    mockDB.pushResult([], 1); // UPDATE subscriptions (연장)
    mockDB.pushResult([], 1); // UPDATE voucher_codes
    mockDB.pushResult([], 1); // UPDATE users.plan
    mockDB.pushResult([], 1); // UPDATE store_transactions
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, PLAY_ENV, NOW);

    // 만료(취소) 처리 없이 Play 값으로 연장됐는지.
    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();
    const extendCall = findCall('UPDATE subscriptions');
    expect(extendCall?.args[0]).toBe(PLAY_FUTURE);
    // autoRenewEnabled=false → cancel_at_period_end=1 유지.
    expect(extendCall?.args[1]).toBe(1);
    expect(extendCall?.args[2]).toBe('sub-1');
    // users.plan 유지 (personal → plus).
    expect(findCall('UPDATE users SET plan')?.args[0]).toBe('plus');
  });

  it('C14: CANCELED 인데 만료가 미래면(기간종료 해지 예약) 강등 대신 연장 + cancel_at_period_end=1', async () => {
    // RTDN 경로(decideSubscriptionAction)와 동일 규칙 — CANCELED + 만료 미래는
    // 기간까지 권한 유지다. ENTITLED_STATES 만 보면 cron 이 조기 강등한다.
    stubPlayFetch(200, {
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
      lineItems: [
        {
          productId: 'personal_monthly',
          expiryTime: PLAY_FUTURE,
          autoRenewingPlan: { autoRenewEnabled: false },
        },
      ],
    });
    mockDB.pushResult([DUE_ROW]); // cancel_at_period_end=1 만기 도래
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]); // google 트랜잭션
    mockDB.pushResult([], 1); // UPDATE subscriptions (연장)
    mockDB.pushResult([], 1); // UPDATE voucher_codes
    mockDB.pushResult([], 1); // UPDATE users.plan
    mockDB.pushResult([], 1); // UPDATE store_transactions
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, PLAY_ENV, NOW);

    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();
    const extendCall = findCall('UPDATE subscriptions');
    expect(extendCall?.args[0]).toBe(PLAY_FUTURE);
    // CANCELED → 기간종료 해지 예약 유지.
    expect(extendCall?.args[1]).toBe(1);
    expect(extendCall?.args[2]).toBe('sub-1');
  });

  it('C14: CANCELED + 만료 지남은 진짜 만료 — 정상 강등한다', async () => {
    stubPlayFetch(200, {
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
      lineItems: [{ productId: 'personal_monthly', expiryTime: PAST }],
    });
    mockDB.pushResult([DUE_ROW]);
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]);

    await processSubscriptionExpiry(mockDB.client as never, PLAY_ENV, NOW);

    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
  });

  it('Play 조회 실패 + 만료 72h 이내면 이번 run 은 스킵한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mockDB.pushResult([DUE_ROW]);
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]);
    mockDB.pushResult([]); // 일반 만료 대상 없음
    mockDB.pushResult([]); // sweep 대상 없음

    await processSubscriptionExpiry(mockDB.client as never, PLAY_ENV, NOW);

    expect(findCall("status = 'cancelled'")).toBeUndefined();
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('Play 조회 실패라도 만료가 72h 넘게 지났으면 만료를 강행한다 (영구 좀비 방지)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mockDB.pushResult([{ ...DUE_ROW, expires_at: VERY_PAST }]);
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]);

    await processSubscriptionExpiry(mockDB.client as never, PLAY_ENV, NOW);

    expect(findCall("status = 'cancelled'")).toBeDefined();
    // 만료 처리도 하드삭제 대신 30일 보관 예약.
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
    expect(findCall('DELETE FROM voice_profiles')).toBeUndefined();
  });

  it('env 미설정이면 재조회 없이 현행대로 만료 처리한다', async () => {
    const fetchMock = stubPlayFetch(200, {});
    mockDB.pushResult([DUE_ROW]);
    mockDB.pushResult([{ provider_transaction_id: 'play-token-1' }]);

    await processSubscriptionExpiry(mockDB.client as never, undefined, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findCall("status = 'cancelled'")).toBeDefined();
    expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /billing/google/confirm — 구매-계정 바인딩 검증 (C4)
// ---------------------------------------------------------------------------
describe('POST /billing/google/confirm — 계정 바인딩 (C4)', () => {
  function buildGoogleApp(userId = 'google-1') {
    const app = new Hono<AppEnv>();
    app.use('*', fakeAuthMiddleware(userId));
    app.route('/billing', billingGoogle);
    return app;
  }

  // 서버 구현(billing-google.ts sha256Hex)과 동일한 계산 — 계약값 생성용.
  async function sha256HexOf(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const FUTURE_EXPIRY = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const CONFIRM_SUB = {
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [{ productId: 'personal_monthly', expiryTime: FUTURE_EXPIRY }],
    latestOrderId: 'order-1',
  };
  const CONFIRM_BODY = { purchase_token: 'play-token-1', product_id: 'personal_monthly' };
  const PLAN_ROW = {
    id: 'plan-1',
    key: 'personal',
    name: '개인',
    plan_type: 'personal',
    period_days: 30,
    max_members: 1,
    price_krw: 4900,
  };

  /** entitlement 성공 경로에 필요한 DB 결과를 순서대로 push 한다. */
  function pushConfirmHappyPathResults() {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([PLAN_ROW]); // loadPlanByKey
    mockDB.pushResult([]); // applyStoreEntitlement — 기존 store_transactions 없음
    mockDB.pushResult([]); // cancelActiveSubscriptionsForUser — 활성 구독 없음
  }

  it('obfuscatedExternalAccountId 가 호출자 해시와 다르면 403 TRANSACTION_ACCOUNT_MISMATCH + DB 무변경', async () => {
    stubPlayFetch(200, {
      ...CONFIRM_SUB,
      externalAccountIdentifiers: { obfuscatedExternalAccountId: 'a'.repeat(64) },
    });
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk

    const res = await buildGoogleApp().request(
      jsonReq('POST', '/billing/google/confirm', CONFIRM_BODY),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('TRANSACTION_ACCOUNT_MISMATCH');
    expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('sha256hex(로그인 사용자 id — JWT sub) 와 일치하면 통과한다', async () => {
    stubPlayFetch(200, {
      ...CONFIRM_SUB,
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: await sha256HexOf('google-1'),
      },
    });
    pushConfirmHappyPathResults();

    const res = await buildGoogleApp().request(
      jsonReq('POST', '/billing/google/confirm', CONFIRM_BODY),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.plan_key).toBe('personal');
    expect(findCall('INSERT OR REPLACE INTO store_transactions')).toBeDefined();
  });

  it('sha256hex(userPk) 와 일치해도 통과한다', async () => {
    stubPlayFetch(200, {
      ...CONFIRM_SUB,
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: await sha256HexOf('user-pk-1'),
      },
    });
    pushConfirmHappyPathResults();

    const res = await buildGoogleApp().request(
      jsonReq('POST', '/billing/google/confirm', CONFIRM_BODY),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('식별자가 없으면(계약 이전 구버전 구매) 기존대로 허용한다', async () => {
    stubPlayFetch(200, CONFIRM_SUB);
    pushConfirmHappyPathResults();

    const res = await buildGoogleApp().request(
      jsonReq('POST', '/billing/google/confirm', CONFIRM_BODY),
      undefined,
      PLAY_ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(findCall('INSERT OR REPLACE INTO store_transactions')).toBeDefined();
  });
});
