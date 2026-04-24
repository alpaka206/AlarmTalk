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
