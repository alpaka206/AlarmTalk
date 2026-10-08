/**
 * 목소리 높이 바꾸기 — **몸집(포먼트) 유지 TD-PSOLA**(2026-10-07 사용자 결정: 높이만, 몸집 유지 방식).
 *
 * ⚠ **두 앱과 같은 셈이다** — 안드로이드 `VoicePitchShifter.kt`·`VoiceTuningAnalysis.kt` 를 한 줄씩 옮겼고,
 * iOS `VoicePitchShifter.swift`·`VoiceTuningAnalyzer.swift` 도 같은 셈으로 맞춰 두었다(앱 쪽은 PR #870 — 아직
 * develop 에 없다). 앱은 등록 미리듣기를 기기에서 굽고(파일 없이), 서버는 그 목소리로 만드는 모든 알람 소리를
 * 이걸로 굽는다 — 셈이 갈리면 미리듣기에서 들은 소리와 알람 소리가 달라진다. 회귀 테스트(`test/pitch-shift.test.ts`)가
 * 두 앱 테스트와 **같은 기대값**을 둔다.
 *
 * Kotlin 의 `Float` 지점은 `Float32Array` 에 담거나 `Math.fround` 로 흉내 낸다(같은 자리에서 반올림해야 같은
 * 결과가 나온다). 숫자 상수도 Kotlin 과 같다.
 */

/** 바꾼 소리의 봉우리 상한(−0.2 dBFS). */
const PEAK_LIMIT = Math.fround(0.977);
/** 높이 추적 표본률 — 원본 표본률과 상관없이 **정확히 16 kHz** 로 바꾼 뒤 잰다. */
const ANALYSIS_RATE_HZ = 16000;
const HOP_SECONDS = 0.01;
const WINDOW_SECONDS = 0.025;
const UNVOICED_HOP_SECONDS = 0.005;
const MARK_LOWPASS_HZ = 900.0;
const TRACK_HIGHPASS_HZ = 40.0;
const TRACK_LOWPASS_HZ = 1200.0;
/** 가장 큰 프레임(95분위)보다 이만큼 작으면 무성. */
const VOICING_GATE_DB = 35.0;
/** 앞뒤 5프레임 중앙값에서 이만큼 넘게 튄 프레임은 옥타브 오류로 보고 버린다. */
const OCTAVE_JUMP_SEMITONES = 7.0;

const YIN_THRESHOLD = 0.2;
const MIN_F0_HZ = 50.0;
const MAX_F0_HZ = 500.0;
const ABSOLUTE_GATE_LUFS = -70.0;

type Coefficients = readonly [number, number, number, number, number];

/** 10 ms 간격 F0 트랙(Hz, 무성 0)과 첫 프레임 중심 시각(초). */
export interface PitchTrack {
  f0: Float64Array;
  firstFrameSeconds: number;
}

/**
 * 높이를 [semitones] 만큼 바꾸고, 크기를 원래 소리와 같은 통합 라우드니스로 되맞춘다(봉우리는 [PEAK_LIMIT] 아래).
 * 0 이면 입력을 복사해 돌려준다. 결과 길이는 입력과 같다. 입력은 바꾸지 않는다.
 */
export function shiftVoicePitch(samples: Float32Array, sampleRate: number, semitones: number): Float32Array {
  if (semitones === 0 || samples.length === 0 || sampleRate <= 0) return Float32Array.from(samples);
  const factor = Math.pow(2.0, semitones / 12.0);
  const shifted = psola(samples, sampleRate, factor);
  return matchLoudness(shifted, sampleRate, integratedLoudness(samples, sampleRate));
}

/** [y] 를 [targetLufs] 에 맞춘다(제자리). 봉우리가 [PEAK_LIMIT] 를 넘지 않게 게인을 줄인다. */
export function matchLoudness(y: Float32Array, sampleRate: number, targetLufs: number | null): Float32Array {
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]!));
  if (peak <= 0) return y;
  const current = integratedLoudness(y, sampleRate);
  const wanted = targetLufs != null && current != null ? Math.pow(10.0, (targetLufs - current) / 20.0) : 1.0;
  const gain = Math.fround(Math.min(wanted, PEAK_LIMIT / peak));
  if (gain === 1) return y;
  for (let i = 0; i < y.length; i++) y[i] = Math.fround(y[i]! * gain);
  return y;
}

/**
 * **정확히 16 kHz 로 바꾼 뒤**([resample]) 40 Hz~1.2 kHz 로 걸러 25 ms 프레임 YIN(문턱 0.2).
 * 큰 소리 대비 −35 dB 아래와 주변보다 7 반음 넘게 튄 프레임은 무성으로 돌린다(앞에서부터 차례로).
 */
