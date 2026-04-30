import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmRoutes from '../src/routes/alarm';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/alarm', alarmRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('GET /alarm — 알람 목록', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]); // count
    mockDB.pushResult([]); // data
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms).toEqual([]);
  });

  it('알람 목록 반환', async () => {
    mockDB.pushResult([{ total: 1 }]); // count
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '07:00',
        is_active: 1,
        message_text: '좋은 아침!',
        category: 'morning',
        voice_name: 'Mom',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarms).toHaveLength(1);
    expect(body.alarms[0].time).toBe('07:00');
  });

  it('목록 응답이 정규화된다 — repeat_days 배열, is_active boolean, mode 기본값', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '07:00',
        is_active: 1,
        repeat_days: '[1,3,5]',
        mode: null,
        voice_profile_id: null,
        speaker_id: null,
        message_text: 'hi',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm'));
    const body = await res.json();
    expect(body.alarms[0].repeat_days).toEqual([1, 3, 5]);
    expect(body.alarms[0].is_active).toBe(true);
    expect(body.alarms[0].mode).toBe('tts');
    expect(body.alarms[0].voice_profile_id).toBeNull();
    expect(body.alarms[0].speaker_id).toBeNull();
  });

  it('목록: mode=sound-only + voice_profile_id/speaker_id 를 그대로 노출', async () => {
    const vp = '40000000-0000-4000-8000-000000000001';
    const sp = '50000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '08:00',
        is_active: 0,
        repeat_days: '[]',
        mode: 'sound-only',
        voice_profile_id: vp,
        speaker_id: sp,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm'));
    const body = await res.json();
    expect(body.alarms[0].mode).toBe('sound-only');
    expect(body.alarms[0].is_active).toBe(false);
    expect(body.alarms[0].voice_profile_id).toBe(vp);
    expect(body.alarms[0].speaker_id).toBe(sp);
  });

  it('목록: repeat_days 가 잘못된 JSON 이어도 빈 배열로 fallback', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '07:00',
        is_active: 1,
        repeat_days: 'not-json',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm'));
    const body = await res.json();
    expect(body.alarms[0].repeat_days).toEqual([]);
  });
});

