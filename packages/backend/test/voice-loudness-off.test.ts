// 음량을 0 으로 되돌리면(`TTS_LOUDNESS_BOOST_DB = 0` — 모델을 바꿔 다시 재고 올릴 필요가 없을 때) 높이 없는 목소리는
// 2026-10-08 전처럼 제공자 MP3 를 그대로 받아 쓰고, 캐시 키도 그때와 같다(스펙 voice-and-message §10). 굽는 갈래가
// '음량이 0 보다 큰가' 로만 갈리는지를 고정한다 — 상수 하나를 바꿔 되돌릴 수 있어야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextToSpeech = vi.fn();
vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));
vi.mock('../src/lib/tts-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/tts-model')>()),
  TTS_LOUDNESS_BOOST_DB: 0,
}));

import { TTS_MODEL_ID } from '../src/lib/tts-model';
import { bakeVoiceMp3, SYNTHESIS_PCM_OUTPUT_FORMAT, type VoicePitch } from '../src/lib/voice-pitch';
import { createSynthesisAttempts } from '../src/lib/voice-provider';
import { tonePcm } from './support/provider-pcm';

function attemptWith(pitch: VoicePitch | null) {
  const attempts = createSynthesisAttempts({
    env: { ELEVENLABS_API_KEY: 'k' } as never,
    profile: { elevenlabs_voice_id: 'el-1' },
    text: '일어날 시간이야',
    language: 'ko',
    pitch,
  });
  expect(attempts).toHaveLength(1);
  return attempts[0]!;
}

describe('음량 0 — 올리지 않는다', () => {
  beforeEach(() => {
    mockTextToSpeech.mockReset();
  });

  it('높이 없는 목소리는 제공자 MP3 를 그대로 쓴다 — output_format 을 붙이지 않는다', async () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 9, 9, 9]);
    mockTextToSpeech.mockResolvedValue(mp3.buffer);
    const attempt = attemptWith(null);
    expect(attempt.pitchSemitones).toBe(0);
    expect(attempt.loudnessBoostDb).toBe(0);

    const result = await attempt.synthesize();
    expect(mockTextToSpeech).toHaveBeenCalledWith('el-1', '일어날 시간이야', { language_code: 'ko' });
    expect(Array.from(result.bytes)).toEqual(Array.from(mp3));
  });

  it('높이가 있으면 높이만 굽는다', async () => {
    const pcm = tonePcm(0.5, 0.1);
    mockTextToSpeech.mockResolvedValue(pcm.buffer);
    const attempt = attemptWith({ semitones: 2, modelId: TTS_MODEL_ID });
    expect(attempt.pitchSemitones).toBe(2);
    expect(attempt.loudnessBoostDb).toBe(0);

    const result = await attempt.synthesize();
    expect(mockTextToSpeech).toHaveBeenCalledWith('el-1', '일어날 시간이야', {
      language_code: 'ko',
      output_format: SYNTHESIS_PCM_OUTPUT_FORMAT,
    });
    expect(Array.from(result.bytes)).toEqual(
      Array.from(await bakeVoiceMp3(pcm, { pitchSemitones: 2, loudnessBoostDb: 0 })),
    );
  });
});
