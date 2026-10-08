// 목소리 높이 — **서버가 굽는다**(스펙 voice-and-message §4-3). 등록 확정 때 적은 높이를 그 목소리로 만드는 모든
// 알람 소리(프리셋·직접 입력)에 굽고, 앱은 받은 파일을 그대로 튼다. 이 파일은 굽는 부품을 고정한다:
// 행에서 읽기·모델 확인·PCM 변환·MP3 만들기·합성 갈래·캐시 키.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mp3EncoderWasm from 'wasm-media-encoders/wasm/mp3';

const mockTextToSpeech = vi.fn();
vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));

import { pitchTrack } from '@alarmtalk/voice';
import {
  appliedPitchSemitones,
  bakePitchMp3,
  encodeMp3,
  pcm16ToFloat32,
  PITCH_PCM_OUTPUT_FORMAT,
  PITCH_PCM_SAMPLE_RATE,
  registerMp3EncoderModule,
  shiftPcmPitch,
  voicePitchFromRow,
} from '../src/lib/voice-pitch';
import { createSynthesisAttempts } from '../src/lib/voice-provider';
import { computeTtsCacheKey } from '../src/lib/audio-cache';
import { TTS_MODEL_ID } from '../src/lib/tts-model';

/** 160 Hz 배음 소리(44.1 kHz, 16-bit 리틀엔디언 PCM) — ElevenLabs `pcm_44100` 이 주는 모양. */
function tonePcm(seconds = 1): Uint8Array {
  const sr = 44_100;
  const count = Math.round(sr * seconds);
  const out = new Uint8Array(count * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    const t = i / sr;
    const v = 0.4 * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 320 * t));
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true);
  }
  return out;
}

