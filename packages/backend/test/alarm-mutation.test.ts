import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmMutation from '../src/routes/alarm-mutation';

function buildApp(userId = 'user-1', loginId = userId) {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId, 'user@test.com', loginId));
  app.route('/alarms', alarmMutation);
  return app;
}

function pushMessageBelongsToCaller() {
  mockDB.pushResult([{ '1': 1 }]);
}

beforeEach(() => {
  mockDB.reset();
});

// ---------------------------------------------------------------------------
// POST /alarms — 알람 생성
// ---------------------------------------------------------------------------
describe('POST /alarms', () => {
  const validBody = { message_id: ID.message, time: '07:30' };

  it('message_id 누락 시 alarm-only 모드로 201 (message_id NULL)', async () => {
    // The "alarm-only" play mode plays just the device's default alarm sound
    // and stores neither a TTS message nor a raw-audio source. Schema migration
    // 22 made alarms.message_id nullable so the row stores NULL.
    const res = await buildApp().request(jsonReq('POST', '/alarms', { time: '07:30' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { alarm: { message_id?: string | null } };
    expect(body.alarm.message_id ?? null).toBe(null);
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

  // 남에게 보내는 알람은 없다(가족 알람은 2026-10-20 에 없앴다). 남을 가리키는 `target_user_id` 는 그룹 밖 발신자가
  // 받던 답(403 `NOT_CONNECTED`)으로 끊는다 — 조용히 내 알람으로 저장하지 않는다. 그 계정이 있는지는 보지 않는다.
  it.each(['other-user', '  other-user  ', 'no-such-account'])(
    'target_user_id 가 남(%j)이면 403 NOT_CONNECTED — DB 를 보지 않는다',
    async (target) => {
      const res = await buildApp().request(
        jsonReq('POST', '/alarms', { ...validBody, target_user_id: target }),
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error_code).toBe('NOT_CONNECTED');
      expect(mockDB.calls).toHaveLength(0);
    },
  );

  // 비었거나 나를 가리키거나(PK·로그인 id 어느 쪽이든) 문자열이 아니면 무시한다 — 옛 검증(400 INVALID_TARGET_USER)은 없다.
  it.each([
    ['PK', 'pk-1'],
    ['로그인 id', 'google-1'],
    ['빈 문자열', ''],
    ['공백', '   '],
    ['숫자', 123],
    ['null', null],
  ])('target_user_id 가 %s 이면 무시하고 내 알람으로 201 — 저장·응답에 싣지 않는다', async (_label, target) => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp('pk-1', 'google-1').request(
      jsonReq('POST', '/alarms', { ...validBody, target_user_id: target }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).alarm).not.toHaveProperty('target_user_id');
    const insert = mockDB.calls.find((call) => call.sql.includes('INSERT INTO alarms'))!;
    expect(insert.sql).not.toMatch(/target_user_id|delivery_version/);
    expect(insert.args[1]).toBe('pk-1');
  });

  it('무료 플랜도 알람 개수 제한 없이 생성 허용', async () => {
    // user plan → free
    mockDB.pushResult([{ plan: 'free' }]);
    // userIdPK 가 채워지며 무료 플랜 판정이 실제로 걸린다(예전엔 resolvedUserPk 가 비어
    // creatorHasPaidVoice 가 무조건 true 였다). 무료 + message_id 조합은
    // usesOnlySystemStockVoice 조회를 타므로 '시스템 스톡 보이스 메시지' 행을 넣어 준다.
    mockDB.pushResult([{ '1': 1 }]);
    // message check → found
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
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
    pushMessageBelongsToCaller();
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
    pushMessageBelongsToCaller();
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
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    const body = await res.json();
    expect(body.alarm.mode).toBe('tts');
    expect(body.alarm.vibration_pattern).toBe('default');
  });

  it('커스텀 mode/vibration/wake_mode 전달', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
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

  it('voice_profile_id null 기본값', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    const body = await res.json();
    expect(body.alarm.voice_profile_id).toBeNull();
  });

  it('안드로이드 진동 패턴(heartbeat)도 받는다 — 셋만 받던 때는 400 이었다(ALARMTALK-ANDROID-14)', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { time: '07:30', vibration_pattern: 'heartbeat' }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).alarm.vibration_pattern).toBe('heartbeat');
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
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    await buildApp().request(jsonReq('POST', '/alarms', { ...validBody, repeat_days: [1, 3, 5] }));
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.args).toContain('[1,3,5]');
  });

  it('voice_profile_id 지정 시 INSERT 반영 + 응답 포함', async () => {
    const vpId = '50000000-0000-4000-8000-000000000001';
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    mockDB.pushResult([{ id: vpId }]);
    mockDB.pushResult([{ id: vpId }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, voice_profile_id: vpId }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.voice_profile_id).toBe(vpId);

    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall!.args).toContain(vpId);
  });

  it('IDOR: foreign or draft voice_profile_id is rejected on create', async () => {
    const foreignVoiceProfileId = '50000000-0000-4000-8000-0000000000aa';
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        ...validBody,
        voice_profile_id: foreignVoiceProfileId,
      }),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO alarms'))).toBe(false);
  });

  it('user 미존재 시 plan 체크 건너뛰고 생성 허용', async () => {
    // user query → 0 rows (user not found)
    mockDB.pushResult([]);
    // message check
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    // INSERT
    mockDB.pushResult([], 1);

    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(201);
  });

  it('옛 그룹 등급(family)은 유료가 아니다 — 클론 목소리 알람은 403', async () => {
    mockDB.pushResult([{ plan: 'family' }]);
    mockDB.pushResult([]); // usesOnlySystemStockVoice → 시스템 스톡 문구가 아니다
    const res = await buildApp().request(jsonReq('POST', '/alarms', validBody));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('snooze_minutes 커스텀 값 INSERT 반영', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    await buildApp().request(jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 15 }));
    const insertCall = mockDB.calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall!.args).toContain(15);
  });

  it('voice_profile_id 잘못된 UUID 형식 → 400 INVALID_VOICE_PROFILE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, voice_profile_id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

it('repeat_days 배열이 아닌 값 → 400 INVALID_REPEAT_DAYS', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, repeat_days: 'mon,wed' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REPEAT_DAYS');
  });

  it('time "00:00" 경계값 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, time: '00:00' }),
    );
    expect(res.status).toBe(201);
  });

  it('time "23:59" 경계값 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
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
    pushMessageBelongsToCaller();
    mockDB.pushResult([], 1);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { ...validBody, snooze_minutes: 1 }),
    );
    expect(res.status).toBe(201);
  });

  it('snooze_minutes 경계값 30 (최대) 허용', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([{ id: ID.message }]);
    pushMessageBelongsToCaller();
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
// greeting 버킷 정책 — 유료 클론(비-시스템) 보이스 전용, 시스템 보이스 우회 차단
// ---------------------------------------------------------------------------
describe('greeting 버킷 정책 (POST/PATCH)', () => {
  const vpId = '50000000-0000-4000-8000-000000000010';

  it('POST: 시스템 보이스 + greeting → 400 INVALID_BUCKET_ID (무료 우회 차단)', async () => {
    mockDB.pushResult([{ plan: 'personal' }]); // user plan
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller(시스템 보이스도 접근은 허용)
    mockDB.pushResult([]); // greeting 게이트: non-system 클론 아님(시스템 보이스)

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { time: '07:30', voice_profile_id: vpId, bucket_id: 'greeting' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO alarms'))).toBe(false);
  });

  it('POST: 클론(비-시스템) 보이스 + greeting → 201', async () => {
    mockDB.pushResult([{ plan: 'personal' }]); // user plan
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller(사전 검증)
    mockDB.pushResult([{ '1': 1 }]); // greeting 게이트: non-system 클론 확인
    mockDB.pushResult([{ '1': 1 }]); // 트랜잭션 내 voice_profile 재검증
    mockDB.pushResult([], 1); // INSERT alarms

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { time: '07:30', voice_profile_id: vpId, bucket_id: 'greeting' }),
    );
    expect(res.status).toBe(201);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO alarms'));
    expect(insert).toBeDefined();
    expect(insert!.args).toContain('greeting');
  });

  it('POST: 시스템 스톡 클립 message + greeting → 400 (message 의 voice_profile 로 판정)', async () => {
    mockDB.pushResult([{ plan: 'personal' }]); // user plan
    mockDB.pushResult([{ '1': 1 }]); // messageBelongsToCaller(프리셋 접근은 허용)
    mockDB.pushResult([]); // greeting 게이트: 시스템 보이스 메시지 → 클론 아님

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { time: '07:30', message_id: ID.message, bucket_id: 'greeting' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO alarms'))).toBe(false);
  });

  it('POST: 보이스 지정이 전혀 없는 greeting 버킷 → 400', async () => {
    mockDB.pushResult([{ plan: 'personal' }]); // user plan (게이트는 추가 조회 없이 거부)

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', { time: '07:30', bucket_id: 'greeting' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO alarms'))).toBe(false);
  });

  it('POST: 클론 voice_profile + 시스템 스톡 greeting message 혼합 → 400 (방어심화 G)', async () => {
    // vp 분기가 통과해도 message_id 가 함께 있으면 그 message 의 voice_profile 이 시스템이면
    // 혼합(무료 미리듣기 클립 우회)으로 거부해야 한다.
    mockDB.pushResult([{ plan: 'personal' }]); // user plan
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller(클론 vp 접근 허용)
    mockDB.pushResult([{ '1': 1 }]); // messageBelongsToCaller(프리셋 접근 허용)
    mockDB.pushResult([{ '1': 1 }]); // greeting 게이트: vp 는 클론
    mockDB.pushResult([]); // greeting 게이트: message 의 voice_profile 은 시스템 → 혼합 거부

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        voice_profile_id: vpId,
        message_id: ID.message,
        bucket_id: 'greeting',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO alarms'))).toBe(false);
  });

  function pushExistingAlarmRow(overrides: Record<string, unknown> = {}) {
    mockDB.pushResult([
      {
        id: ID.alarm,
        message_id: null,
        mode: 'tts',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        bucket_id: null,
        user_plan: 'personal',
        ...overrides,
      },
    ]);
  }

  it('PATCH: bucket_id=greeting + 시스템 voice_profile → 400 INVALID_BUCKET_ID', async () => {
    pushExistingAlarmRow();
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller
    mockDB.pushResult([]); // greeting 게이트: 시스템 보이스

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { bucket_id: 'greeting', voice_profile_id: vpId }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(false);
  });

  it('PATCH: bucket_id=greeting + 클론 voice_profile → 200', async () => {
    pushExistingAlarmRow();
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller
    mockDB.pushResult([{ '1': 1 }]); // greeting 게이트: 클론 확인
    mockDB.pushResult([{ '1': 1 }]); // 트랜잭션 내 voice_profile 재검증
    mockDB.pushResult([], 1); // UPDATE alarms
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: null,
        time: '07:30',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: vpId,
        bucket_id: 'greeting',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { bucket_id: 'greeting', voice_profile_id: vpId }),
    );
    expect(res.status).toBe(200);
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(true);
  });

  it('PATCH: 기존 greeting 알람의 voice_profile 을 시스템 보이스로 교체 시도 → 400', async () => {
    // bucket_id 를 안 건드려도 결과 조합(effective)이 시스템+greeting 이면 거부한다.
    pushExistingAlarmRow({ bucket_id: 'greeting', voice_profile_id: vpId });
    mockDB.pushResult([{ '1': 1 }]); // voiceProfileBelongsToCaller(새 시스템 보이스 접근 허용)
    mockDB.pushResult([]); // greeting 게이트: 시스템 보이스 → 클론 아님

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, {
        voice_profile_id: '50000000-0000-4000-8000-0000000000bb',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_BUCKET_ID');
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(false);
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
    const res = await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, { mode: 'bad' }));
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
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '08:00',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

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
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '09:00',
        repeat_days: '[1,3,5]',
        is_active: 0,
        snooze_minutes: 10,
        mode: 'sound-only',
        vibration_pattern: 'strong',
        wake_mode: 'voice_only',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

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
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '07:30',
        repeat_days: '[]',
        is_active: 0,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: false }));

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
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '07:30',
        repeat_days: '[0,6]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { repeat_days: [0, 6] }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.args).toContain('[0,6]');
    expect((await res.json()).alarm.repeat_days).toEqual([0, 6]);
  });

