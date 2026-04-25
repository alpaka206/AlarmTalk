import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const V1 = '40000000-0000-4000-8000-000000000001';
const M1 = '10000000-0000-4000-8000-000000000001';
const M404 = '10000000-0000-4000-8000-0000000000ff';

const mockDB = createMockDB();
const mockTextToSpeech = vi.fn();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));

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

import ttsRoutes from '../src/routes/tts';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/tts', ttsRoutes);
  return app;
}

function reqWithEnv(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

beforeEach(() => {
  mockDB.reset();
  mockTextToSpeech.mockReset();
});

describe('POST /tts/generate — TTS 생성', () => {
  it('필수 필드 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', {}));
    expect(res.status).toBe(400);
  });

  it('잘못된 voice_profile_id 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: 'bad', text: 'hi' }),
    );
    expect(res.status).toBe(400);
  });

  it('텍스트 200자 초과면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'x'.repeat(201) }),
    );
    expect(res.status).toBe(400);
  });

  it('잘못된 카테고리면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: 'hello',
        category: 'invalid',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('일일 제한 초과면 429', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 3, daily_tts_reset_at: today }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(429);
  });

  it('음성 프로필 없으면 404', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
  });

  it('음성 프로필 ready 아니면 400', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today }]);
    mockDB.pushResult([{ id: V1, status: 'processing', perso_voice_id: null, elevenlabs_voice_id: null }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not ready');
  });
});

