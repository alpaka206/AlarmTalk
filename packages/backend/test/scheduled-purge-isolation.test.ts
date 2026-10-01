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
// 등급 통지는 파기 트랜잭션이 대기열에 적고(실제 DB 로 `account-purge-plan-push.test.ts` 가 본다),
// **1분 전용 크론의 홀수 분**이 자기 예산으로 비운다 — 여기서는 그 **배선**만 본다.
const runPlanNotificationDrainTurn = vi.hoisted(() => vi.fn().mockResolvedValue(false));
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
vi.mock('../src/lib/pending-plan-notifications', () => ({
  runPlanNotificationDrainTurn,
  isPlanNotificationDrainMinute: (now: Date) => now.getUTCMinutes() % 2 === 1,
  prunePendingPlanNotifications: vi.fn().mockResolvedValue(undefined),
}));
const runPersonalPromoEnd = vi.hoisted(() => vi.fn().mockResolvedValue({ transitioned: [], sweep: null }));
vi.mock('../src/lib/personal-promo-end', () => ({
  runPersonalPromoEnd,
  isPromoEndAlertSlot: () => false,
}));
vi.mock('../src/lib/account-deletion', () => ({
  purgeUserAccount: vi.fn().mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: [] }),
  pseudonymizeBillingForRetention: vi.fn().mockResolvedValue(undefined),
}));
const withWriteTransaction = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/transactions', () => ({ withWriteTransaction }));
// 지역 날씨 미리 계산은 지역의 현지 슬롯(21시·06시)이 열린 틱에 원천(기상청·気象庁·NWS)을 부른다. 이 파일은
// 그 일을 보지 않으므로 끈다 — 안 끄면 시각에 따라 테스트가 실제 네트워크로 나간다. 그 동작은
// weather-region-daily.test.ts.
vi.mock('../src/lib/weather-region-daily', () => ({
  hasOpenWeatherSlot: vi.fn().mockReturnValue(false),
  refreshWeatherRegionDaily: vi.fn(),
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
});

describe('scheduled() — 계정 파기 격리', () => {
  it('앞 계정의 파기가 던져도 뒤 계정의 파기를 시도한다', async () => {
    withWriteTransaction
      .mockRejectedValueOnce(new Error('Too many subrequests by single Worker invocation.'))
      .mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: [] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(withWriteTransaction).toHaveBeenCalledTimes(2);
  });

  it('파기 순서는 기한이 먼저 온 계정부터로 고정이다', async () => {
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: [] });
    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );
    const purgeQuery = executeMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : (arg as { sql: string }).sql))
      .find((sql) => sql.includes("deletion_status = 'pending_deletion'"));
    expect(purgeQuery).toMatch(/ORDER BY deletion_purge_at, id/);
  });

  it('5분 틱은 등급 통지 대기열을 비우지 않는다 — 남은 예산을 나눠 쓰면 잘린다(코덱스 #841)', async () => {
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'], planChangedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(runPlanNotificationDrainTurn).not.toHaveBeenCalled();
    // 목소리 철회 통지는 그대로 이 틱에서 나간다.
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    expect(vi.mocked(notifyDowngradedAlarms)).toHaveBeenCalledTimes(1);
  });

  it('1분 크론의 홀수 분 — 대기 행이 있으면 비우기가 이 실행을 쓰고, 개인 플랜 종료 작업은 건너뛴다', async () => {
    runPlanNotificationDrainTurn.mockResolvedValueOnce(true);

    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T00:01:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(runPlanNotificationDrainTurn).toHaveBeenCalledTimes(1);
    expect(runPersonalPromoEnd).not.toHaveBeenCalled();
  });

  it('1분 크론의 홀수 분 — 대기 행이 없으면 개인 플랜 종료 작업이 그대로 돈다', async () => {
    runPlanNotificationDrainTurn.mockResolvedValueOnce(false);

    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T00:03:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(runPlanNotificationDrainTurn).toHaveBeenCalledTimes(1);
    expect(runPersonalPromoEnd).toHaveBeenCalledTimes(1);
  });

  it('1분 크론의 짝수 분 — 비우기는 차례가 없고 개인 플랜 종료 작업만 돈다', async () => {
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T00:02:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(runPlanNotificationDrainTurn).not.toHaveBeenCalled();
    expect(runPersonalPromoEnd).toHaveBeenCalledTimes(1);
  });

  it('1분 크론 — 비우기가 던지면 그 실행의 예산을 모르므로 종료 작업은 건너뛰고(다음 분이 한다) 던지지 않는다', async () => {
    runPlanNotificationDrainTurn.mockRejectedValueOnce(new Error('turso down'));

    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T00:05:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(runPersonalPromoEnd).not.toHaveBeenCalled();
  });
  it('1분 크론 — 비우기 실패는 그 시각의 첫 비우기 분(UTC 1분)에 경보로 올라간다(종료 작업의 0분 자리에는 닿지 못한다)', async () => {
    runPlanNotificationDrainTurn.mockRejectedValueOnce(new Error('turso down'));
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T05:01:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as never,
    );

    expect(captureException).toHaveBeenCalledTimes(1);

    captureException.mockClear();
    runPlanNotificationDrainTurn.mockRejectedValueOnce(new Error('turso down'));
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T05:03:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as never,
    );

    // 나머지 분은 로그만 — 1분마다 경보가 쌓이지 않는다.
    expect(captureException).not.toHaveBeenCalled();
  });

  it('1분 크론 — 표가 없으면(배포가 마이그레이션보다 먼저 돈 창) 차례를 쓰지 않고 종료 작업이 그대로 돈다', async () => {
    runPlanNotificationDrainTurn.mockRejectedValueOnce(new Error('SQLITE_ERROR: no such table: pending_plan_notifications'));
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T05:07:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as never,
    );

    expect(runPersonalPromoEnd).toHaveBeenCalledTimes(1);
  });

  it('1분 크론 — 상한에서 버린 사람(예고를 끝내 못 보냄)은 그때마다 경보로 올린다', async () => {
    runPlanNotificationDrainTurn.mockImplementationOnce(async (_db: unknown, _env: unknown, hooks: { onGaveUp?: (n: number) => void }) => {
      hooks.onGaveUp?.(1);
      return true;
    });
    await worker.scheduled(
      { scheduledTime: new Date('2026-10-01T05:09:00.000Z').getTime(), cron: '* * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as never,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
