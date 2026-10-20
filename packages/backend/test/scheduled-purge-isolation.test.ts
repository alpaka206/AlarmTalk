// **탈퇴 파기 한 건이 실패해도 같은 틱의 다음 계정은 파기한다**(2026-09-20).
//
// 예전에는 예외가 루프를 빠져나가 뒤 계정이 파기되지 않았고, 조회 순서가 고정이라 다음
// 틱도 같은 계정에서 다시 막혔다 — 파기 요청 데이터가 무기한 남았다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/audio-retention', () => ({
  cleanupExpiredAudio: vi.fn().mockResolvedValue(undefined),
  cleanupStaleDraftVoices: vi.fn().mockResolvedValue(undefined),
  drainExternalDeletions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/billing-cancel', () => ({
  processSubscriptionExpiry: vi.fn().mockResolvedValue(undefined),
}));
// 경보가 실제로 Sentry 에 닿는지 본다(1분 크론 경보 자리 — 리뷰).
const captureException = vi.hoisted(() => vi.fn());
vi.mock('toucan-js', () => ({
  Toucan: class {
    captureException = captureException;
    withScope = (fn: (scope: { setTags: () => void; captureException: typeof captureException }) => void) =>
      fn({ setTags: () => undefined, captureException });
    setTag = () => undefined;
  },
}));
const runPersonalPromoEnd = vi.hoisted(() => vi.fn().mockResolvedValue({ transitioned: [], sweep: null }));
const isPromoEndAlertSlot = vi.hoisted(() => vi.fn(() => false));
vi.mock('../src/lib/personal-promo-end', () => ({
  runPersonalPromoEnd,
  isPromoEndAlertSlot,
}));
vi.mock('../src/lib/account-deletion', () => ({
  purgeUserAccount: vi.fn().mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] }),
  pseudonymizeBillingForRetention: vi.fn().mockResolvedValue(undefined),
}));
const withWriteTransaction = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/transactions', () => ({ withWriteTransaction }));
// 지역 날씨 미리 계산은 지역의 현지 슬롯(21시·06시)이 열린 틱에 원천(기상청·気象庁·NWS)을 부른다. 이 파일은
// 그 일을 보지 않으므로 끈다 — 안 끄면 시각에 따라 테스트가 실제 네트워크로 나간다. 그 동작은
// weather-region-daily.test.ts.
vi.mock('../src/lib/weather-region-daily', () => ({
  hasOpenWeatherSlot: vi.fn().mockReturnValue(false),
  hasWeatherSlotLastTick: vi.fn().mockReturnValue(false),
  refreshWeatherRegionDaily: vi.fn(),
}));
const revokeAppleToken = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/lib/apple-revoke', () => ({
  appleSignInConfig: () => ({ teamId: 't', keyId: 'k', privateKey: 'p', clientId: 'c' }),
  revokeAppleToken,
}));
vi.mock('../src/lib/fcm', () => ({
  sendAlarmPush: vi.fn().mockResolvedValue(undefined),
  notifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
}));

