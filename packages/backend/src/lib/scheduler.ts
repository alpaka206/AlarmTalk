/**
 * 알람 발사 판정 순수 함수들.
 *
 * cron(`scheduled` 핸들러)이 활성 알람 목록과 현재 시각을 넘기면, 지금 울려야 할
 * 알람을 추려낸다. 시각 비교는 **UTC HH:mm 정확 매칭**, 요일은 `getUTCDay`.
 *
 * ⚠️ 알려진 이슈(F1): cron 주기가 5분 간격인데 여기는 정확-분 매칭이라 분이 5의
 * 배수가 아닌 알람은 푸시되지 않는다. 또한 알람 `time`이 로컬시각으로 저장되면
 * UTC 비교와 어긋난다. 실제 울림은 온디바이스라 푸시는 보조 경로다.
 * 자세한 내용: docs/tech/backend-findings.ko.md
 */
export type AlarmMode = 'sound-only' | 'tts';

export interface ScheduledAlarm {
  id: string;
  user_id: string;
  target_user_id?: string | null;
  time: string;
  repeat_days: number[];
  is_active: boolean;
  mode: AlarmMode;
  voice_profile_id?: string | null;
  speaker_id?: string | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatHHmm(now: Date): string {
  return `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
}

export function shouldAlarmFire(alarm: ScheduledAlarm, now: Date): boolean {
  if (!alarm.is_active) return false;
  if (alarm.time !== formatHHmm(now)) return false;

  const repeat = Array.isArray(alarm.repeat_days) ? alarm.repeat_days : [];
  if (repeat.length === 0) return true;

  const today = now.getUTCDay();
  return repeat.includes(today);
}

export function selectFiringAlarms(alarms: ScheduledAlarm[], now: Date): ScheduledAlarm[] {
  return alarms.filter((a) => shouldAlarmFire(a, now));
}