describe('GET /alarm/:id — 단일 조회 정규화', () => {
  it('단일 조회 응답이 정규화된다', async () => {
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '09:00',
        is_active: 1,
        repeat_days: '[0,6]',
        mode: 'tts',
        voice_profile_id: null,
        speaker_id: null,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/alarm/${ID.alarm}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarm.repeat_days).toEqual([0, 6]);
    expect(body.alarm.is_active).toBe(true);
    expect(body.alarm.mode).toBe('tts');
    expect(body.alarm.voice_profile_id).toBeNull();
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/alarm/${ID.alarm404}`));
    expect(res.status).toBe(404);
  });
});

describe('POST /alarm — 알람 생성', () => {
  it('message_id 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { time: '07:00' }));
    expect(res.status).toBe(400);
  });

  it('time 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { message_id: ID.message }));
    expect(res.status).toBe(400);
  });

  it('잘못된 time 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { message_id: ID.message, time: '7pm' }));
    expect(res.status).toBe(400);
  });

  it('시간 범위 초과 (25:00) 면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { message_id: ID.message, time: '25:00' }));
    expect(res.status).toBe(400);
  });

  it('잘못된 repeat_days 면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', repeat_days: [7] }),
    );
    expect(res.status).toBe(400);
  });

  it('snooze_minutes 범위 초과면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', snooze_minutes: 60 }),
    );
    expect(res.status).toBe(400);
  });

  it('target_user_id 에 친구가 아닌 사용자면 403', async () => {
    mockDB.pushResult([]); // friendship check
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', target_user_id: 'user-2' }),
    );
    expect(res.status).toBe(403);
  });

  it('���료 플랜 알람 2개 초과면 403', async () => {
    mockDB.pushResult([{ plan: 'free' }]); // user plan
    mockDB.pushResult([{ count: 2 }]); // alarm count
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('무료 플랜');
    expect(body.error_code).toBe('FREE_PLAN_LIMIT');
  });

  it('메시지가 존재하지 않으면 404', async () => {
    mockDB.pushResult([{ plan: 'plus' }]); // user plan (not free, skip count)
    mockDB.pushResult([]); // message lookup
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.messageBad, time: '07:00' }),
    );
    expect(res.status).toBe(404);
  });

  it('정상 생성이면 201', async () => {
    mockDB.pushResult([{ plan: 'plus' }]); // user plan
    mockDB.pushResult([{ id: ID.message }]); // message exists
    mockDB.pushResult([], 1); // insert alarm
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', repeat_days: [1, 3, 5] }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.time).toBe('07:00');
    expect(body.alarm.repeat_days).toEqual([1, 3, 5]);
  });

  it('target_user_id 있고 친구이면 201', async () => {
    mockDB.pushResult([{ id: ID.friendship }]); // friendship exists
    mockDB.pushResult([{ plan: 'plus' }]); // target user plan
    mockDB.pushResult([{ id: ID.message }]); // message exists
    mockDB.pushResult([], 1); // insert
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '08:00', target_user_id: 'user-2' }),
    );
    expect(res.status).toBe(201);
  });

  it('mode 가 허용 목록 밖이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', mode: 'video' }),
    );
    expect(res.status).toBe(400);
  });

  it('voice_profile_id UUID 형식이 아니면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        voice_profile_id: 'not-a-uuid',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('speaker_id UUID 형식이 아니면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        speaker_id: 'bad',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('mode + voice_profile_id + speaker_id 포함해 정상 생성', async () => {
    const voiceProfileId = '40000000-0000-4000-8000-000000000001';
    const speakerId = '50000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        mode: 'sound-only',
        voice_profile_id: voiceProfileId,
        speaker_id: speakerId,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.mode).toBe('sound-only');

    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO alarms'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('mode');
    expect(insert!.sql).toContain('voice_profile_id');
    expect(insert!.sql).toContain('speaker_id');
    expect(insert!.args).toContain('sound-only');
    expect(insert!.args).toContain(voiceProfileId);
    expect(insert!.args).toContain(speakerId);
  });

  it('mode 미지정 시 기본값은 tts', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.mode).toBe('tts');
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO alarms'));
    expect(insert!.args).toContain('tts');
  });

  it('POST 응답에 voice_profile_id/speaker_id 가 null 로 명시된다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm).toHaveProperty('voice_profile_id', null);
    expect(body.alarm).toHaveProperty('speaker_id', null);
  });
});

describe('PATCH /alarm/:id — 알람 수정', () => {
  it('소유하지 않은 알람이면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/alarm/${ID.alarm404}`, { time: '08:00' }));
    expect(res.status).toBe(404);
  });

  it('업데이트 필드가 없으면 400', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/alarm/${ID.alarm}`, {}));
    expect(res.status).toBe(400);
  });

  it('잘못된 time 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/alarm/${ID.alarm}`, { time: 'bad' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_TIME_FORMAT');
  });

  it('정상 수정', async () => {
    mockDB.pushResult([{ id: ID.alarm }]); // existing
    mockDB.pushResult([], 1); // update
    mockDB.pushResult([{ id: ID.alarm, time: '09:30', is_active: 0, snooze_minutes: 5, repeat_days: '[]' }]); // select updated
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', `/alarm/${ID.alarm}`, { time: '09:30', is_active: false }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('mode/voice_profile_id/speaker_id 변경 반영', async () => {
    const voiceProfileId = '40000000-0000-4000-8000-0000000000aa';
    const speakerId = '50000000-0000-4000-8000-0000000000bb';
    mockDB.pushResult([{ id: ID.alarm }]); // existing
    mockDB.pushResult([], 1); // update
    mockDB.pushResult([
      {
        id: ID.alarm,
        time: '07:00',
        is_active: 1,
        snooze_minutes: 5,
        repeat_days: '[]',
        mode: 'sound-only',
        voice_profile_id: voiceProfileId,
        speaker_id: speakerId,
      },
    ]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', `/alarm/${ID.alarm}`, {
        mode: 'sound-only',
        voice_profile_id: voiceProfileId,
        speaker_id: speakerId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarm.mode).toBe('sound-only');
    expect(body.alarm.voice_profile_id).toBe(voiceProfileId);
    expect(body.alarm.speaker_id).toBe(speakerId);

    const update = mockDB.calls.find((c) => c.sql.startsWith('UPDATE alarms SET'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('mode = ?');
    expect(update!.sql).toContain('voice_profile_id = ?');
    expect(update!.sql).toContain('speaker_id = ?');
    expect(update!.args).toContain('sound-only');
    expect(update!.args).toContain(voiceProfileId);
    expect(update!.args).toContain(speakerId);
  });
});

