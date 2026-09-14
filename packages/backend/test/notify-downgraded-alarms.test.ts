// 강등 알림 팬아웃 가드 (Codex #654).
//
// 팬아웃 규칙은 순수 함수로, 실제 플랫폼 분기는 notifyDowngradedAlarms까지 태워 검증한다.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMockDB } from './helpers';
import { buildDowngradeSignals, notifyDowngradedAlarms } from '../src/lib/fcm';

afterEach(() => vi.unstubAllGlobals());

describe('buildDowngradeSignals 팬아웃', () => {
  it('같은 수신자의 알람이 여러 개여도 한 번만 만든다', () => {
    const signals = buildDowngradeSignals([
      { alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-3', ownerUserId: 'recipient', isReceived: true },
    ]);

    expect(signals).toEqual([
      { userId: 'recipient', data: { type: 'family_alarm', alarmId: 'al-1' } },
    ]);
  });

  it('수신자가 여럿이면 각자 한 번씩', () => {
    const signals = buildDowngradeSignals([
      { alarmId: 'al-1', ownerUserId: 'a', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'b', isReceived: true },
      { alarmId: 'al-3', ownerUserId: 'a', isReceived: true },
    ]);

    expect(signals.map((signal) => signal.userId).sort()).toEqual(['a', 'b']);
  });

  it('받은 알람과 본인 소유 알람에 서로 다른 신호를 만든다', () => {
    const signals = buildDowngradeSignals([
      { alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'owner', isReceived: false },
    ]);

    expect(signals.map((signal) => signal.data.type).sort()).toEqual([
      'family_alarm',
      'voice_access_revoked',
    ]);
  });

  it('알람 행이 없어도 접근권 상실 계정에는 만든다', () => {
    expect(buildDowngradeSignals([], ['user-1'])).toEqual([
      { userId: 'user-1', data: { type: 'voice_access_revoked' } },
    ]);
  });

  it('본인 소유 알람 주인과 접근권 상실 계정이 겹쳐도 한 번만', () => {
    const signals = buildDowngradeSignals(
      [{ alarmId: 'al-1', ownerUserId: 'me', isReceived: false }],
      ['me'],
    );

    expect(signals).toEqual([{ userId: 'me', data: { type: 'voice_access_revoked' } }]);
  });

  it('대상이 없으면 빈 목록', () => {
    expect(buildDowngradeSignals([], [])).toEqual([]);
  });
});

describe('notifyDowngradedAlarms 플랫폼 라우팅', () => {
  it('iOS 토큰에는 FCM이 아니라 APNs background push를 보낸다', async () => {
    const mockDB = createMockDB();
    mockDB.pushResult([{ token: 'ios-device-token', platform: 'ios' }]);

    const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDowngradedAlarms(
      mockDB.client as never,
      {
        APNS_KEY_ID: 'KEY1234567',
        APNS_PRIVATE_KEY: privateKey,
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_BUNDLE_ID: 'com.alarmtalk.app',
        ENVIRONMENT: 'development',
      },
      [{ alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true }],
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.sandbox.push.apple.com/3/device/ios-device-token');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['apns-push-type']).toBe('background');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.aps).toEqual({ 'content-available': 1 });
    expect(body).toMatchObject({ type: 'family_alarm', alarmId: 'al-1' });
  });
});
