import { createEncoder, type WasmMediaEncoder } from 'wasm-media-encoders';
import { boostLoudness, shiftVoicePitch } from '@alarmtalk/voice';
import { VoicePitchSemitonesSchema } from '@alarmtalk/shared';

/**
 * 합성한 소리를 **서버가 굽는다** — 목소리 높이(`docs/spec/voice-and-message.md` §4-3)와 음량(§10).
 *
 * 높이: 등록 미리듣기에서 사용자가 고른 높이(반음)를 등록 확정 때 `voice_profiles.pitch_semitones` 에 적고, 그 목소리로
 * 만드는 모든 알람 소리(프리셋 사전렌더·직접 입력)에 굽는다. 그래서 앱은 받은 파일을 그대로 틀고, 공유받은 가족·
 * 가족 알람 수신자·다른 기기도 같은 소리를 듣는다. 앱이 미리듣기를 기기에서 굽는 셈과 **같은 셈**이다
 * (`@alarmtalk/voice` 의 `shiftVoicePitch` — 두 앱과 같은 기대값 테스트).
 *
 * 음량: eleven_v4_turbo 는 v3 보다 작게 낸다 — **모든 합성**을 `TTS_LOUDNESS_BOOST_DB` 만큼 올린다(`@alarmtalk/voice` 의
 * `boostLoudness`). 기본 목소리 게시본·앱 번들 인사말도 같은 셈·같은 값이라 미리듣기와 알람의 크기가 갈리지 않는다.
 *
 * 굽는 길: ElevenLabs 에 **압축하지 않은 PCM** 을 받아(MP3 를 풀지 않는다 — 손실 압축을 한 번만 거친다) 높이가 있으면
 * 높이를 바꾸고 크기를 원래대로 되맞춘 뒤, 음량을 올려 MP3 128 kbps 로 만든다(제공자 MP3 `mp3_44100_128` 과 같은
 * 형식·크기). 높이도 음량도 0 이면 굽지 않는다(`needsVoiceBake`) — 그때는 제공자 MP3 를 그대로 쓴다.
 */

/**
 * 굽는 합성이 ElevenLabs 에 받는 형식 — 16-bit 리틀엔디언 모노 PCM, 44.1 kHz. 음량을 올리는 동안
 * (`TTS_LOUDNESS_BOOST_DB` > 0)은 높이와 상관없이 **모든 합성**이 이 형식으로 받는다.
 */
export const SYNTHESIS_PCM_OUTPUT_FORMAT = 'pcm_44100';
export const SYNTHESIS_PCM_SAMPLE_RATE = 44_100;
/** 제공자 MP3(`mp3_44100_128`)와 같은 비트레이트 — 굽지 않은 소리와 형식·크기를 맞춘다. */
const SYNTHESIS_MP3_BITRATE = 128;
/** 인코더에 한 번에 넘기는 표본 수(1초) — 긴 클립도 WASM 메모리를 한꺼번에 키우지 않는다. */
const ENCODE_CHUNK_SAMPLES = SYNTHESIS_PCM_SAMPLE_RATE;
/**
 * 굽는 소리의 길이 상한. 직접 입력(200자)·프리셋 문구의 소리는 이보다 한참 짧다 — 넘으면 합성이 잘못된 것이고(모델이
 * 길게 지어낸 소리), 굽는 동안의 메모리(높이를 바꾸면 표본 수의 약 16배, 음량만이면 약 10배 + 인코더 16 MiB)가 워커
 * 한도(128 MB, WASM 메모리 포함)에 다가간다. 한도를 넘으면 워커가 잡을 수 없게 죽으므로, 그 전에 던져 실패로 센다.
 */
const MAX_BAKE_SECONDS = 60;

export interface VoicePitch {
  /** 반음(−6…+3, 0.5 눈금). 0 은 저장하지 않는다(행에는 NULL). */
  semitones: number;
  /**
   * 등록할 때의 합성 모델(`TTS_MODEL_ID`). 높이는 **그 모델이 낸 높이를 바로잡는 상대값**이라, 모델이 바뀐 뒤에는
   * 굽지 않는다(`appliedPitchSemitones`) — 새 모델에 옛 보정을 걸면 오히려 틀어진다.
   */
  modelId: string | null;
}

/**
 * 한 합성에 굽는 것. 둘 다 캐시 키에 들어간다(`computeTtsCacheKey` 의 `pitchSemitones`·`loudnessBoostDb` — 0 이면 빠진다).
 */