/** MPEG 오디오 프레임 동기(11비트 1) — LAME 출력은 프레임으로 바로 시작한다. */
function looksLikeMp3(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

beforeAll(() => {
  registerMp3EncoderModule(mp3EncoderWasm);
});

describe('행에서 높이 읽기(voicePitchFromRow)', () => {
  it('값이 없거나·0 이거나·범위 밖이면 굽지 않는다', () => {
    expect(voicePitchFromRow(null)).toBeNull();
    expect(voicePitchFromRow({})).toBeNull(); // 배포 창 — 컬럼이 아직 없다
    expect(voicePitchFromRow({ pitch_semitones: null })).toBeNull();
    expect(voicePitchFromRow({ pitch_semitones: 0 })).toBeNull();
    expect(voicePitchFromRow({ pitch_semitones: -6.5 })).toBeNull();
    expect(voicePitchFromRow({ pitch_semitones: 3.5 })).toBeNull();
    expect(voicePitchFromRow({ pitch_semitones: -1.25 })).toBeNull();
  });

  it('범위 안의 값과 그 모델을 읽는다', () => {
    expect(voicePitchFromRow({ pitch_semitones: -1.5, pitch_model_id: 'eleven_v4_turbo' })).toEqual({
      semitones: -1.5,
      modelId: 'eleven_v4_turbo',
    });
    // libSQL 이 REAL 을 문자열로 줄 때도 같다.
    expect(voicePitchFromRow({ pitch_semitones: '2.5', pitch_model_id: '' })).toEqual({ semitones: 2.5, modelId: null });
  });
});

describe('이번 합성에 굽는 높이(appliedPitchSemitones)', () => {
  it('등록 때의 모델과 지금 모델이 같을 때만 굽는다', () => {
    expect(appliedPitchSemitones({ semitones: -2, modelId: TTS_MODEL_ID }, TTS_MODEL_ID)).toBe(-2);
    // 높이는 그 모델이 낸 높이를 바로잡는 상대값이다 — 모델이 바뀌면 옛 보정을 걸지 않는다.
    expect(appliedPitchSemitones({ semitones: -2, modelId: 'eleven_v3' }, TTS_MODEL_ID)).toBe(0);
    expect(appliedPitchSemitones({ semitones: -2, modelId: null }, TTS_MODEL_ID)).toBe(0);
    expect(appliedPitchSemitones(null, TTS_MODEL_ID)).toBe(0);
  });
});

describe('PCM → MP3', () => {
  it('16-bit 리틀엔디언 PCM 을 [-1, 1) 실수로 바꾼다', () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01]); // −32768, 32767, 0, (남는 1바이트)
    const samples = pcm16ToFloat32(bytes);
    expect(samples.length).toBe(3);
    expect(samples[0]).toBe(-1);
    expect(samples[1]).toBeCloseTo(32767 / 32768, 6);
    expect(samples[2]).toBe(0);
  });

  it('MP3 128 kbps 로 만든다(높이 없는 목소리와 같은 형식·크기)', async () => {
    const mp3 = await encodeMp3(pcm16ToFloat32(tonePcm(2)), 44_100);
    expect(looksLikeMp3(mp3)).toBe(true);
    // 128 kbps × 2초 ≈ 32 KB(프레임 경계·지연 여유).
    expect(mp3.length).toBeGreaterThan(28_000);
    expect(mp3.length).toBeLessThan(40_000);
  });

  // 머리말(MP3 프레임)만 보면 부호가 뒤집히거나 표본률을 잘못 넘겨도 통과한다 — 실제 높이를 잰다.
  it('PCM 의 높이를 그 반음만큼 실제로 바꾼다(부호·표본률)', () => {
    const median = (samples: Float32Array) => {
      const voiced = Array.from(pitchTrack(samples, PITCH_PCM_SAMPLE_RATE).f0).filter((f) => f > 0).sort((a, b) => a - b);
      expect(voiced.length).toBeGreaterThan(20);
      return voiced[Math.floor(voiced.length / 2)]!;
    };
    const pcm = tonePcm(1);
    const original = median(pcm16ToFloat32(pcm));
    expect(original).toBeGreaterThan(155);
    expect(original).toBeLessThan(165);
    for (const semitones of [-2, 2]) {
      const shifted = median(shiftPcmPitch(pcm, semitones));
      const expected = original * Math.pow(2, semitones / 12);
      expect(Math.abs(shifted / expected - 1), `${semitones} 반음`).toBeLessThan(0.03);
    }
  });

  it('PCM 을 그 높이로 구워 MP3 로 돌려준다', async () => {
    const mp3 = await bakePitchMp3(tonePcm(1), -2);
    expect(looksLikeMp3(mp3)).toBe(true);
  });

  it('빈 PCM 은 던진다 — 원래 소리로 대신 올리지 않는다', async () => {
    await expect(bakePitchMp3(new Uint8Array(0), -2)).rejects.toThrow();
  });

  it('머리말 없는 16-bit 표본이 아니거나 지나치게 길면 던진다', () => {
    const pcm = tonePcm(0.2);
    expect(() => shiftPcmPitch(pcm.subarray(0, pcm.length - 1), -2)).toThrow('odd byte length');
    for (const header of ['RIFF', 'ID3']) {
      const wrapped = new Uint8Array(pcm.length);
      wrapped.set(pcm);
      wrapped.set(Array.from(header, (ch) => ch.charCodeAt(0)));
      expect(() => shiftPcmPitch(wrapped, -2), header).toThrow('container format');
    }
    // 60초를 넘는 소리는 합성이 잘못된 것이고, 굽는 메모리가 워커 한도에 다가간다.
    expect(() => shiftPcmPitch(new Uint8Array(PITCH_PCM_SAMPLE_RATE * 2 * 61), -2)).toThrow('longer than');
  });

  it('인코더를 다시 써도(동시에 굽더라도) 같은 소리는 같은 MP3 다', async () => {
    const a = pcm16ToFloat32(tonePcm(1));
    const b = pcm16ToFloat32(tonePcm(0.5));
    const first = await encodeMp3(a, 44_100);
    const [again, other] = await Promise.all([encodeMp3(a, 44_100), encodeMp3(b, 44_100)]);
    expect(Array.from(again)).toEqual(Array.from(first));
    expect(Array.from(other)).toEqual(Array.from(await encodeMp3(b, 44_100)));
  });
});

