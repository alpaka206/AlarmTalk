// **탈퇴 등급 통지 대기열** — 실제 SQLite(코덱스 #841).
//
// 파기 트랜잭션이 받을 사람을 적고(`account-purge-plan-push.test.ts`), 커밋 뒤 발송이 끝난 다음에만
// 지운다. 비우기는 1분 전용 크론의 홀수 분이 **자기 예산을 통째로 가진 실행**에서 하고, 사람마다 기기
// 수로 비용을 미리 세어 예산 안에 드는 만큼만 잡는다 — 예산 때문에 시도 횟수가 오르지 않는다.
// 즉시 삭제는 커밋 뒤 자기 파기분을 곧바로 보내되 시도 횟수를 쓰지 않는다.
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
  enqueuePlanNotificationsStatement,
  isPlanNotificationDrainMinute,
  runPlanNotificationDrainTurn,
  sendPlanNotificationsNow,
  PLAN_NOTIFY_MAX_ATTEMPTS,
  PLAN_NOTIFY_RUN_BUDGET,
  PLAN_NOTIFY_RUN_OVERHEAD,
} from '../src/lib/pending-plan-notifications';

const MESSAGE_BUDGET = PLAN_NOTIFY_RUN_BUDGET - PLAN_NOTIFY_RUN_OVERHEAD;

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

/** 이 사람에게 기기 `n` 대를 심는다(비용 계산이 센다). */
async function withDevices(userId: string, n: number): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, name, plan) VALUES (?, ?, ?, 'free')`,
    args: [userId, `${userId}@example.com`, userId],
  });
  for (let i = 0; i < n; i++) {
    await db.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`,
      args: [`pt-${userId}-${i}`, userId, `tok-${userId}-${i}`],
    });
  }
}

async function attemptsOf(userId: string): Promise<number> {
  const res = await db.execute({
    sql: `SELECT attempts FROM pending_plan_notifications WHERE user_id = ?`,
    args: [userId],
  });
  return Number(res.rows[0]?.attempts ?? -1);
}

/** 잠금 기한이 지난 뒤 — 테스트는 같은 순간에 도므로 기한을 직접 지난 시각으로 돌린다. */
async function leasesExpire(): Promise<void> {
  await db.execute(`UPDATE pending_plan_notifications SET claimed_until = '2000-01-01 00:00:00.000'
                    WHERE claimed_until IS NOT NULL`);
}

/** 지우기에서 던지는 실행(실행이 그 지점에서 죽었다) — 그 앞의 조회·잡기·발송은 된다. */
function diesAtDelete(): Client {
  return {
    execute: async (stmt: Parameters<Client['execute']>[0]) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      if (sql.includes('DELETE FROM pending_plan_notifications')) throw new Error('worker died');
      return db.execute(stmt);
    },
  } as unknown as Client;
}

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  notifyBillingStateChanged.mockReset();
  notifyBillingStateChanged.mockImplementation(async () => undefined);
});

describe('탈퇴 등급 통지 대기열 — 넣기', () => {
  it('중복을 접고, 이미 있는 사람은 한 행으로 남되 새 사건으로 다시 센다(시도 횟수·잠금을 되돌린다)', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1', 'm2', 'm1', ''])!);
    await db.execute(
      `UPDATE pending_plan_notifications SET attempts = 2, claimed_until = '2999-01-01 00:00:00.000' WHERE user_id = 'm2'`,
    );
    await db.execute(enqueuePlanNotificationsStatement(['m2', 'm3'])!);
    expect(await queued()).toEqual(['m1', 'm2', 'm3']);
    expect(await attemptsOf('m2')).toBe(0);
    const lease = await db.execute(`SELECT claimed_until FROM pending_plan_notifications WHERE user_id = 'm2'`);
    expect(lease.rows[0]!.claimed_until).toBeNull();
    expect(enqueuePlanNotificationsStatement([])).toBeNull();
  });
});

