import { describe, it, expect } from 'vitest';
import { purgeUserAccount } from '../src/lib/account-deletion';

/**
 * **한 번의 워커 실행에서 DB 를 몇 번 왕복하는가.**
 *
 * 이 백엔드의 DB 호출 하나는 Cloudflare Workers 의 subrequest 하나다. 한 실행에 허용되는
 * subrequest 는 ~50 개라, 문장마다 왕복하면 계정 파기 한 번으로 한도를 넘긴다 — 실제로
 * 2026-09-18 운영에서 `DELETE /api/user/me` 가 500 으로 죽었다
 * ("Too many subrequests by single Worker invocation").
 *
 * 그래서 결과를 읽지 않는 쓰기는 `batch` 로 묶는다. 이 테스트는 **그 묶음이 풀리는 것**을
 * 막는다 — 문장 수가 늘어나는 것은 괜찮지만, 왕복 수가 늘어나면 안 된다.
 */
function countingExecutor() {
  const counts = { roundTrips: 0, statements: 0 };
  const tx = {
    execute: async (_stmt: unknown) => {
      counts.roundTrips += 1;
      counts.statements += 1;
      return { rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: undefined };
    },
    batch: async (stmts: unknown[]) => {
      counts.roundTrips += 1;
      counts.statements += stmts.length;
      return [];
    },
  };
  return { tx, counts };
}

describe('계정 파기의 DB 왕복 수 (Workers subrequest 한도)', () => {
  it('왕복은 한 자릿수로 유지하고, 문장은 묶어서 보낸다', async () => {
    const { tx, counts } = countingExecutor();
    await purgeUserAccount(tx as never, 'user-pk', 'login-id');

    // 한도(~50)의 절반도 쓰지 않아야 한다 — 호출부(트랜잭션 begin/commit, 애플 연결 해제,
    // 가명처리, 알림)가 같은 실행에서 함께 돌기 때문이다.
    expect(counts.roundTrips).toBeLessThanOrEqual(12);
    // 실제로 여러 문장이 나가는데도 왕복이 적다는 것 = 묶여서 나갔다는 뜻이다.
    expect(counts.statements).toBeGreaterThan(20);
  });
});
