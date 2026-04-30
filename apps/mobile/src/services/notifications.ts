import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { TFunction } from 'i18next';
import type { Alarm } from '../types';
import { parseRepeatDays } from '../lib/alarmForm';
import { registerPushToken, unregisterPushToken } from './api';

const ALARM_CATEGORY = 'alarm';
const SNOOZE_ACTION = 'snooze';
const DISMISS_ACTION = 'dismiss';

export const NotificationChannel = {
  ALARMS: 'alarms',
  NOTES: 'notes',
  REMINDERS: 'reminders',
  SYSTEM: 'system',
} as const;

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

export function configureNotificationChannels(t: TFunction): void {
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(NotificationChannel.ALARMS, {
      name: t('settings.channelAlarms'),
      description: t('settings.channelAlarmsDesc'),
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default_alarm',
      // Long, repeating buzz pattern (sleep through me if you can).
      vibrationPattern: [0, 1000, 500, 1000, 500, 1000, 500, 1000],
      enableLights: true,
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      showBadge: true,
    });

    Notifications.setNotificationChannelAsync(NotificationChannel.NOTES, {
      name: t('settings.channelNotes'),
      description: t('settings.channelNotesDesc'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default_alarm',
      vibrationPattern: [0, 250, 200, 250],
      enableLights: true,
    });

    Notifications.setNotificationChannelAsync(NotificationChannel.REMINDERS, {
      name: t('settings.channelReminders'),
      description: t('settings.channelRemindersDesc'),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default_alarm',
    });

    Notifications.setNotificationChannelAsync(NotificationChannel.SYSTEM, {
      name: t('settings.channelSystem'),
      description: t('settings.channelSystemDesc'),
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  if (Platform.OS !== 'web') {
    Notifications.setNotificationCategoryAsync(ALARM_CATEGORY, [
      {
        identifier: SNOOZE_ACTION,
        buttonTitle: t('notification.snoozeAction'),
        options: { opensAppToForeground: false },
      },
      {
        identifier: DISMISS_ACTION,
        buttonTitle: t('notification.dismissAction'),
        options: { opensAppToForeground: false },
      },
    ]);
  }
}

export async function syncAlarmNotifications(alarms: Alarm[]): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const activeAlarms = alarms.filter((a) => a.is_active);

  for (const alarm of activeAlarms) {
    const [hour, minute] = alarm.time.split(':').map(Number) as [number, number];
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
      sound: 'default_alarm',
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 1000, 500, 1000, 500, 1000, 500, 1000],
      sticky: true,
      autoDismiss: false,
      categoryIdentifier: ALARM_CATEGORY,
      data: notificationData,
      ...(Platform.OS === 'android' && { channelId: NotificationChannel.ALARMS }),
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
      sound: 'default_alarm',
      categoryIdentifier: ALARM_CATEGORY,
      data,
      ...(Platform.OS === 'android' && { channelId: NotificationChannel.ALARMS }),
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

export async function unregisterPushTokenFromServer(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await unregisterPushToken(token);
  } catch {
    // best-effort — don't block logout if unregister fails
  }
}