describe('탈퇴 등급 통지 대기열 — 1분 전용 크론의 홀수 분(자기 예산을 통째로 가진 실행)', () => {
  it('홀수 분에만 차례가 있다 — 짝수 분은 늘 개인 플랜 종료 작업이다', () => {
    expect(isPlanNotificationDrainMinute(new Date('2026-10-01T00:01:00Z'))).toBe(true);
    expect(isPlanNotificationDrainMinute(new Date('2026-10-01T00:02:00Z'))).toBe(false);
  });

  it('비어 있으면 차례를 쓰지 않는다(false) — 아무도 깨우지 않는다', async () => {
    expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(false);
    expect(notifyBillingStateChanged).not.toHaveBeenCalled();
  });

  it('비용을 미리 센다 — 기기 수로 예산에 드는 사람만 잡고, 안 드는 사람은 잡지 않아 시도 횟수가 그대로다', async () => {
    // 기기당 두 통. 한 사람 기기 6대 = 12통 — 예산(메시지)에 세 사람까지 든다.
    const perPerson = 6;
    const fits = Math.floor(MESSAGE_BUDGET / (2 * perPerson));
    const ids = Array.from({ length: fits + 2 }, (_, i) => `m${i}`);
    for (const [i, id] of ids.entries()) {
      await withDevices(id, perPerson);
      await enqueueAt(id, `2026-10-01 00:00:0${i}.000`);
    }

    expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(true);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(ids.slice(0, fits));
    // 예산 안에 다 들었으므로 자르지 않는다.
    expect(notifyBillingStateChanged.mock.calls[0]![3]).toEqual({ maxMessages: undefined });
    // 안 든 사람은 잡지 않았다 — 시도 횟수 0, 다음 차례에 그대로 나간다.
    expect(await queued()).toEqual(ids.slice(fits));
    for (const id of ids.slice(fits)) expect(await attemptsOf(id)).toBe(0);
  });

  it('한 사람만으로 예산을 넘으면 그 사람만 보내되 메시지를 예산까지 자른다(보이는 예고가 먼저 남는다)', async () => {
    await withDevices('many', MESSAGE_BUDGET); // 기기 수 = 메시지 예산 → 두 통씩이면 두 배
    await withDevices('next', 1);
    await enqueueAt('many', '2026-10-01 00:00:00.000');
    await enqueueAt('next', '2026-10-01 00:00:01.000');

    await runPlanNotificationDrainTurn(db, undefined);

    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['many']);
    expect(notifyBillingStateChanged.mock.calls[0]![3]).toEqual({ maxMessages: MESSAGE_BUDGET });
    expect(await queued()).toEqual(['next']);
  });

  it('시도가 적은 행이 먼저다 — 거듭 죽은 행이 새 사람을 막지 않는다', async () => {
    await enqueueAt('crashed', '2026-10-01 00:00:00.000', 2);
    await enqueueAt('fresh', '2026-10-01 00:05:00.000');
    await withDevices('crashed', MESSAGE_BUDGET); // 혼자서 예산을 다 쓰는 사람
    await withDevices('fresh', 1);

    await runPlanNotificationDrainTurn(db, undefined);

    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['fresh']);
  });

  it('**보낸 뒤에** 지운다 — 보낸 뒤 실행이 죽으면 행이 남아 잠금 기한 뒤 다시 보낸다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    let queuedAtSend: string[] = [];
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      queuedAtSend = await queued();
    });

    await expect(runPlanNotificationDrainTurn(diesAtDelete(), undefined)).rejects.toThrow('worker died');
    // 보낼 때 행은 아직 있었다(지우기를 앞으로 옮기면 이 단언이 깨진다).
    expect(queuedAtSend).toEqual(['m1']);
    expect(await queued()).toEqual(['m1']);
    // 잠금 기한 전에는 아무도 못 고른다.
    expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(false);

    await leasesExpire();
    expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(true);
    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(2);
    expect(await queued()).toEqual([]);
  });

  it('거듭 죽은 행은 상한에서 보내지 않고 지운다 — 같은 예고가 끝없이 반복되지 않는다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['stuck'])!);
    for (let i = 0; i < PLAN_NOTIFY_MAX_ATTEMPTS; i++) {
      await expect(runPlanNotificationDrainTurn(diesAtDelete(), undefined)).rejects.toThrow();
      await leasesExpire();
    }
    expect(await attemptsOf('stuck')).toBe(PLAN_NOTIFY_MAX_ATTEMPTS);
    notifyBillingStateChanged.mockClear();

    await runPlanNotificationDrainTurn(db, undefined);

    expect(notifyBillingStateChanged).not.toHaveBeenCalled();
    expect(await queued()).toEqual([]);
  });

  it('보내는 사이 같은 사람이 다른 탈퇴로 다시 들어오면 그 새 사건은 지우지 않는다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    });

    await runPlanNotificationDrainTurn(db, undefined);

    expect(await queued()).toEqual(['m1']);
    expect(await attemptsOf('m1')).toBe(0);
  });
});

describe('탈퇴 등급 통지 대기열 — 즉시 삭제의 곧바로 보내기', () => {
  it('지정한 사람만 보내고 지운다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1', 'm2', 'other'])!);

    await sendPlanNotificationsNow(db, undefined, ['m1', 'm2']);

    expect(notifyBillingStateChanged.mock.calls[0]![2]).toEqual(['m1', 'm2']);
    expect(await queued()).toEqual(['other']);
  });

  it('**시도 횟수를 쓰지 않는다** — 그 요청은 파기로 예산을 이미 썼고, 잘린 것은 그 사람의 실패가 아니다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);

    await expect(sendPlanNotificationsNow(diesAtDelete(), undefined, ['m1'])).rejects.toThrow();

    expect(await attemptsOf('m1')).toBe(0);
    // 잠금 기한 뒤 전용 크론이 잇는다.
    await leasesExpire();
    expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(true);
    expect(await queued()).toEqual([]);
  });

  it('잡힌 행은 다른 실행이 고르지 않는다 — 전용 크론과 겹쳐도 같은 예고가 두 번 나가지 않는다', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    // 즉시 삭제가 잡고 보내는 도중에 전용 크론과 다른 즉시 삭제가 같은 사람을 찾는다.
    notifyBillingStateChanged.mockImplementationOnce(async () => {
      expect(await runPlanNotificationDrainTurn(db, undefined)).toBe(false);
      await sendPlanNotificationsNow(db, undefined, ['m1']);
    });

    await sendPlanNotificationsNow(db, undefined, ['m1']);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(await queued()).toEqual([]);
  });

  it('두 실행이 같은 행을 읽어도 한쪽만 잡는다(읽은 값 그대로일 때만 잡기)', async () => {
    await db.execute(enqueuePlanNotificationsStatement(['m1'])!);
    let raced = false;
    const cron = {
      execute: async (stmt: Parameters<Client['execute']>[0]) => {
        const res = await db.execute(stmt);
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        if (!raced && sql.trimStart().startsWith('SELECT')) {
          raced = true;
          await sendPlanNotificationsNow(db, undefined, ['m1']);
        }
        return res;
      },
    } as unknown as Client;

    await runPlanNotificationDrainTurn(cron, undefined);

    expect(notifyBillingStateChanged).toHaveBeenCalledTimes(1);
    expect(await queued()).toEqual([]);
  });
});
