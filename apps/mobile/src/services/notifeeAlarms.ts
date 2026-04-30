/**
 * Android-only "true alarm clock" scheduling via @notifee/react-native.
 *
 * Why notifee instead of expo-notifications:
 *   - `trigger.alarmManager.allowWhileIdle: true` survives Doze mode
 *     (the OS kicking your app to sleep on idle phones), which the
 *     stock expo-notifications scheduler does NOT.
 *   - `fullScreenAction` lets the OS launch our ringing activity
 *     *over* the lock screen automatically when the alarm fires —
 *     the part you can't reproduce with expo-notifications alone.
 *   - `loopSound + ongoing + autoCancel:false` makes the notification
 *     behave like the system Clock app's alarm: the buzzer keeps
 *     playing until the user dismisses it from the ringing screen.
 *
 * iOS stays on the Alarmy-style background-audio trick in
 * `alarmRinger.ts` — Apple doesn't expose AlarmManager-equivalent APIs.
 */
import { Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  TriggerType,
  type TimestampTrigger,
} from '@notifee/react-native';
import type { Alarm } from '../types';
import { parseRepeatDays } from '../lib/alarmForm';

const ALARM_CHANNEL_ID = 'alarm-ringing';

function nextOccurrencesMs(alarm: Alarm, daysAhead = 7): number[] {
  const [hStr, mStr] = alarm.time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return [];
  const days = parseRepeatDays(alarm.repeat_days);
  const now = new Date();
  const out: number[] = [];

  for (let offset = 0; offset <= daysAhead; offset++) {
    const target = new Date(now);
    target.setDate(target.getDate() + offset);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) continue;
    if (days.length === 0 || days.includes(target.getDay())) {
      out.push(target.getTime());
      if (days.length === 0) break; // one-shot: just the next one
    }
  }
  return out;
}

export async function configureNotifeeAlarmChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: ALARM_CHANNEL_ID,
    name: '알람',
    description: '알람 시계 — 잠금화면 위에 풀스크린으로 표시됩니다.',
    importance: AndroidImportance.HIGH,
    sound: 'default_alarm',
    vibration: true,
    vibrationPattern: [300, 800, 300, 800, 300, 800],
    bypassDnd: true,
    visibility: AndroidVisibility.PUBLIC,
  });
}

export async function syncNotifeeAlarms(alarms: Alarm[]): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Cancel all of *our* previously-scheduled triggers; we recreate them
  // from the current list of active alarms below.
  const ids = await notifee.getTriggerNotificationIds();
  for (const id of ids) {
    if (id.startsWith('alarm:')) await notifee.cancelTriggerNotification(id);
  }

  const active = alarms.filter((a) => a.is_active);
  if (active.length === 0) return;

  for (const alarm of active) {
    const occurrences = nextOccurrencesMs(alarm, 7);
    for (const ts of occurrences) {
      const trigger: TimestampTrigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: ts,
        alarmManager: {
          allowWhileIdle: true,
        },
      };
      await notifee.createTriggerNotification(
        {
          id: `alarm:${alarm.id}:${ts}`,
          title: alarm.voice_name ? `🗣️ ${alarm.voice_name}` : '⏰ 알람',
          body: alarm.message_text || '알람 시간이에요',
          data: {
            alarmId: alarm.id,
            text: alarm.message_text ?? '',
            voiceName: alarm.voice_name ?? '',
          },
          android: {
            channelId: ALARM_CHANNEL_ID,
            category: AndroidCategory.ALARM,
            importance: AndroidImportance.HIGH,
            visibility: AndroidVisibility.PUBLIC,
            sound: 'default_alarm',
            loopSound: true,
            ongoing: true,
            autoCancel: false,
            // Tapping the notification (or the OS auto-launching the
            // full-screen intent) opens our app, after which our
            // foreground/background event handler routes to /alarm/ringing.
            pressAction: { id: 'default', launchActivity: 'default' },
            fullScreenAction: { id: 'default', launchActivity: 'default' },
          },
        },
        trigger,
      );
    }
  }
}

export const NOTIFEE_ALARM_CHANNEL_ID = ALARM_CHANNEL_ID;
