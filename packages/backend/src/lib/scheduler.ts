/**
 * 알람 발사 판정 순수 함수들.
 *
 * cron(`scheduled` 핸들러)이 활성 알람 목록과 현재 시각을 넘기면, 지금 울려야 할
 * 알람을 추려낸다.
 *
 * 판정 규칙 (F1 수정):
 *  - 알람 `time`(HH:mm)은 **알람의 timezone(IANA, 기본 Asia/Seoul) 로컬 시각**으로
 *    해석한다. 클라이언트가 로컬 시각 그대로 저장하므로 UTC 비교는 틀린다.
 *  - cron 이 5분 간격이므로 정확-분 매칭 대신 **(now - windowMinutes, now] 윈도우**
 *    안에 알람 시각이 들어오면 발사로 본다. 윈도우는 cron 주기와 같게 잡아
 *    연속 실행 간 빠지는 분도, 중복 발사도 없게 한다.
 *  - 요일 반복도 알람 timezone 기준 요일로 판정한다.
 *
 * 실제 울림은 온디바이스(AlarmKit/AlarmManager)가 권위이고, 이 푸시는 보조 경로다.
 */
export type AlarmMode = 'sound-only' | 'tts';

export const DEFAULT_ALARM_TIMEZONE = 'Asia/Seoul';

/** wrangler.toml 의 crons = ["*\/5 * * * *"] 과 반드시 일치해야 한다. */
export const CRON_WINDOW_MINUTES = 5;

export interface ScheduledAlarm {
  id: string;
  user_id: string;
  target_user_id?: string | null;
  time: string;
  repeat_days: number[];
  is_active: boolean;
  mode: AlarmMode;
  voice_profile_id?: string | null;
  /** IANA timezone (예: 'Asia/Seoul'). 없으면 DEFAULT_ALARM_TIMEZONE. */
  timezone?: string | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatHHmm(now: Date): string {
  return `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
}

interface LocalClock {
  /** 자정 기준 경과 분 (0~1439). */
  minutesOfDay: number;
  /** 0=일요일 … 6=토요일. */
  dayOfWeek: number;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** UTC 시각을 주어진 IANA 시간대의 로컬 시계(분/요일)로 변환. 잘못된 tz 는 기본값 폴백. */
export function localClockFor(now: Date, timezone: string | null | undefined): LocalClock {
  const zone = timezone?.trim() || DEFAULT_ALARM_TIMEZONE;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = getFormatter(zone);
  } catch {
    formatter = getFormatter(DEFAULT_ALARM_TIMEZONE);
  }
  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let weekday = 'Sun';
  for (const part of parts) {
    if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'weekday') weekday = part.value;
  }
  return {
    minutesOfDay: hour * 60 + minute,
    dayOfWeek: WEEKDAY_TO_INDEX[weekday] ?? 0,
  };
}

function parseHHmm(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * 알람 시각이 (now - windowMinutes, now] 윈도우에 들어오는지 판정.
 * 자정 래핑(예: now=00:02, 알람=23:59)을 처리한다.
 */
export function shouldAlarmFire(
  alarm: ScheduledAlarm,
  now: Date,
  windowMinutes: number = CRON_WINDOW_MINUTES,
): boolean {
  if (!alarm.is_active) return false;
  const alarmMinutes = parseHHmm(alarm.time);
  if (alarmMinutes === null) return false;

  const clock = localClockFor(now, alarm.timezone);
  // (now - window, now] 윈도우와의 분 차이 — 자정 래핑 보정.
  const diff = (clock.minutesOfDay - alarmMinutes + 1440) % 1440;
  if (diff >= windowMinutes) return false;

  const repeat = Array.isArray(alarm.repeat_days) ? alarm.repeat_days : [];
  if (repeat.length === 0) return true;

  // 윈도우가 자정을 걸치면 알람 발사일은 오늘이 아니라 어제일 수 있다.
  const crossedMidnight = alarmMinutes > clock.minutesOfDay;
  const fireDay = crossedMidnight ? (clock.dayOfWeek + 6) % 7 : clock.dayOfWeek;
  return repeat.includes(fireDay);
}

export function selectFiringAlarms(
  alarms: ScheduledAlarm[],
  now: Date,
  windowMinutes: number = CRON_WINDOW_MINUTES,
): ScheduledAlarm[] {
  return alarms.filter((a) => shouldAlarmFire(a, now, windowMinutes));
}
