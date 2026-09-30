// 합성 모델 id 는 코드 상수 `TTS_MODEL_ID`(`lib/tts-model.ts`, eleven_v4_turbo) 하나가 정한다(스펙
// `docs/spec/voice-and-message.md` §10). 워커 변수 `ELEVENLABS_TTS_MODEL_ID` 로 바꾸던 길은 없앴다 — 그 값이
// 남아 있으면 서버와 스톡 스크립트의 캐시 키·지문이 서로 다른 모델을 가리키게 된다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextToSpeech = vi.fn();

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));

import { createSynthesisAttempts } from '../src/lib/voice-provider';

function attemptFor(env: Record<string, string | undefined>) {
  const attempts = createSynthesisAttempts({
    env: { ELEVENLABS_API_KEY: 'test-key', ...env } as never,
    profile: { elevenlabs_voice_id: 'voice-1' },
    text: '일어나',
    language: 'ko',
  });
  expect(attempts).toHaveLength(1);
  return attempts[0]!;
}

describe('합성 모델 id — 코드 상수 eleven_v4_turbo', () => {
  beforeEach(() => {
    mockTextToSpeech.mockReset();
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1]).buffer);
  });

  it('eleven_v4_turbo 로 합성하고, 캐시 키에 들어갈 modelId 도 같다', async () => {
    const attempt = attemptFor({});
    expect(attempt.modelId).toBe('eleven_v4_turbo');
    const result = await attempt.synthesize();
    expect(result.modelId).toBe('eleven_v4_turbo');
    expect(mockTextToSpeech).toHaveBeenCalledWith('voice-1', '일어나', { language_code: 'ko' });
  });

  it('워커에 옛 ELEVENLABS_TTS_MODEL_ID 가 남아 있어도 무시한다', async () => {
    const attempt = attemptFor({ ELEVENLABS_TTS_MODEL_ID: 'eleven_v3' });
    expect(attempt.modelId).toBe('eleven_v4_turbo');
    const result = await attempt.synthesize();
    expect(result.modelId).toBe('eleven_v4_turbo');
  });
});
