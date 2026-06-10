/**
 * 쓰기 트랜잭션 헬퍼.
 *
 * 롤백 위험이 있는 다중 쓰기(구독/바우처 사용, 소유권 이전, 계정 파기 등)를
 * `BEGIN write … COMMIT`으로 감싼다. 콜백이 던지면 롤백하고, 어떤 경우든
 * `finally`에서 트랜잭션을 닫는다(libSQL write txn은 단일 writer 락이라 누수 시
 * 후속 쓰기를 막을 수 있어 반드시 닫는다).
 */
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
