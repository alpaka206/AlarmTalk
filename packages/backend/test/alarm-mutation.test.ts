import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmMutation from '../src/routes/alarm-mutation';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/alarms', alarmMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// ---------------------------------------------------------------------------
// POST /alarms — 알람 생성
// ---------------------------------------------------------------------------
describe('POST /alarms', () => {
  const validBody = { message_id: ID.message, time: '07:30' };

  it('message_id 누락 시 400', async () => {
    const res = await buildApp().request(jsonReq('POST', '/alarms', { time: '07:30' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('REQUIRED_FIELDS_MISSING');
  });

  it('time 누락 시 400', async () => {
    const res = await buildApp().request(jsonReq('POST', '/alarms', { message_id: ID.message }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('REQUIRED_FIELDS_MISSING');
  });

  it('유효하지 않은 mode 시 400 INVALID_MODE', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, mode: 'invalid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ALARM_MODE');
  });

  it('target_user_id 가 친구 아닌 경우 403 NOT_FRIENDS', async () => {
    // friendship query → no rows
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, target_user_id: 'other-user' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('NOT_FRIENDS');
  });

  it('자기 자신에게는 friendship 검증 건너뜀', async () => {
    // user plan query → free user
    mockDB.pushResult([{ plan: 'personal' }]);
    // message existence check → found
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT → success
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, target_user_id: 'user-1' }),
    );
    expect(res.status).toBe(201);
  });

  it('무료 플랜 2개 제한 — 3번째 알람 거부', async () => {
    // user plan → free
    mockDB.pushResult([{ plan: 'free' }]);
    // alarm count → 2
    mockDB.pushResult([{ count: 2 }]);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FREE_PLAN_LIMIT');
  });

  it('무료 플랜 2개 미만이면 생성 허용', async () => {
    // user plan → free
    mockDB.pushResult([{ plan: 'free' }]);
    // alarm count → 1
    mockDB.pushResult([{ count: 1 }]);
    // message check → found
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
  });

  it('유료 플랜은 알람 개수 제한 없음', async () => {
    // user plan → personal
    mockDB.pushResult([{ plan: 'personal' }]);
    // message check
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
  });

  it('message 존재하지 않으면 404', async () => {
    // user plan → personal (skip limit)
    mockDB.pushResult([{ plan: 'personal' }]);
    // message check → not found
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(404);
  });

  it('성공 시 201 + alarm 객체 반환', async () => {
    // user plan
    mockDB.pushResult([{ plan: 'personal' }]);
    // message check
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm).toBeDefined();
    expect(body.alarm.message_id).toBe(ID.message);
    expect(body.alarm.time).toBe('07:30');
    expect(body.alarm.mode).toBe('tts');
    expect(body.alarm.vibration_pattern).toBe('default');
  });

  it('기본값: mode=tts, vibration_pattern=default, wake_mode=sound_then_voice', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    const body = await res.json();
    expect(body.alarm.mode).toBe('tts');
    expect(body.alarm.vibration_pattern).toBe('default');
  });

  it('커스텀 mode/vibration/wake_mode 전달', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        ...validBody,
        mode: 'sound-only',
        vibration_pattern: 'strong',
        wake_mode: 'voice_only',
      }),
    );
    const body = await res.json();
    expect(body.alarm.mode).toBe('sound-only');
    expect(body.alarm.vibration_pattern).toBe('strong');
  });

  it('target_user_id 가 친구이면 생성 성공', async () => {
    // friendship check → found
    mockDB.pushResult([{ id: ID.friendship }]);
    // user plan for target
    mockDB.pushResult([{ plan: 'personal' }]);
    // message check
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, target_user_id: 'friend-1' }),
    );
    expect(res.status).toBe(201);
  });

  it('voice_profile_id, speaker_id null 기본값', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    const body = await res.json();
    expect(body.alarm.voice_profile_id).toBeNull();
    expect(body.alarm.speaker_id).toBeNull();
  });

  it('유효하지 않은 vibration_pattern → 400 INVALID_VIBRATION_PATTERN', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, vibration_pattern: 'ultra' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VIBRATION_PATTERN');
  });

  it('유효하지 않은 wake_mode → 400 INVALID_WAKE_MODE', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, wake_mode: 'shake' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_WAKE_MODE');
  });

  it('유효하지 않은 time 형식 → 400 INVALID_TIME_FORMAT', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '7:30' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TIME_FORMAT');
  });

  it('time 값 범위 초과 (25:00) → 400 INVALID_TIME_VALUE', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '25:00' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TIME_VALUE');
  });

  it('유효하지 않은 message_id 형식 → 400 INVALID_MESSAGE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { message_id: 'not-a-uuid', time: '07:30' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_MESSAGE_ID');
  });

  it('repeat_days 범위 밖 (7) → 400 INVALID_REPEAT_DAYS', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: [0, 7] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REPEAT_DAYS');
  });

  it('snooze_minutes 범위 밖 (0) → 400 INVALID_SNOOZE_MINUTES', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 0 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('snooze_minutes 범위 밖 (31) → 400 INVALID_SNOOZE_MINUTES', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 31 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('repeat_days INSERT SQL에 JSON.stringify 반영', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: [1, 3, 5] }),
    );
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.args).toContain('[1,3,5]');
  });

  it('voice_profile_id + speaker_id 지정 시 INSERT 반영 + 응답 포함', async () => {
    const vpId = '50000000-0000-4000-8000-000000000001';
    const spkId = '60000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, voice_profile_id: vpId, speaker_id: spkId }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.voice_profile_id).toBe(vpId);
    expect(body.alarm.speaker_id).toBe(spkId);

    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall!.args).toContain(vpId);
    expect(insertCall!.args).toContain(spkId);
  });

  it('user 미존재 시 plan 체크 건너뛰고 생성 허용', async () => {
    // user query → 0 rows (user not found)
    mockDB.pushResult([]);
    // message check
    mockDB.pushResult([{ id: ID.message }]);
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
  });

  it('family 플랜도 알람 개수 제한 없음', async () => {
    mockDB.pushResult([{ plan: 'family' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
  });

  it('snooze_minutes 커스텀 값 INSERT 반영', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 15 }),
    );
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall!.args).toContain(15);
  });

  it('target_user_id 비문자열 타입 → 400 INVALID_TARGET_USER', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, target_user_id: 123 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TARGET_USER');
  });

  it('voice_profile_id 잘못된 UUID 형식 → 400 INVALID_VOICE_PROFILE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, voice_profile_id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('speaker_id 잘못된 UUID 형식 → 400 INVALID_SPEAKER_ID', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, speaker_id: 'bad-speaker' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_SPEAKER_ID');
  });

  it('repeat_days 배열이 아닌 값 → 400 INVALID_REPEAT_DAYS', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: 'mon,wed' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REPEAT_DAYS');
  });

  it('무료 플랜 count 문자열 "2" → Number() 변환 후 거부', async () => {
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([{ count: '2' }]);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FREE_PLAN_LIMIT');
  });

  it('time "00:00" 경계값 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '00:00' }),
    );
    expect(res.status).toBe(201);
  });

  it('time "23:59" 경계값 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '23:59' }),
    );
    expect(res.status).toBe(201);
  });

  it('time "24:00" → 400 INVALID_TIME_VALUE', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '24:00' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TIME_VALUE');
  });

  it('snooze_minutes 경계값 1 (최소) 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 1 }),
    );
    expect(res.status).toBe(201);
  });

  it('snooze_minutes 경계값 30 (최대) 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 30 }),
    );
    expect(res.status).toBe(201);
  });

  it('repeat_days 소수점 값 → 400 INVALID_REPEAT_DAYS', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: [1, 2.5] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REPEAT_DAYS');
  });

  it('repeat_days 음수 → 400 INVALID_REPEAT_DAYS', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: [-1, 3] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REPEAT_DAYS');
  });
});

