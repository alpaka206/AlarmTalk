import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import familyAlarmRoutes from '../src/routes/family-alarm';

function buildApp(userId = 'google-sender') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/family-alarm', familyAlarmRoutes);
  return app;
}

const SENDER_PK = 'sender-pk-001';
const RECIPIENT_PK = 'recipient-pk-002';
const GROUP_ID = 'group-001';
const VP_ID = 'vp-001';
const UPLOAD_ID = 'upload-001';

function pushResolveUserPk(pk: string | null) {
  if (pk) {
    mockDB.pushResult([{ id: pk }]);
  } else {
    mockDB.pushResult([]);
  }
}

function pushAssertSameGroup(senderGroups: string[], recipientGroups: string[]) {
  mockDB.pushResult(senderGroups.map((id) => ({ plan_group_id: id })));
  mockDB.pushResult(recipientGroups.map((id) => ({ plan_group_id: id })));
}

function pushRecipient(opts: { allowAlarms?: boolean; notFound?: boolean } = {}) {
  if (opts.notFound) {
    mockDB.pushResult([]);
  } else {
    mockDB.pushResult([{
      id: RECIPIENT_PK,
      google_id: 'google-recipient',
      allow_family_alarms: opts.allowAlarms !== false ? 1 : 0,
    }]);
  }
}

function pushVoiceProfileOwned(found: boolean) {
  mockDB.pushResult(found ? [{ id: VP_ID }] : []);
}

function pushLatestVoiceProfile(found: boolean) {
  mockDB.pushResult(found ? [{ id: VP_ID }] : []);
}

function pushInserts() {
  mockDB.pushResult([], 1); // INSERT messages
  mockDB.pushResult([], 1); // INSERT alarms
}

function validTtsBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient_user_id: RECIPIENT_PK,
    wake_at: '07:30',
    message_text: '좋은 아침이야!',
    ...overrides,
  };
}

function validVoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient_user_id: RECIPIENT_PK,
    wake_at: '07:30',
    voice_upload_id: UPLOAD_ID,
    ...overrides,
  };
}

beforeEach(() => {
  mockDB.reset();
});

// ─── POST /family-alarm/alarms (TTS) ────────────────────────────