export function pitchTrack(samples: Float32Array, sampleRate: number): PitchTrack {
  const rate = ANALYSIS_RATE_HZ;
  const resampled = resample(samples, sampleRate, rate);
  const x = biquad(biquad(resampled, rbj(TRACK_HIGHPASS_HZ, rate, false)), rbj(TRACK_LOWPASS_HZ, rate, true));
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const window = Math.round(rate * WINDOW_SECONDS);
  const tauMax = Math.ceil(rate / MIN_F0_HZ);
  const f0: number[] = [];
  const levels: number[] = [];
  let start = 0;
  while (start + window + tauMax < x.length) {
    let energy = 0.0;
    for (let j = 0; j < window; j++) energy += x[start + j]! * x[start + j]!;
    levels.push(20.0 * Math.log10(Math.sqrt(energy / window) + 1e-12));
    f0.push(yinFrequency(x, start, window, rate) ?? 0.0);
    start += hop;
  }
  const track = Float64Array.from(f0);
  if (track.length > 0) {
    const sorted = levels.slice().sort((a, b) => a - b);
    const loud = sorted[Math.min(Math.trunc(sorted.length * 0.95), sorted.length - 1)]!;
    for (let i = 0; i < track.length; i++) if (levels[i]! < loud - VOICING_GATE_DB) track[i] = 0.0;
    for (let i = 0; i < track.length; i++) {
      if (track[i]! === 0.0) continue;
      const neighbors: number[] = [];
      for (let k = Math.max(0, i - 5); k <= Math.min(track.length - 1, i + 5); k++) {
        if (track[k]! > 0.0) neighbors.push(track[k]!);
      }
      if (neighbors.length < 3) {
        track[i] = 0.0;
        continue;
      }
      neighbors.sort((a, b) => a - b);
      const median = neighbors[Math.trunc(neighbors.length / 2)]!;
      if (Math.abs((12.0 * Math.log(track[i]! / median)) / Math.log(2.0)) > OCTAVE_JUMP_SEMITONES) track[i] = 0.0;
    }
  }
  return { f0: track, firstFrameSeconds: window / 2.0 / rate };
}

