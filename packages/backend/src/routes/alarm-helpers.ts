import { UUID_RE } from '../lib/validate';
import { FREE_BUCKET_CATEGORIES, CLONE_PRERENDER_CATEGORIES } from '../lib/stock-clips';
import {
  isBlockedByFamilyAlarmQuietTime,
  type FamilyAlarmSettings,
} from '../lib/family-alarm-settings';
import type { DbExecutor } from '../lib/transactions';

/** 알람 시각 판정의 폴백 시간대. 클라가 IANA tz 를 안 보냈거나 값이 부정확할 때 쓴다. */
export const DEFAULT_ALARM_TIMEZONE = 'Asia/Seoul';

export const ALARM_MODES = ['sound-only', 'tts'] as const;
export type AlarmMode = (typeof ALARM_MODES)[number];
export const VIBRATION_PATTERNS = ['default', 'strong', 'none'] as const;
export type VibrationPattern = (typeof VIBRATION_PATTERNS)[number];
export const WAKE_MODES = ['sound_then_voice', 'voice_only'] as const;
export type WakeMode = (typeof WAKE_MODES)[number];

export type AlarmRow = Record<string, unknown> & {
  repeat_days?: unknown;
  is_active?: unknown;
  mode?: unknown;
  vibration_pattern?: unknown;
  wake_mode?: unknown;
  voice_profile_id?: unknown;
  user_id?: unknown;
  target_user_id?: unknown;
  creator_email?: unknown;
  creator_name?: unknown;
  category?: unknown;
};

export function normalizeAlarmRow(row: AlarmRow, viewer?: string | string[] | null) {
  const rawRepeat = row.repeat_days;
  let repeatDays: number[] = [];
  if (typeof rawRepeat === 'string' && rawRepeat.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawRepeat);
      if (Array.isArray(parsed)) repeatDays = parsed.filter((n): n is number => Number.isInteger(n));
    } catch {
      repeatDays = [];
    }
  } else if (Array.isArray(rawRepeat)) {
    repeatDays = rawRepeat.filter((n): n is number => Number.isInteger(n));
  }

  const mode: AlarmMode =
    row.mode === 'sound-only' || row.mode === 'tts' ? row.mode : 'tts';

  const vibrationPattern: VibrationPattern =
    row.vibration_pattern === 'default' || row.vibration_pattern === 'strong' || row.vibration_pattern === 'none'
      ? row.vibration_pattern
      : 'default';

  const wakeMode: WakeMode =
    row.wake_mode === 'sound_then_voice' || row.wake_mode === 'voice_only'
      ? row.wake_mode
      : 'sound_then_voice';

  const category = typeof row.category === 'string' ? row.category : null;
  const isFamilyAlarm = category === 'family' || category === 'family-voice';
  const senderUserId = typeof row.user_id === 'string' ? row.user_id : null;
  const targetUserId = typeof row.target_user_id === 'string' ? row.target_user_id : null;
  const senderName = typeof row.creator_name === 'string' ? row.creator_name : null;
  const senderEmail = typeof row.creator_email === 'string' ? row.creator_email : null;
  // 뷰어 식별자 집합. 계정 연동(email/UUID 계정 ↔ google 로그인) 사용자는 PK(users.id)와
  // 로그인 id(google_id=JWT sub)가 서로 다르다. 단일 값이 아니라 집합으로 비교해야
  // '내가 보낸 알람'을 '받은 알람'으로 오분류하지 않는다(PR #536 P1).
  const viewerIds = (Array.isArray(viewer) ? viewer : viewer != null ? [viewer] : []).filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  const viewerSet = new Set(viewerIds);
  const viewerIsCreator = senderUserId !== null && viewerSet.has(senderUserId);
  // 서버 권위 판별: 내가 target 이고 내가 만든 게 아니면 '받은 알람'(카테고리 무관).
  // 클라 pull 은 클라측 네임스페이스 비교(session.user.id) 대신 이 플래그로 받은 알람만 임포트한다.
  const isReceived =
    viewerSet.size > 0 && targetUserId !== null && viewerSet.has(targetUserId) && !viewerIsCreator;
  // 기존 의미 유지: 가족 알람이고 보낸 사람이 뷰어가 아니면 '받은 가족 알람'(target 없어도 성립).
  const isReceivedFamilyAlarm =
    isFamilyAlarm && viewerSet.size > 0 && senderUserId !== null && !viewerIsCreator;

  return {
    ...row,
    repeat_days: repeatDays,
    is_active: row.is_active === 1 || row.is_active === true,
    mode,
    vibration_pattern: vibrationPattern,
    wake_mode: wakeMode,
    voice_profile_id: (row.voice_profile_id ?? null) as string | null,
    sender_user_id: senderUserId,
    sender_name: senderName,
    sender_email: senderEmail,
    is_family_alarm: isFamilyAlarm,
    is_received: isReceived,
    is_received_family_alarm: isReceivedFamilyAlarm,
  };
}