describe('POST /family-alarm/alarms — TTS 가족 알람', () => {
  // --- validation ---

  it('recipient_user_id 누락 → 400 RECIPIENT_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ recipient_user_id: '' })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('RECIPIENT_REQUIRED');
  });

  it('wake_at 형식 오류 → 400 INVALID_WAKE_AT', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ wake_at: '25:00' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_WAKE_AT');
  });

  it('wake_at 미전송 → 400 INVALID_WAKE_AT', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ wake_at: 123 })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_WAKE_AT');
  });

  it('message_text 빈 문자열 → 400 MESSAGE_TEXT_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ message_text: '' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('MESSAGE_TEXT_REQUIRED');
  });

  it('message_text 500자 초과 → 400 MESSAGE_TEXT_TOO_LONG', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ message_text: 'A'.repeat(501) })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('MESSAGE_TEXT_TOO_LONG');
  });

  it('message_text 정확히 500자 → 통과 (길이 경계)', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushLatestVoiceProfile(true);
    pushInserts();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ message_text: 'A'.repeat(500) })));
    expect(res.status).toBe(201);
  });

  // --- auth / permission ---

  it('발신자 미존재 → 404 USER_NOT_FOUND', async () => {
    pushResolveUserPk(null);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('자기 자신에게 → 400 SELF_ALARM', async () => {
    pushResolveUserPk(RECIPIENT_PK); // sender PK = recipient PK

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ALARM');
  });

  it('같은 그룹이 아닌 경우 → 403 NOT_SAME_GROUP', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], ['different-group']);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('NOT_SAME_GROUP');
  });

  it('발신자가 그룹 미소속 → 403 NOT_SAME_GROUP', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([], [GROUP_ID]);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('NOT_SAME_GROUP');
  });

  it('수신자 미존재 → 404 RECIPIENT_NOT_FOUND', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient({ notFound: true });

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('RECIPIENT_NOT_FOUND');
  });

  it('수신자 가족 알람 비허용 → 403 FAMILY_ALARM_DISABLED', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient({ allowAlarms: false });

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FAMILY_ALARM_DISABLED');
  });

  // --- voice profile ---

  it('voice_profile_id 지정했으나 수신자 소유 아님 → 400 VOICE_NOT_OWNED', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushVoiceProfileOwned(false);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ voice_profile_id: VP_ID })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_NOT_OWNED');
  });

  it('voice_profile_id 미지정 + 수신자 프로필 없음 → 400 NO_VOICE_PROFILE', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushLatestVoiceProfile(false);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_VOICE_PROFILE');
  });

  // --- happy path ---

  it('정상 생성 — voice_profile_id 미지정 (최신 프로필 자동 선택)', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushLatestVoiceProfile(true);
    pushInserts();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody()));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.alarm.sender_user_id).toBe(SENDER_PK);
    expect(body.alarm.recipient_user_id).toBe(RECIPIENT_PK);
    expect(body.alarm.wake_at).toBe('07:30');
    expect(body.alarm.mode).toBe('tts');
    expect(body.alarm.voice_profile_id).toBe(VP_ID);
    expect(body.alarm.repeat_days).toEqual([]);
    expect(body.message.text).toBe('좋은 아침이야!');
    expect(body.message.synthesis_text).toContain(body.message.text);
    expect(body.message.tags).toHaveLength(1);
    expect(body.message.synthesis_text).toContain(`[${body.message.tags[0]}]`);
    expect(body.message.category).toBe('family');

    const insertMsg = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(insertMsg).toBeDefined();
    expect(insertMsg!.sql).toContain('synthesis_text');
    expect(insertMsg!.sql).toContain('delivery_tags_json');
    expect(insertMsg!.args[3]).toBe(body.message.text);
    expect(insertMsg!.args[4]).toBe(body.message.synthesis_text);
    expect(insertMsg!.args[5]).toBe(JSON.stringify(body.message.tags));
    const insertAlarm = mockDB.calls.find((c) => c.sql.includes('INSERT INTO alarms'));
    expect(insertAlarm).toBeDefined();
  });

  it('정상 생성 — voice_profile_id 지정', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushVoiceProfileOwned(true);
    pushInserts();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({ voice_profile_id: VP_ID })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.voice_profile_id).toBe(VP_ID);
  });

  it('repeat_days 정규화 — 중복 제거 + 정렬 + 범위 외 필터', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushLatestVoiceProfile(true);
    pushInserts();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({
      repeat_days: [5, 1, 1, 3, 7, -1, 5],
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm.repeat_days).toEqual([1, 3, 5]);
  });

  it('repeat_days 비배열 → 빈 배열로 정규화', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    pushLatestVoiceProfile(true);
    pushInserts();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms', validTtsBody({
      repeat_days: 'invalid',
    })));
    expect(res.status).toBe(201);
    expect((await res.json()).alarm.repeat_days).toEqual([]);
  });

  it('malformed JSON body → 빈 body로 처리 → RECIPIENT_REQUIRED', async () => {
    const app = buildApp();
    const req = new Request('http://localhost/family-alarm/alarms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RECIPIENT_REQUIRED');
  });
});

// ─── POST /family-alarm/alarms/voice ─────────────────────────────