it('voice_profile_id 잘못된 UUID → 400 INVALID_VOICE_PROFILE_ID', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { voice_profile_id: 'bad-uuid' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

it('is_active 비불리언 → 400 INVALID_IS_ACTIVE', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: 'yes' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_IS_ACTIVE');
  });

  it('time 잘못된 형식 → 400 INVALID_TIME_FORMAT', async () => {
    const res = await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '8:30' }));
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
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '08:00',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, { time: '08:00' }));
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.sql).toContain("updated_at = datetime('now')");
  });

  it('mode 수정 시 UPDATE SQL에 mode 반영', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '07:30',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'sound-only',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { mode: 'sound-only' }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall!.sql).toContain('mode = ?');
    expect(updateCall!.args).toContain('sound-only');
  });

  it('IDOR: 타인/미존재 message_id 로 수정 시 404 MESSAGE_NOT_FOUND', async () => {
    const foreignMsg = '10000000-0000-4000-8000-0000000000aa';
    // existing alarm → 존재 (소유자 본인)
    mockDB.pushResult([
      {
        id: ID.alarm,
        message_id: ID.message,
        mode: 'tts',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        user_plan: 'personal',
      },
    ]);
    // messageBelongsToCaller → 소유/프리셋 아님 (0 rows)
    mockDB.pushResult([]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { message_id: foreignMsg }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('MESSAGE_NOT_FOUND');
    // 소유권 미통과 시 UPDATE 가 실행되면 안 됨
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(false);
  });

  it('IDOR: 본인 소유 message_id 로 수정은 허용', async () => {
    mockDB.pushResult([
      {
        id: ID.alarm,
        message_id: null,
        mode: 'tts',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        user_plan: 'personal',
      },
    ]);
    // messageBelongsToCaller → 소유 확인 (1 row)
    mockDB.pushResult([{ '1': 1 }]);
    pushMessageBelongsToCaller();
    // UPDATE
    mockDB.pushResult([], 1);
    // SELECT updated
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '07:30',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { message_id: ID.message }),
    );
    expect(res.status).toBe(200);
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(true);
  });

  it('IDOR: 타인/미존재 voice_profile_id 로 수정 시 404 VOICE_PROFILE_NOT_FOUND', async () => {
    const foreignVp = '50000000-0000-4000-8000-0000000000aa';
    mockDB.pushResult([
      {
        id: ID.alarm,
        message_id: ID.message,
        mode: 'tts',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        user_plan: 'personal',
      },
    ]);
    // voiceProfileBelongsToCaller → 0 rows
    mockDB.pushResult([]);

    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { voice_profile_id: foreignVp }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
    expect(mockDB.calls.some((c) => c.sql.includes('UPDATE alarms'))).toBe(false);
  });

  it('voice_profile_id null 로 해제', async () => {
    mockDB.pushResult([{ id: ID.alarm }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([
      {
        id: ID.alarm,
        user_id: 'user-1',
        message_id: ID.message,
        time: '07:30',
        repeat_days: '[]',
        is_active: 1,
        snooze_minutes: 5,
        mode: 'tts',
        vibration_pattern: 'default',
        wake_mode: 'sound_then_voice',
        voice_profile_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

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
    mockDB.pushResult([]);
    mockDB.pushResult([], 0);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('ALARM_NOT_FOUND');
  });

  it('성공 삭제 (message_id 없음) → 200 success, cascade 미발생', async () => {
    mockDB.pushResult([{ message_id: null }]);
    mockDB.pushResult([], 1);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDB.calls.some((c) => c.sql.startsWith('DELETE FROM generated_audio_assets'))).toBe(
      false,
    );
  });

  it('마지막 참조 알람 삭제 시 generated_audio_assets 정리', async () => {
    mockDB.pushResult([{ message_id: ID.message }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const cascadeDelete = mockDB.calls.find((c) =>
      c.sql.startsWith('DELETE FROM generated_audio_assets'),
    );
    expect(cascadeDelete).toBeDefined();
    expect(cascadeDelete!.args).toContain(ID.message);

    // ⚠ **포인터도 함께 끊는다.** R2 오브젝트와 에셋 행만 지우고 `messages.audio_url`
    // 을 두면 `r2://...` 가 영구히 죽은 포인터로 남는다 — 그 메시지를 다시 쓰는 경로는
    // 없는 오브젝트를 받으러 가고, TTL 스윕은 '아직 참조 중' 으로 오판해 청소를 건너뛴다.
    const clearPointer = mockDB.calls.find((c) =>
      c.sql.startsWith('UPDATE messages SET audio_url = NULL'),
    );
    expect(clearPointer).toBeDefined();
    expect(clearPointer!.args).toContain(ID.message);
  });

  it('다른 알람이 같은 message_id 쓰면 audio_url 포인터도 보존', async () => {
    mockDB.pushResult([{ message_id: ID.message }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ cnt: 1 }]);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(
      mockDB.calls.some((c) => c.sql.startsWith('UPDATE messages SET audio_url = NULL')),
    ).toBe(false);
  });

  it('다른 알람이 같은 message_id 쓰면 generated_audio_assets 보존', async () => {
    mockDB.pushResult([{ message_id: ID.message }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ cnt: 1 }]);
    const res = await buildApp().request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(mockDB.calls.some((c) => c.sql.startsWith('DELETE FROM generated_audio_assets'))).toBe(
      false,
    );
  });

  it('DELETE SQL에 userId 바인딩 (다른 사용자 알람 삭제 방지)', async () => {
    mockDB.pushResult([{ message_id: null }]);
    mockDB.pushResult([], 1);
    await buildApp('user-A').request(
      new Request(`http://localhost/alarms/${ID.alarm}`, { method: 'DELETE' }),
    );
    const deleteCall = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM alarms'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.sql).toContain('user_id');
    expect(deleteCall!.args).toContain('user-A');
  });
});

// ---------------------------------------------------------------------------
