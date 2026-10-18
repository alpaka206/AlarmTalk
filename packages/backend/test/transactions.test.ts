import type { Client } from '@libsql/client';
import { LibsqlError } from '@libsql/client/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  withReadTransaction,
  withWriteTransaction,
  withRetryableWriteTransaction,
} from '../src/lib/transactions';
import { createMockDB } from './helpers';

describe('withReadTransaction', () => {
  it('게이트웨이 5xx 면 트랜잭션째 다시 시도한다 — 읽기는 부작용이 없다(코덱스 #795)', async () => {
    vi.useFakeTimers();
    const mockDB = createMockDB();
    mockDB.pushError(new LibsqlError('Server returned HTTP status 525', 'SERVER_ERROR'));
    mockDB.pushResult([{ id: 'u1' }]);
    let attempts = 0;

    const result = withReadTransaction(mockDB.client as unknown as Client, async (tx) => {
      attempts += 1;
      const rows = await tx.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: ['u1'] });
      return rows.rows.length;
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(1);
    expect(attempts).toBe(2);
    // 첫 회차는 롤백으로 닫히고, 두 번째가 커밋한다.
    expect(mockDB.transactions.rollbacks).toBe(1);
    expect(mockDB.transactions.commits).toBe(1);
    vi.useRealTimers();
  });

  it('SQL 오류는 다시 시도하지 않는다', async () => {
    const mockDB = createMockDB();
    mockDB.pushError(new LibsqlError('no such column: nope', 'SQLITE_ERROR'));
    let attempts = 0;
    await expect(
      withReadTransaction(mockDB.client as unknown as Client, async (tx) => {
        attempts += 1;
        await tx.execute({ sql: 'SELECT nope FROM users' });
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_ERROR' });
    expect(attempts).toBe(1);
  });

  it('쓰기 트랜잭션은 게이트웨이 5xx 에도 다시 시도하지 않는다 — 부작용이 두 번 날 수 있다', async () => {
    const mockDB = createMockDB();
    mockDB.pushError(new LibsqlError('Server returned HTTP status 525', 'SERVER_ERROR'));
    let attempts = 0;
    await expect(
      withWriteTransaction(mockDB.client as unknown as Client, async (tx) => {
        attempts += 1;
        await tx.execute({ sql: 'INSERT INTO t VALUES (1)' });
      }),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(attempts).toBe(1);
    expect(mockDB.transactions.rollbacks).toBe(1);
  });
});

describe('withWriteTransaction', () => {
  it('commits when the transaction body succeeds', async () => {
    const mockDB = createMockDB();
    mockDB.pushResult([], 1);

    const result = await withWriteTransaction(mockDB.client as unknown as Client, async (tx) => {
      await tx.execute({ sql: 'INSERT INTO test VALUES (?)', args: ['ok'] });
      return 'done';
    });

    expect(result).toBe('done');
    expect(mockDB.transactions.commits).toBe(1);
    expect(mockDB.transactions.rollbacks).toBe(0);
  });

  it('rolls back when the transaction body fails', async () => {
    const mockDB = createMockDB();

    await expect(
      withWriteTransaction(mockDB.client as unknown as Client, async (tx) => {
        await tx.execute({ sql: 'INSERT INTO test VALUES (?)', args: ['before-error'] });
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');

    expect(mockDB.transactions.commits).toBe(0);
    expect(mockDB.transactions.rollbacks).toBe(1);
  });
});

describe('withRetryableWriteTransaction', () => {
  afterEach(() => vi.useRealTimers());
  const gatewayError = () => new LibsqlError('Server returned HTTP status 520', 'SERVER_ERROR');

  it('COMMIT 전 520은 롤백 뒤 다시 실행하고 한 번만 커밋한다', async () => {
    vi.useFakeTimers();
    const db = createMockDB();
    db.pushError(gatewayError());
    db.pushResult([], 1);
    let attempts = 0;
    const result = withRetryableWriteTransaction(db.client as unknown as Client, async (tx) => {
      attempts += 1;
      return tx.execute('UPDATE users SET token_epoch = token_epoch + 1');
    });
    await vi.runAllTimersAsync();
    expect((await result).rowsAffected).toBe(1);
    expect(attempts).toBe(2);
    expect(db.transactions.rollbacks).toBe(1);
    expect(db.transactions.commits).toBe(1);
  });

  it.each(['commit', 'rollback'] as const)(
    '%s 결과가 불확실하면 재시도하지 않는다',
    async (stage) => {
      const error = gatewayError();
      const tx = {
        closed: false,
        execute: vi.fn().mockImplementation(async () => {
          if (stage === 'rollback') throw error;
          return { rowsAffected: 1 };
        }),
        commit: vi.fn().mockRejectedValue(error),
        rollback: vi.fn().mockImplementation(async () => {
          if (stage === 'rollback') throw error;
        }),
        close: vi.fn(),
      };
      const db = { transaction: vi.fn().mockResolvedValue(tx) };
      await expect(
        withRetryableWriteTransaction(db as unknown as Client, async (executor) =>
          executor.execute('UPDATE users SET token_epoch = token_epoch + 1'),
        ),
      ).rejects.toBe(error);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.close).toHaveBeenCalledTimes(1);
    },
  );

  it('첫 batch 실패로 libSQL이 닫은 트랜잭션도 COMMIT 전이면 다시 시도한다', async () => {
    vi.useFakeTimers();
    const db = createMockDB();
    const transaction = vi.spyOn(db.client, 'transaction');
    transaction.mockResolvedValueOnce({
      closed: true,
      execute: vi.fn().mockRejectedValue(gatewayError()),
      close: vi.fn(),
    } as never);
    const result = withRetryableWriteTransaction(db.client as unknown as Client, async (tx) =>
      tx.execute('UPDATE users SET token_epoch = token_epoch + 1'),
    );
    await vi.runAllTimersAsync();
    await result;
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(db.transactions.commits).toBe(1);
  });
});
