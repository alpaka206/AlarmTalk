import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

// Play 검증은 글로벌 fetch 로만 스텁한다 — OAuth(JWT 서명)는 실 키가 필요하므로 모듈 목.
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

import billingGoogleRtdn, {
  parseDeveloperNotification,
  decideSubscriptionAction,
  selectAuthoritativeLineItem,
} from '../src/routes/billing-google-rtdn';

function pubsubEnvelope(notification: unknown): { message: { data: string } } {
  const json = JSON.stringify(notification);
  const b64 = Buffer.from(json, 'utf-8').toString('base64');
  return { message: { data: b64 } };
}

describe('billing google RTDN', () => {
  describe('parseDeveloperNotification', () => {
    it('Pub/Sub 엔벨로프의 base64 data 를 DeveloperNotification 으로 디코드한다', () => {
      const env = pubsubEnvelope({
        version: '1.0',
        packageName: 'com.alarmtalk.app',
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'tok_123',
          subscriptionId: 'personal_monthly',
        },
      });
      const parsed = parseDeveloperNotification(env);
      expect(parsed?.packageName).toBe('com.alarmtalk.app');
      expect(parsed?.subscriptionNotification?.purchaseToken).toBe('tok_123');
      expect(parsed?.subscriptionNotification?.subscriptionId).toBe('personal_monthly');
    });

    it('UTF-8(한글) 페이로드도 깨지지 않는다', () => {
      const parsed = parseDeveloperNotification(pubsubEnvelope({ packageName: '한글앱' }));
      expect(parsed?.packageName).toBe('한글앱');
    });

    it('testNotification 도 파싱된다', () => {
      const parsed = parseDeveloperNotification(
        pubsubEnvelope({ testNotification: { version: '1.0' } }),
      );
      expect(parsed?.testNotification).toBeDefined();
    });

    it('data 가 없거나 형식이 잘못되면 null', () => {
      expect(parseDeveloperNotification(null)).toBeNull();
      expect(parseDeveloperNotification({})).toBeNull();
      expect(parseDeveloperNotification({ message: {} })).toBeNull();
      expect(parseDeveloperNotification({ message: { data: 'not-base64-json!' } })).toBeNull();
    });
  });

  describe('decideSubscriptionAction', () => {
    const now = 1_000_000_000_000;
    const future = now + 86_400_000;
    const past = now - 86_400_000;

    it('ACTIVE + 만료 미래 → entitle', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', future, now)).toBe('entitle');
    });

    it('GRACE_PERIOD + 만료 미래 → entitle', () => {
      expect(
        decideSubscriptionAction('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', future, now),
      ).toBe('entitle');
    });

    it('CANCELED + 만료 미래 → cancel_at_period_end (기간까지 유지)', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_CANCELED', future, now)).toBe(
        'cancel_at_period_end',
      );
    });

    it('CANCELED + 만료 지남 → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_CANCELED', past, now)).toBe('deactivate');
    });

    it('EXPIRED → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_EXPIRED', past, now)).toBe('deactivate');
    });

    it('ON_HOLD / PAUSED / REVOKED → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ON_HOLD', future, now)).toBe('deactivate');
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_PAUSED', future, now)).toBe('deactivate');
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_REVOKED', past, now)).toBe('deactivate');
    });

    it('ACTIVE 라도 만료가 지났으면 deactivate (방어적)', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', past, now)).toBe('deactivate');
    });

    it('만료시각이 NaN 이면 deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', NaN, now)).toBe('deactivate');
    });
  });

  // 위조 RTDN 등급상승 방어: 등급 결정용 productId 는 알림 본문(위조 가능)이 아니라
  // 재조회한 lineItems(권위)에서 와야 한다.
  describe('selectAuthoritativeLineItem (위조 productId 등급상승 차단)', () => {
    it('위조된 상위 productId 알림이 와도 실제 구독 lineItem(저가) 을 고른다', () => {
      const lineItems = [{ productId: 'personal_monthly', expiryTime: '2999-01-01T00:00:00Z' }];
      // 공격자가 family_monthly 로 위조해도 → 실제 personal lineItem 이 선택됨
      const picked = selectAuthoritativeLineItem(lineItems, 'family_monthly');
      expect(picked?.productId).toBe('personal_monthly');
    });

    it('알림 productId 가 실제 lineItem 과 일치하면 그 항목을 고른다', () => {
      const lineItems = [
        { productId: 'personal_monthly' },
        { productId: 'family_monthly' },
      ];
      expect(selectAuthoritativeLineItem(lineItems, 'family_monthly')?.productId).toBe(
        'family_monthly',
      );
    });

    it('lineItems 가 없으면 undefined (등급 부여 불가)', () => {
      expect(selectAuthoritativeLineItem(undefined, 'family_monthly')).toBeUndefined();
      expect(selectAuthoritativeLineItem([], 'family_monthly')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 라우트 통합: 스테일 토큰 게이트 + 구독 단위 스코프 (C3)
  //
  // 재가입/플랜변경 직후 옛 purchaseToken 의 늦은 EXPIRED 알림이 사용자 전체 구독에
  // 작용하면 방금 결제한 신규 구독까지 취소된다 — 토큰에 매핑된 구독이 활성일 때만
  // 그 구독 한 건에 작용해야 한다.
  // -------------------------------------------------------------------------
  describe('POST /rtdn — 스테일 토큰 게이트 + 구독 단위 스코프', () => {
    const RTDN_ENV = {
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: 'svc@play.test',
        private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
      }),
      ANDROID_PACKAGE_NAME: 'com.alarmtalk.app',
      GOOGLE_RTDN_VERIFICATION_TOKEN: 'rtdn-secret',
    };
    const FUTURE = '2999-01-01T00:00:00.000Z';
    const PAST = '2020-01-01T00:00:00.000Z';

    function buildApp() {
      const app = new Hono<AppEnv>();
      app.route('/billing/google', billingGoogleRtdn);
      return app;
    }

    function rtdnRequest(notificationType: number) {
      return new Request('http://localhost/billing/google/rtdn?token=rtdn-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pubsubEnvelope({
            packageName: 'com.alarmtalk.app',
            subscriptionNotification: {
              notificationType,
              purchaseToken: 'play-token-old',
              subscriptionId: 'personal_monthly',
            },
          }),
        ),
      });
    }

    function stubPlayLookup(state: string, expiryTime: string) {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            subscriptionState: state,
            lineItems: [{ productId: 'personal_monthly', expiryTime }],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function findCall(sqlFragment: string) {
      return mockDB.calls.find((c) => c.sql.includes(sqlFragment));
    }

    const TXN_ROW = { user_id: 'user-pk-1', subscription_id: 'sub-old' };
    const ACTIVE_MAPPED_ROW = { plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal' };

    beforeEach(() => {
      mockDB.reset();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('스테일 토큰(비활성 구독 매핑) EXPIRED → 아무 것도 안 건드리고 200 ack', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_EXPIRED', PAST);
      mockDB.pushResult([TXN_ROW]); // store_transactions 매핑
      mockDB.pushResult([]); // 매핑 구독 활성 조회 미스 (이미 취소/교체된 옛 구독)

      const res = await buildApp().request(rtdnRequest(13), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe('stale_token');
      // 신규 활성 구독 무손상: 어떤 쓰기도 없어야 한다.
      expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
      expect(findCall('INSERT INTO paid_voice_retention')).toBeUndefined();
      expect(mockDB.transactions.commits).toBe(0);
    });

    it('매핑에 subscription_id 가 없어도(NULL) 스코프 불가로 무시한다', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_EXPIRED', PAST);
      mockDB.pushResult([{ user_id: 'user-pk-1', subscription_id: null }]);

      const res = await buildApp().request(rtdnRequest(13), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe('stale_token');
      expect(mockDB.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
    });

    it('활성 매핑 구독 EXPIRED → 그 구독 한 건만 취소 (사용자 전체 취소 아님)', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_EXPIRED', PAST);
      mockDB.pushResult([TXN_ROW]); // store_transactions 매핑
      mockDB.pushResult([ACTIVE_MAPPED_ROW]); // 매핑 구독이 현재 활성

      const res = await buildApp().request(rtdnRequest(13), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('deactivated');

      // 취소 UPDATE 는 구독 id 스코프 — WHERE id = ?
      const cancelCalls = mockDB.calls.filter((c) => c.sql.includes("status = 'cancelled'"));
      expect(cancelCalls).toHaveLength(1);
      expect(cancelCalls[0]!.sql).toContain("WHERE id = ? AND status = 'active'");
      expect(cancelCalls[0]!.args).toContain('sub-old');
      // 사용자 전체 활성 구독 나열(cancelActiveSubscriptionsForUser 경로)이 없어야 한다.
      expect(findCall('ORDER BY s.starts_at DESC')).toBeUndefined();
      // 30일 보관 예약은 유지된다 (sweep 이 삭제 전 활성 유료 구독을 재확인).
      expect(findCall('INSERT INTO paid_voice_retention')).toBeDefined();
      expect(mockDB.transactions.commits).toBe(1);
    });

    it('활성 매핑 구독 CANCELED(기간 남음) → cancel_at_period_end 도 그 구독만', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_CANCELED', FUTURE);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([ACTIVE_MAPPED_ROW]);

      const res = await buildApp().request(rtdnRequest(3), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('cancel_at_period_end');

      const scheduleCall = findCall('cancel_at_period_end = 1');
      expect(scheduleCall).toBeDefined();
      expect(scheduleCall!.sql).toContain("WHERE id = ? AND status = 'active'");
      expect(scheduleCall!.args).toEqual([FUTURE, 'sub-old']);

      const voucherCall = findCall('UPDATE voucher_codes');
      expect(voucherCall).toBeDefined();
      expect(voucherCall!.sql).toContain('issuer_subscription_id = ?');
      expect(voucherCall!.sql).not.toContain('issuer_user_id');
      expect(voucherCall!.args).toEqual([FUTURE, 'sub-old']);
    });

    it('스테일 토큰 CANCELED 도 무시한다 (신규 구독 예약취소 오염 방지)', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_CANCELED', FUTURE);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([]); // 매핑 구독 비활성

      const res = await buildApp().request(rtdnRequest(3), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe('stale_token');
      expect(findCall('cancel_at_period_end = 1')).toBeUndefined();
    });

    it('스테일 토큰 ON_HOLD 도 무시한다 (신규 구독 사용자의 plan 강등 방지)', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_ON_HOLD', FUTURE);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([]); // 매핑 구독 비활성

      const res = await buildApp().request(rtdnRequest(5), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe('stale_token');
      expect(findCall("plan = 'free'")).toBeUndefined();
    });

    it('entitle(RENEWED)은 게이트 제외 — 매핑 구독이 비활성이어도 부활시킨다', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_ACTIVE', FUTURE);
      mockDB.pushResult([TXN_ROW]); // store_transactions 매핑 (라우트)
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
      mockDB.pushResult([TXN_ROW]); // applyStoreEntitlement 내부 기존 트랜잭션 조회
      mockDB.pushResult([{ plan_id: 'plan-1' }]); // currentSubscriptionPlanId — 동일 plan → 갱신 분기

      const res = await buildApp().request(rtdnRequest(2), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('entitled');
      // 갱신도 토큰에 매핑된 구독 스코프로만 작용한다 (store-billing 경로).
      const renewCall = findCall('SET expires_at = ?');
      expect(renewCall).toBeDefined();
      expect(renewCall!.args).toContain('sub-old');
    });
  });
});
