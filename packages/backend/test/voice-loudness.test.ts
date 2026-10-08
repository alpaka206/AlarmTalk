// 합성한 소리의 음량 — **모든 합성을 `TTS_LOUDNESS_BOOST_DB` 만큼 올린다**(스펙 voice-and-message §10, 2026-10-08
// 오너 결정). eleven_v4_turbo 는 같은 목소리·같은 문장을 v3 보다 작게 낸다(§10 「위험」 — 기본 목소리 중앙 −4.1 dB). 서버는 PCM 을 받아
// (높이 →) 음량 → MP3 차례로 굽고, 기본 목소리 게시본·앱 번들 인사말도 같은 셈(`boostLoudness`)·같은 값을 쓴다 —
// 갈리면 미리듣기와 알람의 크기가 달라진다. 이 파일은 서버 쪽을 고정한다: 올리는 셈·봉우리 상한·차례·합성 갈래가
// 언제나 PCM 을 받는가·캐시 키. 음량을 0 으로 두었을 때의 옛 갈래는 `voice-loudness-off.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextToSpeech = vi.fn();
vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));

import { boostLoudness, integratedLoudness, shiftVoicePitch } from '@alarmtalk/voice';
import { computeTtsCacheKey, STOCK_TTS_CACHE_SCOPE } from '../src/lib/audio-cache';
import { TTS_LOUDNESS_BOOST_DB, TTS_MODEL_ID } from '../src/lib/tts-model';
import {
  bakeVoiceMp3,
  bakeVoiceSamples,
  encodeMp3,
  needsVoiceBake,
  pcm16ToFloat32,
  SYNTHESIS_PCM_OUTPUT_FORMAT,
  SYNTHESIS_PCM_SAMPLE_RATE as SR,
  type VoicePitch,
} from '../src/lib/voice-pitch';
import { createSynthesisAttempts } from '../src/lib/voice-provider';
import { looksLikeMp3, tonePcm } from './support/provider-pcm';

const BOOST_GAIN = Math.pow(10, TTS_LOUDNESS_BOOST_DB / 20);
/** 봉우리 상한(−0.2 dBFS) — `boostLoudness`·`shiftVoicePitch` 와 같은 값. */
const PEAK_LIMIT = Math.fround(0.977);
const served = (pitchSemitones: number) => ({ pitchSemitones, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB });

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

function loudnessGainDb(after: Float32Array, before: Float32Array): number {
  return integratedLoudness(after, SR)! - integratedLoudness(before, SR)!;
}

