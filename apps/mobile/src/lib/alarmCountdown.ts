import type { Alarm } from '../types';
import { parseRepeatDays } from './alarmForm';

export function getNextFireMs(alarm: Alarm): number | null {
  if (!alarm.is_active) return null;
  const [h, m] = alarm.time.split(':').map(Number) as [number, number];
  const days = parseRepeatDays(alarm.repeat_days);
  const now = new Date();
  const todayMinutes = now.getHours() * 60 + now.getMinutes();
  const alarmMinutes = h * 60 + m;
  const todayDow = now.getDay();

  if (days.length === 0) {
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  for (let offset = 0; offset <= 7; offset++) {
    const dow = (todayDow + offset) % 7;
    if (!days.includes(dow)) continue;
    if (offset === 0 && alarmMinutes <= todayMinutes) continue;
    const target = new Date(now);
    target.setDate(target.getDate() + offset);
    target.setHours(h, m, 0, 0);
    return target.getTime() - now.getTime();
  }
  return null;
}

export function formatCountdown(
  ms: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return t('alarms.countdownDaysHours', { days, hours: remHours });
  }
  if (hours > 0) return t('alarms.countdownHoursMinutes', { hours, minutes: mins });
  return t('alarms.countdownMinutes', { minutes: mins });
}

export function getNearestFireMs(alarms: Alarm[]): number | null {
  let nearest = Infinity;
  for (const a of alarms) {
    const ms = getNextFireMs(a);
    if (ms !== null && ms < nearest) nearest = ms;
  }
  return nearest < Infinity ? nearest : null;
}
