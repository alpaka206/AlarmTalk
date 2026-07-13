import { UUID_RE } from '../lib/validate';
import { isStoredAudioUrl } from '../lib/audio-loader';
import { FREE_BUCKET_CATEGORIES, PAID_BUCKET_CATEGORIES } from '../lib/stock-clips';

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
  speaker_id?: unknown;
  user_id?: unknown;
  target_user_id?: unknown;
  creator_email?: unknown;
  creator_name?: unknown;
  category?: unknown;
  raw_audio_url?: unknown;
  raw_audio_duration_ms?: unknown;
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
    speaker_id: (row.speaker_id ?? null) as string | null,
    raw_audio_url: (row.raw_audio_url ?? null) as string | null,
    raw_audio_duration_ms:
      typeof row.raw_audio_duration_ms === 'number'
        ? row.raw_audio_duration_ms
        : null,
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
  speaker_id?: string | null;
  time?: string;
  repeat_days?: number[];
  snooze_minutes?: number;
  message_id?: string | null;
  is_active?: boolean;
  target_user_id?: string;
  raw_audio_url?: string | null;
  bucket_id?: string | null;
}): FieldError | null {
  if (body.message_id != null && !UUID_RE.test(body.message_id)) {
    return { error: 'Invalid message_id format', error_code: 'INVALID_MESSAGE_ID' };
  }

  // 무료 버킷(기상/약) + 유료 클론 버킷(날씨/운세/사랑/약) 카테고리만 허용. null=버킷 해제.
  // 유료 클론 오프라인 버킷 알람은 bucket_id 로 love/fortune/weather 를 실어 동기화하므로, 무료만
  // 허용하면 그 알람이 INVALID_BUCKET_ID 로 거부돼 영구 미동기화된다.
  if (
    body.bucket_id !== undefined &&
    body.bucket_id !== null &&
    (typeof body.bucket_id !== 'string' ||
      (!FREE_BUCKET_CATEGORIES.includes(body.bucket_id) &&
        !PAID_BUCKET_CATEGORIES.includes(body.bucket_id)))
  ) {
    return { error: 'Invalid bucket_id', error_code: 'INVALID_BUCKET_ID' };
  }

  if (body.target_user_id !== undefined && typeof body.target_user_id !== 'string') {
    return { error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' };
  }

  if (body.raw_audio_url !== undefined && body.raw_audio_url !== null) {
    if (typeof body.raw_audio_url !== 'string' || !isStoredAudioUrl(body.raw_audio_url.trim())) {
      return { error: 'raw_audio_url must be a stored r2:// object', error_code: 'INVALID_RAW_AUDIO_URL' };
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

  if (body.speaker_id !== undefined && body.speaker_id !== null && !UUID_RE.test(body.speaker_id)) {
    return { error: 'Invalid speaker_id format', error_code: 'INVALID_SPEAKER_ID' };
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