describe('올리는 셈(bakeVoiceSamples)', () => {
  it('높이 없는 소리도 받은 소리보다 정확히 그 dB 만큼 크다 — 앱·게시본과 같은 셈(boostLoudness)', () => {
    const pcm = tonePcm(0.5, 0.05); // 봉우리 ≈0.065 — 상한까지 여유가 있다
    const original = pcm16ToFloat32(pcm);
    const baked = bakeVoiceSamples(pcm, served(0));

    expect(baked.length).toBe(original.length);
    const gain = peakOf(baked) / peakOf(original);
    expect(gain).toBeGreaterThan(1);
    expect(gain).toBeCloseTo(BOOST_GAIN, 5);
    expect(loudnessGainDb(baked, original)).toBeCloseTo(TTS_LOUDNESS_BOOST_DB, 2);
    // 다른 셈을 쓰지 않는다 — 기본 목소리 게시본·앱 번들 인사말이 쓰는 그 함수 그대로다.
    expect(Array.from(baked)).toEqual(Array.from(boostLoudness(original, TTS_LOUDNESS_BOOST_DB).samples));
  });

  it('봉우리가 −0.2 dBFS 에 닿으면 그 직전까지만 올린다 — 자르지 않는다', () => {
    const pcm = tonePcm(0.5, 0.7); // 봉우리 ≈0.91 — 4 dB 를 다 올리면 1 을 넘는다
    const original = pcm16ToFloat32(pcm);
    const baked = bakeVoiceSamples(pcm, served(0));

    expect(peakOf(baked)).toBeLessThanOrEqual(PEAK_LIMIT + 1e-6);
    expect(peakOf(baked)).toBeCloseTo(PEAK_LIMIT, 4);
    const gain = peakOf(baked) / peakOf(original);
    expect(gain).toBeGreaterThan(1);
    expect(gain).toBeLessThan(BOOST_GAIN);
  });

  it('높이를 먼저 바꾸고(원래 크기로 되맞춤) 음량을 마지막에 올린다', () => {
    const pcm = tonePcm(1, 0.1);
    const original = pcm16ToFloat32(pcm);
    const baked = bakeVoiceSamples(pcm, served(-2));

    const pitchThenBoost = boostLoudness(shiftVoicePitch(original, SR, -2), TTS_LOUDNESS_BOOST_DB).samples;
    expect(Array.from(baked)).toEqual(Array.from(pitchThenBoost));
    // 차례를 바꾸면(음량 → 높이) 높이 바꾸기의 크기 되맞춤이 올린 크기를 기준으로 삼아 표본이 같지 않다 — 위 단언이
    // 차례를 실제로 가려낸다는 뜻이다.
    const boostThenPitch = shiftVoicePitch(boostLoudness(original, TTS_LOUDNESS_BOOST_DB).samples, SR, -2);
    expect(Array.from(baked)).not.toEqual(Array.from(boostThenPitch));
    // 높이가 있어도 결과는 받은 소리보다 그 dB 만큼 크다(되맞춤이 원래 크기로 돌려놓은 뒤 올리므로).
    expect(loudnessGainDb(baked, original)).toBeCloseTo(TTS_LOUDNESS_BOOST_DB, 1);
  });

  it('구운 표본을 MP3 128 kbps 로 묶는다 — 올리지 않은 소리와 다른 바이트다', async () => {
    const pcm = tonePcm(0.5, 0.1);
    const mp3 = await bakeVoiceMp3(pcm, served(0));
    expect(looksLikeMp3(mp3)).toBe(true);
    expect(Array.from(mp3)).toEqual(Array.from(await encodeMp3(bakeVoiceSamples(pcm, served(0)), SR)));
    expect(Array.from(mp3)).not.toEqual(Array.from(await encodeMp3(pcm16ToFloat32(pcm), SR)));
  });

  it('높이든 음량이든 하나라도 있으면 굽는다', () => {
    expect(needsVoiceBake(served(0))).toBe(true);
    expect(needsVoiceBake({ pitchSemitones: -1.5, loudnessBoostDb: 0 })).toBe(true);
    expect(needsVoiceBake({ pitchSemitones: 0, loudnessBoostDb: 0 })).toBe(false);
  });
});

