import { generateWaveform, formatTime } from '../src/utils/waveform';

describe('generateWaveform', () => {
  it('지정된 barCount만큼 배열을 반환한다', () => {
    expect(generateWaveform('test', 10)).toHaveLength(10);
    expect(generateWaveform('test', 50)).toHaveLength(50);
    expect(generateWaveform('test', 0)).toHaveLength(0);
  });

  it('모든 값이 0~1 범위 안에 있다', () => {
    const bars = generateWaveform('hello', 100);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(1);
    }
  });

  it('모든 값이 0.15 이상이다 (최소 바 높이)', () => {
    const bars = generateWaveform('any seed', 100);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('같은 seed + barCount면 항상 동일한 결과를 반환한다 (결정론적)', () => {
    const a = generateWaveform('deterministic', 30);
    const b = generateWaveform('deterministic', 30);
    expect(a).toEqual(b);
  });

  it('다른 seed면 다른 결과를 반환한다', () => {
    const a = generateWaveform('alpha', 20);
    const b = generateWaveform('beta', 20);
    expect(a).not.toEqual(b);
  });

  it('빈 seed도 동작한다', () => {
    const bars = generateWaveform('', 10);
    expect(bars).toHaveLength(10);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0.15);
      expect(bar).toBeLessThanOrEqual(1);
    }
  });

  it('한글 seed도 동작한다', () => {
    const bars = generateWaveform('안녕하세요', 20);
    expect(bars).toHaveLength(20);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0.15);
    }
  });
});

describe('formatTime', () => {
  it('0ms → "0:00"', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('1000ms → "0:01"', () => {
    expect(formatTime(1000)).toBe('0:01');
  });

  it('59000ms → "0:59"', () => {
    expect(formatTime(59000)).toBe('0:59');
  });

  it('60000ms → "1:00"', () => {
    expect(formatTime(60000)).toBe('1:00');
  });

  it('90000ms → "1:30"', () => {
    expect(formatTime(90000)).toBe('1:30');
  });

  it('3661000ms → "61:01" (1시간 1분 1초)', () => {
    expect(formatTime(3661000)).toBe('61:01');
  });

  it('소수점 ms는 버림한다 (1999ms → "0:01")', () => {
    expect(formatTime(1999)).toBe('0:01');
  });

  it('초 한자리수는 0으로 패딩한다', () => {
    expect(formatTime(5000)).toBe('0:05');
    expect(formatTime(65000)).toBe('1:05');
  });
});
