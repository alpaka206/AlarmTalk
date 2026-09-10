// **결제 보류 알림이 두 플랫폼에 같은 두 통을 보내는가.**
//
// ⚠ 표시용 한 통만으로는 부족하다. 알림에는 `content-available` 이 없어 **앱이
// 백그라운드면 깨어나지 않는다** — 사용자가 앱을 열기 전까지 서버 플랜을 다시 읽지 못하고,
// **이미 예약된 유료 목소리 알람이 계속 그 목소리로 울린다**(iOS 는 예약 시점에 소리가
// 고정된다). 예전에는 안드로이드만 두 통을 받았다(코덱스 #732 P1).
//
// 클라는 이미 이 짝을 전제로 쓰여 있다 — iOS `PushNotificationCoordinator` 의
// `billingHold` 는 "표시 전용, 짝이 되는 data-only `plan_changed` 가 재조회를 담당한다"
// 고 적고 아무 일도 하지 않는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

const sendApnsNotifications = vi.fn().mockResolvedValue([]);
const sendPushNotifications = vi.fn().mockResolvedValue([]);

vi.mock('../src/lib/apns', () => ({
  sendApnsNotifications: (...args: unknown[]) => sendApnsNotifications(...args),
  apnsConfigFromEnv: () => ({ useSandbox: true }),
  pruneDeadApnsTokens: vi.fn().mockResolvedValue(undefined),
}));

import { sendPaymentFailedPush } from '../src/lib/fcm';

const ENV = {
  FIREBASE_PROJECT_ID: 'p',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  APNS_KEY_ID: 'K',
  APNS_PRIVATE_KEY: 'pk',
  APPLE_TEAM_ID: 'T',
  APPLE_BUNDLE_ID: 'com.alarmtalk.app',
} as never;

/** 한 사람의 기기 목록. `getPushTargetsForUser` 가 이 한 줄을 읽는다. */
function pushTargets(rows: Array<{ token: string; platform: string }>) {
  mockDB.pushResult(rows);
}

beforeEach(() => {
  mockDB.reset();
  sendApnsNotifications.mockClear();
  sendPushNotifications.mockClear();
  // FCM 실전송은 fetch 를 모킹해 막는다(자격은 가짜라 서명 전에 가로챈다).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendPaymentFailedPush — 표시용 + 신호용 두 통', () => {
  it('iOS 는 알림 한 통과 **조용한 신호** 한 통을 받는다', async () => {
    pushTargets([{ token: 'ios-tok', platform: 'ios' }]);

    await sendPaymentFailedPush(mockDB.client as never, ENV, {
      ownerUserPk: 'owner',
      memberUserPks: [],
    });

    const messages = sendApnsNotifications.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);

    const visible = messages.find((m) => m.silent !== true)!;
    expect(visible.title).toBe('결제가 확인되지 않았어요');
    expect(visible.data).toEqual({ type: 'billing_hold' });

    const silent = messages.find((m) => m.silent === true)!;
    // ⚠ `silent` 가 `content-available: 1` + background 우선순위를 만든다(`lib/apns.ts`).
    //   이게 없으면 앱이 백그라운드에서 깨어나지 않는다.
    expect(silent.data).toEqual({ type: 'plan_changed' });
    expect(silent.title).toBe('');
  });

  it('안드로이드도 같은 두 통이다 — 표시용은 소셜 채널로', async () => {
    pushTargets([{ token: 'and-tok', platform: 'android' }]);

    await sendPaymentFailedPush(mockDB.client as never, ENV, {
      ownerUserPk: 'owner',
      memberUserPks: [],
    });

    // FCM 전송은 fetch 로 나가므로 payload 를 직접 못 보지만, APNs 로는 아무것도 안 간다.
    expect(sendApnsNotifications).not.toHaveBeenCalled();
  });

  it('ownerUserPk 가 null 이면 소유자에게는 보내지 않는다', async () => {
    // 크론이 같은 보류를 5분마다 다시 발견하므로, 소유자 플랜이 실제로 바뀐 회차에만
    // 소유자를 넣는다(`processSubscriptionExpiry` 의 `paymentHolds`).
    pushTargets([{ token: 'member-ios', platform: 'ios' }]);

    await sendPaymentFailedPush(mockDB.client as never, ENV, {
      ownerUserPk: null,
      memberUserPks: ['member-1'],
    });

    const messages = sendApnsNotifications.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const visible = messages.find((m) => m.silent !== true)!;
    // 소유자 문구가 아니라 멤버 문구여야 한다.
    expect(visible.title).toBe('함께 쓰는 이용권이 멈췄어요');
    // 기기 목록 조회도 멤버 것 한 번뿐이다.
    expect(mockDB.calls).toHaveLength(1);
    expect(mockDB.calls[0]!.args).toContain('member-1');
  });

  it('소유자가 멤버 목록에 섞여 들어와도 두 번 보내지 않는다', async () => {
    pushTargets([{ token: 'ios-tok', platform: 'ios' }]);

    await sendPaymentFailedPush(mockDB.client as never, ENV, {
      ownerUserPk: 'owner',
      memberUserPks: ['owner'],
    });

    expect(mockDB.calls).toHaveLength(1);
  });
});
