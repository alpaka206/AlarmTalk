// `scripts/mp3-loudness-boost.ts` — 들어 본 MP3 에 서버와 같은 음량 올리기를 거는 길(기본 목소리 게시본·번들 인사말).
//
// 풀기(afconvert)는 macOS 에만 있어 여기서는 대역 디코더를 넘긴다. 나머지 — MP3 생김새 읽기, 인코더 지연·채움 걷어 내기,
// 표지, 서버와 같은 셈·같은 인코더로 묶기, 두 번 올리지 않기 — 는 CI 에서 그대로 돈다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { boostLoudness } from '@alarmtalk/voice';

import {
  AlreadyBoostedError,
  boostMp3,
  ENCODER_DELAY_SAMPLES,
  loudnessStats,
  LOUDNESS_BOOST_MARKER,
  MP3_FRAME_SAMPLES,
  readFloat32MonoWav,
  readLoudnessBoostMarker,
  readMp3Layout,
  trimBoostedDecode,
  trimToGaplessAudio,
  withLoudnessBoostMarker,
} from '../scripts/mp3-loudness-boost.ts';
import { TTS_LOUDNESS_BOOST_DB } from '../src/lib/tts-model';
import { encodeMp3, SYNTHESIS_PCM_SAMPLE_RATE } from '../src/lib/voice-pitch';
import { computeTtsCacheKey, generatedTtsObjectKey, STOCK_TTS_CACHE_SCOPE } from '../src/lib/audio-cache';
import { SYSTEM_VOICE_LIBRARY_USER_ID } from '../src/lib/stock-clips';

const RATE = SYNTHESIS_PCM_SAMPLE_RATE;
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** ElevenLabs(ffmpeg)가 붙이는 것과 같은 모양의 ID3v2.4 — TSSE 하나. */
function providerId3(): Uint8Array {
  const body = [3, ...ascii('Lavf60.16.101'), 0];
  const frame = [...ascii('TSSE'), 0, 0, 0, body.length, 0, 0, ...body];
  const padded = [...frame, ...new Array(35 - frame.length).fill(0)];
  return Uint8Array.from([...ascii('ID3'), 4, 0, 0, 0, 0, 0, 35, ...padded]);
}

/** 128 kbps·44.1 kHz·모노 Info 프레임(417바이트) — LAME 확장에 지연·채움을 적는다(ffmpeg 가 쓰는 모양). */
function infoFrame(audioFrames: number, delay: number, padding: number): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0], 0);
  let p = 4 + 17;
  frame.set(ascii('Info'), p);
  p += 4;
  frame.set([0, 0, 0, 0x0f], p); // 프레임 수·바이트 수·목차·품질
  p += 4;
  new DataView(frame.buffer).setUint32(p, audioFrames);
  p += 4 + 4 + 100 + 4;
  frame.set(ascii('Lavf'), p);
  const d = p + 21;
  frame[d] = delay >> 4;
  frame[d + 1] = ((delay & 0x0f) << 4) | (padding >> 8);
  frame[d + 2] = padding & 0xff;
  return frame;
}

function tone(length: number, amplitude: number): Float32Array {
  const x = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const envelope = Math.sin((Math.PI * i) / length);
    x[i] = amplitude * envelope * Math.sin((2 * Math.PI * 330 * i) / RATE);
  }
  return x;
}

/** 우리 인코더로 한 번 더 묶을 때 크기가 주는 만큼(LAME 128 kbps — 2026-10-08 시청본 240개 실측 중앙 −0.45 dB). */
const REENCODE_LOSS_DB = 0.45;

/**
 * [signal] 을 '제공자 MP3' 로 만든다 — 실제 프레임(우리 인코더) 앞에 ID3·Info 프레임을 붙이고, 그 프레임 수에 맞는 채움을
 * 적는다. 함께 돌려주는 대역 디코더는 afconvert 처럼 프레임 수 × 1152 표본을 내고 소리를 지연(576) 뒤에 둔다 — 제공자
 * MP3 는 원래 신호를, 그 밖의 것(`boostMp3` 가 다시 묶은 MP3)은 서버와 같은 셈으로 올린 신호를 [REENCODE_LOSS_DB] 만큼
 * 줄여서 낸다(진짜 디코더로 풀면 그만큼 작다). 부른 횟수는 [decodeCalls] 로 센다.
 */
