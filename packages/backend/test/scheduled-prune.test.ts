import { describe, it, expect, vi, beforeEach } from 'vitest';

// scheduled() 가 호출하는 모든 동적 import 를 no-op 으로 만들어 cron 본문만 검증한다.
vi.mock('../src/lib/audio-retention', () => ({
  cleanupExpiredAudio: vi.fn().mockResolvedValue(undefined),
  drainExternalDeletions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/billing-cancel', () => ({
  processSubscriptionExpiry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/account-deletion', () => ({
  purgeUserAccount: vi.fn().mockResolvedValue(undefined),
  pseudonymizeBillingForRetention: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/transactions', () => ({
  withWriteTransaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/fcm', () => ({
  sendAlarmPush: vi.fn().mockResolvedValue(undefined),
}));

const executeMock = vi.hoisted(() =>
  vi.fn().mockImplementation((arg: unknown) => {
    void arg;
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

describe('scheduled() — email_verification_codes prune (FIX 10)', () => {
  it('만료 후 72h 경과 코드를 파라미터 바인딩으로 삭제한다', async () => {
    const now = new Date('2026-06-22T00:00:00.000Z');
    const env = {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
      PASSWORD_PEPPER: 'pep',
    } as never;

    await worker.scheduled(
      { scheduledTime: now.getTime(), cron: '*/5 * * * *' } as never,
      env,
    );

    const pruneCall = executeMock.mock.calls.find(
      (call) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        typeof (call[0] as { sql?: string }).sql === 'string' &&
        (call[0] as { sql: string }).sql.includes('DELETE FROM email_verification_codes'),
    );

    expect(pruneCall).toBeDefined();
    const stmt = pruneCall![0] as { sql: string; args: unknown[] };
    // 파라미터 바인딩(인라인 금지)
    expect(stmt.sql).toContain('expires_at < ?');
    expect(Array.isArray(stmt.args)).toBe(true);
    // expires_at 은 ISO 문자열로 기록되므로 ISO 문자열로 비교한다.
    const expected = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    expect(stmt.args[0]).toBe(expected);
  });
});
