/**
 * 브라우저에서 [이름 클립] + [고정 본문 클립] 을 이어 붙인다(2026-09-15 결정: 이름만 더빙).
 *
 * 왜 웹에서 붙이나: 이름은 문장 **맨 앞**에만 오고 뒤에 쉼표 쉼이 있어, 그 자리에서 짧게
 * 크로스페이드하면 이음새가 안 들린다. 서버에 오디오 디코드/인코드를 두지 않아도 되고,
 * 요청마다 만드는 것은 이름 0.5~1초뿐이며 본문은 CDN 에 캐시된 정적 파일이다.
 *
 * 흐름: fetch → decodeAudioData → OfflineAudioContext 에서 두 버퍼를 겹쳐 렌더 → 재생용 WAV
 * Blob(즉시) / 저장용 MP3(lamejs, 요청 시). 둘 다 `kind: "url"`(Blob URL)로 재생기에 넘긴다.
 *
 * 음량: 두 클립이 같은 목소리·같은 엔진에서 나와도 크기가 다를 수 있어 본문 RMS 에 이름을
 * 맞춘다(±6dB 안에서). 무음 꼬리: 이름 클립 끝의 무음을 잘라 쉼이 두 배로 길어지지 않게 한다.
 */

export type SpliceOptions = {
  /** 이름 → 본문 겹침(크로스페이드) 길이. 쉼표 쉼 안에서 사라질 정도로 짧게. */
  crossfadeMs?: number;
  /** 이름 뒤에 남길 쉼. 클립의 무음 꼬리를 자른 뒤 이만큼만 둔다. */
  pauseMs?: number;
  /** 무음으로 볼 임계(선형 진폭). */
  silenceFloor?: number;
};

const DEFAULTS: Required<SpliceOptions> = {
  crossfadeMs: 24,
  pauseMs: 140,
  silenceFloor: 0.012,
};

type Ctx = AudioContext | OfflineAudioContext;

/** URL → AudioBuffer. 디코드는 컨텍스트가 필요하다(샘플레이트가 그 컨텍스트로 맞춰진다). */
export async function loadClip(ctx: Ctx, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`clip ${res.status}: ${url}`);
  const bytes = await res.arrayBuffer();
  return await ctx.decodeAudioData(bytes);
}

/** 채널을 합쳐 모노 Float32Array 로. 스플라이스는 모노로 한다(목소리 클립이라 손해가 없다). */
function toMono(buf: AudioBuffer): Float32Array {
  const n = buf.length;
  const out = new Float32Array(n);
  const channels = buf.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i] / channels;
  }
  return out;
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to; i++) {
    sum += samples[i] * samples[i];
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** 앞뒤 무음을 잘라 낸 구간 [start, end). */
function trimSilence(samples: Float32Array, floor: number): [number, number] {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < floor) start++;
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]) < floor) end--;
  return [start, end];
}

/**
 * 이름 + 본문 → 한 버퍼. 결과 샘플레이트는 본문 클립을 따른다.
 *
 *   [이름(무음 잘라냄, 본문 음량에 맞춤)] [pause] [본문]
 *                                 └─ crossfade ─┘
 */
export function spliceNameAndBody(
  name: AudioBuffer,
  body: AudioBuffer,
  opts: SpliceOptions = {},
): AudioBuffer {
  const o = { ...DEFAULTS, ...opts };
  const sr = body.sampleRate;
  const bodyMono = toMono(body);
  const nameMonoRaw = toMono(resampleIfNeeded(name, sr));
  const [ns, ne] = trimSilence(nameMonoRaw, o.silenceFloor);
  const nameMono = nameMonoRaw.subarray(ns, ne);
  const [bs] = trimSilence(bodyMono, o.silenceFloor);

  // 음량 맞추기: 이름을 본문의 RMS 에 맞춘다(±6dB 로 제한 — 클립이 잘못돼도 폭발하지 않게).
  const nameRms = rms(nameMono);
  const bodyRms = rms(bodyMono, bs, Math.min(bodyMono.length, bs + sr * 2));
  let gain = nameRms > 0 && bodyRms > 0 ? bodyRms / nameRms : 1;
  gain = Math.min(2, Math.max(0.5, gain));

  const fade = Math.round((o.crossfadeMs / 1000) * sr);
  const pause = Math.round((o.pauseMs / 1000) * sr);
  const bodyStart = nameMono.length + pause - fade; // 본문이 시작되는 샘플(겹침 시작)
  const bodyLen = bodyMono.length - bs;
  const total = bodyStart + bodyLen;
  const out = new Float32Array(total);

  for (let i = 0; i < nameMono.length; i++) out[i] = nameMono[i] * gain;
  for (let i = 0; i < bodyLen; i++) {
    const at = bodyStart + i;
    let s = bodyMono[bs + i];
    if (i < fade) {
      // 겹치는 구간: 본문은 올라오고, 이미 있던 이름 꼬리·무음은 내려간다.
      const t = i / fade;
      s = s * t + out[at] * (1 - t);
    }
    out[at] = s;
  }

  const result = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: sr });
  result.copyToChannel(out, 0);
  return result;
}

/** 샘플레이트가 다르면 선형 보간으로 맞춘다(목소리 클립엔 충분). 같으면 그대로. */
function resampleIfNeeded(buf: AudioBuffer, sr: number): AudioBuffer {
  if (buf.sampleRate === sr) return buf;
  const ratio = buf.sampleRate / sr;
  const len = Math.round(buf.length / ratio);
  const out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: sr });
  const src = toMono(buf);
  const dst = out.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = pos - i0;
    dst[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  return out;
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** 재생용 WAV(16-bit PCM 모노). 인코딩이 없어 즉시 만들어진다. */
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const pcm = toInt16(toMono(buf));
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm.buffer as ArrayBuffer], { type: "audio/wav" });
}

/** 저장용 MP3(모노, 128kbps). 인코더는 누를 때만 불러온다 — 첫 화면 번들에 얹지 않는다. */
export async function audioBufferToMp3(buf: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const pcm = toInt16(toMono(buf));
  const enc = new Mp3Encoder(1, buf.sampleRate, 128);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  for (let i = 0; i < pcm.length; i += block) {
    const part = enc.encodeBuffer(pcm.subarray(i, i + block));
    if (part.length) chunks.push(part);
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(tail);
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}