export interface VoiceBake {
  /** 높이(반음, `appliedPitchSemitones`). 0 이면 높이를 바꾸지 않는다. */
  pitchSemitones: number;
  /** 올리는 음량(dB, `TTS_LOUDNESS_BOOST_DB`). 0 이면 올리지 않는다. */
  loudnessBoostDb: number;
}

/**
 * 행에서 높이를 읽는다. 컬럼이 아직 없거나(배포 창 — 마이그레이션 #128 전) 비었거나 0 이거나 범위 밖이면 null.
 *
 * ⚠ 배포 창에 null 로 읽는 것은 **옳다** — 컬럼이 없으면 아무 목소리도 높이를 가질 수 없다(값은 그 컬럼에만
 *   적힌다). 그래서 이 값을 읽으려고 전용 SELECT 를 만들지 말 것: 직접 입력은 `SELECT *` 로 읽은 행을 그대로
 *   넘긴다(전용 쿼리면 그 창 동안 모든 직접 입력이 500 이 된다 — `tts.ts` 의 `requestVoiceGeneration` 주석).
 */
export function voicePitchFromRow(row: Record<string, unknown> | null | undefined): VoicePitch | null {
  if (!row) return null;
  const raw = row.pitch_semitones;
  if (raw === null || raw === undefined || raw === '') return null;
  const semitones = Number(raw);
  if (semitones === 0 || !VoicePitchSemitonesSchema.safeParse(semitones).success) return null;
  const modelId = typeof row.pitch_model_id === 'string' && row.pitch_model_id.trim() !== '' ? row.pitch_model_id : null;
  return { semitones, modelId };
}

/** 이번 합성에 실제로 굽는 반음. 0 이면 굽지 않는다 — 높이가 없거나, 등록 때의 모델과 지금 모델이 다르다. */
export function appliedPitchSemitones(pitch: VoicePitch | null | undefined, modelId: string): number {
  if (!pitch || pitch.semitones === 0) return 0;
  if (pitch.modelId !== modelId) return 0;
  return pitch.semitones;
}

/** 굽는가 — 높이든 음량이든 하나라도 있으면 PCM 으로 받아 굽는다. 둘 다 0 이면 제공자 MP3 를 그대로 쓴다. */
export function needsVoiceBake(bake: VoiceBake): boolean {
  return bake.pitchSemitones !== 0 || bake.loudnessBoostDb > 0;
}

let mp3EncoderModule: WebAssembly.Module | null = null;
/**
 * isolate 하나에 인코더 하나 — 만들어 두고 다시 쓴다(`configure` 로 다시 쓸 수 있다고 패키지 README 가 적고 있다).
 * ⚠ 굽기마다 새로 만들지 말 것: 인스턴스마다 WASM 메모리 16 MiB 를 새로 잡고 해제는 GC 몫이라, 연달아 구우면 워커
 *   메모리 한도(128 MB — WASM 메모리 포함)를 넘을 수 있다. 넘으면 잡을 수 없게 죽고 같은 isolate 의 다른 요청도
 *   함께 죽는다. 음량을 올리면서 **모든 합성**이 이 인코더를 지나므로 더 그렇다.
 */
let mp3Encoder: Promise<WasmMediaEncoder<'audio/mpeg'>> | null = null;

/**
 * MP3 인코더(LAME → WASM)를 넘겨받는다. 워커는 **미리 컴파일된 모듈만** 쓸 수 있어(실행 중 컴파일 금지) 진입점
 * (`src/index.ts`)이 `.wasm` 을 정적으로 import 해 여기 건넨다(묶는 규칙은 `wrangler.toml` 의 `[[rules]]`). 등록이
 * 빠지면 **모든 합성이 실패한다**(음량을 올리는 동안은 모든 합성이 굽는다). 테스트는 같은 파일을 컴파일해 넘긴다
 * (`vitest.config.ts` 의 alias·`setupFiles`).
 *
 * ⚠ 이 파일에서 `.wasm` 을 직접 import 하지 말 것 — Node 로 도는 스크립트(`scripts/publish-stock-clips.ts` 등)도
 *   합성 모듈을 거쳐 이 파일을 불러오는데, Node 는 `.wasm` import 를 풀지 못해 스크립트가 시작부터 죽는다. 스크립트가
 *   인코더를 쓰려면 같은 `.wasm` 을 스스로 컴파일해 여기 넘긴다(테스트의 `test/support/mp3-encoder-wasm.ts` 와 같은 방법).
 */
export function registerMp3EncoderModule(module: WebAssembly.Module): void {
  mp3EncoderModule = module;
  mp3Encoder = null;
}

