import { describe, it, expect } from 'vitest';
import {
  validateAlarmFields,
  normalizeTimezone,
  ALARM_MODES,
  VIBRATION_PATTERNS,
  WAKE_MODES,
} from '../src/routes/alarm-helpers';
import {
  FREE_BUCKET_CATEGORIES,
  CLONE_PRERENDER_CATEGORIES,
  STOCK_GREETING_CATEGORY,
} from '../src/lib/stock-clips';

/**
 * **구버전 앱이 보내는 옛 카테고리 이름을 계속 받아야 한다.**
 *
 * 2026-09-03 에 `love` → `cheer` 로 이름을 바꿨는데, 허용 집합은 카탈로그에서 파생되므로
 * 그 순간 옛 값이 목록에서 사라진다. 스토어에 올라간 앱과 이미 저장된 알람 행은 우리가
 * 고칠 수 없으니, **요청 경계에서 접어** 받는다. 접기를 지우면 그 앱의 알람 저장·수정·
 * 전송이 전부 `INVALID_BUCKET_ID`(400) 가 된다.
 */
describe('옛 버킷 이름 접기', () => {
  it('구버전 앱의 bucket_id=love 를 cheer 로 받아 준다', () => {
    const body: Record<string, unknown> = { time: '07:00', bucket_id: 'love' };
    expect(validateAlarmFields(body as never)).toBeNull();
    expect(body.bucket_id).toBe('cheer');
  });

  it('현재 이름은 그대로 통과한다', () => {
    for (const bucket of ['cheer', 'weather', 'fortune', 'medication', 'greeting']) {
      const body: Record<string, unknown> = { time: '07:00', bucket_id: bucket };
      expect(validateAlarmFields(body as never), bucket).toBeNull();
      expect(body.bucket_id).toBe(bucket);
    }
  });

  it('모르는 값은 여전히 거절한다', () => {
    const body: Record<string, unknown> = { time: '07:00', bucket_id: 'nope' };
    expect(validateAlarmFields(body as never)?.error_code).toBe('INVALID_BUCKET_ID');
  });
});

