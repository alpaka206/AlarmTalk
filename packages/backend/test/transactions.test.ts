import type { Client } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { withWriteTransaction } from '../src/lib/transactions';
import { createMockDB } from './helpers';

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