const executeMock = vi.hoisted(() =>
  vi.fn().mockImplementation((arg: { sql?: string } | string) => {
    const sql = typeof arg === 'string' ? arg : (arg.sql ?? '');
    if (sql.includes("deletion_status = 'pending_deletion'")) {
      return Promise.resolve({
        rows: [
          { id: 'stuck', google_id: null, apple_refresh_token: null },
          { id: 'next', google_id: null, apple_refresh_token: null },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }),
);
vi.mock('../src/lib/db', () => ({
  getDB: () => ({ execute: executeMock }),
  initDB: vi.fn(),
}));

import worker from '../src/index';

beforeEach(() => {
  vi.clearAllMocks();
  isPromoEndAlertSlot.mockReturnValue(false);
});

describe('scheduled() — 계정 파기 격리', () => {
  it('앞 계정의 파기가 던져도 뒤 계정의 파기를 시도한다', async () => {
    withWriteTransaction
      .mockRejectedValueOnce(new Error('Too many subrequests by single Worker invocation.'))
      .mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(withWriteTransaction).toHaveBeenCalledTimes(2);
  });

  it('파기 직전 재확인은 기한도 본다 — 철회 뒤 다시 신청한 계정을 옛 기한으로 지우지 않고, 애플 연결도 끊지 않는다', async () => {
    const { purgeUserAccount } = await import('../src/lib/account-deletion');
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation((arg: { sql?: string } | string) => {
      const sql = typeof arg === 'string' ? arg : (arg.sql ?? '');
      if (sql.includes("deletion_status = 'pending_deletion'")) {
        return Promise.resolve({
          rows: [
            { id: 'renewed', google_id: null, apple_refresh_token: 'apple-rt' },
            { id: 'due', google_id: null, apple_refresh_token: 'apple-rt-2' },
          ],
        });
      }
      return original(arg);
    });
    const tx = {
      execute: vi.fn().mockImplementation((arg: { sql: string; args?: unknown[] }) => {
        // 'renewed' 는 철회 뒤 다시 신청해 기한이 30일 뒤다 — 기한 조건에 걸려 0행.
        expect(arg.sql).toMatch(/deletion_purge_at <= \?/);
        return Promise.resolve({ rows: arg.args?.[0] === 'renewed' ? [] : [{ 1: 1 }] });
      }),
    };
    withWriteTransaction.mockImplementation((_db: unknown, fn: (t: typeof tx) => unknown) => fn(tx));

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(vi.mocked(purgeUserAccount).mock.calls.map((call) => call[1])).toEqual(['due']);
    // 애플 연결은 파기가 커밋된 계정만 끊는다(코덱스 #904).
    expect(revokeAppleToken.mock.calls.map((call) => call[1])).toEqual(['apple-rt-2']);
    executeMock.mockImplementation(original);
  });

  it('트랜잭션 안에서 다시 봐서 그 사이 로그인으로 철회된 계정은 지우지 않는다(2026-10-15)', async () => {
    const { purgeUserAccount, pseudonymizeBillingForRetention } = await import('../src/lib/account-deletion');
    // 'stuck' 은 조회와 트랜잭션 사이에 다시 로그인해 active 가 됐다, 'next' 는 그대로 유예다.
    const tx = {
      execute: vi.fn().mockImplementation((arg: { args?: unknown[] }) =>
        Promise.resolve({ rows: arg.args?.[0] === 'stuck' ? [] : [{ 1: 1 }] }),
      ),
    };
    withWriteTransaction.mockImplementation((_db: unknown, fn: (t: typeof tx) => unknown) => fn(tx));

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(vi.mocked(purgeUserAccount).mock.calls.map((call) => call[1])).toEqual(['next']);
    expect(vi.mocked(pseudonymizeBillingForRetention).mock.calls.map((call) => call[1])).toEqual(['next']);
    const recheck = tx.execute.mock.calls.map(([arg]) => (arg as { sql: string }).sql);
    expect(recheck.every((sql) => sql.includes("deletion_status = 'pending_deletion'"))).toBe(true);
  });

  it('파기 순서는 기한이 먼저 온 계정부터로 고정이다', async () => {
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] });
    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );
    const purgeQuery = executeMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : (arg as { sql: string }).sql))
      .find((sql) => sql.includes("deletion_status = 'pending_deletion'"));
    expect(purgeQuery).toMatch(/ORDER BY deletion_purge_at, id/);
  });

  it('5분 틱의 파기는 목소리 철회 통지를 그 틱에서 보낸다', async () => {
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    expect(vi.mocked(notifyDowngradedAlarms)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyDowngradedAlarms).mock.calls[0]![3]).toContain('m1');
  });

  // 1분 크론은 **기간 한정 개인 플랜 종료 전용**이다 — 분과 무관하게 그 일만 하고, 자기 예산(~50 subrequest)을 통째로 쓴다.
  // (탈퇴 등급 통지 대기열이 홀수 분을 나눠 쓰던 시절이 있었다 — 커플·가족 이용권과 함께 2026-10-20 에 없앴다.)
  it.each(['2026-10-01T00:01:00.000Z', '2026-10-01T00:02:00.000Z', '2026-10-01T00:03:00.000Z'])(
    '1분 크론(%s) — 언제나 개인 플랜 종료 작업만 돈다',
    async (at) => {
      await worker.scheduled(
        { scheduledTime: new Date(at).getTime(), cron: '* * * * *' } as never,
        { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
      );

      expect(runPersonalPromoEnd).toHaveBeenCalledTimes(1);
      expect(runPersonalPromoEnd.mock.calls[0]![3]).toMatchObject({ role: 'dedicated' });
      // 5분 틱의 일(계정 파기 조회 등)은 하지 않는다.
      expect(executeMock).not.toHaveBeenCalled();
      expect(withWriteTransaction).not.toHaveBeenCalled();
    },
  );

  it('1분 크론 — 종료 작업이 던져도 던지지 않고, 경보는 시간당 자리에서만 올린다', async () => {
    const env = {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
      PASSWORD_PEPPER: 'pep',
      SENTRY_DSN: 'https://k@o.ingest.sentry.io/1',
    } as never;
    runPersonalPromoEnd.mockRejectedValueOnce(new Error('turso down'));
    await expect(
      worker.scheduled(
        { scheduledTime: new Date('2026-10-01T05:03:00.000Z').getTime(), cron: '* * * * *' } as never,
        env,
      ),
    ).resolves.toBeUndefined();
    // 경보 자리가 아니면 로그만 — 1분마다 경보가 쌓이지 않는다.
    expect(captureException).not.toHaveBeenCalled();

    isPromoEndAlertSlot.mockReturnValue(true);
    runPersonalPromoEnd.mockRejectedValueOnce(new Error('turso down'));
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T06:00:00.000Z').getTime(), cron: '* * * * *' } as never,
      env,
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