describe('GET /alarm/tick — 발화 대상 조회', () => {
  it('활성 알람 중 현재 시각과 일치하는 것만 반환', async () => {
    // 현재 UTC 분 기준 HH:mm
    const now = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const hhmm = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        target_user_id: null,
        time: hhmm,
        repeat_days: '[]',
        is_active: 1,
        mode: 'tts',
        voice_profile_id: null,
        speaker_id: null,
      },
      {
        id: '00000000-0000-4000-8000-0000000000aa',
        user_id: 'user-1',
        target_user_id: null,
        time: '23:58', // 거의 확실히 일치 안 함 (현재 시각과 다를 확률 매우 높음)
        repeat_days: '[]',
        is_active: 1,
        mode: 'tts',
        voice_profile_id: null,
        speaker_id: null,
      },
    ]);

    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm/tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBe(2);
    // 첫 번째는 현재 시각 매칭 → 발화
    expect(body.firing.length).toBeGreaterThanOrEqual(1);
    expect(body.firing[0].id).toBe(ID.alarm);
  });

  it('알람이 하나도 없으면 firing=[]', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm/tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBe(0);
    expect(body.firing).toEqual([]);
  });
});

describe('DELETE /alarm/:id — 알람 삭제', () => {
  it('존재하지 않으면 404 + ALARM_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/alarm/${ID.alarm404}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('ALARM_NOT_FOUND');
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/alarm/${ID.alarm}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('error_code 일관성 검증', () => {
  it('POST — time 누락 시 REQUIRED_FIELDS_MISSING', async () => {
    // Source-less alarms are now valid ("alarm-only" play mode plays the
    // device default sound), so the only true required field at create time
    // is `time`.
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', {}));
    const body = await res.json();
    expect(body.error_code).toBe('REQUIRED_FIELDS_MISSING');
  });

  it('POST — 잘못된 mode 시 INVALID_ALARM_MODE', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', mode: 'video' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_ALARM_MODE');
  });

  it('POST — 잘못된 vibration_pattern 시 INVALID_VIBRATION_PATTERN', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', vibration_pattern: 'extreme' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VIBRATION_PATTERN');
  });

  it('POST — 잘못된 wake_mode 시 INVALID_WAKE_MODE', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00', wake_mode: 'alarm_only' }),
    );
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_WAKE_MODE');
  });

  it('PATCH — 소유하지 않은 알람 시 ALARM_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/alarm/${ID.alarm404}`, { time: '08:00' }));
    const body = await res.json();
    expect(body.error_code).toBe('ALARM_NOT_FOUND');
  });

  it('PATCH — 업데이트 필드 없으면 NO_UPDATE_FIELDS', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/alarm/${ID.alarm}`, {}));
    const body = await res.json();
    expect(body.error_code).toBe('NO_UPDATE_FIELDS');
  });

  it('GET /:id — 잘못된 ID 형식 시 INVALID_ALARM_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/alarm/not-a-uuid'));
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_ALARM_ID');
  });

  it('DELETE — 잘못된 ID 형식 시 INVALID_ALARM_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/alarm/not-a-uuid'));
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_ALARM_ID');
  });
});
