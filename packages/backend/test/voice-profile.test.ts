import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const V1 = '40000000-0000-4000-8000-000000000001';
const V2 = '40000000-0000-4000-8000-000000000002';
const V_BAD = 'not-a-uuid';

const mockDB = createMockDB();
const mockCreateInstantClone = vi.fn();
const mockDeleteVoice = vi.fn();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.createInstantClone = mockCreateInstantClone;
    this.deleteVoice = mockDeleteVoice;
  }),
}));

import voiceProfile from '../src/routes/voice-profile';

const ENV: Env = {
  PERSO_API_KEY: 'x',
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/vp', voiceProfile);
  return app;
}

function req(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function cloneForm(audio: Uint8Array | null, name: string | null): Request {
  const form = new FormData();
  if (audio) form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'sample.wav');
  if (name) form.append('name', name);
  return new Request('http://localhost/vp/clone', { method: 'POST', body: form });
}

beforeEach(() => {
  mockDB.reset();
  mockCreateInstantClone.mockReset();
  mockDeleteVoice.mockReset();
});

/* ------------------------------------------------------------------ */
/*  GET /vp — 프로필 목록                                              */
/* ------------------------------------------------------------------ */
describe('GET / — 프로필 목록 (voice-profile)', () => {
  it('빈 목록', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('기본 pagination limit=50, offset=0', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: '테스트' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.profiles).toHaveLength(1);
  });

  it('limit 최대 100 으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=999'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(100);
  });

  it('limit=0 은 기본값 50 으로 폴백 (falsy)', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=0'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(50);
  });

  it('offset 음수이면 0 으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?offset=-5'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(0);
  });

  it('유효한 status 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: 'ok', status: 'ready' }]);
    await req(buildApp(), new Request('http://localhost/vp?status=ready'));
    expect(mockDB.calls[0]!.sql).toContain('AND status = ?');
    expect(mockDB.calls[0]!.args).toContain('ready');
  });

  it('무효한 status 는 무시', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?status=invalid'));
    expect(mockDB.calls[0]!.sql).not.toContain('AND status');
  });

  it('processing/failed status 도 유효', async () => {
    for (const st of ['processing', 'failed']) {
      mockDB.reset();
      mockDB.pushResult([{ total: 0 }]);
      mockDB.pushResult([]);
      await req(buildApp(), new Request(`http://localhost/vp?status=${st}`));
      expect(mockDB.calls[0]!.sql).toContain('AND status = ?');
      expect(mockDB.calls[0]!.args).toContain(st);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/:id — 프로필 상세                                          */
/* ------------------------------------------------------------------ */
describe('GET /:id — 프로필 상세 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V_BAD}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}`));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('자신의 프로필이면 200 반환', async () => {
    mockDB.pushResult([{ id: V1, name: '엄마', status: 'ready' }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('엄마');
  });

  it('쿼리에 user_id 포함 (소유권 검증)', async () => {
    mockDB.pushResult([{ id: V1 }]);
    await req(buildApp('user-A'), new Request(`http://localhost/vp/${V1}`));
    expect(mockDB.calls[0]!.args).toContain('user-A');
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /vp/:id — 이름 변경                                         */
/* ------------------------------------------------------------------ */
describe('PATCH /:id — 이름 변경 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V_BAD}`, { name: 'ok' }));
    expect(res.status).toBe(400);
  });

  it('JSON 아닌 body → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'PATCH', body: 'plain text' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('JSON_BODY_REQUIRED');
  });

  it('빈 이름 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('공백만 → 400 (trim 후 빈 문자열)', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('51자 초과 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 'x'.repeat(51) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('50자 정확히 → 통과', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 'a'.repeat(50) }));
    expect(res.status).toBe(200);
  });

  it('name 이 숫자이면 빈 문자열로 처리 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 123 }));
    expect(res.status).toBe(400);
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '새이름' }));
    expect(res.status).toBe(404);
  });

  it('정상 변경 시 200 + updated_at 갱신 쿼리', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '새 이름' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('새 이름');
    const updateCall = mockDB.calls[1]!;
    expect(updateCall.sql).toContain('updated_at');
    expect(updateCall.args).toContain('새 이름');
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/:id/stats — 통계                                          */
/* ------------------------------------------------------------------ */
describe('GET /:id/stats — 통계 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V_BAD}/stats`));
    expect(res.status).toBe(400);
  });

  it('프로필 없으면 404', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/stats`));
    expect(res.status).toBe(404);
  });

  it('통계 반환 (메시지 3개, 알람 2개)', async () => {
    mockDB.pushResult([{ id: V1, name: '엄마' }]);
    mockDB.pushResult([{ count: 3 }]);
    mockDB.pushResult([{ count: 2 }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/stats`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voice_profile_id).toBe(V1);
    expect(body.messages).toBe(3);
    expect(body.alarms).toBe(2);
  });

  it('alarms 쿼리에 target_user_id 포함 (수신 알람 포함)', async () => {
    mockDB.pushResult([{ id: V1, name: 'x' }]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    await req(buildApp('user-X'), new Request(`http://localhost/vp/${V1}/stats`));
    const alarmCall = mockDB.calls[2]!;
    expect(alarmCall.sql).toContain('target_user_id');
    expect(alarmCall.args).toContain('user-X');
  });
});

