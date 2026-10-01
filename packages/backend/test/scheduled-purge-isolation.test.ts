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
// 크론은 finally 에서 그 대기열을 비운다 — 여기서는 비우는 **배선**만 본다.
const drainPendingPlanNotifications = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/lib/pending-plan-notifications', () => ({ drainPendingPlanNotifications }));
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

  it('등급 통지 대기열은 모든 파기 트랜잭션이 끝난 뒤 한 번 비운다(트랜잭션 안에서 쏘지 않는다)', async () => {
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(drainPendingPlanNotifications).toHaveBeenCalledTimes(1);
    // 오래된 순으로 꺼낸다 — 특정 사람을 지정하지 않는다(앞 틱에서 잘린 행까지 잇는다).
    expect(drainPendingPlanNotifications.mock.calls[0]![2]).toBeUndefined();
    const lastTx = Math.max(...withWriteTransaction.mock.invocationCallOrder);
    expect(drainPendingPlanNotifications.mock.invocationCallOrder[0]!).toBeGreaterThan(lastTx);
  });

  it('뒤 계정의 파기가 실패해도 대기열은 비운다(앞 계정분이 들어 있다)', async () => {
    withWriteTransaction
      .mockResolvedValueOnce({ downgradedAlarms: [], voiceAccessRevokedUserIds: [], planChangedUserIds: ['m1'] })
      .mockRejectedValueOnce(new Error('Too many subrequests by single Worker invocation.'));

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(drainPendingPlanNotifications).toHaveBeenCalledTimes(1);
  });

  it('파기할 계정이 없는 틱에도 대기열을 비운다 — 앞 틱에서 잘린 사람을 잇는 자리다', async () => {
    // 이 테스트만 '파기할 계정 없음' — 끝나면 원래 구현으로 되돌린다(구현은 clearAllMocks 로 안 풀린다).
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(() => Promise.resolve({ rows: [] }));
    try {
      await worker.scheduled(
        { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
        { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
      );
    } finally {
      executeMock.mockImplementation(original);
    }
    expect(withWriteTransaction).not.toHaveBeenCalled();
    expect(drainPendingPlanNotifications).toHaveBeenCalledTimes(1);
  });

  it('등급 통지(보이는 삭제 예고)를 목소리 철회 통지보다 **먼저** 보낸다(코덱스 #841)', async () => {
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'], planChangedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(drainPendingPlanNotifications).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyDowngradedAlarms)).toHaveBeenCalledTimes(1);
    expect(drainPendingPlanNotifications.mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(notifyDowngradedAlarms).mock.invocationCallOrder[0]!,
    );
  });

  it('대기열 비우기가 던져도 목소리 철회 통지는 따로 나간다', async () => {
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    drainPendingPlanNotifications.mockRejectedValueOnce(new Error('Too many subrequests'));
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'], planChangedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(vi.mocked(notifyDowngradedAlarms)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyDowngradedAlarms).mock.calls[0]![3]).toContain('m1');
  });

  it('목소리 철회 통지가 던져도 대기열 비우기는 이미 끝났다(먼저 돈다)', async () => {
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    vi.mocked(notifyDowngradedAlarms).mockRejectedValueOnce(new Error('FCM down'));
    withWriteTransaction.mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['m1'], planChangedUserIds: ['m1'] });

    await worker.scheduled(
      { scheduledTime: new Date('2026-09-20T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      { TURSO_DATABASE_URL: 'mock', TURSO_AUTH_TOKEN: 'mock', PASSWORD_PEPPER: 'pep' } as never,
    );

    expect(drainPendingPlanNotifications).toHaveBeenCalledTimes(1);
  });
});
