import { formatLastSeen } from '../src/lib/formatLastSeen';

const mockT = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && 'count' in opts) return `${key}:${opts.count}`;
  return key;
}) as unknown as import('i18next').TFunction;

describe('formatLastSeen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('null 입력 → lastSeen.unknown', () => {
    expect(formatLastSeen(null, mockT)).toBe('lastSeen.unknown');
  });

  it('undefined 입력 → lastSeen.unknown', () => {
    expect(formatLastSeen(undefined, mockT)).toBe('lastSeen.unknown');
  });

  it('빈 문자열 → lastSeen.unknown', () => {
    expect(formatLastSeen('', mockT)).toBe('lastSeen.unknown');
  });

  it('유효하지 않은 날짜 → lastSeen.unknown', () => {
    expect(formatLastSeen('not-a-date', mockT)).toBe('lastSeen.unknown');
  });

  it('미래 시간 → lastSeen.unknown (diffMs < 0)', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(future, mockT)).toBe('lastSeen.unknown');
  });

  it('방금 전 (30초 전) → lastSeen.justNow', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const thirtySecsAgo = new Date(now - 30_000).toISOString().replace('Z', '');
    expect(formatLastSeen(thirtySecsAgo, mockT)).toBe('lastSeen.justNow');
  });

  it('5분 전 → lastSeen.minutesAgo:5', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const fiveMinAgo = new Date(now - 5 * 60_000).toISOString().replace('Z', '');
    expect(formatLastSeen(fiveMinAgo, mockT)).toBe('lastSeen.minutesAgo:5');
  });

  it('59분 전 → lastSeen.minutesAgo:59', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 59 * 60_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.minutesAgo:59');
  });

  it('1시간 전 → lastSeen.hoursAgo:1', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 60 * 60_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.hoursAgo:1');
  });

  it('23시간 전 → lastSeen.hoursAgo:23', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 23 * 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.hoursAgo:23');
  });

  it('1일 전 → lastSeen.daysAgo:1', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 24 * 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.daysAgo:1');
  });

  it('29일 전 → lastSeen.daysAgo:29', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 29 * 24 * 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.daysAgo:29');
  });

  it('30일 이상 → lastSeen.longAgo', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 30 * 24 * 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.longAgo');
  });

  it('90일 전 → lastSeen.longAgo', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const ago = new Date(now - 90 * 24 * 3_600_000).toISOString().replace('Z', '');
    expect(formatLastSeen(ago, mockT)).toBe('lastSeen.longAgo');
  });

  it('정확히 0ms 차이 (동시각) → lastSeen.justNow', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const exact = new Date(now).toISOString().replace('Z', '');
    expect(formatLastSeen(exact, mockT)).toBe('lastSeen.justNow');
  });
});
