import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';
import { resetSharedInMemoryVoiceStorage } from '@alarmtalk/voice';

const V1 = '40000000-0000-4000-8000-000000000001';
const V404 = '40000000-0000-4000-8000-0000000000ff';

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

import voiceRoutes from '../src/routes/voice';

const ENV: Env = {
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
  app.route('/voice', voiceRoutes);
  return app;
}

function reqWithEnv(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

beforeEach(() => {
  mockDB.reset();
  resetSharedInMemoryVoiceStorage();
  mockCreateInstantClone.mockReset();
  mockDeleteVoice.mockReset();
});

function uploadRequest(
  path: string,
  opts: {
    audio?: { bytes: Uint8Array; type: string; name?: string } | null;
    fields?: Record<string, string>;
    noAudio?: boolean;
  } = {},
): Request {
  const form = new FormData();
  if (opts.audio) {
    const blob = new Blob([opts.audio.bytes], { type: opts.audio.type });
    form.append('audio', blob, opts.audio.name ?? 'sample.mp3');
  }
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) {
      form.append(k, v);
    }
  }
  return new Request(`http://localhost${path}`, { method: 'POST', body: form });
}

describe('GET /voice — 음성 프로필 목록', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('프로필 목록 반환', async () => {
    mockDB.pushResult([{ total: 2 }]);
    mockDB.pushResult([
      { id: V1, name: 'Voice A', status: 'ready' },
      { id: V404, name: 'Voice B', status: 'processing' },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('status 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: 'Voice A', status: 'ready' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice?status=ready'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(1);
  });
});

describe('GET /voice/:id — 음성 프로필 상세', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/bad-id'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/voice/${V404}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('프로필 반환', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', status: 'ready' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/voice/${V1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('Voice A');
  });
});

