// 강등 알림 팬아웃 가드 (Codex #654).
//
// 팬아웃 규칙은 순수 함수로, 실제 플랫폼 분기는 notifyDowngradedAlarms까지 태워 검증한다.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMockDB } from './helpers';
import { buildDowngradeSignals, notifyDowngradedAlarms } from '../src/lib/fcm';

afterEach(() => vi.unstubAllGlobals());

describe('buildDowngradeSignals 팬아웃', () => {
  it('같은 주인의 알람이 여러 개여도 한 번만 만든다', () => {
    const signals = buildDowngradeSignals([
      { alarmId: 'al-1', ownerUserId: 'owner' },
      { alarmId: 'al-2', ownerUserId: 'owner' },
      { alarmId: 'al-3', ownerUserId: 'owner' },
    ]);

    expect(signals).toEqual([{ userId: 'owner', data: { type: 'voice_access_revoked' } }]);
  });

  it('주인이 여럿이면 각자 한 번씩', () => {
    const signals = buildDowngradeSignals([
      { alarmId: 'al-1', ownerUserId: 'a' },
      { alarmId: 'al-2', ownerUserId: 'b' },
      { alarmId: 'al-3', ownerUserId: 'a' },
    ]);

    expect(signals.map((signal) => signal.userId).sort()).toEqual(['a', 'b']);
  });

  it('신호는 언제나 계정 단위 voice_access_revoked 하나다 — 알람 id 를 싣지 않는다', () => {
    const signals = buildDowngradeSignals(
      [
        { alarmId: 'al-1', ownerUserId: 'a' },
        { alarmId: 'al-2', ownerUserId: 'b' },
      ],
      ['c'],
    );

    expect(signals.map((signal) => signal.data)).toEqual([
      { type: 'voice_access_revoked' },
      { type: 'voice_access_revoked' },
      { type: 'voice_access_revoked' },
    ]);
  });

  it('알람 행이 없어도 접근권 상실 계정에는 만든다', () => {
    expect(buildDowngradeSignals([], ['user-1'])).toEqual([
      { userId: 'user-1', data: { type: 'voice_access_revoked' } },
    ]);
  });

  it('알람 주인과 접근권 상실 계정이 겹쳐도 한 번만', () => {
    const signals = buildDowngradeSignals([{ alarmId: 'al-1', ownerUserId: 'me' }], ['me']);

    expect(signals).toEqual([{ userId: 'me', data: { type: 'voice_access_revoked' } }]);
  });

  it('제자리 교체면 그 프로필 id·범위·세대를 싣는다 — 클라가 그 목소리의 직접 입력 알람만 정리한다', () => {
    const signals = buildDowngradeSignals([], ['owner'], {
      replacedVoiceProfileId: 'vp-1',
      replacedGeneration: '2026-10-20 00:00:00',
    });

    expect(signals).toEqual([
      {
        userId: 'owner',
        data: {
          type: 'voice_access_revoked',
          voiceProfileId: 'vp-1',
          scope: 'custom_messages',
          invalidatedAt: '2026-10-20 00:00:00',
        },
      },
    ]);
  });

  it('대상이 없으면 빈 목록', () => {
    expect(buildDowngradeSignals([], [])).toEqual([]);
  });
});

describe('notifyDowngradedAlarms 플랫폼 라우팅', () => {
  it('iOS 토큰에는 FCM이 아니라 APNs background push를 보낸다', async () => {
    const mockDB = createMockDB();
    mockDB.pushResult([{ uid: 'owner', gid: null, token: 'ios-device-token', platform: 'ios' }]);

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
      [{ alarmId: 'al-1', ownerUserId: 'owner' }],
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.sandbox.push.apple.com/3/device/ios-device-token');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['apns-push-type']).toBe('background');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.aps).toEqual({ 'content-available': 1 });
    expect(body).toMatchObject({ type: 'voice_access_revoked' });
  });
});