type FieldError = { error: string; error_code: string };

export function validateAlarmFields(body: {
  mode?: string;
  vibration_pattern?: string;
  wake_mode?: string;
  voice_profile_id?: string | null;
  time?: string;
  repeat_days?: number[];
  snooze_minutes?: number;
  message_id?: string | null;
  is_active?: boolean;
  target_user_id?: string;
  bucket_id?: string | null;
}): FieldError | null {
  if (body.message_id != null && !UUID_RE.test(body.message_id)) {
    return { error: 'Invalid message_id format', error_code: 'INVALID_MESSAGE_ID' };
  }

  // 무료 버킷(기상/약) + 유료 클론 사전렌더 버킷(날씨/운세/사랑/약 + greeting) 카테고리만 허용. null=버킷 해제.
  // 유료 클론 오프라인 버킷 알람은 bucket_id 로 love/fortune/weather 뿐 아니라 기본 preset 컨텍스트의
  // greeting(기상 인사) 도 실어 동기화한다(AlarmEditorState.clonePrerenderBucketCategoryFor: preset→greeting).
  // CLONE_PRERENDER_CATEGORIES(=유료 버킷+greeting) 로 허용하지 않으면 기본 클론 알람이 INVALID_BUCKET_ID
  // 로 거부돼 영구 미동기화된다.
  if (
    body.bucket_id !== undefined &&
    body.bucket_id !== null &&
    (typeof body.bucket_id !== 'string' ||
      (!FREE_BUCKET_CATEGORIES.includes(body.bucket_id) &&
        !CLONE_PRERENDER_CATEGORIES.includes(body.bucket_id)))
  ) {
    return { error: 'Invalid bucket_id', error_code: 'INVALID_BUCKET_ID' };
  }

  if (body.target_user_id !== undefined && typeof body.target_user_id !== 'string') {
    return { error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' };
  }

  if (body.mode !== undefined && !ALARM_MODES.includes(body.mode as AlarmMode)) {
    return { error: `mode must be one of: ${ALARM_MODES.join(', ')}`, error_code: 'INVALID_ALARM_MODE' };
  }

  if (body.vibration_pattern !== undefined && !VIBRATION_PATTERNS.includes(body.vibration_pattern as VibrationPattern)) {
    return { error: `vibration_pattern must be one of: ${VIBRATION_PATTERNS.join(', ')}`, error_code: 'INVALID_VIBRATION_PATTERN' };
  }

  if (body.wake_mode !== undefined && !WAKE_MODES.includes(body.wake_mode as WakeMode)) {
    return { error: `wake_mode must be one of: ${WAKE_MODES.join(', ')}`, error_code: 'INVALID_WAKE_MODE' };
  }

  if (body.voice_profile_id !== undefined && body.voice_profile_id !== null && !UUID_RE.test(body.voice_profile_id)) {
    return { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' };
  }

  if (body.time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.time)) {
      return { error: 'time must be in HH:mm format', error_code: 'INVALID_TIME_FORMAT' };
    }
    const [h, m] = body.time.split(':').map(Number) as [number, number];
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return { error: 'Invalid time value', error_code: 'INVALID_TIME_VALUE' };
    }
  }

  if (
    body.repeat_days !== undefined &&
    (!Array.isArray(body.repeat_days) || body.repeat_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    return { error: 'repeat_days must be an array of integers 0-6', error_code: 'INVALID_REPEAT_DAYS' };
  }

  if (
    body.snooze_minutes !== undefined &&
    (!Number.isInteger(body.snooze_minutes) || body.snooze_minutes < 1 || body.snooze_minutes > 30)
  ) {
    return { error: 'snooze_minutes must be an integer between 1 and 30', error_code: 'INVALID_SNOOZE_MINUTES' };
  }

  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return { error: 'is_active must be a boolean', error_code: 'INVALID_IS_ACTIVE' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 타인 발신(가족/친구) 알람 가드 — 수신자 시간대 판정 + (수신자, time) 슬롯 원자 점유
// ---------------------------------------------------------------------------

/**
 * 타인 발신 알람의 최소 리드타임(분). 다음 발사 시각이 이보다 임박하면 400 으로 거부한다.
 *
 * ⚠ **앱의 같은 상수와 반드시 같은 값이다** — 안드로이드 `FAMILY_ALARM_MIN_LEAD_MILLIS`,
 * iOS `familyAlarmMinLeadMillis`. 앱만 낮추면 앱은 통과시키고 서버가 400 으로 막아
 * **"상대 알람 설정에 실패했어요" 만 뜨는 막다른 길**이 된다(2026-08-24 실기기 재현).
 *
 * ⚠ 예전 값 30분은 **푸시가 없고 15분 주기 폴링으로만** 받은 알람을 가져오던 시절의
 * 것이다. 지금은 `family_alarm` 푸시가 즉시 pull 을 돌리므로 그 근거가 사라졌다.
 * 0 으로 두지 않는 이유는 앱 쪽 주석과 같다(수신 기기 오프라인·Doze 면 pull 이 늦는다).
 */
export const FAMILY_ALARM_MIN_LEAD_MINUTES = 5;

/**
 * 클라이언트가 보낸 IANA timezone 을 정규화한다. 푸시 스케줄러가 알람 HH:mm 을
 * 이 시간대로 판정한다. 형식이 어긋나면 null (스케줄러가 Asia/Seoul 폴백).
 */
export function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(trimmed)) return null;
  return trimmed;
}

