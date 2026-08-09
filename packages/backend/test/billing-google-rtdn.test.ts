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
      // plan 재정렬(E2)을 위한 남은 활성 구독 '조회'는 허용된다 — 사용자 전체 '취소'가
      // 없다는 보장은 위의 cancelCalls(1건·WHERE id = ? 스코프) 단언이 담당한다.
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

    // -------------------------------------------------------------------------
    // D: RTDN entitle 경로 서버측 ack — 앱 미실행으로 confirm 이 안 와도 RTDN 이
    //    ack 재시도 경로가 되게 한다 (미ack → 3일 후 Play 자동 환불 방지).
    // -------------------------------------------------------------------------
    const PLAN_ROW = {
      id: 'plan-1',
      key: 'personal',
      name: '개인',
      plan_type: 'personal',
      period_days: 30,
      max_members: 1,
      price_krw: 4900,
    };

    it('entitle 시 acknowledgement 이 PENDING 이면 서버가 :acknowledge 를 호출한다 (D)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
              acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
              lineItems: [{ productId: 'personal_monthly', expiryTime: FUTURE }],
            }),
            { status: 200 },
          ),
        ) // 권위 재조회
        .mockResolvedValueOnce(new Response('{}', { status: 200 })); // :acknowledge 성공
      vi.stubGlobal('fetch', fetchMock);
      mockDB.pushResult([TXN_ROW]); // store_transactions 매핑
      mockDB.pushResult([PLAN_ROW]); // loadPlanByKey
      mockDB.pushResult([TXN_ROW]); // applyStoreEntitlement 기존 트랜잭션
      mockDB.pushResult([{ plan_id: 'plan-1' }]); // currentSubscriptionPlanId — 동일 plan → 갱신 분기

      const res = await buildApp().request(rtdnRequest(2), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('entitled');
      // 권위 lookup 다음 두 번째 fetch 가 :acknowledge 여야 한다.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1]![0])).toContain(
        '/purchases/subscriptions/personal_monthly/tokens/play-token-old:acknowledge',
      );
    });

    it('entitle 시 이미 ACKNOWLEDGED 면 ack 를 호출하지 않는다 (D)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            lineItems: [{ productId: 'personal_monthly', expiryTime: FUTURE }],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([PLAN_ROW]);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([{ plan_id: 'plan-1' }]);

      const res = await buildApp().request(rtdnRequest(2), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      // lookup 한 번뿐 — ack 호출 없음.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // E: suspend(ON_HOLD/PAUSED)도 잔여 활성 유료 구독을 존중 (deactivate E2 와 대칭).
    //    매핑(정지된) 구독을 제외한 다른 활성 유료 구독이 있으면 free 로 내리지 않는다.
    // -------------------------------------------------------------------------
    it('suspend 시 매핑 구독 외 다른 활성 유료 구독이 있으면 그 plan 을 유지한다 (E)', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_ON_HOLD', FUTURE);
      mockDB.pushResult([TXN_ROW]); // store_transactions 매핑 (subscription_id='sub-old')
      mockDB.pushResult([ACTIVE_MAPPED_ROW]); // 매핑 구독이 현재 활성 (게이트 통과)
      mockDB.pushResult([
        { sub_id: 'sub-other', user_id: 'user-pk-1', plan_id: 'plan-2', plan_group_id: null, plan_type: 'family', plan_key: 'family' },
        { sub_id: 'sub-old', user_id: 'user-pk-1', plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
      ]); // 남은 활성 구독 (매핑 sub-old + 다른 유료 sub-other)

      const res = await buildApp().request(rtdnRequest(5), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('suspended');
      // 매핑(sub-old) 제외한 다른 활성 유료 구독(family)의 plan 으로 유지 — free 강등 아님.
      expect(findCall('UPDATE users SET plan = ?')?.args).toEqual(['family', 'user-pk-1']);
      expect(findCall("plan = 'free'")).toBeUndefined();
      // 회복형 상태 — 음성 접근 정리(is_shared 해제·타인 알람 강등)는 하지 않는다.
      expect(findCall('UPDATE voice_profiles')).toBeUndefined();
      expect(findCall('UPDATE alarms')).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // 보류는 **그룹 전체**에 전파된다.
    //
    // ⚠ 예전에는 소유자만 free 가 되고 멤버는 유료 그대로였다 — 소유자는 돈을 안 내는데
    //    가족·커플 전원이 최대 30일(Play 계정보류)간 유료 기능을 계속 썼다. 게다가 멤버
    //    화면에는 공유 목소리가 멀쩡히 보이는데 그걸로 새 알람을 만들면 404 로 막혔다.
    // ⚠ 그룹 구조는 **보존**해야 한다 — 결제가 복구되면 재초대 없이 살아나야 한다.
    // -------------------------------------------------------------------------
    it('suspend 시 그룹 멤버도 함께 free 로 내리되 그룹은 보존한다', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_ON_HOLD', FUTURE);
      mockDB.pushResult([TXN_ROW]);
      // 매핑 구독이 그룹 소유 구독이다.
      mockDB.pushResult([{ plan_id: 'plan-fam', plan_group_id: 'grp-1', plan_type: 'family', plan_key: 'family' }]);
      // 소유자 재계산 — 남은 건 정지된 구독뿐 → free
      mockDB.pushResult([
        { sub_id: 'sub-old', user_id: 'user-pk-1', plan_id: 'plan-fam', plan_group_id: 'grp-1', plan_type: 'family', plan_key: 'family' },
      ]);
      mockDB.pushResult([], 1); // UPDATE users SET plan (소유자 → free)
      // 그룹 멤버 목록
      mockDB.pushResult([{ user_id: 'member-1' }]);
      mockDB.pushResult([{ plan: 'family' }]); // 멤버 plan(before)
      mockDB.pushResult([{ id: 'sub-member-1' }]); // 멤버의 그룹 구독
      mockDB.pushResult([
        { sub_id: 'sub-member-1', user_id: 'member-1', plan_id: 'plan-fam', plan_group_id: 'grp-1', plan_type: 'family', plan_key: 'family' },
      ]); // 멤버 재계산 대상(제외되면 유료 없음)
      mockDB.pushResult([], 1); // UPDATE users SET plan (멤버 → free)
      mockDB.pushResult([{ plan: 'free' }]); // 멤버 plan(after)
      mockDB.pushResult([]); // FCM 토큰 조회(소유자)
      mockDB.pushResult([]); // FCM 토큰 조회(멤버)

      const res = await buildApp().request(rtdnRequest(5), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('suspended');

      // 소유자와 멤버 **둘 다** free 로 내려간다.
      const planUpdates = mockDB.calls.filter((c) => c.sql.includes('UPDATE users SET plan = ?'));
      expect(planUpdates.map((c) => c.args)).toEqual([
        ['free', 'user-pk-1'],
        ['free', 'member-1'],
      ]);

      // ⚠ 그룹·멤버십·구독 행은 건드리지 않는다(재초대 없이 복구되어야 한다).
      expect(findCall('DELETE FROM plan_group_members')).toBeUndefined();
      expect(findCall('DELETE FROM plan_groups')).toBeUndefined();
      expect(findCall("status = 'cancelled'")).toBeUndefined();
      // 회복형이라 음성 접근 정리도 하지 않는다.
      expect(findCall('UPDATE voice_profiles')).toBeUndefined();
    });

    it('suspend 시 매핑 구독뿐이면(다른 유료 구독 없음) free 로 내린다 (E)', async () => {
      stubPlayLookup('SUBSCRIPTION_STATE_PAUSED', FUTURE);
      mockDB.pushResult([TXN_ROW]);
      mockDB.pushResult([ACTIVE_MAPPED_ROW]);
      mockDB.pushResult([
        { sub_id: 'sub-old', user_id: 'user-pk-1', plan_id: 'plan-1', plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
      ]); // 남은 활성 구독은 매핑(정지된) 구독뿐 → 제외하면 유료 없음

      const res = await buildApp().request(rtdnRequest(6), undefined, RTDN_ENV);

      expect(res.status).toBe(200);
      expect((await res.json()).action).toBe('suspended');
      expect(findCall('UPDATE users SET plan = ?')?.args).toEqual(['free', 'user-pk-1']);
      // 회복형 free 강등은 음성 접근 정리 없이 users.plan 만 회수한다.
      expect(findCall('UPDATE voice_profiles')).toBeUndefined();
      expect(findCall('UPDATE alarms')).toBeUndefined();
    });
  });
});
