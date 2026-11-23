/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

import {
  sendPushNotifications,
  sendVoiceShareChangedPush,
  pruneStaleTokens,
} from '../src/lib/fcm';

/** FCM 미설정 env — MOCK_SEND_UNCONFIGURED 경로. */
const unconfiguredEnv = {} as Parameters<typeof sendPushNotifications>[1];

/**
 * 실전송 경로용 가짜 자격. google-oauth 의 토큰 발급과 FCM 전송은
 * 글로벌 fetch 를 모킹해 검증한다 (실 키 불필요 — 서명 전에 fetch 가 가로챔).
 */
const RSA_TEST_ENV = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'svc@test-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  }),
} as Parameters<typeof sendPushNotifications>[1];

beforeEach(() => {
  mockDB.reset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 무음 신호 발송(`sendSilentSignalPush`)의 묶음 조회·중복 제거 — 예전에는 `sendPlanChangedPush`(2026-11-23 삭제)로 쟀다.
// 같은 발송부를 쓰는 `sendVoiceShareChangedPush` 로 잰다(신호 종류만 다르다).
describe('sendVoiceShareChangedPush — 무음 신호 묶음 발송', () => {
  it('대상 전원의 토큰을 한 번에 조회해 data 메시지를 만든다(중복 사용자 제거)', async () => {
    // ⚠ 사람마다 조회하지 않는다 — 조회 하나가 워커 subrequest 하나다(여러 사람을 한꺼번에 알리는 처리).
    mockDB.pushResult([
      { uid: 'user-1', gid: null, token: 'tok-a', platform: 'android' },
      { uid: 'user-2', gid: null, token: 'tok-b', platform: 'android' },
    ]);
    await sendVoiceShareChangedPush(mockDB.client as never, RSA_TEST_ENV, ['user-1', 'user-2', 'user-1']);
    const tokenQueries = mockDB.calls.filter((c) => c.sql.includes('push_tokens'));
    expect(tokenQueries).toHaveLength(1);
    // 중복을 뺀 두 사람이 PK·로그인 id 양쪽 자리에 한 번씩 들어간다.
    expect(tokenQueries[0].args).toEqual(['user-1', 'user-2', 'user-1', 'user-2']);
  });

  it('PK 와 로그인 id 가 같은 계정도 기기 하나에 한 통이다', async () => {
    // 이메일 계정은 첫 로그인 뒤 users.id == users.google_id 가 된다 — 조회 행 하나가 두 키에
    // 모두 걸린다. 두 번 넣으면 같은 기기에 두 통이 나간다(2026-09-20 검토에서 재현).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDB.pushResult([{ uid: 'email-u1', gid: 'email-u1', token: 'tok-email', platform: 'android' }]);
    await sendVoiceShareChangedPush(mockDB.client as never, unconfiguredEnv, ['email-u1']);
    // 자격 미설정 경로는 보낼 메시지마다 경고 한 줄을 남긴다 — 한 줄이어야 한 통이다.
    const sends = warnSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { action?: string; token?: string })
      .filter((line) => line.action === 'MOCK_SEND_UNCONFIGURED');
    expect(sends.map((line) => line.token)).toEqual(['tok-emai...']);
  });

  it('토큰이 하나도 없으면 전송하지 않는다(조기 반환)', async () => {
    mockDB.pushResult([]); // user-1 토큰 없음
    await sendVoiceShareChangedPush(mockDB.client as never, RSA_TEST_ENV, ['user-1']);
    // push_tokens 조회만 하고, 전송/정리 쿼리는 없다.
    expect(mockDB.calls.every((c) => c.sql.includes('push_tokens'))).toBe(true);
  });
});

describe('sendPushNotifications — 미설정(mock) 경로', () => {
  it('빈 배열이면 빈 결과', async () => {
    const results = await sendPushNotifications([], unconfiguredEnv);
    expect(results).toEqual([]);
  });

  it('자격 미설정이면 success=false + FCM_UNCONFIGURED', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await sendPushNotifications(
      [
        { token: 'tok-1', title: 'Test', body: 'Hello' },
        { token: 'tok-2', title: 'Test', body: 'World', data: { type: 'alarm' } },
      ],
      unconfiguredEnv,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ token: 'tok-1', success: false, error: 'FCM_UNCONFIGURED' });
    expect(results[1]).toEqual({ token: 'tok-2', success: false, error: 'FCM_UNCONFIGURED' });
  });

  it('미설정 시 MOCK_SEND_UNCONFIGURED 경고 로그 (토큰 마스킹)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendPushNotifications(
      [{ token: 'abcdefghijk', title: 'AlarmTalk', body: '알람' }],
      unconfiguredEnv,
    );
    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.action).toBe('MOCK_SEND_UNCONFIGURED');
    expect(logged.token).toBe('abcdefgh...');
    expect(logged.title).toBe('AlarmTalk');
  });
});

describe('sendPushNotifications — 실전송 경로 (fetch 모킹)', () => {
  it('OAuth 토큰 발급 후 FCM v1 endpoint 로 메시지를 보낸다', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), {
          status: 200,
        });
      }
      expect(href).toBe('https://fcm.googleapis.com/v1/projects/test-project/messages:send');
      return new Response(JSON.stringify({ name: 'projects/test-project/messages/1' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    // crypto.subtle 서명은 가짜 키로 실패하므로 importKey/sign 을 우회.
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

    const results = await sendPushNotifications(
      [{ token: 'real-tok', title: 'AlarmTalk', body: '07:00 알람이 울립니다' }],
      RSA_TEST_ENV,
    );
    expect(results).toEqual([{ token: 'real-tok', success: true }]);

    const fcmCall = fetchMock.mock.calls.find(([u]) => new URL(String(u)).hostname === 'fcm.googleapis.com');
    expect(fcmCall).toBeDefined();
    const body = JSON.parse(String((fcmCall![1] as RequestInit).body));
    expect(body.message.token).toBe('real-tok');
    expect(body.message.notification.title).toBe('AlarmTalk');
    expect(body.message.android.priority).toBe('HIGH');
  });

  it('UNREGISTERED 응답이면 success=false + 에러 코드 전달', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            status: 'NOT_FOUND',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }),
        { status: 404 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);

    const results = await sendPushNotifications(
      [{ token: 'stale-tok', title: 'T', body: 'B' }],
      RSA_TEST_ENV,
    );
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('UNREGISTERED');
  });
});

describe('pruneStaleTokens', () => {
  it('UNREGISTERED 토큰을 push_tokens 에서 삭제한다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([]);
    await pruneStaleTokens(mockDB.client as never, [
      { token: 'good', success: true },
      { token: 'stale', success: false, error: 'UNREGISTERED' },
      { token: 'transient', success: false, error: 'UNAVAILABLE' },
    ]);
    const deletes = mockDB.calls.filter((c) => c.sql.includes('DELETE FROM push_tokens'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args).toEqual(['stale']);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — 미설정 경로 로깅                                      */
/* ------------------------------------------------------------------ */
describe('sendPushNotifications — 미설정 로깅 edge cases', () => {
  it('8자 미만 토큰도 slice 후 "..." 붙여 로깅', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendPushNotifications([{ token: 'abc', title: 'T', body: 'B' }], unconfiguredEnv);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('abc...');
  });

  it('빈 문자열 토큰 → "..." 로깅', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendPushNotifications([{ token: '', title: 'T', body: 'B' }], unconfiguredEnv);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('...');
  });

  it('정확히 8자 토큰 → 전체 + "..."', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendPushNotifications([{ token: '12345678', title: 'T', body: 'B' }], unconfiguredEnv);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('12345678...');
  });
});