// ---------------------------------------------------------------------------
// PATCH /alarms/:id — 알람 수정
// ---------------------------------------------------------------------------
describe('PATCH /alarms/:id', () => {
  it('잘못된 UUID 형식 → 400 INVALID_ALARM_ID', async () => {
    const res = await buildApp().request(jsonReq('PATCH', '/alarms/not-uuid', { time: '08:00' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ALARM_ID');
  });

  it('유효하지 않은 mode → 400 INVALID_MODE', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { mode: 'bad' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ALARM_MODE');
  });

  it('존재하지 않는 알람 → 404', async () => {
    // existing check → not found
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '08:00' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('ALARM_NOT_FOUND');
  });

  it('빈 body → 400 NO_UPDATE_FIELDS', async () => {
    // existing check → found
    mockDB.pushResult([{ id: ID.alarm }]);
    const res = await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_UPDATE_FIELDS');
  });

  it('time 수정 성공', async () => {
    // existing check
    mockDB.pushResult([{ id: ID.alarm }]);
    // UPDATE
    mockDB.pushResult([], 1);
    // SELECT updated row
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '08:00',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '08:00' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alarm.time).toBe('08:00');
  });

  it('여러 필드 동시 수정', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '09:00',
      repeat_days: '[1,3,5]',
      is_active: 0,
      snooze_minutes: 10,
      mode: 'sound-only',
      vibration_pattern: 'strong',
      wake_mode: 'voice_only',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, {
        time: '09:00',
        repeat_days: [1, 3, 5],
        is_active: false,
        snooze_minutes: 10,
        mode: 'sound-only',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarm.is_active).toBe(false);
    expect(body.alarm.repeat_days).toEqual([1, 3, 5]);
  });

  it('is_active 토글 시 UPDATE SQL에 0/1 반영', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '07:30',
      repeat_days: '[]',
      is_active: 0,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: false }),
    );

    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.args).toContain(0);
  });

  it('유효하지 않은 vibration_pattern → 400', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { vibration_pattern: 'mega' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VIBRATION_PATTERN');
  });

  it('유효하지 않은 wake_mode → 400', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { wake_mode: 'shake_phone' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_WAKE_MODE');
  });

  it('snooze_minutes 범위 밖 → 400', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { snooze_minutes: 0 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_SNOOZE_MINUTES');
  });

  it('repeat_days 수정 시 JSON.stringify SQL 반영', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '07:30',
      repeat_days: '[0,6]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { repeat_days: [0, 6] }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.args).toContain('[0,6]');
    expect((await res.json()).alarm.repeat_days).toEqual([0, 6]);
  });

  it('speaker_id 수정 반영', async () => {
    const spkId = '60000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '07:30',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: spkId,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { speaker_id: spkId }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.args).toContain(spkId);
  });

  it('voice_profile_id 잘못된 UUID → 400 INVALID_VOICE_PROFILE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { voice_profile_id: 'bad-uuid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('speaker_id 잘못된 UUID → 400 INVALID_SPEAKER_ID', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { speaker_id: 'bad-speaker' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_SPEAKER_ID');
  });

  it('is_active 비불리언 → 400 INVALID_IS_ACTIVE', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: 'yes' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_IS_ACTIVE');
  });

  it('time 잘못된 형식 → 400 INVALID_TIME_FORMAT', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '8:30' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TIME_FORMAT');
  });

  it('message_id 잘못된 UUID → 400 INVALID_MESSAGE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { message_id: 'not-uuid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_MESSAGE_ID');
  });

  it('UPDATE SQL에 항상 updated_at = datetime(now) 포함', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '08:00',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '08:00' }),
    );
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.sql).toContain("updated_at = datetime('now')");
  });

  it('mode 수정 시 UPDATE SQL에 mode 반영', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '07:30',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'sound-only',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { mode: 'sound-only' }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.sql).toContain('mode = ?');
    expect(updateCall!.args).toContain('sound-only');
  });

  it('voice_profile_id null 로 해제', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      message_id: ID.message,
      time: '07:30',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'tts',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      speaker_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { voice_profile_id: null }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).alarm.voice_profile_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE /alarms/:id — 알람 삭제
// ---------------------------------------------------------------------------
describe('DELETE /alarms/:id', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await buildApp().request(jsonReq('DELETE', '/alarms/bad-id', undefined));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ALARM_ID');
  });

  it('존재하지 않는 알람 → 404', async () => {
    mockDB.pushResult([], 0);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('ALARM_NOT_FOUND');
  });

  it('성공 삭제 → 200 success', async () => {
    mockDB.pushResult([], 1);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('DELETE SQL에 userId 바인딩 (다른 사용자 알람 삭제 방지)', async () => {
    mockDB.pushResult([], 1);
    await buildApp('user-A').request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    const deleteCall = mockDB.calls[0];
    expect(deleteCall!.sql).toContain('user_id');
    expect(deleteCall!.args).toContain('user-A');
  });
});
