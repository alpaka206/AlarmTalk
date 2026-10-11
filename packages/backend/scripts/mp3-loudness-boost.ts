/**
 * **사람이 들어 본 MP3 에 서버와 같은 음량 올리기를 건다** — 다시 합성하지 않는다.
 *
 * eleven_v4_turbo 는 v3 보다 작게 내서, 서버는 모든 합성을 `TTS_LOUDNESS_BOOST_DB` 만큼 올려 MP3 로 묶는다
 * (`voice-pitch.ts` 의 `bakeVoiceSamples` → `encodeMp3`). 미리 구워 둔 소리 — 기본 목소리 게시본
 * (`publish-stock-clips.ts`)과 앱 번들 인사말(`boost-bundled-greetings.ts`) — 도 **같은 셈·같은 값·같은 인코더**를
 * 거쳐야 미리듣기와 알람의 크기가 갈리지 않는다. 그 둘은 ElevenLabs 가 준 MP3 라 여기서 풀어서 같은 길을 태운다:
 *
 *   MP3 → (afconvert) 실수 표본 → 인코더 지연·끝 채움 걷어 내기 → `boostLoudness` → `encodeMp3`
 *       → 다시 풀어 원본보다 커졌으면 그 MP3, 아니면 들어 본 MP3 그대로 → 표지(ID3)
 *
 * - 연기(performance)는 그대로다 — 크기만 바꾼다. 대신 손실 압축을 한 번 더 거친다(서버는 PCM 을 받아 한 번).
 *   음질 차이는 128 kbps 음성에서 들리지 않지만, 한 번 묶을 때마다 크기가 약 0.45 dB 준다(LAME 128 kbps 의 성질 —
 *   2026-10-08 시청본 240개 실측 −0.58~−0.40, 중앙 −0.45). 그래서 다시 묶은 소리는 서버가 같은 소리를 PCM 에서 구운
 *   것보다 그만큼 작다 — 순 변화가 배율 − 0.45 dB 쯤이다. 값은 보정하지 않는다 — 셈과 값을 서버와 하나로 둔다(실측은
 *   `docs/ops/tts-model-rerender.md`).
 * - ⚠ **다시 묶어도 커지지 않으면 다시 묶지 않는다**(2026-10-08). 봉우리가 이미 높아 배율이 그 손실보다 작은 클립은
 *   다시 묶으면 들어 본 것보다 **작아진다** — 시우 번들 인사말 3개가 −0.24~−0.38 dB, 시청본 240개 중 52개(시우 51·
 *   애니 1)가 그랬다. 그래서 묶은 결과를 같은 디코더로 다시 풀어 통합 음량을 원본과 견주고, 커졌을 때만 그걸 낸다.
 *   아니면 들어 본 MP3 의 오디오 프레임을 한 바이트도 바꾸지 않고 표지만 단다([BoostedMp3] 의 `reencoded`). 그래서
 *   음량 올리기가 들어 본 소리를 줄이는 일은 없다.
 * - ⚠ **두 번 올리지 않는다.** 결과에는 ID3 표지(TXXX [LOUDNESS_BOOST_MARKER])를 달고 — 그대로 둔 소리에도 단다 —
 *   표지가 있는 소리는 받지 않는다([AlreadyBoostedError]). 표지 없이 두 번 올리면 +8 dB 가 되는데, 귀에는 '좀 크다'
 *   일 뿐이라 아무도 모르고 지나간다.
 * - 풀기는 macOS 내장 `afconvert` 로 한다 — 새 의존성을 들이지 않는다. 게시·번들은 원래 이 맥에서 사람이 돌린다.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { boostLoudness, integratedLoudness } from '@alarmtalk/voice';

import { TTS_LOUDNESS_BOOST_DB } from '../src/lib/tts-model.ts';
import { encodeMp3, registerMp3EncoderModule, SYNTHESIS_PCM_SAMPLE_RATE } from '../src/lib/voice-pitch.ts';

/** MPEG-1 Layer III 한 프레임의 표본 수. */
export const MP3_FRAME_SAMPLES = 1152;
/**
 * 우리 인코더(LAME — `encodeMp3`)가 앞에 붙이는 지연(표본). 결과에는 Info 태그가 없어 디코더가 걷어 내지 못하므로,
 * 다시 풀어서 잴 때 이만큼 앞을 건너뛴다(2026-10-08 실측 — afconvert 로 푼 신호가 정확히 이만큼 밀렸다).
 */