function psola(x: Float32Array, sr: number, factor: number): Float32Array {
  const track = pitchTrack(x, sr);
  const raw = track.f0;
  if (raw.length === 0) return Float32Array.from(x);
  const xl = biquad(x, rbj(MARK_LOWPASS_HZ, sr, true));

  // 5 프레임 중앙값으로 매끈하게 + 30 ms 이하 무성 틈은 양끝을 이어 메운다.
  const smooth = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]! === 0.0) {
      smooth[i] = 0.0;
      continue;
    }
    const w: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) if (raw[k]! > 0.0) w.push(raw[k]!);
    w.sort((a, b) => a - b);
    smooth[i] = w[Math.trunc(w.length / 2)]!;
  }
  let i = 1;
  while (i < smooth.length - 1) {
    if (smooth[i]! !== 0.0) {
      i++;
      continue;
    }
    let j = i;
    while (j < smooth.length && smooth[j]! === 0.0) j++;
    if (j - i <= 3 && smooth[i - 1]! !== 0.0 && j < smooth.length) {
      for (let k = i; k < j; k++) {
        smooth[k] = smooth[i - 1]! + ((smooth[j]! - smooth[i - 1]!) * (k - i + 1)) / (j - i + 1);
      }
    }
    i = j + 1;
  }
  const f0At = (n: number): number => {
    const idx = Math.round((n / sr - track.firstFrameSeconds) / HOP_SECONDS);
    return idx < 0 || idx >= smooth.length ? 0.0 : smooth[idx]!;
  };

  // 분석 표시 — 유성이면 한 주기마다, 무성이면 5 ms 마다.
  // ⚠ 두 간격 모두 1 아래로 내려가지 않게 둔다 — 0 이면 n 이 나아가지 않아 끝나지 않고, 워커에서는 잡을 수 없는 CPU
  //   초과로 죽는다. 닿을 수 있는 입력(표본률 100 Hz 이상, 높이 88 kHz 미만)에서는 결과가 앱과 같다.
  const unvoicedHop = Math.max(1, Math.round(sr * UNVOICED_HOP_SECONDS));
  const markAt: number[] = [];
  const markPeriod: number[] = [];
  const markVoiced: boolean[] = [];
  let n = 0;
  let prevVoiced = false;
  while (n < x.length) {
    const f = f0At(n);
    if (f > 0.0) {
      const period = Math.max(1, Math.round(sr / f));
      let best: number;
      let bestValue = Number.NEGATIVE_INFINITY;
      if (!prevVoiced) {
        // 유성 구간의 첫 표시 — 한 주기 안에서 가장 큰 봉우리.
        best = n;
        for (let k = n; k <= Math.min(x.length - 1, n + period); k++) {
          if (xl[k]! > bestValue) {
            bestValue = xl[k]!;
            best = k;
          }
        }
      } else {
        // 직전 표시 둘레 한 주기 파형과 가장 닮은 자리(정규화 상호상관)를 다음 표시로.
        const previous = markAt[markAt.length - 1]!;
        const half = Math.round(period / 2.0);
        best = n;
        const reach = Math.round(0.15 * period);
        for (let k = Math.max(half, n - reach); k <= Math.min(x.length - 1 - half, n + reach); k++) {
          let sxy = 0.0;
          let sxx = 0.0;
          let syy = 0.0;
          for (let jj = -half; jj < half; jj++) {
            const ai = previous + jj;
            const a = ai >= 0 && ai < xl.length ? xl[ai]! : 0.0;
            const b = xl[k + jj]!;
            sxy += a * b;
            sxx += a * a;
            syy += b * b;
          }
          const r = sxy / Math.sqrt(sxx * syy + 1e-12);
          if (r > bestValue) {
            bestValue = r;
            best = k;
          }
        }
      }
      if (markAt.length > 0 && best <= markAt[markAt.length - 1]!) {
        best = markAt[markAt.length - 1]! + Math.round(0.5 * period);
      }
      markAt.push(best);
      markPeriod.push(period);
      markVoiced.push(true);
      n = best + period;
      prevVoiced = true;
    } else {
      markAt.push(n);
      markPeriod.push(unvoicedHop);
      markVoiced.push(false);
      n += unvoicedHop;
      prevVoiced = false;
    }
  }

  // 합성 — 표시 간격만 1/배율로 바꿔 다시 겹쳐 더한다(무성은 그대로).
  const y = new Float32Array(x.length);
  let k = 0;
  let ts = markAt[0]!;
  while (ts < x.length) {
    while (k + 1 < markAt.length && Math.abs(markAt[k + 1]! - ts) <= Math.abs(markAt[k]! - ts)) k++;
    const center = markAt[k]!;
    const period = markPeriod[k]!;
    const left = Math.round(k > 0 ? Math.min(Math.max(center - markAt[k - 1]!, 0.5 * period), 1.5 * period) : period);
    const right = Math.round(
      k + 1 < markAt.length ? Math.min(Math.max(markAt[k + 1]! - center, 0.5 * period), 1.5 * period) : period,
    );
    const t0 = Math.round(ts);
    for (let jj = -left; jj <= right; jj++) {
      const src = center + jj;
      const dst = t0 + jj;
      if (src < 0 || src >= x.length || dst < 0 || dst >= y.length) continue;
      const w = jj < 0 ? 0.5 * (1 + Math.cos((Math.PI * jj) / left)) : 0.5 * (1 + Math.cos((Math.PI * jj) / right));
      // Kotlin: y[dst] += (x[src] * w).toFloat() — Float + Float.
      y[dst] = y[dst]! + Math.fround(x[src]! * w);
    }
    ts += markVoiced[k]! ? period / factor : unvoicedHop;
  }
  return y;
}

/**
 * 표본률 바꾸기 — 내릴 때는 먼저 새 나이퀴스트 아래(0.45 × 목표)로 RBJ 저역통과를 두 번 걸고(Direct Form I),
 * `i × 원본/목표` 자리를 선형 보간한다. 길이는 `⌊n × 목표 / 원본⌋`.
 */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to || x.length === 0 || from <= 0 || to <= 0) return x;
  let src: Float32Array;
  if (to < from) {
    const c = rbj(0.45 * to, from, true);
    src = biquad(biquad(x, c), c);
  } else {
    src = x;
  }
  const count = Math.max(1, Math.trunc((x.length * to) / from));
  const step = from / to;
  const out = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const position = index * step;
    const i0 = Math.min(src.length - 1, Math.trunc(position));
    const i1 = Math.min(src.length - 1, i0 + 1);
    const fraction = Math.fround(position - i0);
    out[index] = Math.fround(src[i0]! + Math.fround(Math.fround(src[i1]! - src[i0]!) * fraction));
  }
  return out;
}

/** 한 단 RBJ 필터(Q 1/√2) 계수 — [b0, b1, b2, a1, a2](a0 로 정규화). */
function rbj(cutoffHz: number, sr: number, lowpass: boolean): Coefficients {
  const w0 = (2.0 * Math.PI * cutoffHz) / sr;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * 0.7071067811865476);
  const a0 = 1.0 + alpha;
  const b0 = lowpass ? (1 - c) / 2 : (1 + c) / 2;
  const b1 = lowpass ? 1 - c : -(1 + c);
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

