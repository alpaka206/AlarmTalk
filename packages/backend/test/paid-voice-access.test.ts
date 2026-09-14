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

  // **직접 녹음 알람은 유료 기능이 아니다**(2026-08-12 확정).
  //
  // 사용자가 자기 폰에 녹음한 소리는 서버에 올라오지 않는다 — 양 앱의 `RemoteAlarmMapper`
  // 가 `mode: hasRemoteVoice ? 'tts' : 'sound-only'` 로 보내고 `hasRemoteVoice` 는
  // `ttsMessageId != null` 이라, 녹음 알람에는 `message_id` 도 `voice_profile_id` 도 없다.
  //
  // ⚠ 예전에는 `alarmUsesPaidVoice` 가 `wake_mode === 'voice_only'` 만 보고 403 을 냈다.
  // 그러면 무료 사용자의 녹음 알람이 **서버에서 거절돼 로컬에만 남고 sync 가 영구히
  // 실패**한다(앱에는 저장된 것처럼 보인다). 그 항을 지운 것을 여기서 고정한다.
  it('allows a free-plan user to save a locally recorded voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        // 서버가 아는 유료 자산이 하나도 없다 — 음원은 기기에만 있다.
        mode: 'sound-only',
        wake_mode: 'voice_only',
      }),
    );

    expect(res.status).not.toBe(403);
  });

  // 반대 방향 — 이 완화가 **클론 목소리까지 열어 주면 안 된다.**
  it('still blocks a free-plan user from a clone-voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        voice_profile_id: ID.alarm,
        mode: 'sound-only',
        wake_mode: 'voice_only',
      }),
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

  // F2: 유료 사용자가 '기본(시스템) 목소리'를 고르면 무료처럼 프리셋(날씨/약)만 허용한다 —
  // 직접 입력(커스텀 텍스트)은 차단(BASIC_VOICE_PRESET_ONLY). 이렇게 커스텀 클론 슬롯 공간을 아낀다.
  // ⚠ **이 테스트가 옛 제한을 고정하고 있었다**(2026-08-11 뒤집음).
  // 유료 사용자가 기본(시스템) 목소리를 고르면 직접 입력이 막혔는데, 이용권을 산 사람이
  // **왜 안 되는지 알 수 없는 벽**을 만나는 자리였다. 시스템 보이스에도
  // `elevenlabs_voice_id` 가 있어 말할 수는 있고, 막던 이유(비용)는 **직접 입력 월 한도**가
  // 이미 세고 있다 — 한도를 차감하는 조건으로 열었다.
  it('lets a paid user type custom text with a basic (system) voice', async () => {
    mockDB.pushResult([{ plan: 'plus' }]); // 유료 사용자
    mockDB.pushResult([]); // findUsableVoiceProfile: 본인 소유 보이스 없음
    // findUsableVoiceProfile: 시스템(기본) 보이스
    mockDB.pushResult([{ id: ID.alarm, user_id: 'system-user', status: 'ready', is_system: 1 }]);

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: ID.alarm, text: 'hello' }),
    );

    // 프리셋 게이트를 통과했음만 본다(그 뒤 동의·합성 단계에서 다른 응답이 날 수 있다).
    expect((await res.json()).error_code).not.toBe('BASIC_VOICE_PRESET_ONLY');
  });

  // 열린 것은 **직접 입력뿐**이다 — 동적 문구(날씨·운세)는 여전히 막는다.
  // 그쪽은 매번 새로 만들어야 해서 월 한도로 셀 수 없다.
  it('still blocks translation on a basic (system) voice even for a paid user', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ id: ID.alarm, user_id: 'system-user', status: 'ready', is_system: 1 }]);

    const res = await buildApp().request(
      // 번역은 매번 새로 만들어야 해서 한도로 셀 수 없다 — 기본 목소리에는 여전히 막힌다.
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: ID.alarm,
        text: 'hello',
        translate: true,
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('BASIC_VOICE_PRESET_ONLY');
  });

  // F2 대비군: 유료 사용자가 '자기 커스텀 클론'(is_system=0)을 고르면 직접 입력은 F2 프리셋
  // 게이트에 걸리지 않는다(=BASIC_VOICE_PRESET_ONLY 아님). 커스텀 클론은 전체 기능 사용 가능.
  it('does not apply the basic-voice preset gate to a paid user with their own custom clone', async () => {
    mockDB.pushResult([{ plan: 'plus' }]); // 유료 사용자
    // findUsableVoiceProfile: 본인 소유 커스텀 클론(is_system=0)
    mockDB.pushResult([{ id: ID.alarm, user_id: 'user-pk-1', status: 'ready', is_system: 0 }]);

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: ID.alarm, text: 'hello' }),
    );

    // F2 게이트를 통과했음만 검증한다(그 뒤 동의/합성 단계에서 다른 응답이 날 수 있음).
    expect((await res.json()).error_code).not.toBe('BASIC_VOICE_PRESET_ONLY');
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

  // **직접 녹음 알람은 유료 기능이 아니다**(2026-08-12 확정).
  //
  // 사용자가 자기 폰에 녹음한 소리는 서버에 올라오지 않는다 — 양 앱의 `RemoteAlarmMapper`
  // 가 `mode: hasRemoteVoice ? 'tts' : 'sound-only'` 로 보내고 `hasRemoteVoice` 는
  // `ttsMessageId != null` 이라, 녹음 알람에는 `message_id` 도 `voice_profile_id` 도 없다.
  //
  // ⚠ 예전에는 `alarmUsesPaidVoice` 가 `wake_mode === 'voice_only'` 만 보고 403 을 냈다.
  // 그러면 무료 사용자의 녹음 알람이 **서버에서 거절돼 로컬에만 남고 sync 가 영구히
  // 실패**한다(앱에는 저장된 것처럼 보인다). 그 항을 지운 것을 여기서 고정한다.
  it('allows a free-plan user to save a locally recorded voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        // 서버가 아는 유료 자산이 하나도 없다 — 음원은 기기에만 있다.
        mode: 'sound-only',
        wake_mode: 'voice_only',
      }),
    );

    expect(res.status).not.toBe(403);
  });

  // 반대 방향 — 이 완화가 **클론 목소리까지 열어 주면 안 된다.**
  it('still blocks a free-plan user from a clone-voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        voice_profile_id: ID.alarm,
        mode: 'sound-only',
        wake_mode: 'voice_only',
      }),
    );

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

  // **직접 녹음 알람은 유료 기능이 아니다**(2026-08-12 확정).
  //
  // 사용자가 자기 폰에 녹음한 소리는 서버에 올라오지 않는다 — 양 앱의 `RemoteAlarmMapper`
  // 가 `mode: hasRemoteVoice ? 'tts' : 'sound-only'` 로 보내고 `hasRemoteVoice` 는
  // `ttsMessageId != null` 이라, 녹음 알람에는 `message_id` 도 `voice_profile_id` 도 없다.
  //
  // ⚠ 예전에는 `alarmUsesPaidVoice` 가 `wake_mode === 'voice_only'` 만 보고 403 을 냈다.
  // 그러면 무료 사용자의 녹음 알람이 **서버에서 거절돼 로컬에만 남고 sync 가 영구히
  // 실패**한다(앱에는 저장된 것처럼 보인다). 그 항을 지운 것을 여기서 고정한다.
  it('allows a free-plan user to save a locally recorded voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        // 서버가 아는 유료 자산이 하나도 없다 — 음원은 기기에만 있다.
        mode: 'sound-only',
        wake_mode: 'voice_only',
      }),
    );

    expect(res.status).not.toBe(403);
  });

  // 반대 방향 — 이 완화가 **클론 목소리까지 열어 주면 안 된다.**
  it('still blocks a free-plan user from a clone-voice alarm', async () => {
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:30',
        voice_profile_id: ID.alarm,
        mode: 'sound-only',
        wake_mode: 'voice_only',
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
