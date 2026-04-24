import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Alarm } from '../types';
import { parseRepeatDays } from '../lib/alarmForm';
import { registerPushToken } from './api';

const ALARM_CATEGORY = 'alarm';
const SNOOZE_ACTION = 'snooze';
const DISMISS_ACTION = 'dismiss';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('alarms', {
    name: 'Alarms',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 500, 250, 500],
  });
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationCategoryAsync(ALARM_CATEGORY, [
    {
      identifier: SNOOZE_ACTION,
      buttonTitle: '😴 스누즈',
      options: { opensAppToForeground: false },
    },
    {
      identifier: DISMISS_ACTION,
      buttonTitle: '✓ 끄기',
      options: { opensAppToForeground: false },
    },
  ]);
}

export async function syncAlarmNotifications(alarms: Alarm[]): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const activeAlarms = alarms.filter((a) => a.is_active);

  for (const alarm of activeAlarms) {
    const [hour, minute] = alarm.time.split(':').map(Number);
    const repeatDays = parseRepeatDays(alarm.repeat_days);
    const title = alarm.voice_name ? `🗣️ ${alarm.voice_name}` : '⏰ VoiceAlarm';
    const body = alarm.message_text || 'Alarm';
    const notificationData = {
      alarmId: alarm.id,
      messageId: alarm.message_id,
      text: alarm.message_text || '',
      voiceName: alarm.voice_name || '',
      category: alarm.category || '',
      snoozeMinutes: alarm.snooze_minutes || 5,
    };

    const content: Notifications.NotificationContentInput = {
      title,
      body,
      sound: 'default',
      categoryIdentifier: ALARM_CATEGORY,
      data: notificationData,
      ...(Platform.OS === 'android' && { channelId: 'alarms' }),
    };

    if (repeatDays.length === 0) {
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });
    } else {
      for (const weekday of repeatDays) {
        const expoWeekday = weekday === 0 ? 1 : weekday + 1;
        await Notifications.scheduleNotificationAsync({
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: expoWeekday,
            hour,
            minute,
          },
        });
      }
    }
  }
}

export async function scheduleSnoozeNotification(
  title: string,
  body: string,
  data: Record<string, unknown>,
  snoozeMinutes: number,
): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      categoryIdentifier: ALARM_CATEGORY,
      data,
      ...(Platform.OS === 'android' && { channelId: 'alarms' }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: snoozeMinutes * 60,
    },
  });
}

export { SNOOZE_ACTION, DISMISS_ACTION };

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription | { remove: () => void } {
  if (Platform.OS === 'web') return { remove: () => {} };
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export async function registerPushTokenWithServer(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(token, platform);
    return token;
  } catch {
    return null;
  }
}