describe('GET /tts/messages — 메시지 목록', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('메시지 목록 반환', async () => {
    mockDB.pushResult([{ total: 2 }]);
    mockDB.pushResult([
      { id: M1, text: 'hello', category: 'morning' },
      { id: M404, text: 'bye', category: 'evening' },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('카테고리 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: M1, text: 'hello', category: 'morning' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?category=morning'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
  });

  it('잘못된 voice_profile_id 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?voice_profile_id=bad'));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tts/messages/:id — 메시지 삭제', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/tts/messages/bad-id'));
    expect(res.status).toBe(400);
  });

  it('연관 알람 있으면 409 경고', async () => {
    mockDB.pushResult([{ cnt: 2 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.warning).toBe(true);
    expect(body.alarm_count).toBe(2);
  });

  it('force=true로 연관 알람 있어도 삭제', async () => {
    mockDB.pushResult([{ cnt: 2 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.alarms_affected).toBe(2);
  });

  it('메시지 없으면 404', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 0);
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M404}`));
    expect(res.status).toBe(404);
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('GET /tts/presets — 프리셋 메시지', () => {
  it('프리셋 목록 반환', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/presets'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets[0]).toHaveProperty('category');
    expect(body.presets[0]).toHaveProperty('messages');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /tts/generate                                    */
/* ------------------------------------------------------------------ */
describe('POST /tts/generate — edge cases', () => {
  const today = () => new Date().toISOString().split('T')[0]!;

  it('user 미존재 시 사용량 체크 건너뛰고 voice profile 조회로 진행', async () => {
    mockDB.pushResult([]);          // users: empty
    mockDB.pushResult([]);          // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('daily_tts_reset_at가 오늘이 아니면 카운트 리셋 후 진행', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 99, daily_tts_reset_at: '2020-01-01' }]);
    mockDB.pushResult([], 1);       // UPDATE daily_tts_count = 0
    mockDB.pushResult([]);          // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect(mockDB.calls[1].sql).toContain('daily_tts_count = 0');
  });

  it('알 수 없는 plan이면 기본 제한 3으로 폴백', async () => {
    mockDB.pushResult([{ plan: 'enterprise', daily_tts_count: 3, daily_tts_reset_at: today() }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('DAILY_TTS_LIMIT_EXCEEDED');
  });

  it('elevenlabs_voice_id 없으면 NO_VOICE_ID 400', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: null }]);
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_VOICE_ID');
  });

  it('ElevenLabs 실패 시 500 + detail 포함', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockRejectedValue(new Error('ElevenLabs quota exceeded'));
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('TTS_GENERATION_FAILED');
    expect(body.detail).toBe('ElevenLabs quota exceeded');
  });

  it('ElevenLabs가 비-Error를 throw하면 detail "Unknown error"', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockRejectedValue('raw string error');
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('Unknown error');
  });

  it('성공 시 201 + message_id, audio_base64, category 기본값 custom', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([72, 101]).buffer);
    mockDB.pushResult([], 1);       // INSERT messages
    mockDB.pushResult([], 1);       // UPDATE daily_tts_count
    mockDB.pushResult([], 1);       // INSERT message_library
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message_id).toBeDefined();
    expect(body.audio_base64).toBeDefined();
    expect(body.audio_format).toBe('mp3');
    expect(body.voice_profile_id).toBe(V1);
    // category defaults to 'custom'
    const insertSql = mockDB.calls.find(c => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[4]).toBe('custom');
  });

  it('성공 시 category 명시하면 해당 category 저장', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'test', category: 'morning' }),
    );
    expect(res.status).toBe(201);
    const insertSql = mockDB.calls.find(c => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[4]).toBe('morning');
  });

  it('text 정확히 200자면 허용', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([0]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'a'.repeat(200) }),
    );
    expect(res.status).toBe(201);
  });

  it('voice_profile_id 있고 text 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });

  it('text 있고 voice_profile_id 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { text: 'hello' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });

  it('free plan 일일 제한 미달이면 진행', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 2, daily_tts_reset_at: today() }]);
    mockDB.pushResult([]);          // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('family plan은 사실상 무제한', async () => {
    mockDB.pushResult([{ plan: 'family', daily_tts_count: 9998, daily_tts_reset_at: today() }]);
    mockDB.pushResult([]);          // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — GET /tts/messages                                     */
/* ------------------------------------------------------------------ */
describe('GET /tts/messages — edge cases', () => {
  it('limit > 100이면 100으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=999'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('limit=0은 falsy이므로 기본값 50으로 폴백', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=0'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
  });

  it('limit 비숫자이면 기본값 50', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
  });

  it('offset 음수이면 0으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?offset=-5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it('유효한 voice_profile_id 필터 SQL에 포함', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: M1, text: 'hello' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/tts/messages?voice_profile_id=${V1}`));
    expect(res.status).toBe(200);
    const countCall = mockDB.calls[0];
    expect(countCall.sql).toContain('voice_profile_id');
    expect(countCall.args).toContain(V1);
  });

  it('category + voice_profile_id 복합 필터', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('GET', `/tts/messages?category=morning&voice_profile_id=${V1}`),
    );
    expect(res.status).toBe(200);
    const countCall = mockDB.calls[0];
    expect(countCall.sql).toContain('category');
    expect(countCall.sql).toContain('voice_profile_id');
    expect(countCall.args).toContain('morning');
    expect(countCall.args).toContain(V1);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — DELETE /tts/messages/:id                              */
/* ------------------------------------------------------------------ */
describe('DELETE /tts/messages/:id — edge cases', () => {
  it('삭제 시 message_library부터 삭제 후 messages 삭제 (순서 검증)', async () => {
    mockDB.pushResult([{ cnt: 0 }]);  // alarm check
    mockDB.pushResult([], 1);         // DELETE message_library
    mockDB.pushResult([], 1);         // DELETE messages
    const app = buildApp();
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[1].sql).toContain('DELETE FROM message_library');
    expect(mockDB.calls[2].sql).toContain('DELETE FROM messages');
  });

  it('삭제 SQL에 user_id 포함 (사용자 격리)', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp('user-99');
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[1].args).toContain('user-99');
    expect(mockDB.calls[2].args).toContain('user-99');
  });

  it('force=true이고 알람 0개여도 정상 삭제', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