describe('합성 갈래 — 모든 합성이 PCM 을 받아 굽는다(createSynthesisAttempts)', () => {
  beforeEach(() => {
    mockTextToSpeech.mockReset();
  });

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

  // 예전에는 높이 없는 목소리가 output_format 을 빼고 제공자 MP3 를 그대로 받았다 — 그 소리는 올릴 수 없다.
  it('높이 없는 목소리도 PCM 을 받아 음량을 올린 MP3 를 돌려준다 — output_format 을 빼지 않는다', async () => {
    const pcm = tonePcm(0.3, 0.05);
    mockTextToSpeech.mockResolvedValue(pcm.buffer);
    const attempt = attemptWith(null);
    expect(attempt.pitchSemitones).toBe(0);
    expect(attempt.loudnessBoostDb).toBe(TTS_LOUDNESS_BOOST_DB);
    expect(attempt.outputFormat).toBe('mp3');

    const result = await attempt.synthesize();
    expect(mockTextToSpeech).toHaveBeenCalledTimes(1);
    expect(mockTextToSpeech).toHaveBeenCalledWith('el-1', '일어날 시간이야', {
      language_code: 'ko',
      output_format: SYNTHESIS_PCM_OUTPUT_FORMAT,
    });
    expect(result.outputFormat).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(Array.from(result.bytes)).toEqual(Array.from(await bakeVoiceMp3(pcm, served(0))));
  });

  it('높이가 있으면 높이를 굽고 같은 음량을 올린다 — 굽는 값이 attempt 에 실린다', async () => {
    const pcm = tonePcm(0.5, 0.1);
    mockTextToSpeech.mockResolvedValue(pcm.buffer);
    const attempt = attemptWith({ semitones: -1.5, modelId: TTS_MODEL_ID });
    expect(attempt.pitchSemitones).toBe(-1.5);
    expect(attempt.loudnessBoostDb).toBe(TTS_LOUDNESS_BOOST_DB);

    const result = await attempt.synthesize();
    expect(Array.from(result.bytes)).toEqual(Array.from(await bakeVoiceMp3(pcm, served(-1.5))));
  });

  // 실패를 받은 소리로 메우면 그 문구는 '완료' 로 남아 영영 작은 소리로 운다(사전렌더는 다시 굽지 않는다).
  it('PCM 이 아니면 던진다 — 올리지 않은 소리로 대신 돌려주지 않는다', async () => {
    const mp3Like = new Uint8Array(64);
    mp3Like.set(Array.from('ID3', (ch) => ch.charCodeAt(0)));
    for (const [audio, message] of [
      [mp3Like, 'container format'],
      [new Uint8Array([1, 2, 3]), 'odd byte length'],
      [new Uint8Array(0), 'empty PCM'],
    ] as const) {
      mockTextToSpeech.mockReset();
      mockTextToSpeech.mockResolvedValue(audio.buffer);
      await expect(attemptWith(null).synthesize(), message).rejects.toThrow(message);
    }
  });
});

describe('캐시 키 — 올린 음량은 따로 들어간다', () => {
  const base = {
    provider: 'elevenlabs',
    providerVoiceId: 'el-1',
    voiceProfileId: 'vp-1',
    modelId: TTS_MODEL_ID,
    language: 'ko',
    text: '일어날 시간이야',
    outputFormat: 'mp3',
    scope: STOCK_TTS_CACHE_SCOPE,
  };

  it('음량이 0 이거나 없으면 예전 키 그대로다 — 올리지 않은 소리의 키는 바뀌지 않는다', async () => {
    const before = await computeTtsCacheKey(base);
    expect(await computeTtsCacheKey({ ...base, loudnessBoostDb: 0 })).toBe(before);
    expect(await computeTtsCacheKey({ ...base, loudnessBoostDb: undefined })).toBe(before);
    expect(await computeTtsCacheKey({ ...base, pitchSemitones: 0, loudnessBoostDb: 0 })).toBe(before);
  });

  it('올린 소리는 올리기 전 소리와 키를 나눠 쓰지 않는다 — 높이와 따로 갈린다', async () => {
    const keys = await Promise.all([
      computeTtsCacheKey(base),
      computeTtsCacheKey({ ...base, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }),
      computeTtsCacheKey({ ...base, pitchSemitones: -1.5 }),
      computeTtsCacheKey({ ...base, pitchSemitones: -1.5, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }),
      computeTtsCacheKey({ ...base, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB + 1 }),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    // 결정적이다 — 같은 입력은 같은 키다(게시 스크립트가 서버와 같은 키를 다시 계산한다).
    expect(await computeTtsCacheKey({ ...base, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB })).toBe(keys[1]);
  });

  it('합성 갈래가 실은 값으로 만든 키는 지금 음량을 담는다', async () => {
    const attempt = createSynthesisAttempts({
      env: { ELEVENLABS_API_KEY: 'k' } as never,
      profile: { elevenlabs_voice_id: 'el-1' },
      text: base.text,
      language: 'ko',
    })[0]!;
    const fromAttempt = await computeTtsCacheKey({
      ...base,
      provider: attempt.provider,
      modelId: attempt.modelId,
      outputFormat: attempt.outputFormat,
      pitchSemitones: attempt.pitchSemitones,
      loudnessBoostDb: attempt.loudnessBoostDb,
    });
    expect(fromAttempt).toBe(await computeTtsCacheKey({ ...base, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }));
    expect(fromAttempt).not.toBe(await computeTtsCacheKey(base));
  });
});
