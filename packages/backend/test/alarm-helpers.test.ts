import { describe, it, expect } from 'vitest';
import {
  normalizeAlarmRow,
  validateAlarmFields,
  normalizeTimezone,
  isSupportedTimezone,
  computeNextAlarmFire,
  resolveEffectiveTimezone,
  ALARM_MODES,
  VIBRATION_PATTERNS,
  WAKE_MODES,
} from '../src/routes/alarm-helpers';
import type { DbExecutor } from '../src/lib/transactions';
import {
  FREE_BUCKET_CATEGORIES,
  CLONE_PRERENDER_CATEGORIES,
  STOCK_GREETING_CATEGORY,
} from '../src/lib/stock-clips';

describe('normalizeAlarmRow', () => {
  const base = { id: 'a1', user_id: 'u1' };

  it('parses JSON string repeat_days', () => {
    const row = { ...base, repeat_days: '[0,1,5]' };
    expect(normalizeAlarmRow(row).repeat_days).toEqual([0, 1, 5]);
  });

  it('returns [] for invalid JSON repeat_days', () => {
    const row = { ...base, repeat_days: 'bad' };
    expect(normalizeAlarmRow(row).repeat_days).toEqual([]);
  });

  it('passes through array repeat_days', () => {
    const row = { ...base, repeat_days: [2, 4] };
    expect(normalizeAlarmRow(row).repeat_days).toEqual([2, 4]);
  });

  it('filters non-integer values from repeat_days', () => {
    const row = { ...base, repeat_days: '[1, 2.5, "x", 3]' };
    expect(normalizeAlarmRow(row).repeat_days).toEqual([1, 3]);
  });

  it('returns [] for empty string repeat_days', () => {
    expect(normalizeAlarmRow({ ...base, repeat_days: '' }).repeat_days).toEqual([]);
  });

  it('coerces is_active correctly', () => {
    expect(normalizeAlarmRow({ ...base, is_active: 1 }).is_active).toBe(true);
    expect(normalizeAlarmRow({ ...base, is_active: true }).is_active).toBe(true);
    expect(normalizeAlarmRow({ ...base, is_active: 0 }).is_active).toBe(false);
    expect(normalizeAlarmRow({ ...base, is_active: false }).is_active).toBe(false);
    expect(normalizeAlarmRow({ ...base, is_active: null }).is_active).toBe(false);
  });

  it('defaults mode to tts for unknown values', () => {
    expect(normalizeAlarmRow({ ...base, mode: 'invalid' }).mode).toBe('tts');
    expect(normalizeAlarmRow({ ...base }).mode).toBe('tts');
  });

  it('preserves valid mode values', () => {
    expect(normalizeAlarmRow({ ...base, mode: 'sound-only' }).mode).toBe('sound-only');
    expect(normalizeAlarmRow({ ...base, mode: 'tts' }).mode).toBe('tts');
  });

  it('defaults vibration_pattern to default', () => {
    expect(normalizeAlarmRow({ ...base }).vibration_pattern).toBe('default');
    expect(normalizeAlarmRow({ ...base, vibration_pattern: 'wrong' }).vibration_pattern).toBe('default');
  });

  it('preserves valid vibration_pattern', () => {
    expect(normalizeAlarmRow({ ...base, vibration_pattern: 'strong' }).vibration_pattern).toBe('strong');
    expect(normalizeAlarmRow({ ...base, vibration_pattern: 'none' }).vibration_pattern).toBe('none');
  });

  it('defaults wake_mode to sound_then_voice', () => {
    expect(normalizeAlarmRow({ ...base }).wake_mode).toBe('sound_then_voice');
  });

  it('preserves valid wake_mode', () => {
    expect(normalizeAlarmRow({ ...base, wake_mode: 'voice_only' }).wake_mode).toBe('voice_only');
  });

  it('nullifies missing voice_profile_id and speaker_id', () => {
    const r = normalizeAlarmRow({ ...base });
    expect(r.voice_profile_id).toBeNull();
    expect(r.speaker_id).toBeNull();
  });

  it('detects family alarm from category', () => {
    expect(normalizeAlarmRow({ ...base, category: 'family' }).is_family_alarm).toBe(true);
    expect(normalizeAlarmRow({ ...base, category: 'family-voice' }).is_family_alarm).toBe(true);
    expect(normalizeAlarmRow({ ...base, category: 'personal' }).is_family_alarm).toBe(false);
  });

  it('detects received family alarm when viewer differs from sender', () => {
    const row = { ...base, category: 'family', user_id: 'sender-1' };
    expect(normalizeAlarmRow(row, 'viewer-2').is_received_family_alarm).toBe(true);
    expect(normalizeAlarmRow(row, 'sender-1').is_received_family_alarm).toBe(false);
    expect(normalizeAlarmRow(row).is_received_family_alarm).toBe(false);
  });

  it('is_received_family_alarm accepts an array of viewer ids', () => {
    const row = { ...base, category: 'family', user_id: 'sender-1', target_user_id: 'viewer-2' };
    expect(normalizeAlarmRow(row, ['pk-2', 'viewer-2']).is_received_family_alarm).toBe(true);
    // 뷰어 집합에 sender 가 포함되면(내가 보낸 것) received 아님
    expect(normalizeAlarmRow(row, ['pk-1', 'sender-1']).is_received_family_alarm).toBe(false);
  });

  it('is_received: viewer is target and not creator (category-agnostic)', () => {
    const row = { ...base, user_id: 'sender-1', target_user_id: 'viewer-2' };
    expect(normalizeAlarmRow(row, 'viewer-2').is_received).toBe(true);
    // 내가 만든 알람(내가 sender) → received 아님
    expect(normalizeAlarmRow(row, 'sender-1').is_received).toBe(false);
    // target 이 내가 아님 → received 아님
    expect(normalizeAlarmRow(row, 'other').is_received).toBe(false);
    // 뷰어 미지정 → received 아님
    expect(normalizeAlarmRow(row).is_received).toBe(false);
    // target 없음 → received 아님(가족 플래그와 달리 target 이 필요)
    expect(normalizeAlarmRow({ ...base, user_id: 'sender-1' }, 'viewer-2').is_received).toBe(false);
  });

  it('is_received is namespace-safe across account-linking (PK vs login id)', () => {
    // 계정 연동 사용자: PK(UUID) ≠ 로그인 id(google_id). alarms.user_id·target_user_id 는
    // 로그인 id 로 저장되고, 클라 session.user.id 는 PK 일 수 있다. 서버가 두 식별자를 모두
    // 담은 집합으로 판별하므로 '내가 보낸 알람'을 '받은 알람'으로 오분류하지 않는다.
    const myPk = '11111111-1111-1111-1111-111111111111';
    const myLoginId = 'google-abc';
    const sent = { ...base, user_id: myLoginId, target_user_id: 'friend-login' };
    expect(normalizeAlarmRow(sent, [myPk, myLoginId]).is_received).toBe(false);
    const received = { ...base, user_id: 'friend-login', target_user_id: myLoginId };
    expect(normalizeAlarmRow(received, [myPk, myLoginId]).is_received).toBe(true);
  });

  it('extracts sender info', () => {
    const row = { ...base, user_id: 'u1', creator_name: 'Kim', creator_email: 'k@t.co' };
    const r = normalizeAlarmRow(row);
    expect(r.sender_name).toBe('Kim');
    expect(r.sender_email).toBe('k@t.co');
    expect(r.sender_user_id).toBe('u1');
  });

  it('returns [] for null/undefined/number repeat_days', () => {
    expect(normalizeAlarmRow({ ...base, repeat_days: null }).repeat_days).toEqual([]);
    expect(normalizeAlarmRow({ ...base, repeat_days: undefined }).repeat_days).toEqual([]);
    expect(normalizeAlarmRow({ ...base, repeat_days: 42 }).repeat_days).toEqual([]);
  });

  it('returns [] when JSON parses to non-array', () => {
    expect(normalizeAlarmRow({ ...base, repeat_days: '42' }).repeat_days).toEqual([]);
    expect(normalizeAlarmRow({ ...base, repeat_days: '"hello"' }).repeat_days).toEqual([]);
    expect(normalizeAlarmRow({ ...base, repeat_days: '{}' }).repeat_days).toEqual([]);
    expect(normalizeAlarmRow({ ...base, repeat_days: 'null' }).repeat_days).toEqual([]);
  });

  it('returns [] for empty JSON array string', () => {
    expect(normalizeAlarmRow({ ...base, repeat_days: '[]' }).repeat_days).toEqual([]);
  });

  it('filters NaN/null/undefined/boolean from repeat_days array', () => {
    const row = { ...base, repeat_days: [1, NaN, null, undefined, true, 3] };
    expect(normalizeAlarmRow(row).repeat_days).toEqual([1, 3]);
  });

  it('treats string is_active as false', () => {
    expect(normalizeAlarmRow({ ...base, is_active: 'true' }).is_active).toBe(false);
    expect(normalizeAlarmRow({ ...base, is_active: '1' }).is_active).toBe(false);
  });

  it('treats undefined is_active as false', () => {
    expect(normalizeAlarmRow({ ...base, is_active: undefined }).is_active).toBe(false);
  });

  it('preserves valid voice_profile_id and speaker_id strings', () => {
    const r = normalizeAlarmRow({ ...base, voice_profile_id: 'vp-1', speaker_id: 'sp-2' });
    expect(r.voice_profile_id).toBe('vp-1');
    expect(r.speaker_id).toBe('sp-2');
  });

  it('treats non-string category as non-family', () => {
    expect(normalizeAlarmRow({ ...base, category: 123 }).is_family_alarm).toBe(false);
    expect(normalizeAlarmRow({ ...base, category: null }).is_family_alarm).toBe(false);
    expect(normalizeAlarmRow({ ...base, category: undefined }).is_family_alarm).toBe(false);
  });

  it('returns null sender_name/email for non-string values', () => {
    const r = normalizeAlarmRow({ ...base, creator_name: 42, creator_email: true });
    expect(r.sender_name).toBeNull();
    expect(r.sender_email).toBeNull();
  });

  it('returns null sender_user_id for non-string user_id', () => {
    const r = normalizeAlarmRow({ ...base, user_id: 999 });
    expect(r.sender_user_id).toBeNull();
  });

  it('preserves extra properties via spread', () => {
    const r = normalizeAlarmRow({ ...base, time: '08:00', message: 'hello' });
    expect(r.time).toBe('08:00');
    expect((r as Record<string, unknown>).message).toBe('hello');
    expect(r.id).toBe('a1');
  });

  it('is_received_family_alarm false when sender user_id is non-string', () => {
    const row = { ...base, category: 'family', user_id: 999 };
    expect(normalizeAlarmRow(row, 'viewer-1').is_received_family_alarm).toBe(false);
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

  it('rejects non-string target_user_id', () => {
    const r = validateAlarmFields({ target_user_id: 123 as unknown as string });
    expect(r?.error_code).toBe('INVALID_TARGET_USER');
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

  it('rejects invalid speaker_id but allows null', () => {
    expect(validateAlarmFields({ speaker_id: 'bad' })?.error_code).toBe('INVALID_SPEAKER_ID');
    expect(validateAlarmFields({ speaker_id: null })).toBeNull();
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

  it('accepts empty string target_user_id (is a string)', () => {
    expect(validateAlarmFields({ target_user_id: '' })).toBeNull();
  });

  it('rejects NaN and Infinity snooze_minutes', () => {
    expect(validateAlarmFields({ snooze_minutes: NaN })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: Infinity })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
    expect(validateAlarmFields({ snooze_minutes: -Infinity })?.error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('passes when voice_profile_id/speaker_id are undefined', () => {
    expect(validateAlarmFields({ voice_profile_id: undefined })).toBeNull();
    expect(validateAlarmFields({ speaker_id: undefined })).toBeNull();
  });

  it('rejects empty string voice_profile_id and speaker_id', () => {
    expect(validateAlarmFields({ voice_profile_id: '' })?.error_code).toBe('INVALID_VOICE_PROFILE_ID');
    expect(validateAlarmFields({ speaker_id: '' })?.error_code).toBe('INVALID_SPEAKER_ID');
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
      target_user_id: 'user-abc',
      mode: 'tts',
      vibration_pattern: 'strong',
      wake_mode: 'voice_only',
      voice_profile_id: '12345678-1234-1234-1234-123456789012',
      speaker_id: '12345678-1234-1234-1234-123456789012',
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
    expect(validateAlarmFields({ bucket_id: 'sleep' })?.error_code).toBe('INVALID_BUCKET_ID');
    expect(validateAlarmFields({ bucket_id: '' })?.error_code).toBe('INVALID_BUCKET_ID');
    expect(
      validateAlarmFields({ bucket_id: 123 as unknown as string })?.error_code,
    ).toBe('INVALID_BUCKET_ID');
  });
});

describe('normalizeTimezone / isSupportedTimezone', () => {
  it('normalizeTimezone: 형식이 맞으면 trim 해 반환, 아니면 null', () => {
    expect(normalizeTimezone(' Asia/Seoul ')).toBe('Asia/Seoul');
    expect(normalizeTimezone('America/New_York')).toBe('America/New_York');
    expect(normalizeTimezone('')).toBeNull();
    expect(normalizeTimezone(123)).toBeNull();
    expect(normalizeTimezone('bad zone!')).toBeNull();
    expect(normalizeTimezone('a'.repeat(65))).toBeNull();
  });

  it('isSupportedTimezone: 형식만 맞는 가짜 시간대를 걸러낸다', () => {
    expect(isSupportedTimezone('Asia/Seoul')).toBe(true);
    expect(isSupportedTimezone('America/New_York')).toBe(true);
    expect(isSupportedTimezone('Not/AZone')).toBe(false);
  });
});

describe('resolveEffectiveTimezone — 수신자 저장 tz 우선(발신자 body tz 는 어떤 경우에도 불신)', () => {
  /** 수신자 저장 timezone 조회를 흉내내는 DbExecutor. storedTz=null 이면 기록 없음. */
  function fakeDb(storedTz: string | null): DbExecutor & { args: unknown[] } {
    const captured: unknown[] = [];
    return {
      args: captured,
      execute: (async (stmt: { sql: string; args: unknown[] }) => {
        captured.push(...stmt.args);
        return { rows: storedTz === null ? [] : [{ timezone: storedTz }] };
      }) as unknown as DbExecutor['execute'],
    };
  }

  const RECIPIENT_IDS: [string, string] = ['r-pk', 'r-login'];

  it('수신자 저장 tz 가 있으면 그것을 반환한다', async () => {
    const db = fakeDb('America/New_York');
    await expect(resolveEffectiveTimezone(db, RECIPIENT_IDS)).resolves.toBe('America/New_York');
    // 조회는 수신자 두 식별자(user_id IN)로 바인딩된다.
    expect(db.args).toEqual(['r-pk', 'r-login']);
  });

  it('수신자 기록이 없으면 Asia/Seoul 로 직행한다(발신자 body tz 폴백 없음)', async () => {
    // 발신자가 준 timezone 은 시그니처에서 아예 제거됐다 — 수신자 기록이 없어도
    // 발신자 값으로 판정하지 않고 기본값(Asia/Seoul)으로 판정·저장한다.
    await expect(resolveEffectiveTimezone(fakeDb(null), RECIPIENT_IDS)).resolves.toBe(
      'Asia/Seoul',
    );
  });

  it('저장 tz 가 Intl 미지원 값이어도 Asia/Seoul 기본값', async () => {
    await expect(resolveEffectiveTimezone(fakeDb('Not/AZone'), RECIPIENT_IDS)).resolves.toBe(
      'Asia/Seoul',
    );
  });
});

describe('computeNextAlarmFire — 수신자 시간대 기준 다음 발사 시각', () => {
  // 고정 기준: 2026-07-15T00:00Z = KST 수요일 09:00.
  const NOW = new Date('2026-07-15T00:00:00Z');

  it('일회성: 오늘 시각이 안 지났으면 오늘 발사', () => {
    const fire = computeNextAlarmFire('10:00', [], 'Asia/Seoul', NOW)!;
    expect(fire.fireAt.toISOString()).toBe('2026-07-15T01:00:00.000Z');
    expect(fire.fireDayOfWeek).toBe(3); // 수요일
  });

  it('일회성: 오늘 시각이 지났으면 내일 발사', () => {
    const fire = computeNextAlarmFire('08:00', [], 'Asia/Seoul', NOW)!;
    expect(fire.fireAt.toISOString()).toBe('2026-07-15T23:00:00.000Z'); // KST 목 08:00
    expect(fire.fireDayOfWeek).toBe(4); // 목요일
  });

  it('반복: 다음 매칭 요일로 이동', () => {
    const fire = computeNextAlarmFire('10:00', [6], 'Asia/Seoul', NOW)!;
    expect(fire.fireAt.toISOString()).toBe('2026-07-18T01:00:00.000Z'); // KST 토 10:00
    expect(fire.fireDayOfWeek).toBe(6);
  });

  it('서버 UTC 요일과 수신자 시간대 요일이 다른 경계: UTC 금 15:30 = KST 토 00:30', () => {
    const now = new Date('2026-07-17T14:00:00Z'); // UTC 금 14:00 = KST 금 23:00
    const fire = computeNextAlarmFire('00:30', [], 'Asia/Seoul', now)!;
    expect(fire.fireAt.toISOString()).toBe('2026-07-17T15:30:00.000Z');
    expect(fire.fireAt.getUTCDay()).toBe(5); // UTC 로는 아직 금요일
    expect(fire.fireDayOfWeek).toBe(6); // 수신자(KST) 기준으로는 토요일
  });

  it('지원하지 않는 시간대는 Asia/Seoul 폴백', () => {
    const seoul = computeNextAlarmFire('10:00', [], 'Asia/Seoul', NOW)!;
    const fallback = computeNextAlarmFire('10:00', [], 'Not/AZone', NOW)!;
    expect(fallback.fireAt.getTime()).toBe(seoul.fireAt.getTime());
  });

  it('시간 형식이 틀리면 null', () => {
    expect(computeNextAlarmFire('9:00', [], 'Asia/Seoul', NOW)).toBeNull();
    expect(computeNextAlarmFire('25:00', [], 'Asia/Seoul', NOW)).toBeNull();
  });
});

describe('computeNextAlarmFire — DST 경계(달력 날짜 단위 전진)', () => {
  // 미국 2026년 DST: 3/8(春, 23시간 하루) 시작, 11/1(秋, 25시간 하루) 종료.

  it('봄 전환 직전 자정 부근: 다음 발사일이 전환일(3/8)을 건너뛰지 않는다', () => {
    // now = 2026-03-08T04:30Z = NY 3/7(토) 23:30 EST. '23:00' 은 오늘 지남 → 다음날 3/8(일).
    // 구버전(고정 86,400,000ms 전진)은 now+24h 가 3/9 00:30 EDT 라 달력 3/8 을 건너뛰어
    // 하루 늦게 발사했다.
    const now = new Date('2026-03-08T04:30:00Z');
    const fire = computeNextAlarmFire('23:00', [], 'America/New_York', now)!;
    // 3/8 23:00 EDT(-04) = UTC 3/9 03:00.
    expect(fire.fireAt.toISOString()).toBe('2026-03-09T03:00:00.000Z');
    expect(fire.fireDayOfWeek).toBe(0); // 전환일 당일(일요일)
  });

  it('봄 전환일 요일 반복: 매칭 요일(일)이 한 주 뒤로 밀리지 않는다', () => {
    const now = new Date('2026-03-08T04:30:00Z');
    const fire = computeNextAlarmFire('23:00', [0], 'America/New_York', now)!;
    // 구버전은 3/8 을 건너뛰어 다음 일요일(3/15)로 한 주 밀렸다.
    expect(fire.fireAt.toISOString()).toBe('2026-03-09T03:00:00.000Z');
    expect(fire.fireDayOfWeek).toBe(0);
  });

  it('가을 전환(25시간 하루)도 정확한 벽시계 시각·요일로 발사', () => {
    // now = 2026-11-01T03:30Z = NY 10/31(토) 23:30 EDT → '23:00' 다음 발사는 11/1(일) 23:00 EST.
    const now = new Date('2026-11-01T03:30:00Z');
    const fire = computeNextAlarmFire('23:00', [], 'America/New_York', now)!;
    expect(fire.fireAt.toISOString()).toBe('2026-11-02T04:00:00.000Z'); // EST(-05) 23:00
    expect(fire.fireDayOfWeek).toBe(0);
  });

  it('전환일 아침 알람: 전환 이후 오프셋(EDT)으로 벽시계 시각이 유지된다', () => {
    // now = 2026-03-08T09:00Z = NY 3/8(일) 04:00 EST... 아님 — 3/8 02:00 에 EDT 전환됐으므로
    // 09:00Z = 05:00 EDT. '07:00' 발사는 같은 날 07:00 EDT = 11:00Z 여야 한다(12:00Z 아님).
    const now = new Date('2026-03-08T09:00:00Z');
    const fire = computeNextAlarmFire('07:00', [], 'America/New_York', now)!;
    expect(fire.fireAt.toISOString()).toBe('2026-03-08T11:00:00.000Z');
    expect(fire.fireDayOfWeek).toBe(0);
  });

  it('gap(존재하지 않는 벽시계): 02:30 은 gap 이전(01:30)이 아니라 gap 이후(03:30 EDT)로 확정', () => {
    // NY 2026-03-08 02:00 EST → 03:00 EDT 스프링포워드로 02:00-02:59 는 존재하지 않는다.
    // now = 06:00Z(= 01:00 EST) → 오늘 '02:30' 발사. 2회 보정만으로는 01:30 EST(06:30Z)로
    // 수렴하지만, gap 감지 보정으로 03:30 EDT(= UTC 07:30)로 확정돼야 한다.
    const now = new Date('2026-03-08T06:00:00Z');
    const fire = computeNextAlarmFire('02:30', [], 'America/New_York', now)!;
    expect(fire.fireAt.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(fire.fireDayOfWeek).toBe(0);
  });

  it('ambiguous(두 번 나타나는 벽시계): 01:30 은 이른 쪽(01:30 EDT)으로 확정', () => {
    // NY 2026-11-01 02:00 EDT → 01:00 EST 폴백으로 01:00-01:59 는 두 번 나타난다.
    // 정책상 이른 쪽(01:30 EDT = UTC 05:30)을 선택한다(늦은 쪽 01:30 EST = 06:30 아님).
    const now = new Date('2026-11-01T04:00:00Z');
    const fire = computeNextAlarmFire('01:30', [], 'America/New_York', now)!;
    expect(fire.fireAt.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(fire.fireDayOfWeek).toBe(0);
  });
});
