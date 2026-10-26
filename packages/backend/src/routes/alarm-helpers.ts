import { UUID_RE } from '../lib/validate';
import { isAlarmTargetDate, type ErrorCode } from '@alarmtalk/shared';
import {
  FREE_BUCKET_CATEGORIES,
  CLONE_PRERENDER_CATEGORIES,
  normalizeStockCategory,
} from '../lib/stock-clips';

export const ALARM_MODES = ['sound-only', 'tts'] as const;
export type AlarmMode = (typeof ALARM_MODES)[number];
// 안드로이드 진동 패턴 목록(`data/AlarmConstants.kt` 의 `VibrationPatterns.all`)과 **같은 값**이다 — 앱은 고른
// 값을 그대로 동기화한다(`RemoteAlarmMapper`). 2026-10-12 전에는 서버가 `default`·`strong`·`none` 셋만 받아,
// 그 밖의 패턴을 고른 알람은 동기화마다 400 `INVALID_VIBRATION_PATTERN` 이었다(ALARMTALK-ANDROID-14) — 알람은
// 폰에서 울렸지만 서버 사본이 갱신되지 않았다. iOS 는 진동 화면이 없지만 같은 18종 enum(`AlarmEnums.swift` 의
// `VibrationPattern`)으로 읽고 편집기 저장 때 그 값으로 다시 적는다 — enum 에 없는 값은 '기본' 으로 덮인다.
// DB 칸에는 값 제약이 없다 — 처음 칸을 더할 때의 CHECK 는 표를 다시 만든 마이그레이션 22·23 에서 빠졌다.
// 패턴을 더하면 세 곳을 같이 고친다 — `scripts/check-vibration-patterns.py`(CI lint)가 세 목록을 비교한다.
export const VIBRATION_PATTERNS = [
  'default',
  'strong',
  'short',
  'medium',
  'rise',
  'pulse',
  'bounce',
  'drumroll',
  'heartbeat',
  'ticktock',
  'waltz',
  'zigzag',
  'off_beat',
  'ripple',
  'siren',
  'soft',
  'sos',
  'none',
] as const;
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
  target_date?: unknown;
};

export function normalizeAlarmRow(row: AlarmRow) {
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

  const vibrationPattern: VibrationPattern = VIBRATION_PATTERNS.includes(row.vibration_pattern as VibrationPattern)
    ? (row.vibration_pattern as VibrationPattern)
    : 'default';

  const wakeMode: WakeMode =
    row.wake_mode === 'sound_then_voice' || row.wake_mode === 'voice_only'
      ? row.wake_mode
      : 'sound_then_voice';

  return {
    ...row,
    repeat_days: repeatDays,
    is_active: row.is_active === 1 || row.is_active === true,
    mode,
    vibration_pattern: vibrationPattern,
    wake_mode: wakeMode,
    voice_profile_id: (row.voice_profile_id ?? null) as string | null,
    // 날짜 지정 알람의 날짜(`docs/spec/alarm-lifecycle.md` §4). 형식이 어긋난 값은 날짜 없음으로 읽는다.
    target_date: isAlarmTargetDate(row.target_date) ? row.target_date : null,
  };
}

// error_code 는 **목록에 있는 코드**여야 한다 — 이 객체가 그대로 400 본문이 된다.
type FieldError = { error: string; error_code: ErrorCode };

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
  bucket_id?: string | null;
  target_date?: string | null;
  timezone?: string | null;
}): FieldError | null {
  if (body.message_id != null && !UUID_RE.test(body.message_id)) {
    return { error: 'Invalid message_id format', error_code: 'INVALID_MESSAGE_ID' };
  }

  // 무료 버킷(기상/약) + 유료 클론 사전렌더 버킷(날씨/운세/사랑/약 + greeting) 카테고리만 허용. null=버킷 해제.
  // 유료 클론 오프라인 버킷 알람은 bucket_id 로 love/fortune/weather 뿐 아니라 기본 preset 컨텍스트의
  // greeting(기상 인사) 도 실어 동기화한다(AlarmEditorState.clonePrerenderBucketCategoryFor: preset→greeting).
  // CLONE_PRERENDER_CATEGORIES(=유료 버킷+greeting) 로 허용하지 않으면 기본 클론 알람이 INVALID_BUCKET_ID
  // 로 거부돼 영구 미동기화된다.
  if (body.bucket_id !== undefined && body.bucket_id !== null) {
    if (typeof body.bucket_id !== 'string') {
      return { error: 'Invalid bucket_id', error_code: 'INVALID_BUCKET_ID' };
    }
    // ⚠ **옛 이름을 여기서 접는다**(2026-09-03). 두 허용 집합은 카탈로그에서 파생되므로
    //   이름을 바꾸는 순간 옛 값이 목록에서 사라진다 — 구버전 앱이 보내는 `love` 가
    //   **INVALID_BUCKET_ID(400)** 이 되어 그 앱의 알람 저장·수정·전송이 전부 막힌다.
    //   스토어에 올라간 앱은 우리가 고칠 수 없으니, 경계에서 새 이름으로 바꿔 받는다.
    //   ⚠ 검증 **전에** 접어야 한다 — 접고 나서 검사해야 통과한다.
    body.bucket_id = normalizeStockCategory(body.bucket_id);
    if (
      !FREE_BUCKET_CATEGORIES.includes(body.bucket_id) &&
      !CLONE_PRERENDER_CATEGORIES.includes(body.bucket_id)
    ) {
      return { error: 'Invalid bucket_id', error_code: 'INVALID_BUCKET_ID' };
    }
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

  // 날짜 지정 알람(`docs/spec/alarm-lifecycle.md` §4-7): 실제 날짜 + 같은 요청의 유효한 IANA 시간대 + 빈 반복 요일.
  // **지난 날짜는 거절하지 않는다** — 끝난 날짜 알람의 끄기·켜기도 사본으로 올라온다.
  if (body.target_date !== undefined && body.target_date !== null) {
    if (!isAlarmTargetDate(body.target_date)) {
      return { error: 'target_date must be a real YYYY-MM-DD date', error_code: 'INVALID_TARGET_DATE' };
    }
    if (Array.isArray(body.repeat_days) && body.repeat_days.length > 0) {
      return { error: 'target_date cannot be combined with repeat_days', error_code: 'INVALID_TARGET_DATE' };
    }
    const timezone = normalizeTimezone(body.timezone);
    if (!timezone || !isValidIanaTimezone(timezone)) {
      return { error: 'target_date requires a valid IANA timezone', error_code: 'INVALID_TARGET_DATE' };
    }
  }

  return null;
}

/** 런타임이 아는 IANA 시간대 이름인가(`Intl` 이 거절하면 아니다). 날짜 지정 알람의 시간대 검증용. */
export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * 클라이언트가 보낸 IANA timezone 을 정규화한다. 형식이 어긋나면 null 로 저장한다.
 */
export function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(trimmed)) return null;
  return trimmed;
}