describe('validateAlarmFields', () => {
  it('returns null for valid empty body', () => {
    expect(validateAlarmFields({})).toBeNull();
  });

  it('rejects invalid message_id', () => {
    const r = validateAlarmFields({ message_id: 'not-uuid' });
    expect(r?.error_code).toBe('INVALID_MESSAGE_ID');
  });

  it('accepts valid message_id', () => {
    expect(validateAlarmFields({ message_id: '12345678-1234-1234-1234-123456789012' })).toBeNull();
  });

  it('rejects invalid mode', () => {
    expect(validateAlarmFields({ mode: 'vibrate' })?.error_code).toBe('INVALID_ALARM_MODE');
  });

  it('accepts valid modes', () => {
    for (const m of ALARM_MODES) {
      expect(validateAlarmFields({ mode: m })).toBeNull();
    }
  });

  it('rejects invalid vibration_pattern', () => {
    expect(validateAlarmFields({ vibration_pattern: 'turbo' })?.error_code).toBe('INVALID_VIBRATION_PATTERN');
  });

  it('accepts every Android vibration pattern', () => {
    for (const pattern of ['heartbeat', 'siren', 'sos', 'off_beat', 'ripple', 'drumroll']) {
      expect(validateAlarmFields({ vibration_pattern: pattern }), pattern).toBeNull();
    }
  });

  it('accepts valid vibration_patterns', () => {
    for (const v of VIBRATION_PATTERNS) {
      expect(validateAlarmFields({ vibration_pattern: v })).toBeNull();
    }
  });

  it('rejects invalid wake_mode', () => {
    expect(validateAlarmFields({ wake_mode: 'alarm_only' })?.error_code).toBe('INVALID_WAKE_MODE');
  });

  it('accepts valid wake_modes', () => {
    for (const w of WAKE_MODES) {
      expect(validateAlarmFields({ wake_mode: w })).toBeNull();
    }
  });

  it('rejects invalid voice_profile_id but allows null', () => {
    expect(validateAlarmFields({ voice_profile_id: 'bad' })?.error_code).toBe('INVALID_VOICE_PROFILE_ID');
    expect(validateAlarmFields({ voice_profile_id: null })).toBeNull();
  });

it('rejects malformed time', () => {
    expect(validateAlarmFields({ time: '9:00' })?.error_code).toBe('INVALID_TIME_FORMAT');
    expect(validateAlarmFields({ time: '123:00' })?.error_code).toBe('INVALID_TIME_FORMAT');
  });

  it('rejects out-of-range time values', () => {
    expect(validateAlarmFields({ time: '25:00' })?.error_code).toBe('INVALID_TIME_VALUE');
    expect(validateAlarmFields({ time: '12:60' })?.error_code).toBe('INVALID_TIME_VALUE');
  });

  it('accepts valid times', () => {
    expect(validateAlarmFields({ time: '00:00' })).toBeNull();
    expect(validateAlarmFields({ time: '23:59' })).toBeNull();
    expect(validateAlarmFields({ time: '07:30' })).toBeNull();
  });

  it('rejects invalid repeat_days', () => {
    expect(validateAlarmFields({ repeat_days: [7] })?.error_code).toBe('INVALID_REPEAT_DAYS');
    expect(validateAlarmFields({ repeat_days: [-1] })?.error_code).toBe('INVALID_REPEAT_DAYS');
    expect(validateAlarmFields({ repeat_days: [1.5] })?.error_code).toBe('INVALID_REPEAT_DAYS');
    expect(validateAlarmFields({ repeat_days: 'mon' as unknown as number[] })?.error_code).toBe('INVALID_REPEAT_DAYS');
  });

  it('accepts valid repeat_days', () => {
    expect(validateAlarmFields({ repeat_days: [] })).toBeNull();
    expect(validateAlarmFields({ repeat_days: [0, 3, 6] })).toBeNull();
  });

  it('rejects invalid snooze_minutes', () => {
    expect(validateAlarmFields({ snooze_minutes: 0 })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: 31 })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: 5.5 })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('accepts valid snooze_minutes', () => {
    expect(validateAlarmFields({ snooze_minutes: 1 })).toBeNull();
    expect(validateAlarmFields({ snooze_minutes: 15 })).toBeNull();
    expect(validateAlarmFields({ snooze_minutes: 30 })).toBeNull();
  });

  it('rejects non-boolean is_active', () => {
    expect(validateAlarmFields({ is_active: 1 as unknown as boolean })?.error_code).toBe('INVALID_IS_ACTIVE');
  });

  it('accepts boolean is_active', () => {
    expect(validateAlarmFields({ is_active: true })).toBeNull();
    expect(validateAlarmFields({ is_active: false })).toBeNull();
  });

  it('rejects empty string message_id', () => {
    expect(validateAlarmFields({ message_id: '' })?.error_code).toBe('INVALID_MESSAGE_ID');
  });

  it('rejects NaN and Infinity snooze_minutes', () => {
    expect(validateAlarmFields({ snooze_minutes: NaN })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: Infinity })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: -Infinity })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('passes when voice_profile_id are undefined', () => {
    expect(validateAlarmFields({ voice_profile_id: undefined })).toBeNull();
  });

  it('rejects empty string voice_profile_id', () => {
    expect(validateAlarmFields({ voice_profile_id: '' })?.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('returns first error when multiple fields invalid (validation priority)', () => {
    const r = validateAlarmFields({
      message_id: 'bad',
      mode: 'invalid',
      time: 'nope',
    });
    expect(r?.error_code).toBe('INVALID_MESSAGE_ID');
  });

  it('accepts all valid fields simultaneously', () => {
    expect(validateAlarmFields({
      message_id: '12345678-1234-1234-1234-123456789012',
      mode: 'tts',
      vibration_pattern: 'strong',
      wake_mode: 'voice_only',
      voice_profile_id: '12345678-1234-1234-1234-123456789012',
      time: '07:30',
      repeat_days: [0, 1, 2, 3, 4, 5, 6],
      snooze_minutes: 15,
      is_active: true,
    })).toBeNull();
  });

  it('accepts repeat_days with duplicates', () => {
    expect(validateAlarmFields({ repeat_days: [1, 1, 1] })).toBeNull();
  });

  it('rejects time 24:00', () => {
    expect(validateAlarmFields({ time: '24:00' })?.error_code).toBe('INVALID_TIME_VALUE');
  });
});

describe('validateAlarmFields — bucket_id', () => {
  it('accepts null/undefined (버킷 해제)', () => {
    expect(validateAlarmFields({ bucket_id: null })).toBeNull();
    expect(validateAlarmFields({ bucket_id: undefined })).toBeNull();
  });

  it('accepts every free bucket category', () => {
    for (const cat of FREE_BUCKET_CATEGORIES) {
      expect(validateAlarmFields({ bucket_id: cat })).toBeNull();
    }
  });

  it('accepts every clone prerender bucket category (유료 버킷 + greeting)', () => {
    for (const cat of CLONE_PRERENDER_CATEGORIES) {
      expect(validateAlarmFields({ bucket_id: cat })).toBeNull();
    }
  });

  it('accepts greeting — 기본 preset 컨텍스트 클론 알람 동기화 회귀 방지', () => {
    // AlarmEditorState.clonePrerenderBucketCategoryFor: preset→greeting 를 bucket_id 로 실어 보내므로
    // greeting 이 거부되면 기본 유료 클론 알람이 INVALID_BUCKET_ID 로 영구 미동기화된다.
    expect(STOCK_GREETING_CATEGORY).toBe('greeting');
    expect(validateAlarmFields({ bucket_id: 'greeting' })).toBeNull();
  });

  it('rejects unknown / non-bucket values', () => {
    expect(validateAlarmFields({ bucket_id: 'nope' })?.error_code).toBe('INVALID_BUCKET_ID');
    // TTS 카테고리이지만 버킷 카테고리는 아니다 — 둘이 섞이면 여기서 잡힌다.
    expect(validateAlarmFields({ bucket_id: 'morning' })?.error_code).toBe('INVALID_BUCKET_ID');
    expect(validateAlarmFields({ bucket_id: '' })?.error_code).toBe('INVALID_BUCKET_ID');
    expect(
      validateAlarmFields({ bucket_id: 123 as unknown as string })?.error_code,
    ).toBe('INVALID_BUCKET_ID');
  });
});

describe('normalizeTimezone', () => {
  it('normalizeTimezone: 형식이 맞으면 trim 해 반환, 아니면 null', () => {
    expect(normalizeTimezone(' Asia/Seoul ')).toBe('Asia/Seoul');
    expect(normalizeTimezone('America/New_York')).toBe('America/New_York');
    expect(normalizeTimezone('')).toBeNull();
    expect(normalizeTimezone(123)).toBeNull();
    expect(normalizeTimezone('bad zone!')).toBeNull();
    expect(normalizeTimezone('a'.repeat(65))).toBeNull();
  });
});
