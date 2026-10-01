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
} from '../src/lib/pending-plan-notifications';

let db: Client;

async function queued(): Promise<string[]> {
  const res = await db.execute(`SELECT user_id FROM pending_plan_notifications ORDER BY user_id`);
  return res.rows.map((row) => String(row.user_id));
}

async function enqueueAt(userId: string, createdAt: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO pending_plan_notifications (user_id, created_at) VALUES (?, ?)`,
    args: [userId, createdAt],
  });
}

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  notifyBillingStateChanged.mockReset();
  notifyBillingStateChanged.mockImplementation(async () => undefined);
});

describe('탈퇴 등급 통지 대기열', () => {
  it('넣는 문장은 중복을 접고, 이미 있는 사람은 그대로 둔다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1', 'm2', 'm1', ''])!);
    await db.execute(enqueuePlanNotificationsStatement(['m2', 'm3'])!);
    expect(await queued()).toEqual(['m1', 'm2', 'm3']);
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
    // 발송이 예산을 다 쓴 실행: 그 뒤의 subrequest(지우기)는 전부 던진다.
    const exhausted = {
      execute: async (stmt: Parameters<Client['execute']>[0]) => {
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        if (sql.includes('DELETE FROM pending_plan_notifications')) {
          throw new Error('Too many subrequests by single Worker invocation.');
        }
        return db.execute(stmt);
      },
    } as unknown as Client;

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
});
