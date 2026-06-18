import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

const TOKEN_URI = 'https://oauth2.example.com/token';
let VERTEX_CREDENTIALS_JSON = '';

function toPem(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  const base64 = btoa(binary).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  VERTEX_CREDENTIALS_JSON = JSON.stringify({
    client_email: 'svc@test.iam.gserviceaccount.com',
    private_key: toPem(pkcs8),
    project_id: 'test-project',
    token_uri: TOKEN_URI,
  });
});

function createMockR2Bucket(initial: Record<string, Uint8Array> = {}) {
  const store = new Map<
    string,
    { body: ArrayBuffer; contentType?: string; meta: Record<string, string> }
  >();
  for (const [key, bytes] of Object.entries(initial)) {
    store.set(key, {
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      contentType: 'audio/mpeg',
      meta: { mimeType: 'audio/mpeg', userId: 'user-1', sizeBytes: String(bytes.byteLength) },
    });
  }
  const bucket = {
    put: async (
      key: string,
      value: ArrayBufferLike,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) => {
      const body =
        value instanceof ArrayBuffer ? value : new Uint8Array(value as ArrayBufferLike).buffer;
      store.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
        meta: options?.customMetadata ?? {},
      });
    },
    get: async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        customMetadata: item.meta,
        httpMetadata: item.contentType ? { contentType: item.contentType } : undefined,
        size: item.body.byteLength,
        uploaded: new Date('2026-05-01T00:00:00Z'),
        arrayBuffer: async () => item.body,
      };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

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