describe('합성 갈래(createSynthesisAttempts)', () => {
  beforeEach(() => {
    mockTextToSpeech.mockReset();
  });

  function attemptWith(pitch: Parameters<typeof createSynthesisAttempts>[0]['pitch'], bake = vi.fn()) {
    const attempts = createSynthesisAttempts({
      env: { ELEVENLABS_API_KEY: 'k' } as never,
      profile: { elevenlabs_voice_id: 'el-1' },
      text: '일어날 시간이야',
      language: 'ko',
      pitch,
      bake,
    });
    expect(attempts).toHaveLength(1);
    return { attempt: attempts[0]!, bake };
  }

  it('높이가 있으면 PCM 을 받아 굽고, 결과는 MP3 다', async () => {
    const pcm = tonePcm(0.5);
    mockTextToSpeech.mockResolvedValue(pcm.buffer);
    const baked = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
    const { attempt, bake } = attemptWith(
      { semitones: -1.5, modelId: TTS_MODEL_ID },
      vi.fn().mockResolvedValue(baked),
    );
    expect(attempt.pitchSemitones).toBe(-1.5);

    const result = await attempt.synthesize();
    expect(mockTextToSpeech).toHaveBeenCalledWith('el-1', '일어날 시간이야', {
      language_code: 'ko',
      output_format: PITCH_PCM_OUTPUT_FORMAT,
    });
    expect(bake).toHaveBeenCalledWith(new Uint8Array(pcm.buffer), -1.5);
    expect(result.bytes).toBe(baked);
    expect(result.outputFormat).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('높이가 없거나 모델이 다르면 예전처럼 MP3 를 받아 그대로 쓴다', async () => {
    for (const pitch of [null, { semitones: -1.5, modelId: 'eleven_v3' }]) {
      mockTextToSpeech.mockReset();
      const mp3 = new Uint8Array([0xff, 0xfb, 9, 9]);
      mockTextToSpeech.mockResolvedValue(mp3.buffer);
      const { attempt, bake } = attemptWith(pitch);
      expect(attempt.pitchSemitones).toBe(0);
      const result = await attempt.synthesize();
      // 예전 호출과 **같은 모양** — output_format 을 붙이지 않는다(기본 MP3).
      expect(mockTextToSpeech).toHaveBeenCalledWith('el-1', '일어날 시간이야', { language_code: 'ko' });
      expect(bake).not.toHaveBeenCalled();
      expect(Array.from(result.bytes)).toEqual(Array.from(mp3));
    }
  });

  it('굽기가 실패하면 던진다 — 원래 소리로 대신 돌려주지 않는다', async () => {
    mockTextToSpeech.mockResolvedValue(tonePcm(0.2).buffer);
    const { attempt } = attemptWith(
      { semitones: 2, modelId: TTS_MODEL_ID },
      vi.fn().mockRejectedValue(new Error('encoder failed')),
    );
    await expect(attempt.synthesize()).rejects.toThrow('encoder failed');
  });
});

describe('캐시 키', () => {
  const base = {
    provider: 'elevenlabs',
    providerVoiceId: 'el-1',
    voiceProfileId: 'vp-1',
    modelId: TTS_MODEL_ID,
    language: 'ko',
    text: '일어날 시간이야',
    outputFormat: 'mp3',
  };

  it('높이가 0 이거나 없으면 예전 키 그대로다', async () => {
    const before = await computeTtsCacheKey(base);
    expect(await computeTtsCacheKey({ ...base, pitchSemitones: 0 })).toBe(before);
    expect(await computeTtsCacheKey({ ...base, pitchSemitones: undefined })).toBe(before);
  });

  it('높이를 구운 소리는 원래 소리와 키를 나눠 쓰지 않는다', async () => {
    const plain = await computeTtsCacheKey(base);
    const tuned = await computeTtsCacheKey({ ...base, pitchSemitones: -1.5 });
    expect(tuned).not.toBe(plain);
    expect(await computeTtsCacheKey({ ...base, pitchSemitones: -2 })).not.toBe(tuned);
  });
});
