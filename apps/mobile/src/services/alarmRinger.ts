/**
 * Alarmy-style alarm clock keep-alive.
 *
 * iOS blocks general background scheduling but allows apps that declare
 * `UIBackgroundModes: ["audio"]` to keep running audio in the background.
 * We exploit that: the moment any alarm is active we start playing a
 * (near-)silent looping clip so the OS keeps our JS runtime alive. A 5s
 * timer ticks against the active-alarm list, and when an alarm's HH:mm
 * matches "now" we navigate to the full-screen ringing screen which takes
 * over with the loud alarm sound + sustained vibration.
 *
 * Android works the same way — we set `staysActiveInBackground` on the
 * audio session and Android keeps the audio service running. expo-
 * notifications schedules are still registered as a backup for the case
 * where the OS decides to kill us anyway (force-stop, low-memory).
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { Alarm } from '../types';
import { parseRepeatDays } from '../lib/alarmForm';

const SILENT_LOOP = require('../../assets/sounds/default_alarm.wav');

let keepAliveSound: Audio.Sound | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let activeAlarms: Alarm[] = [];
const recentlyFired = new Map<string, number>();
const FIRE_COOLDOWN_MS = 60_000;
const TICK_MS = 5_000;
let starting = false;

function shouldFireNow(alarm: Alarm, now: Date): boolean {
  if (!alarm.is_active) return false;
  const [hStr, mStr] = alarm.time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const days = parseRepeatDays(alarm.repeat_days);
  if (days.length > 0 && !days.includes(now.getDay())) return false;
  return now.getHours() === h && now.getMinutes() === m;
}

function tick() {
  const now = new Date();
  for (const alarm of activeAlarms) {
    if (!shouldFireNow(alarm, now)) continue;
    const last = recentlyFired.get(alarm.id) ?? 0;
    if (now.getTime() - last < FIRE_COOLDOWN_MS) continue;
    recentlyFired.set(alarm.id, now.getTime());
    fireAlarm(alarm);
    break;
  }
}

function fireAlarm(alarm: Alarm) {
  try {
    router.push({
      pathname: '/alarm/ringing',
      params: {
        alarmId: alarm.id,
        text: alarm.message_text ?? '',
        voiceName: alarm.voice_name ?? '',
      },
    });
  } catch {
    // router not ready (cold boot edge case) — the OS notification will
    // fire as a fallback and tapping it lands on the same screen.
  }
}

export async function startAlarmKeepAlive(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (keepAliveSound || starting) return;
  starting = true;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    });
    const { sound } = await Audio.Sound.createAsync(SILENT_LOOP, {
      isLooping: true,
      // Inaudible but non-zero — iOS revokes the background audio
      // privilege if the audio is *truly* silent (volume 0) for too long.
      volume: 0.001,
      shouldPlay: true,
    });
    keepAliveSound = sound;
    if (!tickInterval) tickInterval = setInterval(tick, TICK_MS);
  } catch {
    keepAliveSound = null;
  } finally {
    starting = false;
  }
}

export async function stopAlarmKeepAlive(): Promise<void> {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  const s = keepAliveSound;
  keepAliveSound = null;
  if (s) {
    try {
      await s.stopAsync();
    } catch {
      // already stopped
    }
    try {
      await s.unloadAsync();
    } catch {
      // already unloaded
    }
  }
}

/**
 * Update the set of active alarms the ticker watches. Pause the silent
 * loop entirely if there's nothing to fire — saves battery and avoids
 * keeping the audio session active for no reason.
 */
export function setMonitoredAlarms(alarms: Alarm[]): void {
  activeAlarms = alarms.filter((a) => a.is_active);
  if (activeAlarms.length === 0) {
    void stopAlarmKeepAlive();
  } else {
    void startAlarmKeepAlive();
  }
}

/**
 * Called when the ringing screen unmounts. We deliberately do NOT shorten
 * the cooldown here — keeping the original "fired at <ts>" timestamp means
 * `tick()` won't refire within the same minute even after the user dismisses
 * the alarm. The natural minute rollover takes care of cleanup: once the
 * clock ticks past HH:mm, `shouldFireNow` returns false and the alarm waits
 * for its next scheduled occurrence (24h later for non-repeating, or the
 * next matching weekday).
 */
export function clearFiringState(_alarmId: string): void {
  // no-op
}