function geminiText(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
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
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
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
    mockDB.pushResult([
      { id: V1, status: 'processing', elevenlabs_voice_id: null },
    ]);
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
    mockDB.pushResult([{ cnt: 2 }]); // alarm check
    mockDB.pushResult([], 1); // UPDATE alarms (detach)
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.alarms_affected).toBe(2);
    const alarmUpdate = mockDB.calls.find((c) => c.sql.startsWith('UPDATE alarms'));
    expect(alarmUpdate).toBeDefined();
    expect(alarmUpdate!.sql).toContain("mode = 'sound-only'");
    expect(alarmUpdate!.sql).toContain("wake_mode = 'sound_then_voice'");
    expect(alarmUpdate!.sql).toContain('message_id = NULL');
    expect(alarmUpdate!.sql).toContain('voice_profile_id = NULL');
    expect(alarmUpdate!.sql).toContain('speaker_id = NULL');
    expect(alarmUpdate!.sql).toContain('EXISTS');
    expect(alarmUpdate!.args).toEqual([M1, M1, 'user-1', 'user-1']);
  });

  it('메시지 없으면 404', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 0);
    mockDB.pushResult([], 0);
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M404}`));
    expect(res.status).toBe(404);
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([{ cnt: 0 }]); // alarm check
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
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

  it('DB tts_presets row가 있으면 서버 프리셋으로 반환', async () => {
    mockDB.pushResult([
      {
        category: 'morning',
        label: '아침',
        emoji: 'sun',
        messages_json: JSON.stringify(['서버 아침 문구']),
      },
    ]);
    const app = buildApp();
    const res = await reqWithEnv(app, jsonReq('GET', '/tts/presets'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0].messages).toEqual(['서버 아침 문구']);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /tts/generate                                    */
/* ------------------------------------------------------------------ */
describe('POST /tts/generate — edge cases', () => {
  const today = () => new Date().toISOString().split('T')[0]!;

  it('user 미존재 시 사용량 체크 건너뛰고 voice profile 조회로 진행', async () => {
    mockDB.pushResult([]); // users: empty
    mockDB.pushResult([]); // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('daily_tts_reset_at가 오늘이 아니면 카운트 리셋 후 진행', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 99, daily_tts_reset_at: '2020-01-01' }]);
    mockDB.pushResult([], 1); // UPDATE daily_tts_count = 0
    mockDB.pushResult([]); // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect(mockDB.calls[1].sql).toContain('daily_tts_count = 0');
  });

  it('알 수 없는 plan이면 기본 제한 3으로 폴백', async () => {
    mockDB.pushResult([{ plan: 'enterprise', daily_tts_count: 3, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('DAILY_TTS_LIMIT_EXCEEDED');
  });

  it('elevenlabs_voice_id 없으면 NO_VOICE_ID 400', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: null }]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_VOICE_ID');
  });

  it('ElevenLabs 실패 시 500 + detail 포함', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    mockDB.pushResult([], 1); // atomic daily-count reservation
    mockTextToSpeech.mockRejectedValue(new Error('ElevenLabs quota exceeded'));
    const app = buildApp();
    const res = await reqWithEnv(
      app,
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
    mockDB.pushResult([]); // cache lookup (miss)
    mockDB.pushResult([], 1); // atomic daily-count reservation
    mockTextToSpeech.mockRejectedValue('raw string error');
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('Unknown error');
  });

  it('성공 시 201 + message_id, audio_base64, category 기본값 custom', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([72, 101]).buffer);
    mockDB.pushResult([], 1); // INSERT messages
    mockDB.pushResult([], 1); // UPDATE daily_tts_count
    mockDB.pushResult([], 1); // INSERT message_library
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message_id).toBeDefined();
    expect(body.audio_base64).toBeDefined();
    expect(body.audio_format).toBe('mp3');
    expect(body.voice_profile_id).toBe(V1);
    // category defaults to 'custom'
    const insertSql = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[6]).toBe('custom');
  });

  it('R2 bucket configured: stores generated TTS under a deterministic cache object key', async () => {
    const r2 = createMockR2Bucket();
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    mockDB.pushResult([], 1); // atomic daily-count reservation
    mockTextToSpeech.mockResolvedValue(new Uint8Array([72, 101]).buffer);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cache_hit).toBe(false);
    expect(body.cache_key).toBeDefined();
    expect(body.audio_object_key).toContain(`generated-tts/${encodeURIComponent('user-1')}/`);
    expect([...r2.store.keys()][0]).toBe(body.audio_object_key);
    expect(mockTextToSpeech).toHaveBeenCalledOnce();

    const cacheInsert = mockDB.calls.find((c) =>
      c.sql.includes('INSERT OR IGNORE INTO generated_audio_assets'),
    );
    expect(cacheInsert).toBeDefined();
    expect(cacheInsert!.args).toContain(body.cache_key);
  });

  it('generated audio cache hit skips provider calls and daily generation count', async () => {
    const objectKey = 'generated-tts/user-1/cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([67, 72]) });
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 3, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([
      {
        message_id: M1,
        provider: 'elevenlabs',
        text: 'hello',
        audio_url: `r2://${objectKey}`,
        audio_object_key: objectKey,
        audio_format: 'mp3',
      },
    ]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache_hit).toBe(true);
    expect(body.message_id).toBe(M1);
    expect(body.audio_base64).toBe('Q0g=');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
    expect(mockDB.calls.some((c) => c.sql.includes('daily_tts_count = daily_tts_count + 1'))).toBe(
      false,
    );
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO messages'))).toBe(false);
  });

  it('checks the provider cache key before enforcing the daily generation limit', async () => {
    const objectKey = 'generated-tts/user-1/eleven-cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([69, 76]) });
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 3, daily_tts_reset_at: today() }]);
    mockDB.pushResult([
      {
        id: V1,
        status: 'ready',
        elevenlabs_voice_id: 'el-voice-1',
      },
    ]);
    mockDB.pushResult([
      {
        message_id: M1,
        provider: 'elevenlabs',
        text: 'hello',
        audio_url: `r2://${objectKey}`,
        audio_object_key: objectKey,
        audio_format: 'mp3',
      },
    ]);

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache_hit).toBe(true);
    expect(body.provider).toBe('elevenlabs');
    expect(body.audio_base64).toBe('RUw=');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
    expect(mockDB.calls.some((c) => c.sql.includes('daily_tts_count = daily_tts_count + 1'))).toBe(
      false,
    );
  });

  it('성공 시 category 명시하면 해당 category 저장', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'test', category: 'morning' }),
    );
    expect(res.status).toBe(201);
    const insertSql = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[6]).toBe('morning');
  });

  it('수동 입력 문구에도 delivery tag가 자동 삽입된다', async () => {
    const text = '좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!';
    const taggedText = `[encouraging] ${text}`;
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([2]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text, category: 'custom' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe(text);
    expect(body.original_text).toBe(text);
    expect(body.synthesis_text).toBe(taggedText);
    expect(body.tags).toEqual(['encouraging']);
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(text);
    expect(inserted!.args[4]).toBe(taggedText);
    expect(inserted!.args[5]).toBe(JSON.stringify(['encouraging']));
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      taggedText,
      expect.objectContaining({
        model_id: 'eleven_v3',
        language_code: 'ko',
      }),
    );
    const ttsOptions = mockTextToSpeech.mock.calls[0][2];
    expect(ttsOptions).not.toHaveProperty('stability');
    expect(ttsOptions).not.toHaveProperty('similarity_boost');
    expect(ttsOptions).not.toHaveProperty('style');
    expect(ttsOptions).not.toHaveProperty('speed');
  });

  it('영어 직접 입력은 번역 없이 language_code=en 으로 합성한다', async () => {
    const text = 'Good morning! Wake up! I hope you have a great day!';
    const taggedText = `[warmly] ${text}`;
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([3]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text,
        category: 'custom',
        language: 'ko',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe(text);
    expect(body.original_text).toBe(text);
    expect(body.synthesis_text).toBe(taggedText);
    expect(body.tags).toEqual(['warmly']);
    expect(body.language).toBe('en');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      taggedText,
      expect.objectContaining({
        language_code: 'en',
      }),
    );
  });

  it('번역 요청인데 번역 설정이 없으면 원문 언어로 잘못 합성하지 않고 실패한다', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: '좋은 아침이에요!',
        category: 'custom',
        language: 'en',
        translate: true,
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('TRANSLATION_NOT_CONFIGURED');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('random=true 면 서버 프리셋 문구를 골라 TTS를 생성한다', async () => {
    mockDB.pushResult([
      {
        category: 'morning',
        label: '아침',
        emoji: 'sun',
        messages_json: JSON.stringify(['서버가 고른 아침 문구']),
      },
    ]);
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([7]).buffer);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'morning',
        random: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.original_text).toBe('서버가 고른 아침 문구');
    expect(body.text).toBe(body.original_text);
    expect(body.synthesis_text).toContain(body.original_text);
    expect(body.tags).toContain('warmly');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      body.synthesis_text,
      expect.any(Object),
    );
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(body.original_text);
    expect(inserted!.args[4]).toBe(body.synthesis_text);
    expect(inserted!.args[5]).toBe(JSON.stringify(body.tags));
    expect(inserted!.args[6]).toBe('morning');
  });

  it('random_context=wake_fortune creates a dynamic relationship-aware prompt', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([
      {
        id: V1,
        status: 'ready',
        elevenlabs_voice_id: 'el-voice-1',
        relationship_label: '손녀',
      },
    ]);
    mockDB.pushResult([]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([8]).buffer);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'morning',
        random: true,
        random_context: 'wake_fortune',
        fortune_gender: '여성',
        fortune_birth_date: '1950-05-19',
        fortune_birth_time: '07:30',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.random_context).toBe('wake_fortune');
    expect(body.original_text).toContain('일어나실 시간');
    expect(body.original_text).not.toContain('손녀 목소리');
    expect(body.original_text).not.toContain('생년월일');
    expect(body.original_text).not.toContain('태어난 시간');
    expect(body.synthesis_text).toContain(body.original_text);
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      body.synthesis_text,
      expect.any(Object),
    );
  });

  it('random_context=wake_fortune can use target user dynamic prompt settings', async () => {
    const contentResponses = [
      geminiText('{"text":"자기야, 오늘은 작은 행운이 온대."}'),
      geminiText('{"text":"[warmly] 자기야, 오늘은 작은 행운이 온대.","tags":["warmly"]}'),
    ];
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const next = contentResponses.shift();
      if (!next) throw new Error('no content response queued');
      return next;
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
      mockDB.pushResult([
        {
          id: V1,
          status: 'ready',
          elevenlabs_voice_id: 'el-voice-1',
          relationship_label: '여자친구',
        },
      ]);
      mockDB.pushResult([
        {
          id: 'user-1',
          dynamic_prompt_settings_json: JSON.stringify({
            fortune: { gender: '남성', birth_date: '1995-05-20', birth_time: '07:30' },
          }),
        },
      ]);
      mockDB.pushResult([]);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([9]).buffer);
      mockDB.pushResult([]);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);

      const app = buildApp();
      const res = await app.request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          category: 'morning',
          random: true,
          random_context: 'wake_fortune',
          target_user_id: 'user-1',
          fortune_gender: '   ',
          fortune_birth_date: '',
          fortune_birth_time: '   ',
          listener_title: '자기야',
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(201);
      const contentCall = mockFetch.mock.calls.find((c) => String(c[0]) !== TOKEN_URI);
      const requestBody = JSON.parse(String(contentCall?.[1]?.body));
      const prompt = requestBody.contents[0].parts[0].text;
      expect(prompt).toContain('birth date=1995-05-20');
      expect(prompt).toContain('birth time=07:30');
      const body = await res.json();
      expect(body.original_text).toBe('자기야, 오늘은 작은 행운이 온대.');
      expect(body.tags).toEqual(['warmly']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('random=true 에 custom category 면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, random: true, category: 'custom' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RANDOM_CATEGORY_REQUIRED');
  });

  it('text 정확히 200자면 허용', async () => {
    mockDB.pushResult([{ plan: 'plus', daily_tts_count: 0, daily_tts_reset_at: today() }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([0]).buffer);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'a'.repeat(200) }),
    );
    expect(res.status).toBe(201);
  });

  it('voice_profile_id 있고 text 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', { voice_profile_id: V1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });

  it('text 있고 voice_profile_id 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', { text: 'hello' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });

  it('free plan 일일 제한 미달이면 진행', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 2, daily_tts_reset_at: today() }]);
    mockDB.pushResult([]); // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('family plan은 사실상 무제한', async () => {
    mockDB.pushResult([{ plan: 'family', daily_tts_count: 9998, daily_tts_reset_at: today() }]);
    mockDB.pushResult([]); // voice_profiles: empty
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
    mockDB.pushResult([{ cnt: 0 }]); // alarm check
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key (정리할 R2 오브젝트 없음)
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
    const app = buildApp();
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[1].sql).toContain('DELETE FROM message_library');
    expect(mockDB.calls[2].sql).toContain('SELECT audio_object_key');
    expect(mockDB.calls[3].sql).toContain('DELETE FROM generated_audio_assets');
    expect(mockDB.calls[4].sql).toContain('DELETE FROM messages');
  });

  it('삭제 SQL에 user_id 포함 (사용자 격리)', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp('user-99');
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[1].args).toContain('user-99');
    expect(mockDB.calls[3].args).toContain('user-99');
    expect(mockDB.calls[4].args).toContain('user-99');
  });

  it('force=true이고 알람 0개여도 정상 삭제', async () => {
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
