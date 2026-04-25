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