export const ENCODER_DELAY_SAMPLES = 576;
/**
 * 음량 올리기를 거친 소리에 다는 표지 — ID3v2 TXXX 프레임의 설명. 값은 그때의 `TTS_LOUDNESS_BOOST_DB` 다 — 실제로
 * 오른 크기가 아니다(봉우리에 닿으면 덜 오르고, 다시 묶어도 커지지 않으면 그대로 둔다 — [boostMp3]). 표지가 말하는 것은
 * '이 값으로 처리했다' 하나다 — 두 번 올리지 않고, 값을 바꾼 뒤 옛 값으로 처리한 파일을 알아챈다.
 */
export const LOUDNESS_BOOST_MARKER = 'alarmtalk-loudness-boost-db';

const MPEG1_L3_BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000, 0];
/** 파일 끝의 ID3v1 태그(`TAG` + 125바이트) — 프레임이 아니므로 건너뛴다. */
const ID3V1_BYTES = 128;

export interface Mp3Layout {
  /** 앞 ID3v2 태그의 길이(바이트, 없으면 0). */
  id3Bytes: number;
  /** 오디오 프레임 수 — Info/Xing 프레임은 빼고 센다(디코더도 그 프레임은 소리로 내지 않는다). */
  audioFrames: number;
  sampleRate: number;
  channels: 1 | 2;
  /** 프레임들이 쓴 비트레이트(kbps) — CBR 이면 하나다. */
  bitratesKbps: number[];
  /**
   * Info/LAME 태그가 적어 둔 인코더 지연·끝 채움(표본). 태그가 없으면 null — 우리 인코더(`encodeMp3`)의 결과가
   * 그렇다(그래서 그 결과는 다시 받지 않는다 — 표지가 막는다).
   */
  gapless: { encoderDelay: number; encoderPadding: number } | null;
}

/**
 * MP3 의 생김새를 읽는다 — 앞 ID3v2 를 건너뛰고 **끝까지 프레임이 빈틈없이 이어지는지** 본다. 중간에 끊기거나
 * MPEG-1 Layer III 가 아니거나 표본률·채널이 프레임마다 다르면 던진다(그런 파일을 풀어 묶으면 무엇이 나올지 모른다).
 */
export function readMp3Layout(mp3: Uint8Array): Mp3Layout {
  const id3Bytes = id3v2Length(mp3);
  let offset = id3Bytes;
  let frames = 0;
  let sampleRate = 0;
  let channels: 1 | 2 = 1;
  const bitrates = new Set<number>();
  let gapless: Mp3Layout['gapless'] = null;
  let infoFrame = false;
  while (offset < mp3.length) {
    const remaining = mp3.length - offset;
    if (remaining === ID3V1_BYTES && asciiAt(mp3, offset, 3) === 'TAG') break;
    if (remaining < 4 || mp3[offset] !== 0xff || (mp3[offset + 1]! & 0xe0) !== 0xe0) {
      throw new Error(`MP3 프레임이 ${offset} 바이트에서 끊겼다(남은 ${remaining} 바이트).`);
    }
    const b1 = mp3[offset + 1]!;
    const b2 = mp3[offset + 2]!;
    const b3 = mp3[offset + 3]!;
    const isMpeg1Layer3 = ((b1 >> 3) & 0b11) === 0b11 && ((b1 >> 1) & 0b11) === 0b01;
    const bitrateKbps = MPEG1_L3_BITRATES_KBPS[(b2 >> 4) & 0x0f]!;
    const frameRate = MPEG1_SAMPLE_RATES[(b2 >> 2) & 0b11]!;
    if (!isMpeg1Layer3 || bitrateKbps === 0 || frameRate === 0) {
      throw new Error(`MPEG-1 Layer III 프레임이 아니다(${offset} 바이트).`);
    }
    const frameChannels: 1 | 2 = ((b3 >> 6) & 0b11) === 0b11 ? 1 : 2;
    if (frames > 0 && (frameRate !== sampleRate || frameChannels !== channels)) {
      throw new Error(`프레임마다 표본률·채널이 다르다(${offset} 바이트).`);
    }
    sampleRate = frameRate;
    channels = frameChannels;
    const frameBytes = Math.floor((144 * bitrateKbps * 1000) / frameRate) + ((b2 >> 1) & 1);
    if (offset + frameBytes > mp3.length) {
      throw new Error(`마지막 프레임이 잘렸다(${offset} 바이트, ${frameBytes} 바이트 중 ${remaining}).`);
    }
    if (frames === 0) {
      const info = readInfoFrame(mp3, offset, frameBytes, frameChannels, (b1 & 1) === 0);
      infoFrame = info.isInfoFrame;
      gapless = info.gapless;
    }
    if (frames > 0 || !infoFrame) bitrates.add(bitrateKbps);
    frames += 1;
    offset += frameBytes;
  }
  const audioFrames = frames - (infoFrame ? 1 : 0);
  if (audioFrames <= 0) throw new Error('MP3 에 오디오 프레임이 없다.');
  return { id3Bytes, audioFrames, sampleRate, channels, bitratesKbps: [...bitrates].sort((a, b) => a - b), gapless };
}

