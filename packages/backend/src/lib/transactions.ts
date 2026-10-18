/**
 * 쓰기 트랜잭션 헬퍼.
 *
 * 롤백 위험이 있는 다중 쓰기(구독/바우처 사용, 소유권 이전, 계정 파기 등)를
 * `BEGIN write … COMMIT`으로 감싼다. 콜백이 던지면 롤백하고, 어떤 경우든
 * `finally`에서 트랜잭션을 닫는다(libSQL write txn은 단일 writer 락이라 누수 시
 * 후속 쓰기를 막을 수 있어 반드시 닫는다).
 */
import type { Client, InStatement, ResultSet } from '@libsql/client';
import { retryTransientTurso } from './turso-retry';

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

/**
 * DB 작업만 하는 콜백의 좁은 재시도. COMMIT 전 실패 뒤 롤백이 확인된 경우만 다시 실행한다.
 * 콜백에서 외부 API·푸시를 부르거나 COMMIT SQL을 직접 실행하면 안 된다.
 * COMMIT 응답 유실은 성공 여부를 모르므로 재시도하지 않는다. 일반 쓰기 헬퍼에는 적용하지 않는다.
 */
export async function withRetryableWriteTransaction<T>(
  db: Client,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const outcome = await retryTransientTurso(async () => {
    let safeToRetry = false;
    try {
      const value = await withTransaction(db, 'write', fn, () => {
        safeToRetry = true;
      });
      return { ok: true as const, value };
    } catch (error) {
      if (safeToRetry) throw error;
      return { ok: false as const, error };
    }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/**
 * 여러 SELECT 가 같은 커밋을 보도록 응답 스냅샷을 고정한다.
 *
 * **통째로 다시 시도한다**(코덱스 #795 3차). `getDB` 의 읽기 재시도는 `execute` 에만 걸려 있어
 * `transaction('read')` 로 나간 SELECT 는 게이트웨이 딸꾹질에 그대로 죽었다(`GET /billing/…` 의
 * 구독 스냅샷). 읽기 트랜잭션은 부작용이 없으므로 콜백째 다시 돌려도 안전하다 — 대신 콜백은
 * **읽기만** 해야 한다(그게 이 헬퍼의 계약이다). 쓰기 트랜잭션은 감싸지 않는다.
 */
export async function withReadTransaction<T>(
  db: Client,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return retryTransientTurso(() => withTransaction(db, 'read', fn));
}

async function withTransaction<T>(
  db: Client,
  mode: 'read' | 'write',
  fn: (tx: DbExecutor) => Promise<T>,
  onRolledBackBeforeCommit?: () => void,
): Promise<T> {
  const tx = await db.transaction(mode);
  let commitStarted = false;
  try {
    const result = await fn(tx as unknown as DbExecutor);
    commitStarted = true;
    await tx.commit();
    return result;
  } catch (error) {
    // libSQL은 BEGIN/첫 batch가 실패하면 스스로 닫는다. COMMIT을 보내지 않은 닫힌 트랜잭션은
    // 영속화되지 않는다. 열린 트랜잭션은 명시적 롤백 성공까지 확인해야 재실행할 수 있다.
    let rolledBack = tx.closed;
    if (!tx.closed) {
      try {
        await tx.rollback();
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    if (!commitStarted && rolledBack) onRolledBackBeforeCommit?.();
    throw error;
  } finally {
    if (!tx.closed) tx.close();
  }
}