describe('POST /family-alarm/alarms/voice — 음성 업로드 가족 알람', () => {
  // --- validation ---

  it('recipient_user_id 누락 → 400 RECIPIENT_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ recipient_user_id: '' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RECIPIENT_REQUIRED');
  });

  it('wake_at 형식 오류 → 400 INVALID_WAKE_AT', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ wake_at: '7:30' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_WAKE_AT');
  });

  it('voice_upload_id 누락 → 400 VOICE_UPLOAD_REQUIRED', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ voice_upload_id: '' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_UPLOAD_REQUIRED');
  });

  it('label 200자 초과 → 400 LABEL_TOO_LONG', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ label: 'X'.repeat(201) })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('LABEL_TOO_LONG');
  });

  it('dub_target_language 잘못된 값 → 400 INVALID_DUB_LANGUAGE', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ dub_target_language: 'fr' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DUB_LANGUAGE');
  });

  // --- auth / permission ---

  it('발신자 미존재 → 404 USER_NOT_FOUND', async () => {
    pushResolveUserPk(null);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('자기 자신에게 → 400 SELF_ALARM', async () => {
    pushResolveUserPk(RECIPIENT_PK);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('SELF_ALARM');
  });

  it('같은 그룹 아님 → 403 NOT_SAME_GROUP', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], []);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('NOT_SAME_GROUP');
  });

  it('수신자 미존재 → 404 RECIPIENT_NOT_FOUND', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient({ notFound: true });

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('RECIPIENT_NOT_FOUND');
  });

  it('수신자 가족 알람 비허용 → 403 FAMILY_ALARM_DISABLED', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient({ allowAlarms: false });

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FAMILY_ALARM_DISABLED');
  });

  // --- upload / voice profile ---

  it('업로드 미존재 → 400 UPLOAD_NOT_FOUND', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    mockDB.pushResult([]); // voice_uploads SELECT empty

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('UPLOAD_NOT_FOUND');
  });

  it('업로드 소유자 불일치 → 400 NOT_UPLOAD_OWNER', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'other-user', object_key: 'audio/test.wav' }]);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NOT_UPLOAD_OWNER');
  });

  it('수신자 음성 프로필 없음 → 400 NO_VOICE_PROFILE', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: SENDER_PK, object_key: 'audio/test.wav' }]);
    pushLatestVoiceProfile(false);

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_VOICE_PROFILE');
  });

  // --- happy path ---

  function pushVoiceHappyPath() {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: SENDER_PK, object_key: 'audio/family-voice.wav' }]);
    pushLatestVoiceProfile(true);
    pushInserts(); // messages + alarms
  }

  it('정상 생성 — dub 없이', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.alarm.sender_user_id).toBe(SENDER_PK);
    expect(body.alarm.recipient_user_id).toBe(RECIPIENT_PK);
    expect(body.alarm.wake_at).toBe('07:30');
    expect(body.alarm.mode).toBe('sound-only');
    expect(body.alarm.voice_upload_id).toBe(UPLOAD_ID);
    expect(body.message.category).toBe('family-voice');
    expect(body.message.audio_url).toBe('audio/family-voice.wav');
    expect(body.dub_job).toBeNull();
  });

  it('label 미지정 → 기본 라벨 사용', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message.text).toBe('가족이 보낸 음성');
  });

  it('label 지정 → 해당 라벨 사용', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ label: '엄마의 응원' })));
    expect(res.status).toBe(201);
    expect((await res.json()).message.text).toBe('엄마의 응원');
  });

  it('dub_target_language 지정 → dub_job 생성 + audio_url null', async () => {
    pushResolveUserPk(SENDER_PK);
    pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
    pushRecipient();
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: SENDER_PK, object_key: 'audio/voice.wav' }]);
    pushLatestVoiceProfile(true);
    pushInserts();
    mockDB.pushResult([], 1); // INSERT dub_jobs

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({
      dub_target_language: 'en',
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message.audio_url).toBeNull();
    expect(body.dub_job).not.toBeNull();
    expect(body.dub_job.target_language).toBe('en');
    expect(body.dub_job.status).toBe('processing');

    const dubInsert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO dub_jobs'));
    expect(dubInsert).toBeDefined();
  });

  it('repeat_days 정규화 (voice 엔드포인트)', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({
      repeat_days: [6, 0, 0, 3],
    })));
    expect(res.status).toBe(201);
    expect((await res.json()).alarm.repeat_days).toEqual([0, 3, 6]);
  });

  it('dub_target_language 유효값 ko/en/ja/zh 모두 허용', async () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      mockDB.reset();
      pushResolveUserPk(SENDER_PK);
      pushAssertSameGroup([GROUP_ID], [GROUP_ID]);
      pushRecipient();
      mockDB.pushResult([{ id: UPLOAD_ID, user_id: SENDER_PK, object_key: 'audio/v.wav' }]);
      pushLatestVoiceProfile(true);
      pushInserts();
      mockDB.pushResult([], 1); // dub_jobs

      const app = buildApp();
      const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({
        dub_target_language: lang,
      })));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.dub_job.target_language).toBe(lang);
    }
  });

  it('dub_target_language null → dub 미생성', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({
      dub_target_language: null,
    })));
    expect(res.status).toBe(201);
    expect((await res.json()).dub_job).toBeNull();
  });

  it('label 200자 정확히 → 통과 (경계값)', async () => {
    pushVoiceHappyPath();

    const app = buildApp();
    const label200 = 'X'.repeat(200);
    const res = await app.request(jsonReq('POST', '/family-alarm/alarms/voice', validVoiceBody({ label: label200 })));
    expect(res.status).toBe(201);
    expect((await res.json()).message.text).toBe(label200);
  });
});