describe('PATCH /voice/:id — 음성 프로필 이름 변경', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/voice/bad-id', { name: '새 이름' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('JSON 이 아니면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(`http://localhost/voice/${V1}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('JSON_BODY_REQUIRED');
  });

  it('이름이 공백이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/voice/${V1}`, { name: '   ' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('이름이 51자 이상이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/voice/${V1}`, { name: '가'.repeat(51) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('존재하지 않거나 소유자가 아니면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/voice/${V404}`, { name: '새 이름' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('정상 변경은 200 과 새 이름을 반환하고 updated_at 이 갱신된다', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 1 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/voice/${V1}`, { name: '  엄마 목소리  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('엄마 목소리');

    const update = mockDB.calls.find((c) => c.sql.includes('UPDATE voice_profiles'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('updated_at');
    expect(update!.args).toContain('엄마 목소리');
    expect(update!.args).toContain(V1);
  });

  it('updates relationship label', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 1 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', `/voice/${V1}`, { relationship_label: '손녀' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.relationship_label).toBe('손녀');
    const update = mockDB.calls.find((c) => c.sql.includes('UPDATE voice_profiles'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('relationship_label = ?');
    expect(update!.args).toContain('손녀');
  });
});

describe('GET /voice/:id/stats — 음성 프로필 통계', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/bad-id/stats'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/voice/${V404}/stats`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('통계 반환', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A' }]);
    mockDB.pushResult([{ count: 5 }]);
    mockDB.pushResult([{ count: 3 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/voice/${V1}/stats`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voice_profile_id).toBe(V1);
    expect(body.messages).toBe(5);
    expect(body.alarms).toBe(3);
  });
});

describe('POST /voice/upload — 원본 오디오 업로드', () => {
  it('정상 업로드는 201 과 upload 메타를 돌려준다', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      uploadRequest('/voice/upload', {
        audio: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'audio/mpeg', name: 'hi.mp3' },
        fields: { durationMs: '90000' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.sizeBytes).toBe(4);
    expect(body.upload.mimeType).toBe('audio/mpeg');
    expect(body.upload.durationMs).toBe(90000);
    expect(body.upload.objectKey.startsWith('mem://user-1/')).toBe(true);
    expect(typeof body.upload.id).toBe('string');

    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voice_uploads'));
    expect(insert).toBeDefined();
    expect(insert!.args).toContain('user-1');
    expect(insert!.args).toContain('audio/mpeg');
  });

  it('audio 파일이 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(uploadRequest('/voice/upload', { audio: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUDIO_FILE_REQUIRED');
  });

  it('MIME 이 audio/* 가 아니면 415', async () => {
    const app = buildApp();
    const res = await app.request(
      uploadRequest('/voice/upload', {
        audio: { bytes: new Uint8Array([1, 2]), type: 'image/png', name: 'x.png' },
      }),
    );
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_AUDIO_MIME_TYPE');
  });

  it('빈 파일이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      uploadRequest('/voice/upload', {
        audio: { bytes: new Uint8Array([]), type: 'audio/wav' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUDIO_FILE_EMPTY');
  });

  it('25 MiB 초과면 413', async () => {
    const tooBig = new Uint8Array(25 * 1024 * 1024 + 1);
    const app = buildApp();
    const res = await app.request(
      uploadRequest('/voice/upload', {
        audio: { bytes: tooBig, type: 'audio/mpeg' },
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error_code).toBe('AUDIO_FILE_TOO_LARGE');
  });

  it('durationMs 가 숫자가 아니면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      uploadRequest('/voice/upload', {
        audio: { bytes: new Uint8Array([1]), type: 'audio/mpeg' },
        fields: { durationMs: 'abc' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_DURATION');
  });
});

describe('DELETE /voice/:id — 음성 프로필 삭제', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/voice/bad-id'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V404}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('연관 메시지가 있어도 프로필만 숨김 처리', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
  });

  it('force=true로 요청해도 메시지와 알람은 삭제하지 않음', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V1}?force=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
  });

  it('draftOnly=true인데 이미 등록된(is_draft=0) 보이스면 삭제하지 않는다(팬텀 성공 보호)', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', elevenlabs_voice_id: 'el-1', is_draft: 0 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V1}?draftOnly=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('not_a_draft');
    // 등록 보이스이므로 ElevenLabs 클론 삭제도 호출되지 않아야 한다.
    expect(mockDeleteVoice).not.toHaveBeenCalled();
  });

  it('draftOnly=true여도 실제 draft(is_draft=1)면 정상 삭제한다', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', elevenlabs_voice_id: null, is_draft: 1 }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V1}?draftOnly=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
  });

  it('연관 메시지가 없어도 소프트 삭제', async () => {
    mockDB.pushResult([{ id: V1, name: 'Voice A', elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/voice/${V1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
  });
});

describe('GET /voice/family — 가족 음성 프로필', () => {
  it('가족 멤버가 없으면 빈 배열', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toEqual([]);
  });

  it('가족 멤버 음성 프로필 반환', async () => {
    mockDB.pushResult([{ user_id: 'user-2' }, { user_id: 'user-3' }]);
    mockDB.pushResult([
      { id: V1, name: '엄마 목소리', status: 'ready', user_id: 'user-2', owner_name: '엄마' },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].owner_name).toBe('엄마');
  });

  it('viewer 라벨 미설정 시 needs_viewer_info=true', async () => {
    mockDB.pushResult([{ user_id: 'user-2' }]);
    mockDB.pushResult([
      {
        id: V1,
        name: '엄마 목소리',
        status: 'ready',
        user_id: 'user-2',
        owner_name: '엄마',
        relationship_label: null,
        listener_title: null,
        viewer_relationship_raw: null,
        viewer_listener_raw: null,
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles[0].needs_viewer_info).toBe(true);
    expect(body.profiles[0].relationship_label).toBeNull();
    expect(body.profiles[0].listener_title).toBeNull();
    expect(body.profiles[0].viewer_relationship_raw).toBeUndefined();
  });

  it('viewer 라벨 설정 시 needs_viewer_info=false', async () => {
    mockDB.pushResult([{ user_id: 'user-2' }]);
    mockDB.pushResult([
      {
        id: V1,
        name: '엄마 목소리',
        status: 'ready',
        user_id: 'user-2',
        owner_name: '엄마',
        relationship_label: '엄마',
        listener_title: '아들',
        viewer_relationship_raw: '엄마',
        viewer_listener_raw: '아들',
      },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles[0].needs_viewer_info).toBe(false);
  });

  it('가족 멤버는 있지만 음성 없으면 빈 배열', async () => {
    mockDB.pushResult([{ user_id: 'user-2' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/voice/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toEqual([]);
  });
});

describe('POST /voice/clone — 음성 클론', () => {
  function cloneRequest(
    audio: Uint8Array | null,
    name: string | null,
    durationMs = '90000',
  ): Request {
    const form = new FormData();
    if (audio) {
      form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'sample.wav');
    }
    if (name) {
      form.append('name', name);
    }
    if (durationMs) {
      form.append('durationMs', durationMs);
    }
    form.append('isDraft', 'true');
    return new Request('http://localhost/voice/clone', { method: 'POST', body: form });
  }

  it('프로필 1개 이상이면 403', async () => {
    // 한도 검사는 draft/official 슬롯을 함께 센다(둘 중 하나라도 차면 차단).
    mockDB.pushResult([{ draft_count: 1, official_count: 1 }]);
    const app = buildApp();
    const res = await reqWithEnv(app, cloneRequest(new Uint8Array([1, 2, 3]), '테스트'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_LIMIT_REACHED');
  });

  it('audio 파일 누락 시 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('name', '테스트');
    form.append('isDraft', 'true');
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      new Request('http://localhost/voice/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 누락 시 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1])], { type: 'audio/wav' }), 'a.wav');
    form.append('isDraft', 'true');
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      new Request('http://localhost/voice/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 50자 초과 시 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const longName = 'x'.repeat(51);
    const app = buildApp();
    const res = await reqWithEnv(app, cloneRequest(new Uint8Array([1, 2]), longName));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('NAME_TOO_LONG');
  });

  it('성공 시 201 + 프로필 반환', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-voice-001' });
    const app = buildApp();
    const res = await reqWithEnv(app, cloneRequest(new Uint8Array([1, 2, 3, 4]), '엄마 목소리'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile.name).toBe('엄마 목소리');
    expect(body.profile.voice_id).toBe('elv-voice-001');
    expect(body.profile.status).toBe('ready');
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    expect(mockCreateInstantClone.mock.calls[0]![2]).toEqual({
      removeBackgroundNoise: true,
      mimeType: 'audio/wav',
      fileName: 'sample.wav',
    });
  });

  it('stores relationship label when cloning a voice', async () => {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
      'sample.wav',
    );
    form.append('name', 'Child voice');
    form.append('durationMs', '90000');
    form.append('relationshipLabel', '손녀');
    form.append('isDraft', 'true');
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-voice-001' });
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      new Request('http://localhost/voice/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile.relationship_label).toBe('손녀');
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO voice_profiles'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('relationship_label');
    expect(insert!.args).toContain('손녀');
  });

  it('ElevenLabs 실패 시 500', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue(new Error('API down'));
    const app = buildApp();
    const res = await reqWithEnv(app, cloneRequest(new Uint8Array([1, 2, 3]), '테스트'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_CLONING_FAILED');
    // K1: 제공자 응답 원문(err.message)은 detail 로 반사하지 않고 안정 에러코드만 노출한다.
    expect(body.detail).toBe('VOICE_CLONING_FAILED');
    expect(JSON.stringify(body)).not.toContain('API down');
  });
});