// Workers 는 Intl.DateTimeFormat 의 timeZone 옵션을 지원한다. 알람 time(HH:mm)은 수신자
// 로컬 벽시계 시각이므로 리드타임·quiet 요일 판정은 반드시 수신자 시간대 기준으로 한다.
const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallClockFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    wallClockFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Intl 이 실제로 아는 시간대인지 확인한다(형식만 맞는 가짜 값 걸러내기). */
export function isSupportedTimezone(timezone: string): boolean {
  try {
    getWallClockFormatter(timezone);
    return true;
  } catch {
    return false;
  }
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

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0=일요일 … 6=토요일 (해당 시간대 기준). */
  dayOfWeek: number;
}

/** UTC 시각을 주어진 IANA 시간대의 벽시계 성분으로 분해한다. */
function wallClockAt(at: Date, timezone: string): WallClock {
  const parts = getWallClockFormatter(timezone).formatToParts(at);
  const clock: WallClock = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, dayOfWeek: 0 };
  for (const part of parts) {
    if (part.type === 'year') clock.year = Number(part.value);
    else if (part.type === 'month') clock.month = Number(part.value);
    else if (part.type === 'day') clock.day = Number(part.value);
    // hour12:false 는 환경에 따라 자정을 '24' 로 줄 수 있다.
    else if (part.type === 'hour') clock.hour = Number(part.value) % 24;
    else if (part.type === 'minute') clock.minute = Number(part.value);
    else if (part.type === 'weekday') clock.dayOfWeek = WEEKDAY_TO_INDEX[part.value] ?? 0;
  }
  return clock;
}

