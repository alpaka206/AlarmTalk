import { describe, expect, it } from 'vitest';
import { boostLoudness } from '../src/loudness-boost.js';

describe('음량 올리기(boostLoudness)', () => {
  it('봉우리에 여유가 있으면 정확히 그 dB 만큼 올린다', () => {
    const x = Float32Array.from([0.1, -0.2, 0.3]);
    const { samples, gain } = boostLoudness(x, 4);
    expect(gain).toBeCloseTo(Math.pow(10, 4 / 20), 10);
    expect(samples[2]).toBeCloseTo(0.3 * Math.pow(10, 4 / 20), 6);
    expect(Array.from(x)).toEqual(Array.from(Float32Array.from([0.1, -0.2, 0.3]))); // 입력은 그대로
  });

  it('봉우리가 −0.2 dBFS 를 넘지 않게 그 직전까지만 올린다', () => {
    const { samples, gain } = boostLoudness(Float32Array.from([0.8, -0.5]), 4);
    expect(gain).toBeLessThan(Math.pow(10, 4 / 20));
    expect(Math.max(...Array.from(samples, Math.abs))).toBeCloseTo(Math.fround(0.977), 6);
  });

  it('이미 봉우리가 한도를 넘는 소리·무음·0 dB 는 그대로 둔다(줄이지 않는다)', () => {
    expect(boostLoudness(Float32Array.from([0.99, -0.1]), 4).gain).toBe(1);
    expect(boostLoudness(new Float32Array(10), 4).gain).toBe(1);
    expect(boostLoudness(Float32Array.from([0.1]), 0).gain).toBe(1);
  });
});
