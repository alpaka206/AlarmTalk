import type { Alarm } from '../src/types';

jest.mock('expo-notifications', () => {
  return {
    __esModule: true,
    scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
    cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
    getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc123]' }),
    addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    AndroidNotificationPriority: { MAX: 'max' },
    AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval' },
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } },
}));

jest.mock('../src/services/api', () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
  unregisterPushToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

import * as Notifications from 'expo-notifications';
import {
  syncAlarmNotifications,
  scheduleSnoozeNotification,
  requestNotificationPermissions,
  configureNotificationChannels,
  registerPushTokenWithServer,
  unregisterPushTokenFromServer,
  addNotificationResponseListener,
  NotificationChannel,
  SNOOZE_ACTION,
  DISMISS_ACTION,
} from '../src/services/notifications';
import { registerPushToken, unregisterPushToken } from '../src/services/api';

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCancelAll = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;
const mockGetPerms = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPerms = Notifications.requestPermissionsAsync as jest.Mock;
const mockSetChannel = Notifications.setNotificationChannelAsync as jest.Mock;
const mockSetCategory = Notifications.setNotificationCategoryAsync as jest.Mock;
const mockGetPushToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockAddListener = Notifications.addNotificationResponseReceivedListener as jest.Mock;
const mockRegister = registerPushToken as jest.Mock;
const mockUnregister = unregisterPushToken as jest.Mock;

const t = (key: string) => `translated:${key}`;

function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'a1',
    user_id: 'u1',
    target_user_id: null,
    message_id: 'm1',
    time: '07:30',
    repeat_days: [],
    is_active: true,
    snooze_minutes: 5,
    created_at: '2026-04-25T00:00:00Z',
    updated_at: '2026-04-25T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPerms.mockResolvedValue({ status: 'granted' });
  mockRequestPerms.mockResolvedValue({ status: 'granted' });
  mockGetPushToken.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
  mockSchedule.mockResolvedValue('notif-id');
});

describe('NotificationChannel constants', () => {
  it('4개 채널 상수를 export한다', () => {
    expect(NotificationChannel.ALARMS).toBe('alarms');
    expect(NotificationChannel.NOTES).toBe('notes');
    expect(NotificationChannel.REMINDERS).toBe('reminders');
    expect(NotificationChannel.SYSTEM).toBe('system');
  });

  it('action 식별자를 export한다', () => {
    expect(SNOOZE_ACTION).toBe('snooze');
    expect(DISMISS_ACTION).toBe('dismiss');
  });
});

describe('requestNotificationPermissions', () => {
  it('이미 granted면 true 반환', async () => {
    mockGetPerms.mockResolvedValueOnce({ status: 'granted' });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
    expect(mockRequestPerms).not.toHaveBeenCalled();
  });

  it('granted 아니면 requestPermissionsAsync 호출', async () => {
    mockGetPerms.mockResolvedValueOnce({ status: 'undetermined' });
    mockRequestPerms.mockResolvedValueOnce({ status: 'granted' });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
    expect(mockRequestPerms).toHaveBeenCalled();
  });

  it('요청 후 denied면 false 반환', async () => {
    mockGetPerms.mockResolvedValueOnce({ status: 'undetermined' });
    mockRequestPerms.mockResolvedValueOnce({ status: 'denied' });
    const result = await requestNotificationPermissions();
    expect(result).toBe(false);
  });
});

describe('configureNotificationChannels', () => {
  it('Android 4개 채널 설정', () => {
    configureNotificationChannels(t as never);
    expect(mockSetChannel).toHaveBeenCalledTimes(4);
    const channelIds = mockSetChannel.mock.calls.map((call: unknown[]) => call[0]);
    expect(channelIds).toEqual([
      NotificationChannel.ALARMS,
      NotificationChannel.NOTES,
      NotificationChannel.REMINDERS,
      NotificationChannel.SYSTEM,
    ]);
  });

  it('알람 카테고리에 snooze/dismiss 액션 설정', () => {
    configureNotificationChannels(t as never);
    expect(mockSetCategory).toHaveBeenCalledWith(
      'alarm',
      expect.arrayContaining([
        expect.objectContaining({ identifier: SNOOZE_ACTION }),
        expect.objectContaining({ identifier: DISMISS_ACTION }),
      ]),
    );
  });

  it('채널 name에 t() 번역 사용', () => {
    configureNotificationChannels(t as never);
    const alarmsCall = mockSetChannel.mock.calls.find(
      (call: unknown[]) => call[0] === NotificationChannel.ALARMS,
    );
    expect(alarmsCall[1].name).toBe('translated:settings.channelAlarms');
  });
});