/**
 * 시간대의 (y,m,d HH:mm) 벽시계 시각을 UTC Date 로 변환한다(2회 보정으로 DST 경계 흡수).
 *
 * DST 경계 정책:
 *  - gap(스프링포워드로 존재하지 않는 벽시계, 예 NY 2026-03-08 02:30): 2회 보정만으로는
 *    gap '이전'(01:30 EST)으로 수렴한다. 보정 후 결과 벽시계의 HH:mm 이 요청과 다르면
 *    잔여 오프셋을 한 번 더 더해 gap '이후'(03:30 EDT)로 확정한다.
 *  - ambiguous(폴백으로 두 번 나타나는 벽시계, 예 NY 2026-11-01 01:30): 2회 보정이 자연히
 *    '이른 쪽'(01:30 EDT)으로 수렴하며 HH:mm 이 일치하므로 추가 보정 없이 그대로 둔다.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const clock = wallClockAt(new Date(ts), timezone);
    const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
    ts += target - asUtc;
  }
  // gap 감지: 보정 결과의 벽시계 HH:mm 이 요청과 다르면 존재하지 않는 시각이므로 잔여
  // 오프셋을 한 번 더 더해 gap 이후 시각으로 확정한다(위 정책 주석 참고).
  const settled = wallClockAt(new Date(ts), timezone);
  if (settled.hour !== hour || settled.minute !== minute) {
    const asUtc = Date.UTC(
      settled.year,
      settled.month - 1,
      settled.day,
      settled.hour,
      settled.minute,
    );
    ts += target - asUtc;
  }
  return new Date(ts);
}

export interface NextAlarmFire {
  /** 지금 이후 첫 발사 시각(UTC). */
  fireAt: Date;
  /** 발사 시각의 효과 시간대 요일(0=일 … 6=토). 일회성 알람 quiet 요일 판정에 쓴다. */
  fireDayOfWeek: number;
}

/**
 * (time HH:mm, repeat_days, 효과 시간대)로 지금 이후 첫 발사 시각을 구한다.
 * 일회성(repeat_days 빈 배열)은 오늘 그 시각, 이미 지났으면 내일. 반복은 다음 매칭 요일.
 * time 형식이 틀리면 null (호출부 validateAlarmFields/WAKE_AT_RE 가 먼저 거른다).
 */
export function computeNextAlarmFire(
  time: string,
  repeatDays: number[],
  timezone: string,
  now: Date = new Date(),
): NextAlarmFire | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const zone = isSupportedTimezone(timezone) ? timezone : DEFAULT_ALARM_TIMEZONE;
  // 오늘부터 최대 8일(반복 요일 한 바퀴 + 자정 경계 여유)을 훑어 첫 매칭 시각을 찾는다.
  // 후보 날짜는 고정 86,400,000ms 더하기가 아니라 '효과 시간대의 달력 날짜' 단위로
  // 전진시킨다 — DST 지역은 로컬 하루가 23/25시간이라 now+24h 반복은 전환일 직전
  // 자정 부근에서 달력 날짜를 건너뛰거나(春) 중복 방문(秋)해 발사일이 하루 밀린다.
  // UTC 정오 앵커로 순수 날짜 산술만 하므로 월/연 롤오버 포함 DST 와 무관하게 안전하다.
  const today = wallClockAt(now, zone);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probeDate = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset, 12));
    const candidate = zonedWallTimeToUtc(
      probeDate.getUTCFullYear(),
      probeDate.getUTCMonth() + 1,
      probeDate.getUTCDate(),
      hour,
      minute,
      zone,
    );
    if (candidate.getTime() <= now.getTime()) continue;
    const fireDayOfWeek = wallClockAt(candidate, zone).dayOfWeek;
    if (repeatDays.length > 0 && !repeatDays.includes(fireDayOfWeek)) continue;
    return { fireAt: candidate, fireDayOfWeek };
  }
  return null; // repeat_days 가 0-6 검증을 통과했다면 도달 불가
}

