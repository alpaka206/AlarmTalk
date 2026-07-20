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
  form.append('isDraft', 'true');
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
  it('blocks TTS generation with a personal voice for a resolved free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free' }]);
    // findUsableVoiceProfile: 본인 소유의 (시스템이 아닌) 보이스
    mockDB.pushResult([{ id: ID.alarm, user_id: 'user-pk-1', status: 'ready', is_system: 0 }]);

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: ID.alarm, text: 'hello' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('blocks custom-text TTS with a system stock voice for a free-plan user', async () => {
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([]); // findUsableVoiceProfile: owned 보이스 없음
    // findUsableVoiceProfile: 시스템 스톡 보이스
    mockDB.pushResult([{ id: ID.alarm, user_id: 'system-user', status: 'ready', is_system: 1 }]);

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: ID.alarm, text: 'hello' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FREE_PLAN_PRESET_ONLY');
  });

  it('blocks voice cloning for a resolved free-plan user', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(cloneRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
    expect(mockDB.calls.some((call) => /FROM user_consents/i.test(call.sql))).toBe(false);
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

  // GET /tts/messages/:id/audio 의 무료 잠금: 다운그레이드로 유료 데이터를 지우지 않고 보존만 하므로,
  // 오디오 서빙 경로가 보이스 소유자의 plan 을 강제하지 않으면 무료 사용자가 유료 합성 오디오를
  // 직접 내려받는 우회가 생긴다(Codex #594 P1). 소유자 plan 기준으로 잠근다.
  function audioRow(overrides: Record<string, unknown>) {
    return {
      id: ID.message,
      user_id: 'user-pk-1',
      voice_profile_id: ID.alarm,
      text: 'hi',
      synthesis_text: 'hi',
      delivery_tags_json: null,
      audio_url: 'r2://generated/x.mp3',
      category: 'custom',
      is_system: 0,
      owner_plan: 'plus',
      ...overrides,
    };
  }

  it('locks retained paid-voice audio when the voice owner is on the free plan', async () => {
    mockDB.pushResult([audioRow({ is_system: 0, owner_plan: 'free' })]);

    const res = await buildApp().request(
      new Request(`http://localhost/tts/messages/${ID.message}/audio`),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_LOCKED_FREE_PLAN');
  });

  it('serves paid-voice audio when the voice owner is still on a paid plan', async () => {
    // audio_url=null 이면 잠금 게이트를 통과한 뒤 404(오디오 없음)로 떨어진다 — R2 목 없이
    // '게이트를 통과했다'만 검증한다(403 이 아님).
    mockDB.pushResult([audioRow({ is_system: 0, owner_plan: 'plus', audio_url: null })]);

    const res = await buildApp().request(
      new Request(`http://localhost/tts/messages/${ID.message}/audio`),
    );

    expect(res.status).not.toBe(403);
    expect((await res.json()).error_code).toBe('MESSAGE_AUDIO_MISSING');
  });

  it('never locks system stock voice audio even for a free-plan owner', async () => {
    mockDB.pushResult([audioRow({ is_system: 1, owner_plan: 'free', audio_url: null })]);

    const res = await buildApp().request(
      new Request(`http://localhost/tts/messages/${ID.message}/audio`),
    );

    expect(res.status).not.toBe(403);
    expect((await res.json()).error_code).toBe('MESSAGE_AUDIO_MISSING');
  });
});
