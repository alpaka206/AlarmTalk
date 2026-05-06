import type { Client } from '@libsql/client';

export type DbExecutor = Pick<Client, 'execute'>;

export async function withWriteTransaction<T>(
  db: Client,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const tx = await db.transaction('write');
  try {
    const result = await fn(tx as unknown as DbExecutor);
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) {
      await tx.rollback().catch(() => undefined);
    }
    throw error;
  } finally {
    if (!tx.closed) tx.close();
  }
}
