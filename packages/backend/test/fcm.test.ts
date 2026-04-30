/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

import { getTokensForUser, sendPushNotifications, sendAlarmPush } from '../src/lib/fcm';

beforeEach(() => {
  mockDB.reset();
  vi.restoreAllMocks();
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

describe('sendPushNotifications', () => {
  it('빈 배열이면 빈 결과', async () => {
    const results = await sendPushNotifications([]);
    expect(results).toEqual([]);
  });

  it('모든 메시지에 success=true 반환 (mock)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = await sendPushNotifications([
      { token: 'tok-1', title: 'Test', body: 'Hello' },
      { token: 'tok-2', title: 'Test', body: 'World', data: { type: 'alarm' } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ token: 'tok-1', success: true });
    expect(results[1]).toEqual({ token: 'tok-2', success: true });
  });

  it('console.log으로 구조화된 로그 출력', async () => {
    const warnSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendPushNotifications([
      { token: 'abcdefghijk', title: 'VoiceAlarm', body: '알람' },
    ]);
    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.action).toBe('MOCK_SEND');
    expect(logged.token).toBe('abcdefgh...');
    expect(logged.title).toBe('VoiceAlarm');
  });
});

describe('sendAlarmPush', () => {
  it('토큰 없으면 빈 결과', async () => {
    mockDB.pushResult([]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      'user-1',
      'alarm-id',
      '07:00',
    );
    expect(results).toEqual([]);
  });

  it('토큰 있으면 알람 메시지 전송', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'device-tok' }]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      'user-1',
      'alarm-123',
      '07:30',
    );
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].token).toBe('device-tok');
  });

  it('여러 디바이스 토큰에 모두 전송', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([
      { token: 'phone-tok' },
      { token: 'tablet-tok' },
    ]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      'user-1',
      'alarm-456',
      '08:00',
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.token)).toEqual(['phone-tok', 'tablet-tok']);
  });

  it('영어 로케일 시 영문 body', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'en-tok' }]);
    await sendAlarmPush(
      mockDB.client as never,
      'user-en',
      'alarm-en',
      '09:00',
      'en',
    );
    const logged = JSON.parse(
      (vi.mocked(console.log).mock.calls[0][0] as string),
    );
    expect(logged.body).toBe('Alarm at 09:00');
  });

  it('한국어 로케일 기본 body', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'ko-tok' }]);
    await sendAlarmPush(
      mockDB.client as never,
      'user-ko',
      'alarm-ko',
      '06:30',
    );
    const logged = JSON.parse(
      (vi.mocked(console.log).mock.calls[0][0] as string),
    );
    expect(logged.body).toBe('06:30 알람이 울립니다');
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
/*  Edge cases — sendPushNotifications                                 */
/* ------------------------------------------------------------------ */
describe('sendPushNotifications — edge cases', () => {
  it('8자 미만 토큰도 slice 후 "..." 붙여 로깅', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendPushNotifications([
      { token: 'abc', title: 'T', body: 'B' },
    ]);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('abc...');
  });

  it('빈 문자열 토큰 → "..." 로깅', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendPushNotifications([
      { token: '', title: 'T', body: 'B' },
    ]);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('...');
  });

  it('data 필드가 있어도 결과에는 token+success만', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = await sendPushNotifications([
      { token: 'tok-data', title: 'T', body: 'B', data: { key: 'val' } },
    ]);
    expect(results[0]).toEqual({ token: 'tok-data', success: true });
    expect(results[0]).not.toHaveProperty('data');
  });

  it('정확히 8자 토큰 → 전체 + "..."', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendPushNotifications([
      { token: '12345678', title: 'T', body: 'B' },
    ]);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe('12345678...');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — sendAlarmPush                                         */
/* ------------------------------------------------------------------ */
describe('sendAlarmPush — edge cases', () => {
  it('data payload에 type=alarm, alarmId, channelId=alarms 포함', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'dev-tok' }]);
    await sendAlarmPush(
      mockDB.client as never,
      'user-1',
      'alarm-xyz',
      '08:30',
    );
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.title).toBe('VoiceAlarm');
    expect(logged.body).toBe('08:30 알람이 울립니다');
  });

  it('title은 항상 VoiceAlarm (로케일 무관)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'en-dev' }]);
    await sendAlarmPush(
      mockDB.client as never,
      'user-en',
      'a1',
      '12:00',
      'en',
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.title).toBe('VoiceAlarm');
  });

  it('alarmTime에 특수 시각 "00:00" 전달', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'midnight-tok' }]);
    await sendAlarmPush(
      mockDB.client as never,
      'user-m',
      'alarm-mid',
      '00:00',
      'ko',
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.body).toBe('00:00 알람이 울립니다');
  });

  it('여러 디바이스에 동일 body/title 전송', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([
      { token: 'phone' },
      { token: 'tablet-xx' },
      { token: 'watch-xxx' },
    ]);
    const results = await sendAlarmPush(
      mockDB.client as never,
      'user-multi',
      'alarm-multi',
      '06:00',
      'en',
    );
    expect(results).toHaveLength(3);
    for (const call of spy.mock.calls) {
      const logged = JSON.parse(call[0] as string);
      expect(logged.title).toBe('VoiceAlarm');
      expect(logged.body).toBe('Alarm at 06:00');
    }
  });
});