/** Direct Form I(Double 로 누산해 표본마다 Float 로). */
function biquad(x: Float32Array, c: Coefficients): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0.0;
  let x2 = 0.0;
  let y1 = 0.0;
  let y2 = 0.0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const v = c[0] * x0 + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * 한 프레임의 YIN 추정(Hz). 문턱 아래로 내려가는 첫 지연을 찾아 그 골짜기 바닥까지 따라가고,
 * 포물선 보간으로 소수 지연을 구한다. 문턱 아래가 없으면 무성(null).
 */
function yinFrequency(signal: Float32Array, start: number, window: number, sampleRate: number): number | null {
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));
  const tauMax = Math.ceil(sampleRate / MIN_F0_HZ);
  if (start < 0 || start + window + tauMax + 1 > signal.length) return null;
  const difference = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0.0;
    for (let j = 0; j < window; j++) {
      const delta = signal[start + j]! - signal[start + j + tau]!;
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  const normalized = new Float64Array(tauMax + 2);
  normalized[0] = 1.0;
  let running = 0.0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    running += difference[tau]!;
    normalized[tau] = running <= 0.0 ? 1.0 : (difference[tau]! * tau) / running;
  }
  let tau = tauMin;
  let found = -1;
  while (tau <= tauMax) {
    if (normalized[tau]! < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && normalized[tau + 1]! < normalized[tau]!) tau++;
      found = tau;
      break;
    }
    tau++;
  }
  if (found < 0) return null;
  let refined = found;
  if (found >= 1 && found < tauMax + 1) {
    const s0 = normalized[found - 1]!;
    const s1 = normalized[found]!;
    const s2 = normalized[found + 1]!;
    const denominator = s0 + s2 - 2.0 * s1;
    if (Math.abs(denominator) > 1e-12) refined = found + (s0 - s2) / (2.0 * denominator);
  }
  if (refined <= 0.0) return null;
  return sampleRate / refined;
}

/** BS.1770 근사 통합 음량(LUFS, 모노). 게이트를 통과한 블록이 없으면 null. */
export function integratedLoudness(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length === 0 || sampleRate <= 0) return null;
  const weighted = kWeight(samples, sampleRate);
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.max(1, Math.round(0.1 * sampleRate));
  const powers: number[] = [];
  if (weighted.length <= block) {
    powers.push(meanSquare(weighted, 0, weighted.length));
  } else {
    for (let start = 0; start + block <= weighted.length; start += hop) powers.push(meanSquare(weighted, start, block));
  }
  const gated = powers.filter((p) => p > 0.0 && blockLoudness(p) > ABSOLUTE_GATE_LUFS);
  if (gated.length === 0) return null;
  let sum = 0;
  for (const g of gated) sum += g;
  return blockLoudness(sum / gated.length);
}

/** BS.1770 K-가중 두 단(임의 표본률 — libebur128 과 같은 설계식). */
function kWeight(samples: Float32Array, sampleRate: number): Float32Array {
  const fs = sampleRate;
  // 1단: 고역 셸프(+4 dB, ~1.68 kHz)
  const shelfF0 = 1681.974450955533;
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * shelfF0) / fs);
  const vh = Math.pow(10.0, shelfGain / 20.0);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0Shelf = 1.0 + k1 / shelfQ + k1 * k1;
  const shelf: Coefficients = [
    (vh + (vb * k1) / shelfQ + k1 * k1) / a0Shelf,
    (2.0 * (k1 * k1 - vh)) / a0Shelf,
    (vh - (vb * k1) / shelfQ + k1 * k1) / a0Shelf,
    (2.0 * (k1 * k1 - 1.0)) / a0Shelf,
    (1.0 - k1 / shelfQ + k1 * k1) / a0Shelf,
  ];
  // 2단: RLB 고역 통과(~38 Hz)
  const hpF0 = 38.13547087602444;
  const hpQ = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * hpF0) / fs);
  const a0Hp = 1.0 + k2 / hpQ + k2 * k2;
  const highPass: Coefficients = [1.0, -2.0, 1.0, (2.0 * (k2 * k2 - 1.0)) / a0Hp, (1.0 - k2 / hpQ + k2 * k2) / a0Hp];
  return biquad(biquad(samples, shelf), highPass);
}

function blockLoudness(meanSquareValue: number): number {
  return -0.691 + 10.0 * Math.log10(meanSquareValue);
}

function meanSquare(samples: Float32Array, start: number, length: number): number {
  if (length <= 0) return 0.0;
  let sum = 0.0;
  for (let i = start; i < start + length; i++) sum += samples[i]! * samples[i]!;
  return sum / length;
}