/** 16-bit 리틀엔디언 PCM → [-1, 1) 실수. 홀수 바이트의 마지막 한 바이트는 버린다. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** 실수 표본을 MP3 로 만든다(모노·128 kbps CBR). */
export async function encodeMp3(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  if (!mp3EncoderModule) throw new Error('MP3 encoder module is not registered.');
  const pending = (mp3Encoder ??= createEncoder('audio/mpeg', mp3EncoderModule));
  let encoder: WasmMediaEncoder<'audio/mpeg'>;
  try {
    encoder = await pending;
  } catch (error) {
    if (mp3Encoder === pending) mp3Encoder = null;
    throw error;
  }
  // ⚠ `configure` 부터 `finalize` 까지 **await 을 두지 말 것** — 인코더 하나를 나눠 쓰므로, 사이에 await 이 있으면
  //   동시에 굽는 다른 요청이 끼어들어 두 소리가 한 스트림에 섞인다.
  try {
    encoder.configure({ channels: 1, sampleRate, bitrate: SYNTHESIS_MP3_BITRATE });
    // ⚠ `encode`·`finalize` 가 돌려주는 배열은 **다음 호출까지만** 유효한 WASM 메모리 창이다 — 매번 복사해 둔다.
    const chunks: Uint8Array[] = [];
    for (let start = 0; start < samples.length; start += ENCODE_CHUNK_SAMPLES) {
      chunks.push(encoder.encode([samples.subarray(start, start + ENCODE_CHUNK_SAMPLES)]).slice());
    }
    chunks.push(encoder.finalize().slice());
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch (error) {
    // 도중에 실패한 인코더는 상태를 믿을 수 없다 — 버리고 다음 굽기가 새로 만든다.
    if (mp3Encoder === pending) mp3Encoder = null;
    throw error;
  }
}

/**
 * ElevenLabs 가 준 PCM([SYNTHESIS_PCM_OUTPUT_FORMAT])을 [bake] 대로 구운 MP3 — 높이를 바꾸고(있으면) 음량을 올린다.
 *
 * ⚠ 실패하면 **던진다** — 받은 소리로 대신 올리지 말 것. 저장된 클립은 '완료' 로 남아 다시 만들어지지 않으므로,
 *   한 번의 실패가 그 목소리의 그 문구를 영구히 높이 없는(또는 작은) 소리로 만든다. 던지면 사전렌더는 다시 시도하고,
 *   직접 입력은 실패를 알린다(재시도하면 된다).
 */
export async function bakeVoiceMp3(pcm: Uint8Array, bake: VoiceBake): Promise<Uint8Array> {
  return encodeMp3(bakeVoiceSamples(pcm, bake), SYNTHESIS_PCM_SAMPLE_RATE);
}

/**
 * [bakeVoiceMp3] 의 앞 절반 — PCM 을 실수로 풀어 **높이 → 음량** 차례로 구운 표본(MP3 로 묶기 전).
 *
 * 차례가 정해져 있다: 높이를 바꾸면 크기를 **원래 소리**에 되맞추고(`shiftVoicePitch`), 음량은 그 뒤에 마지막으로
 * 올린다 — 그래서 높이가 있든 없든 결과는 받은 소리보다 같은 만큼 크다(봉우리 −0.2 dBFS 에 닿으면 그 직전까지).
 *
 * ⚠ 머리말 없는 16-bit 표본이 아니면 던진다 — 다른 형식(WAV·MP3)을 표본으로 읽으면 잡음을 구워 '완료' 로 게시한다.
 */
export function bakeVoiceSamples(pcm: Uint8Array, bake: VoiceBake): Float32Array {
  if (pcm.byteLength === 0) throw new Error('Voice bake received empty PCM.');
  if (pcm.byteLength % 2 !== 0) throw new Error('Voice bake received PCM with an odd byte length.');
  if (startsWithAscii(pcm, 'RIFF') || startsWithAscii(pcm, 'ID3')) {
    throw new Error('Voice bake received a container format instead of raw PCM.');
  }
  if (pcm.byteLength / 2 > MAX_BAKE_SECONDS * SYNTHESIS_PCM_SAMPLE_RATE) {
    throw new Error(`Voice bake refused audio longer than ${MAX_BAKE_SECONDS} seconds.`);
  }
  const samples = pcm16ToFloat32(pcm);
  const pitched =
    bake.pitchSemitones !== 0 ? shiftVoicePitch(samples, SYNTHESIS_PCM_SAMPLE_RATE, bake.pitchSemitones) : samples;
  return boostLoudness(pitched, bake.loudnessBoostDb).samples;
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}