/**
 * 타인 발신 알람 검증(리드타임·quiet)·저장 전용 효과 시간대. 우선순위:
 *  ① 수신자의 가장 최근 '소유' 알람에 저장된 timezone (수신자 기기가 마지막으로 보고한 시간대)
 *  ② DEFAULT_ALARM_TIMEZONE('Asia/Seoul')
 *
 * 요청 body 의 timezone 은 '발신자' 기기 값이라 어떤 경우에도 판정 기준으로 신뢰하지
 * 않는다 — 수신자 기록이 없을 때 body 로 폴백하면 발신자가 오프셋이 다른 시간대를 보내
 * 리드타임(FAMILY_ALARM_MIN_LEAD_MINUTES)/quiet 판정을 우회할 수 있으므로, 폴백은 Asia/Seoul 고정이다.
 * 호출부는 이 함수가 돌려준 효과 시간대를 알람 행(timezone)에 그대로 저장해, cron
 * 스케줄러가 검증과 같은 시간대로 HH:mm 을 해석하게 한다.
 * (본인 알람(비-target) 생성의 timezone 저장 동작과는 무관.)
 */
export async function resolveEffectiveTimezone(
  db: DbExecutor,
  recipientIds: [string, string],
): Promise<string> {
  // 수신자 '소유' 알람(user_id 매칭)의 timezone 이 수신자 기기 시간대를 반영한다.
  // (target_user_id 로 수신한 알람의 timezone 은 발신자 기기 값이라 신뢰하지 않는다.)
  const res = await db.execute({
    sql: `SELECT timezone FROM alarms
          WHERE user_id IN (?, ?) AND timezone IS NOT NULL AND timezone != ''
          ORDER BY updated_at DESC LIMIT 1`,
    args: [recipientIds[0], recipientIds[1]],
  });
  const stored = res.rows.length > 0 ? String(res.rows[0]!.timezone ?? '') : '';
  if (stored && isSupportedTimezone(stored)) return stored;
  return DEFAULT_ALARM_TIMEZONE;
}

/**
 * 타인 발신 알람의 (수신자, time) 슬롯을 원자적으로 점유한다. 반드시
 * withWriteTransaction 안에서 호출할 것(조회→비활성화→insert/update 가 한 트랜잭션).
 *
 * 1) 멱등: 같은 발신자(senderUserId)·같은 수신자·같은 time 의 active 알람이 이미 있으면
 *    새 행을 만들지 않고 그 id 를 재사용한다(호출부가 내용을 UPDATE). 같은 요청 재전송이
 *    중복 행을 만들지 않는다. 이때 기존 행이 가리키던 message_id(previousMessageId)를
 *    함께 돌려줘, 호출부가 교체로 고아가 된 이전 message 행을 같은 트랜잭션에서 정리할
 *    수 있게 한다(가족 알람 멱등 재전송 시 미사용 메시지 누적 방지).
 * 2) 교체: 다른 발신자 것을 포함해 `target_user_id = 수신자 AND time = ? AND is_active = 1`
 *    인 기존 발신 알람을 전부 비활성화한다(최신 생성 우선). 비활성화는 클라 pull 동기화
 *    (RemoteAlarm.is_active → resolveReceivedRemoteEnabled)로 수신자 기기에 전파된다.
 *
 * 스코프: 수신자 '본인이 만든' 알람(target_user_id 없음)은 서버에서 건드리지 않는다 —
 * 받은 알람과 같은 시각의 내 알람 교체는 클라 로컬 확인창(받은 알람 우선 규칙)이 담당한다.
 */