/* ------------------------------------------------------------------ */
/*  POST /vp/clone — 음성 클론                                         */
/* ------------------------------------------------------------------ */
describe('POST /clone — 음성 클론 (voice-profile)', () => {
  it('프로필 2개 이상이면 403 VOICE_LIMIT_REACHED', async () => {
    mockDB.pushResult([{ count: 2 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '테스트'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_LIMIT_REACHED');
    expect(body.error).toContain('2');
  });

  it('프로필 정확히 1개이면 통과', async () => {
    mockDB.pushResult([{ count: 1 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-1' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '두번째'));
    expect(res.status).toBe(201);
  });

  it('audio 누락 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('name', 'test');
    const res = await req(
      buildApp(),
      new Request('http://localhost/vp/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 누락 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1])], { type: 'audio/wav' }), 'a.wav');
    const res = await req(
      buildApp(),
      new Request('http://localhost/vp/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 50자 초과 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'x'.repeat(51)));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NAME_TOO_LONG');
  });

  it('name 50자 정확히 → 통과', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-2' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'a'.repeat(50)));
    expect(res.status).toBe(201);
  });

  it('성공 시 INSERT processing → UPDATE ready 순서', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '엄마'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile.name).toBe('엄마');
    expect(body.profile.voice_id).toBe('elv-ok');
    expect(body.profile.status).toBe('ready');

    const insertCall = mockDB.calls[1]!;
    expect(insertCall.sql).toContain('INSERT INTO voice_profiles');
    expect(insertCall.sql).toContain("'processing'");

    const updateCall = mockDB.calls[2]!;
    expect(updateCall.sql).toContain("status = 'ready'");
    expect(updateCall.args).toContain('elv-ok');
  });

  it('ElevenLabs 실패 → 500 VOICE_CLONING_FAILED', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue(new Error('API down'));
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'test'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_CLONING_FAILED');
    expect(body.detail).toBe('API down');
  });

  it('ElevenLabs 에 audioBuffer 전달 확인', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-x' });
    await req(buildApp(), cloneForm(new Uint8Array([10, 20, 30]), '이름'));
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    const [audioArg, nameArg] = mockCreateInstantClone.mock.calls[0]! as [ArrayBuffer, string];
    expect(new Uint8Array(audioArg)).toEqual(new Uint8Array([10, 20, 30]));
    expect(nameArg).toBe('이름');
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /vp/:id — 프로필 삭제                                       */
/* ------------------------------------------------------------------ */
describe('DELETE /:id — 프로필 삭제 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V_BAD}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });

  it('연관 메시지 있고 force 없으면 409', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([{ cnt: 5 }]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_PROFILE_IN_USE');
    expect(body.message_count).toBe(5);
  });

  it('연관 메시지 있고 force=true 면 cascade 삭제', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([{ cnt: 3 }]);
    mockDB.pushResult([], 2); // DELETE alarms
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([], 3); // DELETE messages
    mockDB.pushResult([], 1); // DELETE voice_profiles
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}?force=true`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.messages_deleted).toBe(3);

    const deleteQueries = mockDB.calls.filter((c) => c.sql.startsWith('DELETE'));
    expect(deleteQueries).toHaveLength(4);
    expect(deleteQueries[0]!.sql).toContain('alarms');
    expect(deleteQueries[1]!.sql).toContain('message_library');
    expect(deleteQueries[2]!.sql).toContain('messages');
    expect(deleteQueries[3]!.sql).toContain('voice_profiles');
  });

  it('연관 메시지 없으면 바로 삭제 (cascade 스킵)', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1); // DELETE voice_profiles
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.messages_deleted).toBe(0);
    const deleteQueries = mockDB.calls.filter((c) => c.sql.startsWith('DELETE'));
    expect(deleteQueries).toHaveLength(1);
    expect(deleteQueries[0]!.sql).toContain('voice_profiles');
  });

  it('ElevenLabs voice 삭제 호출', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-xyz' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockResolvedValue(undefined);
    await req(buildApp(), new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }));
    expect(mockDeleteVoice).toHaveBeenCalledWith('elv-xyz');
  });

  it('ElevenLabs 삭제 실패해도 로컬 삭제 진행', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-fail' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockRejectedValue(new Error('API error'));
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('elevenlabs_voice_id 없으면 외부 API 호출 안 함', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    await req(buildApp(), new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }));
    expect(mockDeleteVoice).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/family — 가족 음성 프로필                                   */
/* ------------------------------------------------------------------ */
describe('GET /family — 가족 음성 프로필 (voice-profile)', () => {
  it('가족 멤버 없으면 빈 배열', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toEqual([]);
  });

  it('가족 멤버 있고 음성 프로필 존재', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }, { user_id: 'member-2' }]);
    mockDB.pushResult([
      { id: V1, name: '아빠', status: 'ready', user_id: 'member-1', owner_name: '김아빠' },
      { id: V2, name: '엄마', status: 'ready', user_id: 'member-2', owner_name: '이엄마' },
    ]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles[0].owner_name).toBe('김아빠');
  });

  it('가족 멤버 있지만 음성 프로필 없으면 빈 배열', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }]);
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toEqual([]);
  });

  it('쿼리에 ready 상태만 필터', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp/family'));
    const voiceQuery = mockDB.calls[1]!;
    expect(voiceQuery.sql).toContain("status = 'ready'");
  });

  it('자기 자신은 제외 (fm2.user_id != ?)', async () => {
    mockDB.pushResult([]);
    await req(buildApp('user-me'), new Request('http://localhost/vp/family'));
    const memberQuery = mockDB.calls[0]!;
    expect(memberQuery.args).toContain('user-me');
    expect(memberQuery.sql).toContain('fm2.user_id != ?');
  });
});
