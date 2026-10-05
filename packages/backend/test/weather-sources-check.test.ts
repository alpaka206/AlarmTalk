import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceDay } from '../src/lib/weather-source';

const { fetchSource } = vi.hoisted(() => ({ fetchSource: vi.fn() }));
vi.mock('../src/lib/weather-source', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/weather-source')>(),
  fetchRegionSourceDays: fetchSource,
}));
vi.mock('@alarmtalk/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alarmtalk/shared')>();
  return { ...actual, WeatherRegions: { ...actual.WeatherRegions, all: [actual.WeatherRegions.byKey('kr-seoul')!] } };
});

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalLog = console.log;
const originalWarn = console.warn;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  console.log = originalLog;
  console.warn = originalWarn;
  vi.useRealTimers();
  vi.restoreAllMocks();
  fetchSource.mockReset();
});

describe('날씨 점검 CLI의 종료 상태', () => {
  it.each([
    { missing: '2026-10-02', exitCode: 1 },
    { missing: '2026-10-04', exitCode: 1 },
    { missing: '2026-10-01', exitCode: 0 },
    { missing: null, exitCode: 0 },
  ])('원천 성공 뒤 $missing 결측이면 종료 코드 $exitCode', async ({ missing, exitCode }) => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:30:00Z'));
    process.argv = [process.execPath, 'weather-sources-check', '--countries', 'KR', '--env-file', '/nonexistent/weather-check.env'];
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const days = new Map<string, SourceDay>();
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      if (date !== missing) days.set(date, { code: 0, maxTemp: 22, minTemp: 14, rainProbability: 0, precipitation: 0 });
    }
    fetchSource.mockResolvedValue({ ok: true, days });
    // CLI 본문을 실제 실행해 집계뿐 아니라 출력·process.exitCode 연결까지 확인한다. 네트워크·DB는 호출하지 않는다.
    await import('../scripts/weather-sources-check');
    expect(fetchSource).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(exitCode);
    expect(output.mock.calls.map(([text]) => String(text)).join(''))
      .toContain(exitCode === 0 ? '문제 없음' : '문제 1건');
  });
});
