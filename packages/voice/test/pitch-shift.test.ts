import { describe, expect, it } from 'vitest';
import { integratedLoudness, pitchTrack, resample, shiftVoicePitch } from '../src/pitch-shift.js';

/**
 * 기대값은 **두 앱 테스트와 같은 숫자**다 — 안드로이드 `VoicePitchShifterTest`·iOS `VoicePitchShifterTests`
 * (셈을 바꾸면 세 테스트의 숫자를 함께 고친다).
 * 같은 입력을 세 구현이 같은 셈으로 굽는다는 것을 고정한다(앱은 미리듣기를, 서버는 알람 소리를 굽는다 —
 * 갈리면 들은 소리와 우는 소리가 달라진다).
 */

/** 앞 0.2초 무음 + 떨림(160±15 Hz) 있는 배음 소리(44.1 kHz, 1초). */
function vibratoTone(): Float32Array {
  const sr = 44_100;
  let phase = 0.0;
  const x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) {
    const t = i / sr;
    if (t < 0.2) {
      x[i] = 0;
      continue;
    }
    const f = 160 + 15 * Math.sin(2 * Math.PI * 1.3 * t);
    phase += (2 * Math.PI * f) / sr;
    x[i] = Math.fround(0.4 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)));
  }
  return x;
}

describe('목소리 높이 바꾸기(TD-PSOLA)', () => {
  it('표본률 바꾸기는 두 앱과 같은 값을 낸다', () => {
    const sr = 44_100.0;
    const x = new Float32Array(4_410);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] = Math.fround(
        0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.25 * Math.sin(2 * Math.PI * 3_100 * t) + 0.1 * Math.sin(2 * Math.PI * 9_000 * t),
      );
    }
    const y = resample(x, 44_100, 16_000);
    expect(y.length).toBe(1_600);
    expect(y[1]).toBeCloseTo(0.08122162520885468, 5);
    expect(y[100]).toBeCloseTo(0.5854929089546204, 5);
    expect(y[777]).toBeCloseTo(-0.24569550156593323, 5);
    expect(y[1_599]).toBeCloseTo(-0.26356241106987, 5);
    let sum = 0;
    for (const v of y) sum += Math.abs(v);
    expect(Math.abs(sum - 539.0014692312106)).toBeLessThan(1e-2);
  });

  it('높이 추적과 바꾼 결과가 두 앱과 같다', () => {
    const x = vibratoTone();
    const track = pitchTrack(x, 44_100);
    expect(track.f0.length).toBe(96);
    expect(Array.from(track.f0).filter((f) => f > 0).length).toBe(77);
    const sumF0 = Array.from(track.f0).reduce((a, b) => a + b, 0);
    expect(Math.abs(sumF0 - 12322.340158236248)).toBeLessThan(1e-6);

    const y = shiftVoicePitch(x, 44_100, -2);
    expect(y.length).toBe(44_100);
    let sum = 0;
    for (const v of y) sum += Math.abs(v);
    expect(Math.abs(sum - 9739.548)).toBeLessThan(1e-3);
    expect(Math.abs(y[30_000] - 0.32448906)).toBeLessThan(1e-6);
    expect(Math.abs(y[40_000] - 0.546782)).toBeLessThan(1e-6);
  });

  it('0 반음이면 그대로 돌려주고 입력을 바꾸지 않는다', () => {
    const x = vibratoTone();
    const before = Float32Array.from(x);
    const same = shiftVoicePitch(x, 44_100, 0);
    expect(Array.from(same)).toEqual(Array.from(before));
    shiftVoicePitch(x, 44_100, -3);
    expect(Array.from(x)).toEqual(Array.from(before));
  });

  it('바꾼 소리의 크기를 원래 소리와 맞추고 봉우리는 −0.2 dBFS 아래로 둔다', () => {
    const x = vibratoTone();
    const original = integratedLoudness(x, 44_100)!;
    for (const semitones of [-6, -1.5, 3]) {
      const y = shiftVoicePitch(x, 44_100, semitones);
      const loud = integratedLoudness(y, 44_100)!;
      let peak = 0;
      for (const v of y) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThanOrEqual(Math.fround(0.977) + 1e-7);
      // 봉우리 제한에 걸리지 않으면 거의 같다.
      expect(Math.abs(loud - original)).toBeLessThan(1.5);
    }
  });

  it('빈 입력·무음은 그대로다', () => {
    expect(shiftVoicePitch(new Float32Array(0), 44_100, -2).length).toBe(0);
    const silence = new Float32Array(44_100);
    const y = shiftVoicePitch(silence, 44_100, -2);
    expect(y.length).toBe(44_100);
    expect(Array.from(y).every((v) => v === 0)).toBe(true);
  });
});
