import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmMutation from '../src/routes/alarm-mutation';
import ttsRoutes from '../src/routes/tts';
import voiceProfileRoutes from '../src/routes/voice-profile';
import voiceUploadRoutes from '../src/routes/voice-upload';

function authWithResolvedPk(userId = 'user-1', userPk = 'user-pk-1') {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userIdPK', userPk);
    c.set('userEmail', 'user@test.com');
    c.set('userName', 'Test User');
    c.set('userPicture', '');
    await next();
  };
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authWithResolvedPk());
  app.route('/alarms', alarmMutation);
  app.route('/tts', ttsRoutes);
  app.route('/vp', voiceProfileRoutes);
  app.route('/vu', voiceUploadRoutes);
  return app;
}

function cloneRequest(): Request {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'sample.wav');
  form.append('name', '테스트');
  form.append('durationMs', '90000');
  return new Request('http://localhost/vp/clone', { method: 'POST', body: form });
}

function uploadRequest(): Request {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'sample.wav');
  form.append('durationMs', '90000');
  return new Request('http://localhost/vu/upload', { method: 'POST', body: form });
}

beforeEach(() => {
  mockDB.reset();
});

describe('paid voice access gates', () => {
  it('blocks TTS generation for a resolved free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free', daily_tts_count: 0, daily_tts_reset_at: '2026-05-18' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: ID.alarm, text: 'hello' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('blocks voice cloning for a resolved free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(cloneRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('blocks voice upload and diarization setup for a resolved free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(uploadRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('blocks voice alarms for a resolved free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        message_id: ID.message,
        mode: 'tts',
        wake_mode: 'sound_then_voice',
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });
});
