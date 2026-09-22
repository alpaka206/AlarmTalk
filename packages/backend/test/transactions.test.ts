import type { Client } from '@libsql/client';
import { LibsqlError } from '@libsql/client/web';
import { describe, expect, it, vi } from 'vitest';
import { withReadTransaction, withWriteTransaction } from '../src/lib/transactions';
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