/** 첫 프레임이 Info/Xing 프레임인가, 그렇다면 LAME 확장의 지연·채움. */
function readInfoFrame(
  mp3: Uint8Array,
  frameOffset: number,
  frameBytes: number,
  channels: 1 | 2,
  hasCrc: boolean,
): { isInfoFrame: boolean; gapless: Mp3Layout['gapless'] } {
  const frameEnd = frameOffset + frameBytes;
  // 머리(4) + CRC(있으면 2) + side info(MPEG-1 모노 17, 스테레오 32 바이트) 뒤에 태그가 온다.
  const tagOffset = frameOffset + 4 + (hasCrc ? 2 : 0) + (channels === 1 ? 17 : 32);
  const tag = tagOffset + 8 <= frameEnd ? asciiAt(mp3, tagOffset, 4) : '';
  if (tag !== 'Info' && tag !== 'Xing') return { isInfoFrame: false, gapless: null };
  const flags = readUint32(mp3, tagOffset + 4);
  let cursor = tagOffset + 8;
  if (flags & 0x1) cursor += 4; // 프레임 수
  if (flags & 0x2) cursor += 4; // 바이트 수
  if (flags & 0x4) cursor += 100; // 목차
  if (flags & 0x8) cursor += 4; // 품질
  // LAME 확장: 인코더 이름 9바이트 + 12바이트 뒤에 지연(12비트)·채움(12비트) 3바이트.
  // 인코더 이름이 글자로 시작하지 않으면 확장이 없는 Xing 이다(LAME·ffmpeg 는 `LAME3.100`·`Lavf`·`Lavc…` 를 쓴다).
  const delayOffset = cursor + 21;
  const first = mp3[cursor] ?? 0;
  const named = (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
  if (!named || delayOffset + 3 > frameEnd) return { isInfoFrame: true, gapless: null };
  const d0 = mp3[delayOffset]!;
  const d1 = mp3[delayOffset + 1]!;
  const d2 = mp3[delayOffset + 2]!;
  return {
    isInfoFrame: true,
    gapless: { encoderDelay: (d0 << 4) | (d1 >> 4), encoderPadding: ((d1 & 0x0f) << 8) | d2 },
  };
}

/**
 * afconvert 가 푼 표본에서 **원래 소리만** 남긴다 — 인코더가 앞에 붙인 지연과 뒤를 채운 표본을 걷어 낸다.
 *
 * 걷어 내지 않고 다시 묶으면 우리 인코더가 지연을 한 번 더 붙여 앞 무음이 늘고 길이가 프레임 하나 넘게 는다.
 * 걷어 내면 서버가 PCM 을 받아 묶은 것과 같은 모양이 된다.
 *
 * afconvert(애플 디코더)는 디코더 지연을 스스로 빼고 **모든 오디오 프레임**(프레임 수 × 1152)을 내준다 — 그래서 원래
 * 소리는 [지연, 프레임 수 × 1152 − 채움) 이다(2026-10-08 실측: ffmpeg 의 libmp3lame 으로 묶은 신호를 이 셈으로 자르니
 * 앞·뒤 위치와 길이가 표본 하나 어긋나지 않았다).
 *
 * ⚠ 길이가 그 셈과 다르면 던진다 — 디코더 동작이 바뀐 것이고, 어긋난 채 자르면 말의 앞뒤가 잘린다.
 * ⚠ Info/LAME 태그(지연·채움)가 없으면 던진다 — 얼마를 걷어 낼지 모른다.
 */
export function trimToGaplessAudio(decoded: Float32Array, layout: Mp3Layout): Float32Array {
  if (!layout.gapless) {
    throw new Error('MP3 에 인코더 지연·채움(Info/LAME 태그)이 없다 — 어디서 온 소리인지 확인할 것.');
  }
  const expected = layout.audioFrames * MP3_FRAME_SAMPLES;
  if (decoded.length !== expected) {
    throw new Error(`푼 표본 수(${decoded.length})가 프레임 수 × ${MP3_FRAME_SAMPLES}(${expected})와 다르다.`);
  }
  const { encoderDelay, encoderPadding } = layout.gapless;
  const length = expected - encoderDelay - encoderPadding;
  if (length <= 0) throw new Error(`지연(${encoderDelay})·채움(${encoderPadding})을 빼니 남는 소리가 없다.`);
  return decoded.slice(encoderDelay, encoderDelay + length);
}

/** 표지(TXXX [LOUDNESS_BOOST_MARKER])에 적힌 dB. 표지가 없으면 null. */
export function readLoudnessBoostMarker(mp3: Uint8Array): number | null {
  const tagLength = id3v2Length(mp3);
  if (tagLength === 0) return null;
  const version = mp3[3]!;
  let cursor = 10;
  while (cursor + 10 <= tagLength) {
    const id = asciiAt(mp3, cursor, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // 채움(0x00)에 닿았다
    const size = version >= 4 ? syncsafe(mp3, cursor + 4) : readUint32(mp3, cursor + 4);
    const body = mp3.subarray(cursor + 10, Math.min(cursor + 10 + size, tagLength));
    // 글자 인코딩 0(ISO-8859-1)·3(UTF-8)만 본다 — 표지는 0 으로 쓴다.
    if (id === 'TXXX' && (body[0] === 0 || body[0] === 3)) {
      const text = new TextDecoder().decode(body.subarray(1));
      const nul = text.indexOf('\u0000');
      if (nul >= 0 && text.slice(0, nul) === LOUDNESS_BOOST_MARKER) {
        // 값 뒤에 끝맺음 NUL 이 붙어 올 수 있다 — 첫 NUL 까지만 값이다.
        return Number(text.slice(nul + 1).split('\u0000')[0]);
      }
    }
    cursor += 10 + size;
  }
  return null;
}

/** [mp3] 앞에 표지만 든 ID3v2.4 태그를 붙인다. 이미 ID3v2 가 있으면 던진다(태그를 겹쳐 쌓지 않는다). */
export function withLoudnessBoostMarker(mp3: Uint8Array, db: number): Uint8Array {
  if (id3v2Length(mp3) > 0) throw new Error('이미 ID3 태그가 있는 MP3 에는 표지를 붙이지 않는다.');
  const body = new TextEncoder().encode(`\u0000${LOUDNESS_BOOST_MARKER}\u0000${db}`); // 0 = ISO-8859-1(글자는 ASCII)
  const frame = new Uint8Array(10 + body.length);
  frame.set(new TextEncoder().encode('TXXX'), 0);
  frame.set(syncsafeBytes(body.length), 4);
  frame.set(body, 10);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 4, 0, 0], 0); // "ID3" v2.4.0, 플래그 없음
  header.set(syncsafeBytes(frame.length), 6);
  const out = new Uint8Array(header.length + frame.length + mp3.length);
  out.set(header, 0);
  out.set(frame, header.length);
  out.set(mp3, header.length + frame.length);
  return out;
}

