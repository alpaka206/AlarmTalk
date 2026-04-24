import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/scheduler', () => ({
  selectFiringAlarms: (alarms: unknown[]) => alarms.slice(0, 1),
}));

import alarmQuery from '../src/routes/alarm-query';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/alarms', alarmQuery);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

const sampleAlarmRow = {
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
  message_text: 'Good morning',
  category: 'morning',
  voice_name: 'Default',
  creator_email: 'user@test.com',
  creator_name: 'Test User',
};

// ---------------------------------------------------------------------------
// GET /alarms/tick — 다음 발화 알람 조회
// ---------------------------------------------------------------------------
describe('GET /alarms/tick', () => {
  it('활성 알람이 없으면 빈 firing 배열', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(new Request('http://localhost/alarms/tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.now).toBeDefined();
    expect(body.checked).toBe(0);
    expect(body.firing).toEqual([]);
  });

  it('활성 알람이 있으면 firing 에 포함', async () => {
    mockDB.pushResult([{
      id: ID.alarm,
      user_id: 'user-1',
      target_user_id: null,
      time: '07:30',
      repeat_days: '[]',
      is_active: 1,
      mode: 'tts',
      voice_profile_id: null,
      speaker_id: null,
    }]);

    const res = await buildApp().request(new Request('http://localhost/alarms/tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBe(1);
    expect(body.firing.length).toBe(1);
    expect(body.firing[0].id).toBe(ID.alarm);
  });

  it('SQL에 user_id와 target_user_id 모두 필터', async () => {
    mockDB.pushResult([]);
    await buildApp('me').request(new Request('http://localhost/alarms/tick'));
    const call = mockDB.calls[0];
    expect(call!.args).toContain('me');
    expect(call!.args.filter((a) => a === 'me').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GET /alarms — 알람 목록 조회
// ---------------------------------------------------------------------------
describe('GET /alarms', () => {
  it('빈 목록 반환', async () => {
    // count
    mockDB.pushResult([{ total: 0 }]);
    // list
    mockDB.pushResult([]);

    const res = await buildApp().request(new Request('http://localhost/alarms'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('limit/offset 파라미터 반영', async () => {
    mockDB.pushResult([{ total: 5 }]);
    mockDB.pushResult([sampleAlarmRow]);

    const res = await buildApp().request(
      new Request('http://localhost/alarms?limit=10&offset=2'),
    );
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(2);
  });

  it('limit 최대값 100 제한', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);

    const res = await buildApp().request(
      new Request('http://localhost/alarms?limit=999'),
    );
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('is_active 필터', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([sampleAlarmRow]);

    await buildApp().request(new Request('http://localhost/alarms?is_active=true'));
    const listCall = mockDB.calls[1];
    expect(listCall!.sql).toContain('is_active');
    expect(listCall!.args).toContain(1);
  });

  it('voice_profile_id 필터', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);

    await buildApp().request(
      new Request('http://localhost/alarms?voice_profile_id=vp-1'),
    );
    const listCall = mockDB.calls[1];
    expect(listCall!.sql).toContain('voice_profile_id');
    expect(listCall!.args).toContain('vp-1');
  });

  it('알람 목록 정상 반환 + normalizeAlarmRow 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([sampleAlarmRow]);

    const res = await buildApp().request(new Request('http://localhost/alarms'));
    const body = await res.json();
    expect(body.alarms.length).toBe(1);
    expect(body.alarms[0].is_active).toBe(true);
    expect(body.alarms[0].repeat_days).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /alarms/:id — 단건 조회
// ---------------------------------------------------------------------------
describe('GET /alarms/:id', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await buildApp().request(new Request('http://localhost/alarms/bad-id'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ALARM_ID');
  });

  it('존재하지 않는 알람 → 404', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('ALARM_NOT_FOUND');
  });

  it('정상 조회 → alarm 객체 반환', async () => {
    mockDB.pushResult([sampleAlarmRow]);

    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarm).toBeDefined();
    expect(body.alarm.id).toBe(ID.alarm);
    expect(body.alarm.time).toBe('07:30');
  });

  it('SQL에 user_id + target_user_id 모두 체크 (타인 알람 접근 방지)', async () => {
    mockDB.pushResult([sampleAlarmRow]);
    await buildApp('me').request(new Request(`http://localhost/alarms/${ID.alarm}`));

    const call = mockDB.calls[0];
    expect(call!.sql).toContain('user_id');
    expect(call!.sql).toContain('target_user_id');
    expect(call!.args).toContain('me');
  });
});
