/**
 * 합성한 목소리의 음량을 **정해진 데시벨만큼** 올린다(2026-10-08 사용자: v4 Turbo 를 +4 dB).
 *
 * v4 Turbo 는 같은 목소리·같은 문장을 v3 보다 1~8 dB 작게 낸다(2026-09-30 측정, 애니 −7.5) — 귀에 들리는 인상과
 * 상관없이 소리 자체가 작다. 서버가 만드는 소리(클론 프리셋·직접 입력)와 기본 목소리 게시본·앱 번들 인사말이 **모두
 * 이 셈 하나로** 같은 만큼 올라가야 미리듣기와 알람의 크기가 갈리지 않는다(스펙 voice-and-message §10).
 *
 * ⚠ 봉우리가 −0.2 dBFS([PEAK_LIMIT])를 넘으면 그 직전까지만 올린다 — 자르면(클리핑) 소리가 찌그러진다. 그래서 이미
 *   봉우리가 높은 클립은 덜 올라간다. 원래 봉우리가 한도를 넘는 소리는 줄이지 않고 그대로 둔다(올리지만 않는다).
 */

/** 봉우리 상한(−0.2 dBFS) — 높이 바꾸기(`shiftVoicePitch`)의 크기 되맞춤과 같은 값. */
const PEAK_LIMIT = Math.fround(0.977);

/** [samples] 를 [db] 데시벨 올린 사본과 실제로 건 배율. 입력은 바꾸지 않는다. */
export function boostLoudness(samples: Float32Array, db: number): { samples: Float32Array; gain: number } {
  const out = Float32Array.from(samples);
  if (!(db > 0) || samples.length === 0) return { samples: out, gain: 1 };
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  if (peak === 0) return { samples: out, gain: 1 };
  const gain = Math.max(1, Math.min(Math.pow(10, db / 20), PEAK_LIMIT / peak));
  if (gain === 1) return { samples: out, gain };
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * gain;
  return { samples: out, gain };
}
