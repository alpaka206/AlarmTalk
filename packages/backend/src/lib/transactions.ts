/**
 * 쓰기 트랜잭션 헬퍼.
 *
 * 롤백 위험이 있는 다중 쓰기(구독/바우처 사용, 소유권 이전, 계정 파기 등)를
 * `BEGIN write … COMMIT`으로 감싼다. 콜백이 던지면 롤백하고, 어떤 경우든
 * `finally`에서 트랜잭션을 닫는다(libSQL write txn은 단일 writer 락이라 누수 시
 * 후속 쓰기를 막을 수 있어 반드시 닫는다).
 */
import type { Client, InStatement, ResultSet } from '@libsql/client';

/**
 * 트랜잭션·클라이언트 공통 실행기.
 *
 * ⚠ **`batch` 가 들어 있는 것이 핵심이다.** 이 백엔드의 DB 호출은 하나가 곧 **Cloudflare
 * Workers 의 subrequest 하나**인데, 한 번의 워커 실행에 허용되는 subrequest 는 ~50 개다
 * (`src/index.ts` 의 init-db 주석이 같은 이유로 마이그레이션을 쪼갠다). 문장을 하나씩
 * 보내면 계정 파기(37문장)처럼 긴 경로가 그 한도에 걸려 **500 으로 죽는다**(2026-09-18
 * 운영 실측: `DELETE /api/user/me` → "Too many subrequests by single Worker invocation").
 * 서로 결과를 참조하지 않는 쓰기는 `batch` 로 **한 번에** 보낸다 — 순서도 원자성도 그대로다.
 */
export type DbExecutor = Pick<Client, 'execute'> & {
  /** 문장마다 결과를 **적은 순서대로** 돌려준다 — 읽기를 모아 한 번에 보낼 때도 쓴다. */
  batch(stmts: InStatement[]): Promise<ResultSet[]>;
};

export async function withWriteTransaction<T>(
  db: Client,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, 'write', fn);
}

/** 여러 SELECT 가 같은 커밋을 보도록 응답 스냅샷을 고정한다. */
export async function withReadTransaction<T>(
  db: Client,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, 'read', fn);
}

async function withTransaction<T>(
  db: Client,
  mode: 'read' | 'write',
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const tx = await db.transaction(mode);
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