/**
 * 앞 ID3v2 태그를 뗀 MP3 — 오디오 프레임(Info 프레임 포함)은 그대로다. 제공자 태그에는 인코더 이름(TSSE)만 있어
 * 떼어도 잃는 것이 없고, 그 자리에 표지 태그를 붙인다([withLoudnessBoostMarker] 는 태그를 겹쳐 쌓지 않는다).
 */
function withoutId3v2(mp3: Uint8Array): Uint8Array {
  return mp3.subarray(id3v2Length(mp3));
}

/**
 * afconvert 가 쓴 WAVE(32-bit 실수·모노·[sampleRate])에서 표본을 꺼낸다. 형식이 다르면 던진다 — 정수 표본을
 * 실수로 읽으면 잡음이 되고, 표본률이 다르면 소리가 늘어진다.
 */
export function readFloat32MonoWav(wav: Uint8Array, sampleRate: number): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (asciiAt(wav, 0, 4) !== 'RIFF' || asciiAt(wav, 8, 4) !== 'WAVE') throw new Error('WAVE 파일이 아니다.');
  let cursor = 12;
  let formatOk = false;
  while (cursor + 8 <= wav.length) {
    const id = asciiAt(wav, cursor, 4);
    const size = view.getUint32(cursor + 4, true);
    const start = cursor + 8;
    if (id === 'fmt ') {
      const format = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      const bits = view.getUint16(start + 14, true);
      if (format !== 3 || channels !== 1 || rate !== sampleRate || bits !== 32) {
        throw new Error(`WAVE 형식이 다르다(형식 ${format}, ${channels}ch, ${rate} Hz, ${bits} bit).`);
      }
      formatOk = true;
    } else if (id === 'data') {
      if (!formatOk) throw new Error('WAVE 의 fmt 가 data 보다 뒤에 있다.');
      const count = Math.floor(Math.min(size, wav.length - start) / 4);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i += 1) out[i] = view.getFloat32(start + i * 4, true);
      return out;
    }
    cursor = start + size + (size & 1);
  }
  throw new Error('WAVE 에 data 가 없다.');
}

