// 합성 모델 id 는 워커 변수 `ELEVENLABS_TTS_MODEL_ID` 로 바꿀 수 있지만 **기본은 eleven_v3** 다(스펙
// `docs/spec/voice-and-message.md` §10). 게시된 클립이 전부 v3 라 비워 두는 것이 운영값이다 — 기본값이
// 흔들리면 스톡 게시 스크립트(`MODEL_ID = 'eleven_v3'`)와 캐시 키가 갈라진다.
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
    text: '[cheerfully] 일어나',
    language: 'ko',
  });
  expect(attempts).toHaveLength(1);
  return attempts[0]!;
}

describe('합성 모델 id — ELEVENLABS_TTS_MODEL_ID', () => {
  beforeEach(() => {
    mockTextToSpeech.mockReset();
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1]).buffer);
  });

  it('비어 있으면 eleven_v3 로 합성하고, 캐시 키에 들어갈 modelId 도 같다', async () => {
    for (const value of [undefined, '', '   ']) {
      mockTextToSpeech.mockClear();
      const attempt = attemptFor({ ELEVENLABS_TTS_MODEL_ID: value });
      expect(attempt.modelId).toBe('eleven_v3');
      const result = await attempt.synthesize();
      expect(result.modelId).toBe('eleven_v3');
      expect(mockTextToSpeech).toHaveBeenCalledWith(
        'voice-1',
        '[cheerfully] 일어나',
        expect.objectContaining({ model_id: 'eleven_v3' }),
      );
    }
  });

  it('값이 있으면 그 모델로 합성하고 modelId(캐시 키)도 그 값이다', async () => {
    const attempt = attemptFor({ ELEVENLABS_TTS_MODEL_ID: ' eleven_v4 ' });
    expect(attempt.modelId).toBe('eleven_v4');
    const result = await attempt.synthesize();
    expect(result.modelId).toBe('eleven_v4');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'voice-1',
      '[cheerfully] 일어나',
      expect.objectContaining({ model_id: 'eleven_v4' }),
    );
  });
});
