import { describe, it, expect } from 'vitest';
import { resolvePrerenderWeatherIndex, type WeatherSignalInput } from '../src/routes/tts';
import { CLONE_WEATHER_CONDITIONS, CLONE_FORTUNE_THEMES } from '../src/lib/stock-clips';

// 클라 hasCompleteCloneBucket 가 날씨=8·운세=5 를 하드코딩하므로(오프라인 버킷 '완전' 판정),
// 백엔드 개수가 바뀌면 이 단언이 깨져 클라 상수 동기화를 강제한다.
describe('클론 매칭 버킷 개수 계약', () => {
  it('날씨 조건=8, 운세 테마=5 (클라 하드코딩과 일치해야 함)', () => {
    expect(CLONE_WEATHER_CONDITIONS.length).toBe(8);
    expect(CLONE_FORTUNE_THEMES.length).toBe(5);
  });
});

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
  it('맑고 추운 날(최저<=0/최고<=5) → cold (nice 오재 방지)', () => {
    expect(resolvePrerenderWeatherIndex({ ...base, code: 0, maxTemp: 2, minTemp: -7 })).toBe(
      idx('cold'),
    );
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
