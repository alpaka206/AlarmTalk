import { describe, it, expect } from 'vitest';
import {
  resolvePrerenderWeatherIndex,
  resolveFortuneThemeIndex,
  type WeatherSignalInput,
} from '../src/routes/tts';
import { CLONE_WEATHER_CONDITIONS, CLONE_FORTUNE_THEMES } from '../src/lib/stock-clips';

const base: WeatherSignalInput = {
  code: 0,
  maxTemp: 20,
  minTemp: 12,
  rainProbability: 0,
  precipitation: 0,
  hasDust: false,
};

const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);

describe('resolvePrerenderWeatherIndex (CLONE_WEATHER_CONDITIONS 순서 인덱스)', () => {
  it('눈 코드 → snow', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 73 })).toBe(idx('snow'));
  });
  it('강수확률/코드 → rain', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, rainProbability: 40 })).toBe(idx('rain'));
    expect(resolvePrerenderWeatherIndex({ ...base, code: 63 })).toBe(idx('rain'));
  });
  it('미세먼지 → dust (비/눈 없을 때)', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, hasDust: true })).toBe(idx('dust'));
  });
  it('안개 코드(45/48) → fog', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 45 })).toBe(idx('fog'));
  });
  it('고온(>=30) → heat', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, maxTemp: 32 })).toBe(idx('heat'));
  });
  it('흐림 코드(2/3) → cloud', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 3 })).toBe(idx('cloud'));
  });
  it('맑음(기본) → nice', () => {
    expect(resolvePrerenderWeatherIndex(base)).toBe(idx('nice'));
  });
  it('우선순위: 눈>비>미세먼지 (동시 조건)', () => {
    expect(
      resolvePrerenderWeatherIndex({ ...base, code: 73, rainProbability: 90, hasDust: true }),
    ).toBe(idx('snow'));
  });
  it('반환 인덱스는 항상 0..conditions-1 범위', () => {
    const i = resolvePrerenderWeatherIndex({ ...base, code: 45 });
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(CLONE_WEATHER_CONDITIONS.length);
  });
});

describe('resolveFortuneThemeIndex (사주+날짜 결정적 테마)', () => {
  const N = CLONE_FORTUNE_THEMES.length;
  it('같은 사람·같은 날짜면 항상 같은 테마(결정적)', () => {
    const a = resolveFortuneThemeIndex('female', '1995-05-19', '07:30', '2026-07-14', N);
    const b = resolveFortuneThemeIndex('female', '1995-05-19', '07:30', '2026-07-14', N);
    expect(a).toBe(b);
  });
  it('날짜가 다르면 테마가 달라질 수 있다(하루 단위 변화)', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      resolveFortuneThemeIndex('female', '1995-05-19', '07:30', `2026-07-${10 + i}`, N),
    );
    expect(new Set(days).size).toBeGreaterThan(1);
  });
  it('사람이 다르면 같은 날 테마가 갈릴 수 있다', () => {
    const p1 = resolveFortuneThemeIndex('female', '1995-05-19', '07:30', '2026-07-14', N);
    const p2 = resolveFortuneThemeIndex('male', '1980-01-02', '23:10', '2026-07-14', N);
    // 결정적이며 각자 0..N-1 범위(값이 우연히 같을 수도 있으나 범위는 보장).
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(N);
    expect(p2).toBeGreaterThanOrEqual(0);
    expect(p2).toBeLessThan(N);
  });
  it('themeCount<=0 이면 0', () => {
    expect(resolveFortuneThemeIndex('x', 'y', 'z', 'd', 0)).toBe(0);
  });
});
