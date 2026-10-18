import type { Client } from '@libsql/client';
import { LibsqlError } from '@libsql/client/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DbExecutor,
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
  it('일반 쓰기는 트랜잭션 열기 단계의 일시적 실패도 재시도하지 않는다', async () => {
    const error = new LibsqlError('Server returned HTTP status 520', 'SERVER_ERROR');
    const db = { transaction: vi.fn().mockRejectedValue(error) };
    const work = vi.fn();
    await expect(withWriteTransaction(db as unknown as Client, work)).rejects.toBe(error);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

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

  it.each([520, 525])('트랜잭션 열기 중 %s가 나면 다시 열고 본문·커밋은 한 번만 실행한다', async (status) => {
    vi.useFakeTimers();
    const db = createMockDB();
    const transaction = vi.spyOn(db.client, 'transaction')
      .mockRejectedValueOnce(new LibsqlError(`Server returned HTTP status ${status}`, 'SERVER_ERROR'));
    const work = vi.fn(async (tx: DbExecutor) => {
      await tx.execute('UPDATE users SET token_epoch = token_epoch + 1');
      return 'done';
    });

    const result = withRetryableWriteTransaction(db.client as unknown as Client, work);
    const resolved = expect(result).resolves.toBe('done');
    await vi.runAllTimersAsync();
    await resolved;

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(1, 'write');
    expect(transaction).toHaveBeenNthCalledWith(2, 'write');
    expect(work).toHaveBeenCalledTimes(1);
    expect(db.transactions.commits).toBe(1);
    expect(db.transactions.rollbacks).toBe(0);
  });

  it('트랜잭션을 계속 열지 못하면 세 번 뒤 오류를 그대로 돌리고 본문을 실행하지 않는다', async () => {
    vi.useFakeTimers();
    const error = gatewayError();
    const db = { transaction: vi.fn().mockRejectedValue(error) };
    const work = vi.fn();
    const rejected = expect(withRetryableWriteTransaction(db as unknown as Client, work)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await rejected;
    expect(db.transaction).toHaveBeenCalledTimes(3);
    expect(work).not.toHaveBeenCalled();
  });

  it('열기 실패가 일시적 통신 오류가 아니면 즉시 실패한다', async () => {
    const error = new LibsqlError('Server returned HTTP status 401', 'SERVER_ERROR');
    const db = { transaction: vi.fn().mockRejectedValue(error) };
    const work = vi.fn();
    await expect(withRetryableWriteTransaction(db as unknown as Client, work)).rejects.toBe(error);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

  it('열기 재시도 후 COMMIT이 실패하면 그 회차는 재실행하지 않는다', async () => {
    vi.useFakeTimers();
    const commitError = gatewayError();
    const tx = {
      closed: false,
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      commit: vi.fn().mockRejectedValue(commitError),
      rollback: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const db = { transaction: vi.fn().mockRejectedValueOnce(gatewayError()).mockResolvedValue(tx) };
    const result = withRetryableWriteTransaction(db as unknown as Client, async (executor) =>
      executor.execute('UPDATE users SET token_epoch = token_epoch + 1'),
    );
    const rejected = expect(result).rejects.toBe(commitError);
    await vi.runAllTimersAsync();
    await rejected;
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.commit).toHaveBeenCalledTimes(1);
  });

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
