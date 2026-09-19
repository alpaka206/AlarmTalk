// **결제 상태 알림은 한 번에, 중복 없이, 보이는 예고 먼저**(2026-09-20).
//
// 재조회 신호(`plan_changed`)와 목소리 삭제 예고를 따로 보내면 토큰 조회·OAuth 가 두 번이고,
// 안드로이드는 같은 `plan_changed` 를 두 번 받았다(예고 짝에 이미 들어 있다). 가족 그룹이
// 통째로 바뀌는 처리에서 그 낭비만으로 워커 subrequest 한도(~50)를 넘겨 커밋 뒤 알림이
// 잘렸다. 받는 것은 플랫폼별로 예전과 같아야 한다 — 중복만 빠진다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();
const sendApnsNotifications = vi.fn().mockResolvedValue([]);
vi.mock('../src/lib/apns', () => ({
  sendApnsNotifications: (...args: unknown[]) => sendApnsNotifications(...args),
  apnsConfigFromEnv: () => ({ useSandbox: true }),
}));
vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => ({ client_email: 'svc@test', private_key: 'k' }),
  getGoogleAccessToken: vi.fn().mockResolvedValue('access'),
}));

import { sendBillingStateSignals } from '../src/lib/fcm';

const ENV = {
  FIREBASE_PROJECT_ID: 'p',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  APNS_KEY_ID: 'K',
  APNS_PRIVATE_KEY: 'pk',
  APPLE_TEAM_ID: 'T',
  APPLE_BUNDLE_ID: 'com.alarmtalk.app',
} as never;

type FcmBody = { message: { token: string; notification?: { title?: string }; data?: Record<string, string> } };
let fcmSent: FcmBody['message'][] = [];

beforeEach(() => {
  mockDB.reset();
  sendApnsNotifications.mockClear();
  fcmSent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      fcmSent.push((JSON.parse(String(init?.body)) as FcmBody).message);
      return new Response('{}', { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendBillingStateSignals', () => {
  it('안드로이드 예고 대상은 짝(표시 + 신호) 두 통뿐이고, 신호만 받는 사람은 한 통이다', async () => {
    mockDB.pushResult([
      { uid: 'warned', gid: null, token: 'and-warned', platform: 'android' },
      { uid: 'plain', gid: null, token: 'and-plain', platform: 'android' },
    ]);
    await sendBillingStateSignals(mockDB.client as never, ENV, {
      planChangedUserIds: ['warned', 'plain'],
      deletionWarningUserPks: ['warned'],
      retentionDays: 3,
    });
    const toWarned = fcmSent.filter((m) => m.token === 'and-warned');
    expect(toWarned.map((m) => m.data?.type)).toEqual(['voice_deletion_warning', 'plan_changed']);
    expect(fcmSent.filter((m) => m.token === 'and-plain').map((m) => m.data?.type)).toEqual(['plan_changed']);
    // 토큰은 한 번에 조회한다.
    expect(mockDB.calls.filter((c) => c.sql.includes('push_tokens'))).toHaveLength(1);
  });

  it('보이는 예고가 무음 신호보다 먼저 나간다 — 한도에 잘려도 되돌릴 수 없는 삭제의 예고는 간다', async () => {
    mockDB.pushResult([
      { uid: 'plain', gid: null, token: 'and-plain', platform: 'android' },
      { uid: 'warned', gid: null, token: 'and-warned', platform: 'android' },
    ]);
    await sendBillingStateSignals(mockDB.client as never, ENV, {
      planChangedUserIds: ['plain', 'warned'],
      deletionWarningUserPks: ['warned'],
      retentionDays: 3,
    });
    expect(fcmSent[0]!.data?.type).toBe('voice_deletion_warning');
  });

  it('iOS 는 예고 alert 와 앱을 깨우는 무음 신호를 둘 다 받는다(alert 는 앱을 깨우지 못한다)', async () => {
    mockDB.pushResult([{ uid: 'ios-user', gid: null, token: 'ios-tok', platform: 'ios' }]);
    await sendBillingStateSignals(mockDB.client as never, ENV, {
      planChangedUserIds: ['ios-user'],
      deletionWarningUserPks: ['ios-user'],
      retentionDays: 3,
    });
    const messages = sendApnsNotifications.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ title: '목소리가 곧 삭제돼요' });
    expect(messages[1]).toMatchObject({ silent: true, data: { type: 'plan_changed' } });
    expect(fcmSent).toHaveLength(0);
  });

  it('예고 대상이 아니면 무음 신호만 — 아직 유료인 사람에게 "삭제된다" 가 가지 않는다', async () => {
    mockDB.pushResult([{ uid: 'paid', gid: null, token: 'and-paid', platform: 'android' }]);
    await sendBillingStateSignals(mockDB.client as never, ENV, {
      planChangedUserIds: ['paid'],
      deletionWarningUserPks: [],
      retentionDays: 3,
    });
    expect(fcmSent.map((m) => m.data?.type)).toEqual(['plan_changed']);
    expect(fcmSent[0]!.notification).toBeUndefined();
  });
});
