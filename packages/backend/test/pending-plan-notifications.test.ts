// **탈퇴 등급 통지 대기열** — 실제 SQLite(코덱스 #841).
//
// 파기 트랜잭션이 받을 사람을 적고(`account-purge-plan-push.test.ts`), 커밋 뒤 발송이 끝난 다음에만
// 지운다. 발송이 subrequest 예산에 잘리면 지우는 문장도 같이 실패해 행이 남고, 다음 크론 틱이 잇는다.
// 규칙: `docs/spec/billing-lifecycle.md` 「그룹 주인이 탈퇴하면」.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';

const notifyBillingStateChanged = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
);
vi.mock('../src/lib/billing-cancel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/billing-cancel')>()),
  notifyBillingStateChanged,
}));

import { runMigrations } from '../src/lib/migrations';
import {
  drainPendingPlanNotifications,
  enqueuePlanNotificationsStatement,
  PLAN_NOTIFY_DRAIN_LIMIT,
  PLAN_NOTIFY_MAX_ATTEMPTS,
} from '../src/lib/pending-plan-notifications';

let db: Client;

async function queued(): Promise<string[]> {
  const res = await db.execute(`SELECT user_id FROM pending_plan_notifications ORDER BY user_id`);
  return res.rows.map((row) => String(row.user_id));
}

async function enqueueAt(userId: string, createdAt: string, attempts = 0): Promise<void> {
  await db.execute({
    sql: `INSERT INTO pending_plan_notifications (user_id, created_at, attempts) VALUES (?, ?, ?)`,
    args: [userId, createdAt, attempts],
  });
}

/** 발송이 예산을 다 쓴 실행 — 그 뒤의 지우기는 던진다(그 앞의 조회·시도 횟수 올리기는 된다). */
function budgetExhaustedAtDelete(): Client {
  return {
    execute: async (stmt: Parameters<Client['execute']>[0]) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      if (sql.includes('DELETE FROM pending_plan_notifications')) {
        throw new Error('Too many subrequests by single Worker invocation.');
      }
      return db.execute(stmt);
    },
  } as unknown as Client;
}

async function attemptsOf(userId: string): Promise<number> {
  const res = await db.execute({
    sql: `SELECT attempts FROM pending_plan_notifications WHERE user_id = ?`,
    args: [userId],
  });
  return Number(res.rows[0]?.attempts ?? -1);
}

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  notifyBillingStateChanged.mockReset();
  notifyBillingStateChanged.mockImplementation(async () => undefined);
});

describe('탈퇴 등급 통지 대기열', () => {
  it('넣는 문장은 중복을 접고, 이미 있는 사람은 한 행으로 남되 새 사건으로 다시 센다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1', 'm2', 'm1', ''])!);
    await db.execute(`UPDATE pending_plan_notifications SET attempts = 2 WHERE user_id = 'm2'`);
    await db.execute(enqueuePlanNotificationsStatement(['m2', 'm3'])!);
    expect(await queued()).toEqual(['m1', 'm2', 'm3']);
    // 다시 들어온 사람은 시도 횟수가 되돌아간다(새 사건 — 지난 시도의 상한에 걸리면 안 된다).
    expect(await attemptsOf('m2')).toBe(0);
    expect(enqueuePlanNotificationsStatement([])).toBeNull();
  });

  it('크론은 오래된 순으로 한도만큼 꺼내 보내고, 보낸 사람만 지운다', async () => {
    const ids = Array.from({ length: PLAN_NOTIFY_DRAIN_LIMIT + 2 }, (_, i) => `m${i}`);
    for (const [i, id] of ids.entries()) {
      await enqueueAt(id, `2026-10-01 00:00:0${i}.000`);
    }

    await drainPendingPlanNotifications(db, undefined);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(ids.slice(0, PLAN_NOTIFY_DRAIN_LIMIT));
    // 남은 사람은 다음 틱이 잇는다.
    expect(await queued()).toEqual(ids.slice(PLAN_NOTIFY_DRAIN_LIMIT));
  });

  it('지정한 사람만 보내고 지운다(즉시 삭제가 자기 파기분을 곧바로 보낼 때)', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1', 'm2', 'other'])!);

    await drainPendingPlanNotifications(db, undefined, { userIds: ['m1', 'm2'] });

    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['m1', 'm2']);
    expect(await queued()).toEqual(['other']);
  });

  it('**보낸 뒤에** 지운다 — 예산이 바닥나 지우기가 실패하면 행이 남아 다음 틱이 다시 보낸다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    let queuedAtSend: string[] = [];
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      queuedAtSend = await queued();
    });
    const exhausted = budgetExhaustedAtDelete();
    await expect(drainPendingPlanNotifications(exhausted, undefined)).rejects.toThrow(/subrequests/);
    // 보낼 때 행은 아직 있었다(지우기를 앞으로 옮기면 이 단언이 깨진다).
    expect(queuedAtSend).toEqual(['m1']);
    expect(await queued()).toEqual(['m1']);

    // 다음 틱 — 다시 보내고 이번에는 지운다.
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(2);
    expect(await queued()).toEqual([]);
  });

  it('비어 있으면 아무도 깨우지 않는다', async () => {
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).not.toHaveBeenCalled();
  });
  it('끝내 예산에 안 들어가는 머리는 뒤로 밀리고, 상한을 넘으면 보내지 않고 지운다(반복 예고 상한)', async () => {
    // 'stuck' 은 매번 예산을 다 써 지우기까지 못 간다. 그 사이 새 사람이 들어온다.
    await enqueueAt('stuck', '2026-10-01 00:00:00.000');
    for (let i = 0; i < PLAN_NOTIFY_MAX_ATTEMPTS; i++) {
      await expect(drainPendingPlanNotifications(budgetExhaustedAtDelete(), undefined, { limit: 1 })).rejects.toThrow();
    }
    expect(await attemptsOf('stuck')).toBe(PLAN_NOTIFY_MAX_ATTEMPTS);

    await enqueueAt('fresh', '2026-10-01 00:00:09.000');
    notifyBillingStateChanged.mockClear();
    // 시도가 적은 새 사람이 먼저 나간다 — 막힌 머리가 뒤 행을 막지 않는다.
    await drainPendingPlanNotifications(db, undefined, { limit: 1 });
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['fresh']);

    // 상한에 닿은 머리는 더 보내지 않고 지운다 — 같은 예고가 5분마다 영원히 나가지 않는다.
    notifyBillingStateChanged.mockClear();
    await drainPendingPlanNotifications(db, undefined, { limit: 1 });
    expect(notifyBillingStateChanged).not.toHaveBeenCalled();
    expect(await queued()).toEqual([]);
  });

  it('보내는 사이 같은 사람이 다른 탈퇴로 다시 들어오면 그 새 사건은 지우지 않는다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      // 발송 중에 두 번째 그룹 주인이 탈퇴해 m1 이 다시 적혔다(시각이 달라지도록 1ms 띄운다).
      await new Promise((resolve) => setTimeout(resolve, 2));
      await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    });

    await drainPendingPlanNotifications(db, undefined);

    // 처음 사건은 보냈고, 새 사건은 남아 다음 틱이 보낸다.
    expect(await queued()).toEqual(['m1']);
    expect(await attemptsOf('m1')).toBe(0);
  });
});