describe('syncAlarmNotifications', () => {
  it('기존 알림 전체 취소 후 재스케줄', async () => {
    await syncAlarmNotifications([makeAlarm()]);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalled();
  });

  it('비활성 알람은 스케줄하지 않는다', async () => {
    await syncAlarmNotifications([makeAlarm({ is_active: false })]);
    expect(mockCancelAll).toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('권한 미부여 시 스케줄하지 않는다', async () => {
    mockGetPerms.mockResolvedValueOnce({ status: 'denied' });
    await syncAlarmNotifications([makeAlarm()]);
    expect(mockCancelAll).toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('repeat_days 빈 배열 → DAILY 트리거', async () => {
    await syncAlarmNotifications([makeAlarm({ time: '08:00', repeat_days: [] })]);
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: 'daily',
          hour: 8,
          minute: 0,
        }),
      }),
    );
  });

  it('repeat_days 지정 → WEEKLY 트리거 (요일별 1개씩)', async () => {
    await syncAlarmNotifications([makeAlarm({ repeat_days: [1, 3, 5] })]);
    expect(mockSchedule).toHaveBeenCalledTimes(3);
  });

  it('weekday 0(일요일) → Expo weekday 1 변환', async () => {
    await syncAlarmNotifications([makeAlarm({ repeat_days: [0] })]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.trigger.weekday).toBe(1);
    expect(call.trigger.type).toBe('weekly');
  });

  it('weekday 1(월요일) → Expo weekday 2 변환', async () => {
    await syncAlarmNotifications([makeAlarm({ repeat_days: [1] })]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.trigger.weekday).toBe(2);
  });

  it('weekday 6(토요일) → Expo weekday 7 변환', async () => {
    await syncAlarmNotifications([makeAlarm({ repeat_days: [6] })]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.trigger.weekday).toBe(7);
  });

  it('시간 파싱: "07:30" → hour=7, minute=30', async () => {
    await syncAlarmNotifications([makeAlarm({ time: '07:30' })]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.trigger.hour).toBe(7);
    expect(call.trigger.minute).toBe(30);
  });

  it('voice_name 있으면 제목에 🗣️ 포함', async () => {
    await syncAlarmNotifications([makeAlarm({ voice_name: '엄마' })]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.title).toContain('🗣️');
    expect(call.content.title).toContain('엄마');
  });

  it('voice_name 없으면 기본 ⏰ VoiceAlarm 제목', async () => {
    await syncAlarmNotifications([makeAlarm()]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.title).toBe('⏰ VoiceAlarm');
  });

  it('Android channelId: alarms', async () => {
    await syncAlarmNotifications([makeAlarm()]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.channelId).toBe(NotificationChannel.ALARMS);
  });

  it('categoryIdentifier: alarm (snooze/dismiss 액션용)', async () => {
    await syncAlarmNotifications([makeAlarm()]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.categoryIdentifier).toBe('alarm');
  });

  it('data에 alarmId, messageId, snoozeMinutes 포함', async () => {
    const alarm = makeAlarm({ id: 'alarm-99', message_id: 'msg-42', snooze_minutes: 10 });
    await syncAlarmNotifications([alarm]);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.data).toMatchObject({
      alarmId: 'alarm-99',
      messageId: 'msg-42',
      snoozeMinutes: 10,
    });
  });

  it('여러 알람 동시 스케줄 (비활성 제외)', async () => {
    const alarms = [
      makeAlarm({ id: 'a1', time: '06:00' }),
      makeAlarm({ id: 'a2', time: '07:00', repeat_days: [1, 2] }),
      makeAlarm({ id: 'a3', is_active: false }),
    ];
    await syncAlarmNotifications(alarms);
    // a1: daily=1, a2: weekly×2=2, a3: inactive=0 → total 3
    expect(mockSchedule).toHaveBeenCalledTimes(3);
  });

  it('repeat_days 문자열 "[1,3]" → 정상 파싱', async () => {
    await syncAlarmNotifications([makeAlarm({ repeat_days: '[1,3]' as unknown as number[] })]);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleSnoozeNotification', () => {
  it('snoozeMinutes를 초로 변환한다', async () => {
    await scheduleSnoozeNotification('Title', 'Body', { key: 'val' }, 10);
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: 'timeInterval',
          seconds: 600,
        }),
      }),
    );
  });

  it('content에 categoryIdentifier: alarm 포함', async () => {
    await scheduleSnoozeNotification('T', 'B', {}, 5);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.categoryIdentifier).toBe('alarm');
  });
});

describe('registerPushTokenWithServer', () => {
  it('토큰 등록 성공 → 토큰 문자열 반환', async () => {
    const token = await registerPushTokenWithServer();
    expect(token).toBe('ExponentPushToken[abc123]');
    expect(mockRegister).toHaveBeenCalledWith('ExponentPushToken[abc123]', 'android');
  });

  it('에러 시 null 반환 (조용히 실패)', async () => {
    mockGetPushToken.mockRejectedValueOnce(new Error('no device'));
    const token = await registerPushTokenWithServer();
    expect(token).toBeNull();
  });
});

describe('unregisterPushTokenFromServer', () => {
  it('토큰 해제 성공', async () => {
    await unregisterPushTokenFromServer();
    expect(mockUnregister).toHaveBeenCalledWith('ExponentPushToken[abc123]');
  });

  it('에러 시 조용히 실패 (로그아웃 차단하지 않음)', async () => {
    mockGetPushToken.mockRejectedValueOnce(new Error('fail'));
    await expect(unregisterPushTokenFromServer()).resolves.toBeUndefined();
  });
});

describe('addNotificationResponseListener', () => {
  it('리스너 등록 후 구독 객체 반환', () => {
    const handler = jest.fn();
    const sub = addNotificationResponseListener(handler);
    expect(mockAddListener).toHaveBeenCalledWith(handler);
    expect(sub).toHaveProperty('remove');
  });
});