/** MP3 바이트 → 실수 표본(모노·44.1 kHz). 테스트는 afconvert 대신 대역을 넘긴다. */
export type Mp3Decoder = (mp3: Uint8Array) => Float32Array;

/**
 * macOS 내장 `afconvert` 로 푸는 디코더. 중간 파일은 [workDir] 아래 임시 폴더에 쓰고 곧바로 지운다.
 * ⚠ 출력 형식을 못 박는다(`LEF32@44100`, 모노) — 원본이 다른 형식이면 afconvert 가 말없이 바꾸므로, 호출 전에
 *   [readMp3Layout] 으로 원본이 44.1 kHz 모노인지 먼저 본다([boostMp3]).
 */
export function afconvertDecoder(workDir: string): Mp3Decoder {
  return (mp3) => {
    mkdirSync(workDir, { recursive: true });
    const dir = mkdtempSync(join(workDir, 'decode-'));
    try {
      const input = join(dir, 'in.mp3');
      const output = join(dir, 'out.wav');
      writeFileSync(input, mp3);
      try {
        execFileSync(
          'afconvert',
          ['-f', 'WAVE', '-d', `LEF32@${SYNTHESIS_PCM_SAMPLE_RATE}`, '-c', '1', input, output],
          { stdio: 'pipe' },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('afconvert(macOS 내장 오디오 변환기)를 찾지 못했다 — 음량 올리기는 macOS 에서만 돈다.', {
            cause: error,
          });
        }
        const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
        throw new Error(`afconvert 가 MP3 를 풀지 못했다${stderr ? `: ${stderr.slice(0, 200)}` : ''}`, { cause: error });
      }
      return readFloat32MonoWav(readFileSync(output), SYNTHESIS_PCM_SAMPLE_RATE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** 이미 표지가 있는 소리 — 다시 올리면 두 번 올라간다. */
export class AlreadyBoostedError extends Error {
  constructor(readonly markerDb: number) {
    super(`이미 음량 올리기를 거친 소리다(표지 ${markerDb} dB) — 두 번 올리지 않는다.`);
    this.name = 'AlreadyBoostedError';
  }
}

export interface BoostedMp3 {
  /** 게시·번들할 MP3 — 표지까지 달았다. */
  bytes: Uint8Array;
  /**
   * 다시 묶은 소리인가. 거짓이면 다시 묶어도 커지지 않아서 들어 본 MP3 의 오디오 프레임을 그대로 두고 표지만 달았다
   * ([bytes] 의 소리가 [before] 다).
   */
  reencoded: boolean;
  /**
   * `boostLoudness` 가 낸 배율 — 봉우리가 −0.2 dBFS 에 닿으면 10^(dB/20) 보다 작다. [reencoded] 가 거짓이면 걸지 않았다.
   */
  gain: number;
  /**
   * 다시 묶은 소리의 통합 음량 − 원본의 통합 음량(dB, 같은 디코더로 풀어 잰다). 그대로 두기로 했어도 묶어 봤으면 그때 잰
   * 값이다. 묶어 보지 않았거나(배율 1) 어느 한쪽을 잴 수 없으면 null — 그때는 그대로 둔다.
   */
  netDb: number | null;
  /** 걷어 낸 원본 표본. */
  before: Float32Array;
  /** 다시 묶은 소리를 풀어 걷어 낸 표본(잴 때 쓴다). 묶어 보지 않았으면 null. */
  after: Float32Array | null;
  sourceAudioFrames: number;
  /** [bytes] 의 오디오 프레임 수. */
  boostedAudioFrames: number;
}

let encoderRegistered = false;

/**
 * 워커는 wrangler 가 미리 컴파일한 모듈을 넘긴다(`src/index.ts`). 여기서는 **같은 .wasm 파일**을 컴파일해 넘긴다
 * (테스트 대역 `test/support/mp3-encoder-wasm.ts` 와 같은 방법) — 그래서 인코더가 서버와 같다.
 */
function ensureMp3Encoder(): void {
  if (encoderRegistered) return;
  const wasm = new Uint8Array(readFileSync(resolveMp3Wasm()));
  // 워커 타입(`@cloudflare/workers-types`)은 실행 중 컴파일을 막으려고 생성자를 감춰 두었다 — Node 에서는 된다.
  const NodeWasmModule = WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module;
  registerMp3EncoderModule(new NodeWasmModule(wasm));
  encoderRegistered = true;
}

/**
 * 패키지가 내보내는 `.wasm` 경로. 번들(`node_modules/.cache/…mjs`)에서는 `import.meta.url` 로 위로 올라가며 찾고, 번들을
 * 다른 곳에 두었으면 cwd(packages/backend) 기준으로 한 번 더 찾는다.
 */
function resolveMp3Wasm(): string {
  for (const base of [import.meta.url, join(process.cwd(), 'package.json')]) {
    try {
      return createRequire(base).resolve('wasm-media-encoders/wasm/mp3');
    } catch {
      // 다음 기준으로 찾는다.
    }
  }
  throw new Error('wasm-media-encoders 의 mp3.wasm 을 찾지 못했다 — packages/backend 에서 실행할 것.');
}

/**
 * [source](ElevenLabs 가 준 MP3)를 풀어 서버와 같은 셈으로 올린 MP3. 값은 언제나 `TTS_LOUDNESS_BOOST_DB` 다 — 부르는
 * 쪽이 따로 정하지 않는다(서버·게시본·번들이 한 값을 쓴다).
 *
 * ⚠ **다시 묶어도 커지지 않으면 들어 본 MP3 를 그대로 낸다**(표지만 단다 — `reencoded: false`). 다시 묶으면 약 0.45 dB
 *   작아지므로(머리말), 봉우리 때문에 배율이 그보다 작은 클립은 올리기가 오히려 소리를 줄인다. 그래서 묶은 결과를 같은
 *   디코더로 다시 풀어 통합 음량을 원본과 견주고, 커졌을 때만 그 결과를 낸다. 배율이 1(봉우리가 이미 한도 위)이면 묶어
 *   보지도 않는다. 문턱(0.45 dB)을 박지 않고 재는 까닭은 그 손실이 클립마다 달라서다(−0.58~−0.40).
 * ⚠ 표지가 있으면 [AlreadyBoostedError] 를 던진다. 44.1 kHz 모노 MPEG-1 Layer III 가 아니어도 던진다 — 서버가 묶는
 *   형식(`encodeMp3`)과 다른 소리를 말없이 바꿔 묶지 않는다.
 * ⚠ 값이 0 이면 던진다 — 서버도 그때는 굽지 않고 제공자 MP3 를 그대로 쓴다(`needsVoiceBake`). 부르는 쪽이 들어 본
 *   바이트를 그대로 쓴다(표지도 달지 않는다 — 0 은 '올리기 전' 이다).
 */
export async function boostMp3(source: Uint8Array, decode: Mp3Decoder): Promise<BoostedMp3> {
  if (!(TTS_LOUDNESS_BOOST_DB > 0)) {
    throw new Error('TTS_LOUDNESS_BOOST_DB 가 0 이다 — 올리지 않는다(들어 본 바이트를 그대로 쓴다).');
  }
  const marker = readLoudnessBoostMarker(source);
  if (marker !== null) throw new AlreadyBoostedError(marker);
  const layout = readMp3Layout(source);
  if (layout.sampleRate !== SYNTHESIS_PCM_SAMPLE_RATE || layout.channels !== 1) {
    throw new Error(`${SYNTHESIS_PCM_SAMPLE_RATE} Hz 모노가 아니다(${layout.sampleRate} Hz, ${layout.channels}ch).`);
  }
  const before = trimToGaplessAudio(decode(source), layout);
  const { samples, gain } = boostLoudness(before, TTS_LOUDNESS_BOOST_DB);
  // 그대로 두는 갈래 — 오디오 프레임(제공자의 Info 프레임까지)은 들어 본 바이트 그대로, 앞 태그만 표지로 바꾼다.
  const kept = (netDb: number | null, after: Float32Array | null): BoostedMp3 => ({
    bytes: withLoudnessBoostMarker(withoutId3v2(source), TTS_LOUDNESS_BOOST_DB),
    reencoded: false,
    gain,
    netDb,
    before,
    after,
    sourceAudioFrames: layout.audioFrames,
    boostedAudioFrames: layout.audioFrames,
  });
  if (gain === 1) return kept(null, null);
  ensureMp3Encoder();
  const encoded = await encodeMp3(samples, SYNTHESIS_PCM_SAMPLE_RATE);
  // 묶은 결과가 빈틈없는 프레임인지 바로 본다 — 깨진 소리를 게시·번들하지 않는다.
  const boosted = readMp3Layout(encoded);
  const after = trimBoostedDecode(decode(encoded), before.length);
  const netDb = loudnessChangeDb(before, after);
  if (netDb === null || netDb <= 0) return kept(netDb, after);
  return {
    bytes: withLoudnessBoostMarker(encoded, TTS_LOUDNESS_BOOST_DB),
    reencoded: true,
    gain,
    netDb,
    before,
    after,
    sourceAudioFrames: layout.audioFrames,
    boostedAudioFrames: boosted.audioFrames,
  };
}

/** [after] 의 통합 음량 − [before] 의 통합 음량(dB). 어느 한쪽이라도 잴 수 없으면(무음·너무 짧다) null. */
function loudnessChangeDb(before: Float32Array, after: Float32Array): number | null {
  const was = integratedLoudness(before, SYNTHESIS_PCM_SAMPLE_RATE);
  const now = integratedLoudness(after, SYNTHESIS_PCM_SAMPLE_RATE);
  return was === null || now === null ? null : now - was;
}

/** 잴 때 쓴다 — 통합 음량(LUFS, `integratedLoudness`)과 표본 봉우리(dBFS). 소리가 없으면 null. */
export function loudnessStats(samples: Float32Array): { lufs: number | null; peakDbfs: number | null } {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]!));
  return {
    lufs: integratedLoudness(samples, SYNTHESIS_PCM_SAMPLE_RATE),
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : null,
  };
}

/** [boostMp3] 가 묶은 MP3 를 다시 풀어 원래 길이만큼 — 우리 인코더의 지연([ENCODER_DELAY_SAMPLES])을 건너뛴다. */
export function trimBoostedDecode(decoded: Float32Array, length: number): Float32Array {
  if (decoded.length < ENCODER_DELAY_SAMPLES + length) {
    throw new Error(`다시 푼 표본(${decoded.length})이 지연 ${ENCODER_DELAY_SAMPLES} + 원래 길이 ${length} 보다 짧다.`);
  }
  return decoded.slice(ENCODER_DELAY_SAMPLES, ENCODER_DELAY_SAMPLES + length);
}

function id3v2Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || asciiAt(bytes, 0, 3) !== 'ID3') return 0;
  const footer = (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  return Math.min(bytes.length, 10 + syncsafe(bytes, 6) + footer);
}

function syncsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! & 0x7f) << 21) |
    ((bytes[offset + 1]! & 0x7f) << 14) |
    ((bytes[offset + 2]! & 0x7f) << 7) |
    (bytes[offset + 3]! & 0x7f)
  );
}

function syncsafeBytes(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < bytes.length; i += 1) out += String.fromCharCode(bytes[offset + i]!);
  return out;
}