async function providerMp3(signal: Float32Array) {
  const frames = await encodeMp3(signal, RATE);
  const audioFrames = readMp3Layout(frames).audioFrames;
  const padding = audioFrames * MP3_FRAME_SAMPLES - 576 - signal.length;
  const bytes = concat(providerId3(), infoFrame(audioFrames, 576, padding), frames);
  const reencoded = boostLoudness(signal, TTS_LOUDNESS_BOOST_DB).samples.map(
    (v) => v * Math.pow(10, -REENCODE_LOSS_DB / 20),
  );
  const decodeCalls: Uint8Array[] = [];
  const decode = (mp3: Uint8Array) => {
    decodeCalls.push(mp3);
    const out = new Float32Array(readMp3Layout(mp3).audioFrames * MP3_FRAME_SAMPLES);
    out.set(mp3 === bytes ? signal : reencoded, 576);
    return out;
  };
  return { bytes, audioFrames, padding, decode, decodeCalls };
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

describe('MP3 생김새 읽기(readMp3Layout)', () => {
  it('우리 인코더의 결과 — 44.1 kHz 모노 128 kbps, Info 태그가 없어 지연·채움을 모른다', async () => {
    const layout = readMp3Layout(await encodeMp3(tone(RATE, 0.3), RATE));
    expect(layout).toMatchObject({ id3Bytes: 0, sampleRate: RATE, channels: 1, bitratesKbps: [128], gapless: null });
    // 1초(44100) + 지연 576 을 담는 프레임 수 이상.
    expect(layout.audioFrames).toBeGreaterThanOrEqual(Math.ceil((RATE + 576) / MP3_FRAME_SAMPLES));
  });

  it('제공자 MP3 — ID3 를 건너뛰고, Info 프레임은 오디오로 세지 않으며, LAME 확장의 지연·채움을 읽는다', async () => {
    const source = await providerMp3(tone(30_000, 0.3));
    const layout = readMp3Layout(source.bytes);
    expect(layout.id3Bytes).toBe(45);
    expect(layout.audioFrames).toBe(source.audioFrames);
    expect(layout.gapless).toEqual({ encoderDelay: 576, encoderPadding: source.padding });
  });

  it('프레임이 중간에 끊기거나 잘리면 던진다 — 깨진 소리를 풀어 묶지 않는다', async () => {
    const mp3 = await encodeMp3(tone(RATE, 0.3), RATE);
    expect(() => readMp3Layout(mp3.subarray(0, mp3.length - 10))).toThrow(/잘렸다/);
    expect(() => readMp3Layout(concat(mp3, Uint8Array.from([1, 2, 3, 4, 5])))).toThrow(/끊겼다/);
  });
});

describe('인코더 지연·채움 걷어 내기(trimToGaplessAudio)', () => {
  it('[지연, 프레임 수 × 1152 − 채움) 만 남긴다', async () => {
    const signal = tone(30_000, 0.3);
    const source = await providerMp3(signal);
    const trimmed = trimToGaplessAudio(source.decode(source.bytes), readMp3Layout(source.bytes));
    expect(trimmed.length).toBe(signal.length);
    expect(Array.from(trimmed)).toEqual(Array.from(signal));
  });

  it('푼 길이가 프레임 수 × 1152 와 다르면 던진다 — 디코더가 다르게 굴면 말의 앞뒤가 잘린다', async () => {
    const source = await providerMp3(tone(30_000, 0.3));
    const layout = readMp3Layout(source.bytes);
    expect(() => trimToGaplessAudio(source.decode(source.bytes).subarray(576), layout)).toThrow(/프레임 수/);
  });

  it('지연·채움 정보가 없으면 던진다 — 얼마를 걷어 낼지 모른다', async () => {
    const mp3 = await encodeMp3(tone(RATE, 0.3), RATE);
    const layout = readMp3Layout(mp3);
    expect(() => trimToGaplessAudio(new Float32Array(layout.audioFrames * MP3_FRAME_SAMPLES), layout)).toThrow(
      /Info\/LAME/,
    );
  });
});

describe('표지(두 번 올리지 않기)', () => {
  it('붙인 표지를 다시 읽는다 — 프레임은 그대로 읽힌다', async () => {
    const mp3 = await encodeMp3(tone(RATE, 0.3), RATE);
    const marked = withLoudnessBoostMarker(mp3, 4);
    expect(readLoudnessBoostMarker(marked)).toBe(4);
    expect(readMp3Layout(marked).audioFrames).toBe(readMp3Layout(mp3).audioFrames);
    expect(new TextDecoder().decode(marked.subarray(0, 64))).toContain(LOUDNESS_BOOST_MARKER);
  });

  it('제공자 ID3(TSSE 만)·태그 없는 MP3 에는 표지가 없다', async () => {
    expect(readLoudnessBoostMarker((await providerMp3(tone(30_000, 0.3))).bytes)).toBeNull();
    expect(readLoudnessBoostMarker(await encodeMp3(tone(RATE, 0.3), RATE))).toBeNull();
  });

  it('이미 ID3 가 있는 MP3 에는 표지를 겹쳐 붙이지 않는다', async () => {
    const tagged = (await providerMp3(tone(30_000, 0.3))).bytes;
    expect(() => withLoudnessBoostMarker(tagged, 4)).toThrow(/ID3/);
  });
});

describe('boostMp3 — 서버와 같은 셈·같은 인코더', () => {
  it('걷어 낸 원본에 boostLoudness(TTS_LOUDNESS_BOOST_DB)를 걸어 encodeMp3 로 묶고 표지를 단다', async () => {
    const signal = tone(30_000, 0.3);
    const source = await providerMp3(signal);
    const result = await boostMp3(source.bytes, source.decode);

    expect(Array.from(result.before)).toEqual(Array.from(signal));
    expect(result.gain).toBeCloseTo(Math.pow(10, TTS_LOUDNESS_BOOST_DB / 20), 10);
    // 서버(`bakeVoiceSamples` → `encodeMp3`)가 같은 표본에서 만드는 바이트 + 표지 — 한 바이트도 다르지 않다.
    const expected = withLoudnessBoostMarker(
      await encodeMp3(boostLoudness(signal, TTS_LOUDNESS_BOOST_DB).samples, RATE),
      TTS_LOUDNESS_BOOST_DB,
    );
    expect(Array.from(result.bytes)).toEqual(Array.from(expected));
    expect(readLoudnessBoostMarker(result.bytes)).toBe(TTS_LOUDNESS_BOOST_DB);
    // 길이(프레임 수)가 그대로다 — 지연을 걷어 냈으므로 우리 인코더의 지연이 한 번만 붙는다.
    expect(result.boostedAudioFrames).toBe(source.audioFrames);
    expect(readMp3Layout(result.bytes).audioFrames).toBe(result.boostedAudioFrames);
    // 다시 풀어 재 본 순 변화 = 배율 − 다시 묶는 손실. 커졌으니 다시 묶은 쪽을 낸다.
    expect(result.reencoded).toBe(true);
    expect(result.netDb!).toBeCloseTo(TTS_LOUDNESS_BOOST_DB - REENCODE_LOSS_DB, 2);
  });

  it('봉우리가 높으면 −0.2 dBFS 직전까지만 올린다(boostLoudness 그대로)', async () => {
    const source = await providerMp3(tone(30_000, 0.9));
    const result = await boostMp3(source.bytes, source.decode);
    const peak = peakOf(result.before);
    expect(result.gain).toBeCloseTo(Math.fround(0.977) / peak, 6);
    expect(result.gain).toBeLessThan(Math.pow(10, TTS_LOUDNESS_BOOST_DB / 20));
    // 덜 올렸어도 다시 묶는 손실보다는 크다(+0.74 dB) — 커지므로 다시 묶은 쪽을 낸다.
    expect(result.reencoded).toBe(true);
    expect(result.netDb!).toBeGreaterThan(0);
  });

  // 시우처럼 봉우리가 이미 한도 가까이인 소리 — 배율이 다시 묶는 손실보다 작아 묶으면 들어 본 것보다 작아진다
  // (2026-10-08 시우 번들 인사말 3개 −0.24~−0.38 dB). 그때는 들어 본 소리를 그대로 둔다(스펙 voice-and-message §10).
  it('다시 묶어도 커지지 않으면 들어 본 MP3 의 오디오 프레임을 그대로 두고 표지만 단다', async () => {
    const source = await providerMp3(tone(30_000, 0.95));
    const result = await boostMp3(source.bytes, source.decode);
    const gainDb = 20 * Math.log10(result.gain);
    expect(gainDb).toBeGreaterThan(0);
    expect(gainDb).toBeLessThan(REENCODE_LOSS_DB);

    expect(result.reencoded).toBe(false);
    expect(result.netDb!).toBeCloseTo(gainDb - REENCODE_LOSS_DB, 2);
    // 오디오 프레임(제공자의 Info 프레임까지)이 한 바이트도 바뀌지 않았다 — 앞 태그만 표지로 바뀌었다.
    const sourceLayout = readMp3Layout(source.bytes);
    const resultLayout = readMp3Layout(result.bytes);
    expect(Array.from(result.bytes.subarray(resultLayout.id3Bytes))).toEqual(
      Array.from(source.bytes.subarray(sourceLayout.id3Bytes)),
    );
    expect(resultLayout.gapless).toEqual(sourceLayout.gapless);
    expect(result.boostedAudioFrames).toBe(source.audioFrames);
    // 표지는 단다 — 다시 돌려도 또 손대지 않는다(번들 스크립트는 건너뛰고, 게시는 멈춘다).
    expect(readLoudnessBoostMarker(result.bytes)).toBe(TTS_LOUDNESS_BOOST_DB);
    await expect(boostMp3(result.bytes, source.decode)).rejects.toBeInstanceOf(AlreadyBoostedError);
  });

  it('크기를 잴 수 없으면(통합 음량의 문턱 −70 LUFS 아래) 커졌는지 모르므로 그대로 둔다', async () => {
    const source = await providerMp3(tone(30_000, 1e-5));
    const result = await boostMp3(source.bytes, source.decode);
    expect(result.gain).toBeCloseTo(Math.pow(10, TTS_LOUDNESS_BOOST_DB / 20), 10);
    expect(result).toMatchObject({ reencoded: false, netDb: null });
    expect(result.after).not.toBeNull();
    expect(readLoudnessBoostMarker(result.bytes)).toBe(TTS_LOUDNESS_BOOST_DB);
  });

  it('봉우리가 이미 한도 위면(배율 1) 묶어 보지도 않고 그대로 둔다', async () => {
    const source = await providerMp3(tone(30_000, 0.99));
    const result = await boostMp3(source.bytes, source.decode);
    expect(peakOf(result.before)).toBeGreaterThan(Math.fround(0.977));
    expect(result).toMatchObject({ reencoded: false, gain: 1, netDb: null, after: null });
    // 원본을 한 번 풀었을 뿐이다 — 다시 묶은 것을 풀어 보지 않았다.
    expect(source.decodeCalls).toEqual([source.bytes]);
    const resultLayout = readMp3Layout(result.bytes);
    expect(Array.from(result.bytes.subarray(resultLayout.id3Bytes))).toEqual(
      Array.from(source.bytes.subarray(readMp3Layout(source.bytes).id3Bytes)),
    );
    expect(readLoudnessBoostMarker(result.bytes)).toBe(TTS_LOUDNESS_BOOST_DB);
  });

  it('이미 올린 소리는 받지 않는다 — 두 번 올라가지 않는다', async () => {
    const source = await providerMp3(tone(30_000, 0.3));
    const once = await boostMp3(source.bytes, source.decode);
    await expect(boostMp3(once.bytes, source.decode)).rejects.toBeInstanceOf(AlreadyBoostedError);
  });
});

describe('잴 때 쓰는 것', () => {
  it('readFloat32MonoWav — afconvert 의 32-bit 실수 WAVE(FLLR 조각 포함)에서 표본을 꺼내고, 다른 형식은 던진다', () => {
    const samples = Float32Array.from([0.5, -0.25, 0.125]);
    const wav = (format: number, rate: number, bits: number) => {
      const fmt = new DataView(new ArrayBuffer(16));
      fmt.setUint16(0, format, true);
      fmt.setUint16(2, 1, true);
      fmt.setUint32(4, rate, true);
      fmt.setUint32(8, (rate * bits) / 8, true);
      fmt.setUint16(12, bits / 8, true);
      fmt.setUint16(14, bits, true);
      const data = new DataView(new ArrayBuffer(samples.length * 4));
      samples.forEach((v, i) => data.setFloat32(i * 4, v, true));
      const chunk = (id: string, body: Uint8Array) => {
        const head = new DataView(new ArrayBuffer(8));
        ascii(id).forEach((c, i) => head.setUint8(i, c));
        head.setUint32(4, body.length, true);
        return concat(new Uint8Array(head.buffer), body);
      };
      const body = concat(
        Uint8Array.from(ascii('WAVE')),
        chunk('fmt ', new Uint8Array(fmt.buffer)),
        chunk('FLLR', new Uint8Array(6)),
        chunk('data', new Uint8Array(data.buffer)),
      );
      return concat(chunk('RIFF', body));
    };
    expect(Array.from(readFloat32MonoWav(wav(3, RATE, 32), RATE))).toEqual(Array.from(samples));
    expect(() => readFloat32MonoWav(wav(1, RATE, 32), RATE)).toThrow(/형식/);
    expect(() => readFloat32MonoWav(wav(3, 48_000, 32), RATE)).toThrow(/형식/);
  });

  it('trimBoostedDecode — 우리 인코더의 지연(576)을 건너뛰고 원래 길이만큼', () => {
    const decoded = Float32Array.from({ length: 2000 }, (_, i) => i);
    expect(Array.from(trimBoostedDecode(decoded, 10))).toEqual(
      Array.from({ length: 10 }, (_, i) => ENCODER_DELAY_SAMPLES + i),
    );
    expect(() => trimBoostedDecode(decoded, 1500)).toThrow(/짧다/);
  });

  it('loudnessStats — 봉우리 dBFS 와 통합 음량, 무음은 null', () => {
    const stats = loudnessStats(tone(RATE, 0.5));
    expect(stats.peakDbfs!).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(stats.lufs).not.toBeNull();
    expect(loudnessStats(new Float32Array(RATE))).toEqual({ lufs: null, peakDbfs: null });
  });
});

describe('publish-stock-clips — 올린 사본을 올리고, 올리기 전 게시본은 교체로 읽는다', () => {
  const script = readFileSync(join(__dirname, '..', 'scripts', 'publish-stock-clips.ts'), 'utf-8');

  it('DB 에 손대기 전에 게시본 사본을 전부 만들고, 업로드는 시청본이 아니라 그 사본이다', () => {
    const staged = script.indexOf('await stageBoostedClips(targets)');
    expect(staged).toBeGreaterThan(0);
    expect(staged).toBeLessThan(script.indexOf('createClient('));
    expect(script).not.toMatch(/uploadToR2\(bucket, objectKey, target\.filePath/);
    expect(script.match(/uploadToR2\(bucket, objectKey, target\.stagedPath/g)).toHaveLength(2);
    expect(script).toMatch(/boostMp3\(readFileSync\(target\.filePath\)/);
  });

  it('시청본 생성기는 음량을 올리지 않는다 — 올려 두면 게시 때 두 번 올라간다', () => {
    const prerender = readFileSync(join(__dirname, '..', 'scripts', 'prerender-stock-preview.ts'), 'utf-8');
    expect(prerender).not.toMatch(/boostMp3|boostLoudness|from '\.\/mp3-loudness-boost/);
  });

  it('올리기 전에 게시한 v4 클립(dev)은 오브젝트 키가 달라 교체 갈래로 간다', async () => {
    // 게시 스크립트가 키를 만드는 입력과 같은 모양(시스템 목소리 — 높이 없음).
    const base = {
      provider: 'elevenlabs',
      providerVoiceId: 'aiUUgjHa4mpHf6UenZuf',
      voiceProfileId: '70000000-0000-4000-9000-000000000102',
      modelId: 'eleven_v4_turbo',
      language: 'ko',
      languageCode: 'ko',
      text: '좋은 아침이에요.',
      outputFormat: 'mp3',
      scope: STOCK_TTS_CACHE_SCOPE,
    };
    const before = generatedTtsObjectKey(SYSTEM_VOICE_LIBRARY_USER_ID, await computeTtsCacheKey(base), 'mp3');
    const after = generatedTtsObjectKey(
      SYSTEM_VOICE_LIBRARY_USER_ID,
      await computeTtsCacheKey({ ...base, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }),
      'mp3',
    );
    // 행의 audio_url(올리기 전 키)과 지금 계산한 키가 다르다 → `existing.audioUrl === audioUrl` 이 거짓 → [교체].
    expect(after).not.toBe(before);
  });
});
