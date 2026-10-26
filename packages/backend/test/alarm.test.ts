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

function pushMessageBelongsToCaller() {
  mockDB.pushResult([{ '1': 1 }]);
}

beforeEach(() => {
  mockDB.reset();
});

describe('GET /alarm/:id — 단일 조회 정규화', () => {
  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/alarm/${ID.alarm404}`));
    expect(res.status).toBe(404);
  });
});

describe('POST /alarm — 알람 생성', () => {
  it('message_id 누락이면 alarm-only 알람으로 생성', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { time: '07:00' }));
    expect(res.status).toBe(201);
  });

  it('time 누락이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/alarm', { message_id: ID.message }));
    expect(res.status).toBe(400);
  });

  it('잘못된 time 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '7pm' }),
    );
    expect(res.status).toBe(400);
  });

  it('시간 범위 초과 (25:00) 면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '25:00' }),
    );
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

  // 남에게 보내는 알람은 없다(가족 알람은 2026-10-20 에 없앴다). 남을 가리키면 그룹 밖 발신자가 받던 답으로 끊는다.
  it('target_user_id 가 남이면 403 NOT_CONNECTED — 그 계정을 조회하지 않는다', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        target_user_id: 'user-2',
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('NOT_CONNECTED');
    expect(mockDB.calls).toHaveLength(0);
  });

  it('무료 플랜도 알람 개수 제한 없이 201', async () => {
    mockDB.pushResult([{ plan: 'free' }]); // user plan
    // userIdPK 가 채워지며 무료 플랜 게이트가 실제로 실행된다 — free + message_id 조합이라
    // usesOnlySystemStockVoice(시스템 스톡 보이스 여부) 조회가 새로 돌아간다.
    // 스톡 클립이면 무료도 허용이므로 행을 하나 돌려준다.
    mockDB.pushResult([{ '1': 1 }]); // usesOnlySystemStockVoice → 시스템 스톡 메시지
    mockDB.pushResult([{ id: ID.message }]); // message exists (트랜잭션 밖 messageBelongsToCaller)
    pushMessageBelongsToCaller(); // 트랜잭션 내 재검증
    mockDB.pushResult([], 1); // insert alarm
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00' }),
    );
    expect(res.status).toBe(201);
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
    pushMessageBelongsToCaller();
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

  it('target_user_id 가 나면 무시하고 내 알람으로 만든다 — 저장·응답에 싣지 않는다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]); // user plan
    mockDB.pushResult([{ id: ID.message }]); // message exists
    pushMessageBelongsToCaller(); // 트랜잭션 내 재검증
    mockDB.pushResult([], 1); // insert
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '08:00',
        target_user_id: 'user-1',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm).not.toHaveProperty('target_user_id');
    const insert = mockDB.calls.find((call) => call.sql.includes('INSERT INTO alarms'))!;
    expect(insert.sql).not.toMatch(/target_user_id|delivery_version/);
    expect(insert.args[1]).toBe('user-1');
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

it('mode + voice_profile_id 포함해 정상 생성', async () => {
    const voiceProfileId = '40000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: voiceProfileId }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([{ id: voiceProfileId }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        mode: 'sound-only',
        voice_profile_id: voiceProfileId,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.mode).toBe('sound-only');

    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO alarms'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('mode');
    expect(insert!.sql).toContain('voice_profile_id');
    expect(insert!.args).toContain('sound-only');
    expect(insert!.args).toContain(voiceProfileId);
  });

  it('mode 미지정 시 기본값은 tts', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
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

  it('POST 응답에 voice_profile_id 가 null 로 명시된다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/alarm', { message_id: ID.message, time: '07:00' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm).toHaveProperty('voice_profile_id', null);
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
    mockDB.pushResult([
      { id: ID.alarm, time: '09:30', is_active: 0, snooze_minutes: 5, repeat_days: '[]' },
    ]); // select updated
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', `/alarm/${ID.alarm}`, { time: '09:30', is_active: false }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('mode/voice_profile_id 변경 반영', async () => {
    const voiceProfileId = '40000000-0000-4000-8000-0000000000aa';
    mockDB.pushResult([{ id: ID.alarm }]); // existing
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller → 소유 확인
    mockDB.pushResult([{ '1': 1 }]);
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
      },
    ]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', `/alarm/${ID.alarm}`, {
        mode: 'sound-only',
        voice_profile_id: voiceProfileId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alarm.mode).toBe('sound-only');
    expect(body.alarm.voice_profile_id).toBe(voiceProfileId);

    const update = mockDB.calls.find((c) => c.sql.startsWith('UPDATE alarms SET'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('mode = ?');
    expect(update!.sql).toContain('voice_profile_id = ?');
    expect(update!.args).toContain('sound-only');
    expect(update!.args).toContain(voiceProfileId);
  });
});

describe('DELETE /alarm/:id — 알람 삭제', () => {
  it('존재하지 않으면 404 + ALARM_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/alarm/${ID.alarm404}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('ALARM_NOT_FOUND');
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([{ message_id: null }]);
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
      jsonReq('POST', '/alarm', {
        message_id: ID.message,
        time: '07:00',
        vibration_pattern: 'extreme',
      }),
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

  it('DELETE — 잘못된 ID 형식 시 INVALID_ALARM_ID', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/alarm/not-a-uuid'));
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_ALARM_ID');
  });
});
