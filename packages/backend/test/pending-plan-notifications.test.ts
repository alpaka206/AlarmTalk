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
  PLAN_NOTIFY_FRESH_LIMIT,
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

/** 잠금 기한이 지난 뒤의 틱 — 테스트는 같은 순간에 도므로 기한을 직접 지난 시각으로 돌린다. */
async function leasesExpire(): Promise<void> {
  await db.execute(`UPDATE pending_plan_notifications SET claimed_until = '2000-01-01 00:00:00.000'
                    WHERE claimed_until IS NOT NULL`);
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

  it('크론은 새 행을 오래된 순으로 한도만큼 꺼내 보내고, 보낸 사람만 지운다', async () => {
    const ids = Array.from({ length: PLAN_NOTIFY_FRESH_LIMIT + 2 }, (_, i) => `m${String(i).padStart(2, '0')}`);
    for (const [i, id] of ids.entries()) {
      await enqueueAt(id, `2026-10-01 00:00:${String(i).padStart(2, '0')}.000`);
    }

    await drainPendingPlanNotifications(db, undefined);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(ids.slice(0, PLAN_NOTIFY_FRESH_LIMIT));
    // 남은 사람은 다음 틱이 잇는다.
    expect(await queued()).toEqual(ids.slice(PLAN_NOTIFY_FRESH_LIMIT));
  });

  it('한도는 크론 한 틱의 최대 적재량(파기 2건 × 떨어져 나갈 멤버 5명)을 덮는다 — 대기열이 불어나지 않는다(코덱스 #841)', () => {
    expect(PLAN_NOTIFY_FRESH_LIMIT).toBeGreaterThanOrEqual(2 * 5);
  });

  it('새 행이 계속 들어와도 다시 시도할 행이 매 틱 따로 한 자리를 받는다(코덱스 #841)', async () => {
    await enqueueAt('retry', '2026-10-01 00:00:00.000', 1);
    for (let i = 0; i < PLAN_NOTIFY_FRESH_LIMIT; i++) {
      await enqueueAt(`f${String(i).padStart(2, '0')}`, `2026-10-01 00:01:${String(i).padStart(2, '0')}.000`);
    }

    await drainPendingPlanNotifications(db, undefined);

    // 새 행 묶음 한 번 + 다시 시도 혼자 한 번 — 재시도가 새 행 뒤에서 굶지 않는다.
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(2);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toHaveLength(PLAN_NOTIFY_FRESH_LIMIT);
    expect(notifyBillingStateChanged.mock.calls[1]![2]).toEqual(['retry']);
    expect(await queued()).toEqual([]);
  });

  it('새 행 묶음이 예산을 다 쓰면 다시 시도할 행은 잡히지 않는다 — 그 사람의 시도 횟수가 억울하게 오르지 않는다', async () => {
    await enqueueAt('retry', '2026-10-01 00:00:00.000', 1);
    await enqueueAt('fresh', '2026-10-01 00:01:00.000');
    // 새 행을 지우는 순간 예산이 바닥난다 — 그 뒤 문장(재시도 조회·잡기)은 전부 던진다.
    let exhausted = false;
    const client = {
      execute: async (stmt: Parameters<Client['execute']>[0]) => {
        if (exhausted) throw new Error('Too many subrequests by single Worker invocation.');
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        if (sql.includes('DELETE FROM pending_plan_notifications')) {
          exhausted = true;
          throw new Error('Too many subrequests by single Worker invocation.');
        }
        return db.execute(stmt);
      },
    } as unknown as Client;

    await expect(drainPendingPlanNotifications(client, undefined)).rejects.toThrow(/subrequests/);

    expect(await attemptsOf('retry')).toBe(1);
    expect(await attemptsOf('fresh')).toBe(1);
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

    // 다음 틱(잠금 기한 뒤) — 다시 보내고 이번에는 지운다.
    await leasesExpire();
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(2);
    expect(await queued()).toEqual([]);
  });

  it('비어 있으면 아무도 깨우지 않는다', async () => {
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).not.toHaveBeenCalled();
  });
  it('끝내 예산에 안 들어가는 사람은 상한에서 보내지 않고 지우고, 그동안 새 행을 막지 않는다(반복 예고 상한)', async () => {
    // 'stuck' 은 매번 예산을 다 써 지우기까지 못 간다.
    await enqueueAt('stuck', '2026-10-01 00:00:00.000');
    for (let i = 0; i < PLAN_NOTIFY_MAX_ATTEMPTS; i++) {
      await expect(drainPendingPlanNotifications(budgetExhaustedAtDelete(), undefined)).rejects.toThrow();
      await leasesExpire();
    }
    expect(await attemptsOf('stuck')).toBe(PLAN_NOTIFY_MAX_ATTEMPTS);

    await enqueueAt('fresh', '2026-10-01 00:00:09.000');
    notifyBillingStateChanged.mockClear();
    await drainPendingPlanNotifications(db, undefined);

    // 새 사람은 나갔고, 상한에 닿은 머리는 더 보내지 않고 지웠다 — 같은 예고가 영원히 나가지 않는다.
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['fresh']);
    expect(await queued()).toEqual([]);
  });

  it('잡힌 행은 잠금 기한까지 다른 실행이 고르지 않는다 — 보내는 동안 다시 잡혀 두 번 나가지 않는다(코덱스 #841)', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    // 크론(A)이 잡고 보내는 도중에, 즉시 삭제(B)와 다음 틱(C)이 같은 사람을 찾는다.
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      await drainPendingPlanNotifications(db, undefined, { userIds: ['m1'] });
      await drainPendingPlanNotifications(db, undefined);
    });

    await drainPendingPlanNotifications(db, undefined);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(await queued()).toEqual([]);
  });

  it('잡은 실행이 보내기 전에 죽으면 잠금 기한이 지난 뒤 다시 보낸다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      throw new Error('worker killed');
    });
    await expect(drainPendingPlanNotifications(db, undefined)).rejects.toThrow('worker killed');

    // 기한 전에는 아무도 못 고른다.
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);

    await leasesExpire();
    await drainPendingPlanNotifications(db, undefined);
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(2);
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
  it('묶음이 일부만 나간 뒤에는 한 사람씩 다시 보낸다 — 뒷사람이 한 번도 못 받은 채 버려지지 않는다(코덱스 #841)', async () => {
    // 'heavy' 는 기기가 많아 함께 보내면 매번 예산을 다 쓴다. 'light' 는 혼자면 들어간다.
    await enqueueAt('heavy', '2026-10-01 00:00:00.000');
    await enqueueAt('light', '2026-10-01 00:00:01.000');
    const sentTo: string[][] = [];
    notifyBillingStateChanged.mockImplementation(async (...args: unknown[]) => {
      sentTo.push(args[2] as string[]);
    });
    /** heavy 가 들어간 실행만 예산이 바닥난다. */
    const runOnce = async () => {
      const before = sentTo.length;
      const lastSend = () => (sentTo.length > before ? sentTo[sentTo.length - 1]! : []);
      const client = {
        execute: async (stmt: Parameters<Client['execute']>[0]) => {
          const sql = typeof stmt === 'string' ? stmt : stmt.sql;
          if (sql.includes('DELETE FROM pending_plan_notifications') && lastSend().includes('heavy')) {
            throw new Error('Too many subrequests by single Worker invocation.');
          }
          return db.execute(stmt);
        },
      } as unknown as Client;
      await drainPendingPlanNotifications(client, undefined).catch(() => undefined);
    };

    for (let tick = 0; tick < PLAN_NOTIFY_MAX_ATTEMPTS + 3; tick++) {
      await runOnce();
      await leasesExpire();
    }

    // 처음 한 번만 함께, 그 뒤로는 혼자씩 — light 는 혼자 보내져 지워졌다.
    expect(sentTo[0]).toEqual(['heavy', 'light']);
    expect(sentTo.slice(1).every((ids) => ids.length === 1)).toBe(true);
    expect(sentTo.slice(1)).toContainEqual(['light']);
    // heavy 는 혼자서도 끝내 안 들어가 상한에서 버려졌다 — 대기열이 비었다.
    expect(await queued()).toEqual([]);
  });

  it('두 실행이 같은 행을 읽어도 한쪽만 잡아 보낸다 — 같은 예고가 두 번 나가지 않는다(코덱스 #841)', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    // 크론(A)이 행을 읽은 직후, 즉시 삭제(B)의 비우기가 끝까지 돈다.
    let raced = false;
    const cron = {
      execute: async (stmt: Parameters<Client['execute']>[0]) => {
        const res = await db.execute(stmt);
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        if (!raced && sql.trimStart().startsWith('SELECT')) {
          raced = true;
          await drainPendingPlanNotifications(db, undefined, { userIds: ['m1'] });
        }
        return res;
      },
    } as unknown as Client;

    await drainPendingPlanNotifications(cron, undefined);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(await queued()).toEqual([]);
  });
});