export async function claimTargetedAlarmSlot(
  executor: DbExecutor,
  senderUserId: string,
  recipientIds: [string, string],
  time: string,
  newAlarmId: string,
): Promise<{ alarmId: string; reused: boolean; previousMessageId: string | null }> {
  const existing = await executor.execute({
    sql: `SELECT id, message_id FROM alarms
          WHERE user_id = ? AND target_user_id IN (?, ?) AND time = ? AND is_active = 1
          ORDER BY created_at DESC LIMIT 1`,
    args: [senderUserId, recipientIds[0], recipientIds[1], time],
  });
  const reused = existing.rows.length > 0;
  const alarmId = reused ? String(existing.rows[0]!.id) : newAlarmId;
  const previousMessageId =
    reused && existing.rows[0]!.message_id != null ? String(existing.rows[0]!.message_id) : null;
  // 유지할 행(id 재사용 시 그 행)만 남기고 같은 슬롯의 나머지 발신 알람을 비활성화.
  await executor.execute({
    sql: `UPDATE alarms SET is_active = 0, updated_at = datetime('now')
          WHERE target_user_id IN (?, ?) AND time = ? AND is_active = 1 AND id != ?`,
    args: [recipientIds[0], recipientIds[1], time, alarmId],
  });
  return { alarmId, reused, previousMessageId };
}

/** 타인 발신 알람 시각 가드 결과 — 통과(효과 시간대 반환) 또는 거부(에러 응답 필드). */
export type FamilyAlarmTimingGuardResult =
  | { ok: true; effectiveTimezone: string; nextFire: NextAlarmFire | null }
  | { ok: false; error: string; error_code: string; status: 400 | 403 };

/**
 * 타인 발신(가족/친구) 알람의 시각 가드 — POST(생성)·PATCH(수정) 공용.
 * 발신자 body.timezone 은 어떤 경우에도 신뢰하지 않고, resolveEffectiveTimezone 이 산출한
 * 효과 시간대(수신자 최근 알람 tz → Asia/Seoul)로 다음 발사 시각을 구해 판정한다.
 *  ① 수신자가 알람 수신을 허용하지 않으면 403 FAMILY_ALARM_DISABLED
 *  ② 다음 발사 시각이 FAMILY_ALARM_MIN_LEAD_MINUTES 미만이면 400 FAMILY_ALARM_LEAD_TIME
 *  ③ 다음 발사 요일·시각이 수신자 quiet 창에 걸리면 403 FAMILY_ALARM_QUIET_TIME
 * 통과 시 { ok:true, effectiveTimezone } — 호출부는 이 효과 시간대를 알람 행(timezone)에
 * 그대로 저장해 cron 스케줄러가 검증과 같은 시간대로 HH:mm 을 해석하게 한다.
 */
export async function evaluateFamilyAlarmTimingGuard(
  db: DbExecutor,
  recipientIds: [string, string],
  settings: FamilyAlarmSettings,
  time: string,
  repeatDays: number[],
  now: Date = new Date(),
): Promise<FamilyAlarmTimingGuardResult> {
  if (!settings.allowFamilyAlarms) {
    return {
      ok: false,
      error: '상대방이 알람 설정을 허용하지 않았습니다.',
      error_code: 'FAMILY_ALARM_DISABLED',
      status: 403,
    };
  }
  const effectiveTimezone = await resolveEffectiveTimezone(db, recipientIds);
  const nextFire = computeNextAlarmFire(time, repeatDays, effectiveTimezone, now);
  if (
    nextFire &&
    nextFire.fireAt.getTime() - now.getTime() < FAMILY_ALARM_MIN_LEAD_MINUTES * 60_000
  ) {
    return {
      ok: false,
      error: `알람은 최소 ${FAMILY_ALARM_MIN_LEAD_MINUTES}분 이후 시각으로만 보낼 수 있습니다.`,
      error_code: 'FAMILY_ALARM_LEAD_TIME',
      status: 400,
    };
  }
  if (
    isBlockedByFamilyAlarmQuietTime(
      time,
      repeatDays,
      settings,
      nextFire?.fireDayOfWeek ?? now.getDay(),
    )
  ) {
    return {
      ok: false,
      error: '상대방이 설정한 불가 시간에는 알람을 만들 수 없습니다.',
      error_code: 'FAMILY_ALARM_QUIET_TIME',
      status: 403,
    };
  }
  return { ok: true, effectiveTimezone, nextFire };
}
