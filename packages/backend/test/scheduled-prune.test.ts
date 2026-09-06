import { describe, it, expect, vi, beforeEach } from 'vitest';

// scheduled() 가 호출하는 모든 동적 import 를 no-op 으로 만들어 cron 본문만 검증한다.
vi.mock('../src/lib/audio-retention', () => ({
  cleanupExpiredAudio: vi.fn().mockResolvedValue(undefined),
  cleanupStaleDraftVoices: vi.fn().mockResolvedValue(undefined),
  drainExternalDeletions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/billing-cancel', () => ({
  processSubscriptionExpiry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/account-deletion', () => ({
  // 커밋 후 알릴 대상을 돌려준다. 비어 있어도 **형태는 지켜야** cron 이 그대로 펴 담는다.
  purgeUserAccount: vi
    .fn()
    .mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] }),
  pseudonymizeBillingForRetention: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/transactions', () => ({
  withWriteTransaction: vi
    .fn()
    .mockResolvedValue({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] }),
}));
vi.mock('../src/lib/fcm', () => ({
  sendAlarmPush: vi.fn().mockResolvedValue(undefined),
  notifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
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

describe('scheduled() — usage_events 보관 기간 정리', () => {
  it('처리방침에 적은 1년이 지난 기록을 배치로 지운다', async () => {
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
        (call[0] as { sql: string }).sql.includes('DELETE FROM usage_events'),
    );

    expect(pruneCall).toBeDefined();
    const stmt = pruneCall![0] as { sql: string; args: unknown[] };
    // 파라미터 바인딩(인라인 금지) + 한 회차에 지우는 양을 묶는다.
    expect(stmt.sql).toContain('occurred_at < ?');
    expect(stmt.sql).toContain('LIMIT ?');
    // ⚠ **문서와 같은 값이어야 한다** — `docs/legal/privacy-policy.ko.md` 3장 표의 1년.
    const expected = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(stmt.args[0]).toBe(expected);
  });
});

describe('scheduled() — retained_billing_records prune', () => {
  it('법정 보존기간이 끝난 가명 결제 기록을 현재 시각 기준으로 삭제한다', async () => {
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
        (call[0] as { sql?: string }).sql?.includes('DELETE FROM retained_billing_records'),
    );

    expect(pruneCall).toBeDefined();
    const stmt = pruneCall![0] as { sql: string; args: unknown[] };
    expect(stmt.sql).toContain('retain_until <= ?');
    expect(stmt.args).toEqual([now.toISOString()]);
  });
});

describe('scheduled() — 탈퇴 파기 알림', () => {
  it('배치 뒤쪽이 실패해도 이미 커밋된 파기는 알린다', async () => {
    const { withWriteTransaction } = await import('../src/lib/transactions');
    const { notifyDowngradedAlarms } = await import('../src/lib/fcm');
    const env = {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
      PASSWORD_PEPPER: 'pep',
    } as never;

    // 파기 대상 2명 — 첫 계정은 커밋되고 둘째에서 던진다.
    executeMock.mockImplementation((arg: unknown) => {
      const sql = (arg as { sql?: string })?.sql ?? '';
      if (sql.includes("deletion_status = 'pending_deletion'")) {
        return Promise.resolve({ rows: [{ id: 'A', google_id: 'gA' }, { id: 'B', google_id: 'gB' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(withWriteTransaction)
      .mockResolvedValueOnce({
        downgradedAlarms: [{ alarmId: 'al-1', ownerUserId: 'R1', isReceived: true }],
        voiceAccessRevokedUserIds: ['M1'],
      } as never)
      .mockRejectedValueOnce(new Error('turso down'));

    await worker.scheduled(
      { scheduledTime: new Date('2026-06-22T00:00:00.000Z').getTime(), cron: '*/5 * * * *' } as never,
      env,
    );

    // A 의 파기는 롤백되지 않는다. 안 알리면 R1·M1 은 폴백 주기만큼 탈퇴자의 목소리를 더 든다.
    expect(notifyDowngradedAlarms).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyDowngradedAlarms).mock.calls[0]![2]).toEqual([
      { alarmId: 'al-1', ownerUserId: 'R1', isReceived: true },
    ]);
    expect(vi.mocked(notifyDowngradedAlarms).mock.calls[0]![3]).toEqual(['M1']);
  });
});
