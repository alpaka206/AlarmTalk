// 같은 요청 표식(`lib/manual-tts-requests.ts`) — 진짜 SQLite(파일)로 돌린다. 겹친 두 요청의 순서는 SQL 이 정하므로 순서 큐 목
// (`helpers.ts` 의 createMockDB)으로는 볼 수 없다.
//
// ⚠ Codex #971: 예전에는 상태를 SELECT 한 뒤 따로 UPSERT 로 잡아, 그 사이 첫 요청이 `done` 으로 바꾸면 둘째가 끝난 표식을
//   가져가면서도 `reclaimedDone` 이 false 였다 — 라우트는 그 요청을 한 번 더 세거나(캐시 히트도 센다) 마지막 횟수였으면 429 를 줬다.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/lib/migrations';
import {
  MANUAL_REQUEST_STALE_MS,
  claimManualRequest,
  completeManualRequest,
  releaseManualRequest,
  type ManualRequestClaim,
} from '../src/lib/manual-tts-requests';
import type { DbExecutor } from '../src/lib/transactions';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-manual-tts-requests-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });

const USER = 'user-1';
const REQ = '0f8fad5b-d9cb-469f-a165-70867728950e';
const T0 = new Date('2026-10-27T01:00:00.000Z');
const input = (fingerprint = 'fp-a') => ({ userPk: USER, requestId: REQ, fingerprint });

/** [beforeQuery] 번째(0부터) 실행 **직전에** [hook] 을 한 번 돌리는 실행기 — 둘째 요청의 문장 사이에 첫 요청을 끼운다. */
function interleaved(beforeQuery: number, hook: () => Promise<void>): DbExecutor {
  let n = 0;
  return {
    execute: async (stmt: InStatement) => {
      if (n++ === beforeQuery) await hook();
      return db.execute(stmt);
    },
  } as unknown as DbExecutor;
}

async function claimed(outcome: Awaited<ReturnType<typeof claimManualRequest>>): Promise<ManualRequestClaim> {
  expect(outcome.kind).toBe('claimed');
  if (outcome.kind !== 'claimed') throw new Error('not claimed');
  return outcome.claim;
}

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  await db.execute('DELETE FROM manual_tts_requests');
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('claimManualRequest — 잡는 것과 직전 상태가 한 문장', () => {
  it('처음 보는 id 는 넣고, 재시도가 아니다', async () => {
    const outcome = await claimManualRequest(db, input(), T0);
    expect(outcome).toMatchObject({ kind: 'claimed', reclaimedDone: false, retried: false });
  });

  // 첫 요청이 잡고 있는 동안 둘째가 온다 — 둘째의 문장 사이 어디에서 첫 요청이 끝나도, 둘째가 그 표식을 가져가면 반드시
  // '이미 셌다'(reclaimedDone) 로 알아야 한다. 못 가져가면 409(in_progress)이고 다시 보내면 그때 끝난 표식으로 잡힌다.
  for (const beforeQuery of [0, 1, 2, 3, 4]) {
    it(`첫 요청이 둘째의 ${beforeQuery}번째 문장 직전에 끝나도 끝난 표식을 새 요청으로 잡지 않는다`, async () => {
      const first = await claimed(await claimManualRequest(db, input(), T0));
      const later = new Date(T0.getTime() + 1000);
      const outcome = await claimManualRequest(
        interleaved(beforeQuery, () => completeManualRequest(db, first)),
        input(),
        later,
      );
      if (outcome.kind === 'claimed') {
        expect(outcome.reclaimedDone).toBe(true);
      } else {
        expect(outcome.kind).toBe('in_progress');
        // 다시 보내면 끝난 표식으로 잡는다 — 세지 않는 갈래.
        expect(await claimManualRequest(db, input(), new Date(later.getTime() + 1000))).toMatchObject({
          kind: 'claimed',
          reclaimedDone: true,
        });
      }
      // 끝난 뒤의 문장들에서 잡혔다면(0~3) 반드시 잡는다 — 마지막 확인 뒤에만 409 가 남는다.
      if (beforeQuery <= 3) expect(outcome).toMatchObject({ kind: 'claimed', reclaimedDone: true, retried: true });
    });
  }

  it('잡혀 있는 표식은 가져가지 않는다(409)', async () => {
    await claimManualRequest(db, input(), T0);
    expect(await claimManualRequest(db, input(), new Date(T0.getTime() + 1000))).toEqual({ kind: 'in_progress' });
  });

  it('2분 넘게 버려진 표식은 새 요청으로 잡는다 — 셌는지 알 수 없다', async () => {
    await claimManualRequest(db, input(), T0);
    const outcome = await claimManualRequest(db, input(), new Date(T0.getTime() + MANUAL_REQUEST_STALE_MS + 1));
    expect(outcome).toMatchObject({ kind: 'claimed', reclaimedDone: false, retried: true });
  });

  it('실패로 놓은 표식은 지워져 다음 시도가 처음 보는 id 로 잡힌다', async () => {
    const first = await claimed(await claimManualRequest(db, input(), T0));
    await releaseManualRequest(db, first);
    expect(await claimManualRequest(db, input(), new Date(T0.getTime() + 1000))).toMatchObject({
      kind: 'claimed',
      reclaimedDone: false,
      retried: false,
    });
  });

  it('끝난 표식의 재시도를 끝냄으로 되돌리면 그다음 재시도도 끝난 표식으로 잡힌다', async () => {
    const first = await claimed(await claimManualRequest(db, input(), T0));
    await completeManualRequest(db, first);
    const retry = await claimed(await claimManualRequest(db, input(), new Date(T0.getTime() + 1000)));
    // 라우트는 셌던 요청의 재시도가 실패하면 지우지 않고 끝냄으로 되돌린다(`letGoOfRequestClaim`).
    await completeManualRequest(db, retry);
    expect(await claimManualRequest(db, input(), new Date(T0.getTime() + 2000))).toMatchObject({
      kind: 'claimed',
      reclaimedDone: true,
    });
  });

  it('같은 id 에 다른 입력은 충돌이다 — 끝났든 잡혀 있든 가져가지 않는다', async () => {
    const first = await claimed(await claimManualRequest(db, input(), T0));
    expect(await claimManualRequest(db, input('fp-b'), new Date(T0.getTime() + 1000))).toEqual({ kind: 'conflict' });
    await completeManualRequest(db, first);
    expect(await claimManualRequest(db, input('fp-b'), new Date(T0.getTime() + 2000))).toEqual({ kind: 'conflict' });
    const stale = new Date(T0.getTime() + MANUAL_REQUEST_STALE_MS + 5000);
    expect(await claimManualRequest(db, input('fp-b'), stale)).toEqual({ kind: 'conflict' });
  });
});
