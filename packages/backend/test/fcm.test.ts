import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

import { getTokensForUser, sendPushNotifications, sendAlarmPush, sendNotePush } from '../src/lib/fcm';

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

describe('sendNotePush', () => {
  it('토큰 없으면 빈 결과', async () => {
    mockDB.pushResult([]);
    const results = await sendNotePush(
      mockDB.client as never,
      'user-1',
      'note-1',
      'Alice',
    );
    expect(results).toEqual([]);
  });

  it('한국어 기본 body', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'note-tok' }]);
    await sendNotePush(
      mockDB.client as never,
      'user-1',
      'note-1',
      'Alice',
    );
    const logged = JSON.parse(
      (vi.mocked(console.log).mock.calls[0][0] as string),
    );
    expect(logged.title).toBe('💌 Alice');
    expect(logged.body).toBe('새 쪽지가 도착했어요');
  });

  it('영어 로케일 시 영문 body', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDB.pushResult([{ token: 'en-tok' }]);
    await sendNotePush(
      mockDB.client as never,
      'user-en',
      'note-en',
      'Bob',
      'en',
    );
    const logged = JSON.parse(
      (vi.mocked(console.log).mock.calls[0][0] as string),
    );
    expect(logged.title).toBe('💌 Bob');
    expect(logged.body).toBe('You have a new note');
  });
});
