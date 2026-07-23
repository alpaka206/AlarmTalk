/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

import {
  getTokensForUser,
  sendPushNotifications,
  sendAlarmPush,
  sendPlanChangedPush,
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

describe('getTokensForUser', () => {
  it('토큰이 없으면 빈 배열', async () => {
    mockDB.pushResult([]);
    const tokens = await getTokensForUser(mockDB.client as never, 'user-1');
    expect(tokens).toEqual([]);
    expect(mockDB.calls[0].sql).toContain('push_tokens');
    expect(mockDB.calls[0].args).toContain('user-1');
  });

  it('여러 토큰 반환', async () => {
    mockDB.pushResult([
      { token: 'tok-a' },
      { token: 'tok-b' },
      { token: 'tok-c' },
    ]);
    const tokens = await getTokensForUser(mockDB.client as never, 'user-2');
    expect(tokens).toEqual(['tok-a', 'tok-b', 'tok-c']);
  });

  it('토큰 1개 반환', async () => {
    mockDB.pushResult([{ token: 'single-token' }]);
    const tokens = await getTokensForUser(mockDB.client as never, 'user-3');
    expect(tokens).toEqual(['single-token']);
  });
});

describe('sendPlanChangedPush', () => {
  it('각 사용자 토큰을 조회해 plan_changed data 메시지를 만든다(중복 사용자 제거)', async () => {
    // 사용자 2명(중복 1) → getTokensForUser 2회만 호출.
    mockDB.pushResult([{ token: 'tok-a' }]); // user-1 토큰
    mockDB.pushResult([{ token: 'tok-b' }]); // user-2 토큰
    await sendPlanChangedPush(mockDB.client as never, RSA_TEST_ENV, ['user-1', 'user-2', 'user-1']);
    const tokenQueries = mockDB.calls.filter((c) => c.sql.includes('push_tokens'));
    expect(tokenQueries).toHaveLength(2); // user-1, user-2 (중복 제거)
    expect(tokenQueries[0].args).toContain('user-1');
    expect(tokenQueries[1].args).toContain('user-2');
  });

  it('토큰이 하나도 없으면 전송하지 않는다(조기 반환)', async () => {
    mockDB.pushResult([]); // user-1 토큰 없음
    await sendPlanChangedPush(mockDB.client as never, RSA_TEST_ENV, ['user-1']);
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

describe('sendAlarmPush', () => {
  it('토큰 없으면 빈 결과', async () => {
    mockDB.pushResult([]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      unconfiguredEnv,
      'user-1',
      'alarm-id',
      '07:00',
    );
    expect(results).toEqual([]);
  });

  it('토큰 있으면 토큰별 결과 반환 (미설정 → success=false)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'device-tok' }]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      unconfiguredEnv,
      'user-1',
      'alarm-123',
      '07:30',
    );
    expect(results).toHaveLength(1);
    expect(results[0].token).toBe('device-tok');
    expect(results[0].success).toBe(false);
  });

  it('여러 디바이스 토큰에 모두 시도', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDB.pushResult([
      { token: 'phone-tok' },
      { token: 'tablet-tok' },
    ]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      unconfiguredEnv,
      'user-1',
      'alarm-456',
      '08:00',
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.token)).toEqual(['phone-tok', 'tablet-tok']);
  });

  it('영어 로케일 시 영문 body 로 전송한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);
    mockDB.pushResult([{ token: 'en-tok' }]);

    await sendAlarmPush(
      mockDB.client as never,
      RSA_TEST_ENV,
      'user-en',
      'alarm-en',
      '09:00',
      'en',
    );
    const fcmCall = fetchMock.mock.calls.find(([u]) => new URL(String(u)).hostname === 'fcm.googleapis.com');
    const body = JSON.parse(String((fcmCall![1] as RequestInit).body));
    expect(body.message.notification.body).toBe('Alarm at 09:00');
  });

  it('한국어 로케일 기본 body + data payload 구성', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);
    mockDB.pushResult([{ token: 'ko-tok' }]);

    await sendAlarmPush(
      mockDB.client as never,
      RSA_TEST_ENV,
      'user-ko',
      'alarm-ko',
      '06:30',
    );
    const fcmCall = fetchMock.mock.calls.find(([u]) => new URL(String(u)).hostname === 'fcm.googleapis.com');
    const body = JSON.parse(String((fcmCall![1] as RequestInit).body));
    expect(body.message.notification.body).toBe('06:30 알람이 울립니다');
    expect(body.message.notification.title).toBe('AlarmTalk');
    expect(body.message.data).toEqual({ type: 'alarm', alarmId: 'alarm-ko', channelId: 'alarms' });
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — getTokensForUser                                      */
/* ------------------------------------------------------------------ */
describe('getTokensForUser — edge cases', () => {
  it('숫자 토큰 값을 String()으로 변환', async () => {
    mockDB.pushResult([{ token: 12345 }]);
    const tokens = await getTokensForUser(mockDB.client as never, 'user-x');
    expect(tokens).toEqual(['12345']);
  });

  it('null 토큰 값을 String()으로 변환 → "null"', async () => {
    mockDB.pushResult([{ token: null }]);
    const tokens = await getTokensForUser(mockDB.client as never, 'user-x');
    expect(tokens).toEqual(['null']);
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
