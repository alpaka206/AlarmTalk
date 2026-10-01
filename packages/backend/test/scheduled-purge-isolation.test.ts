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
const notifyBillingStateChanged = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/lib/billing-cancel', () => ({
  processSubscriptionExpiry: vi.fn().mockResolvedValue(undefined),
  notifyBillingStateChanged,
}));
vi.mock('../src/lib/account-deletion', () => ({
  purgeUserAccount: vi.fn().mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: [] }),
  pseudonymizeBillingForRetention: vi.fn().mockResolvedValue(undefined),
}));
const withWriteTransaction = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/transactions', () => ({ withWriteTransaction }));
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

  it('계정별 등급 변경 대상을 모아 커밋 뒤 한 번에 알린다', async () => {
    withWriteTransaction
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m1', 'm2'] })
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m3'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['m1', 'm2', 'm3']);
    // 두 계정의 트랜잭션이 모두 끝난 뒤다 — 트랜잭션 안에서 쏘지 않는다.
    const lastTx = Math.max(...withWriteTransaction.mock.invocationCallOrder);
    expect(notifyBillingStateChanged.mock.invocationCallOrder[0]!).toBeGreaterThan(lastTx);
  });

  it('뒤 계정의 파기가 실패해도 이미 커밋된 앞 계정의 멤버에게는 알린다', async () => {
    withWriteTransaction
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m1'] })
      .mockRejectedValueOnce(new Error('Too many subrequests by single Worker invocation.'));

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['m1']);
  });

  it('목소리 철회 통지가 던져도 등급 변경 통지는 따로 나간다', async () => {
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    vi.mocked(notifyDowngradedAlarms).mockRejectedValueOnce(new Error('FCM down'));
    withWriteTransaction
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'], planChangedUserIds: ['m1'] })
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m2'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['m1', 'm2']);
  });
});
