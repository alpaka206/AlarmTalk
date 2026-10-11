// **그룹 주인이 탈퇴하면 해체된 멤버에게 등급 변경을 알린다**(2026-10-01) — 실제 SQLite.
//
// 탈퇴 파기(`pseudonymizeBillingForRetention` → `purgeUserAccount`, 한 쓰기 트랜잭션)는 주인의
// 구독을 취소하고 그 자리에서 소유 그룹을 해체한다. 멤버는 가족 → 무료로 내려가는데, 예전에는
// `cancelActiveSubscriptionsForUser` 의 반환값(등급이 바뀐 사람)을 버렸다. 주인에게 클론이
// 없으면 목소리 철회도 아무도 안 깨우므로, 멤버는 다음 앱 시작·주기 pull 까지 옛 등급이었다.
// 규칙: `docs/spec/billing-lifecycle.md` 「그룹 주인이 탈퇴하면」.
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client, type InValue } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import { withWriteTransaction } from '../src/lib/transactions';
import {
  purgeUserAccount,
  pseudonymizeBillingForRetention,
  type AccountPurgeNotifications,
} from '../src/lib/account-deletion';

const PEPPER = 'test-pepper';
const NOW = new Date('2026-09-30T00:00:00.000Z');
const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';

// 떠나는 사람. 계정 id 와 로그인 id 를 일부러 다르게 둔다 — 둘 다 목록에서 빠져야 한다.
const A_PK = 'a0000000-0000-4000-8000-00000000000a';
const A_LOGIN = 'google-sub-leaving-000001';
// A 의 그룹 멤버.
const B_PK = 'b0000000-0000-4000-8000-00000000000b';
// 무관한 사람 — 자기 개인 구독이 있다. 건드리면 안 된다.
const C_PK = 'c0000000-0000-4000-8000-00000000000c';

let db: Client;

async function run(sql: string, args: InValue[] = []): Promise<void> {
  await db.execute({ sql, args });
}

async function one(sql: string, args: InValue[] = []): Promise<Record<string, unknown>> {
  const res = await db.execute({ sql, args });
  return res.rows[0] as unknown as Record<string, unknown>;
}

async function queued(): Promise<string[]> {
  const res = await db.execute(`SELECT user_id FROM pending_plan_notifications ORDER BY user_id`);
  return res.rows.map((row) => String(row.user_id));
}

async function purgeA(): Promise<AccountPurgeNotifications> {
  return withWriteTransaction(db, async (tx) => {
    await pseudonymizeBillingForRetention(tx, A_PK, PEPPER, NOW);
    return purgeUserAccount(tx, A_PK, A_LOGIN, false);
  });
}

/** A 가 가족 그룹(g-a)의 주인이고 B 가 그 그룹 구독으로 들어와 있다. C 는 무관하다. */
async function seedFamily(entitlement: 'entitled' | 'suspended' = 'entitled'): Promise<void> {
  // 보류면 등급은 이미 둘 다 free 다(`propagateGroupMemberPlans`).
  const paidPlan = entitlement === 'entitled' ? 'family' : 'free';
  await run(`INSERT INTO users (id, google_id, email, name, plan) VALUES (?, ?, 'a@example.com', '떠나는주인', ?)`, [
    A_PK,
    A_LOGIN,
    paidPlan,
  ]);
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, 'b@example.com', '멤버', ?)`, [B_PK, paidPlan]);
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, 'c@example.com', '무관', 'plus')`, [C_PK]);
  await run(`INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g-a', ?, ?, 6)`, [A_PK, FAMILY]);
  await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-a', 'g-a', ?, 'owner')`, [A_PK]);
  await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-b', 'g-a', ?, 'member')`, [B_PK]);
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, entitlement_state, starts_at, expires_at)
     VALUES ('sub-a', ?, ?, 'g-a', 'active', ?, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    [A_PK, FAMILY, entitlement],
  );
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, entitlement_state, starts_at, expires_at)
     VALUES ('sub-b', ?, ?, 'g-a', 'active', ?, '2026-09-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    [B_PK, FAMILY, entitlement],
  );
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
     VALUES ('sub-c', ?, ?, NULL, 'active', '2026-09-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z')`,
    [C_PK, PERSONAL],
  );
}

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  // 운영처럼 FK 를 켠다 — 자식 행을 안 지우면 파기가 통째로 롤백되는 것까지 재현한다.
  await db.execute('PRAGMA foreign_keys = ON');
}, 60_000);

describe('그룹 주인 탈퇴 — 해체된 멤버의 등급 변경 통지 (실제 SQLite)', () => {
  it('클론 없는 주인이 떠나면 멤버가 목록에 있고 실제로 무료로 내려간다 — 떠나는 사람·무관한 사람은 없다', async () => {
    await seedFamily();

    const purged = await purgeA();

    // 목소리 철회는 아무도 안 깨운다(파기할 클론이 없다) — 그래서 이 목록이 필요하다.
    expect(purged.downgradedAlarms).toEqual([]);
    expect(purged.voiceAccessRevokedUserIds).toEqual([]);
    expect(purged.planChangedUserIds).toEqual([B_PK]);
    expect(purged.planChangedUserIds).not.toContain(A_PK);
    expect(purged.planChangedUserIds).not.toContain(A_LOGIN);
    expect(purged.planChangedUserIds).not.toContain(C_PK);

    // 목록이 말하는 대로 실제로 바뀌었다.
    expect((await one(`SELECT plan FROM users WHERE id = ?`, [B_PK])).plan).toBe('free');
    expect((await one(`SELECT status FROM subscriptions WHERE id = 'sub-b'`)).status).toBe('cancelled');
    expect((await one(`SELECT COUNT(*) AS n FROM plan_group_members WHERE user_id = ?`, [B_PK])).n).toBe(0);
    // 무관한 사람은 그대로다.
    expect((await one(`SELECT plan FROM users WHERE id = ?`, [C_PK])).plan).toBe('plus');
    expect((await one(`SELECT status FROM subscriptions WHERE id = 'sub-c'`)).status).toBe('active');
    // 떠나는 사람은 파기됐다.
    expect((await one(`SELECT COUNT(*) AS n FROM users WHERE id = ?`, [A_PK])).n).toBe(0);
    // 받을 사람은 파기와 **같은 트랜잭션**에서 통지 대기열에 적혔다 — 커밋 뒤 발송이 잘려도 크론이 잇는다.
    expect(await queued()).toEqual([B_PK]);
  });

  it('클론 있는 주인도 같다 — 목소리 철회 통지와 별개로 멤버가 목록에 있다', async () => {
    await seedFamily();
    await run(
      `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, is_system, is_shared)
       VALUES ('vp-a', ?, '주인 목소리', 'el-voice-a', 0, 1)`,
      [A_PK],
    );

    const purged = await purgeA();

    expect(purged.voiceAccessRevokedUserIds).toEqual([B_PK]);
    expect(purged.planChangedUserIds).toEqual([B_PK]);
    expect((await one(`SELECT plan FROM users WHERE id = ?`, [B_PK])).plan).toBe('free');
  });

  it('결제 보류 중인 주인도 활성 구독으로 잡혀 그룹이 해체되고 멤버가 목록에 있다', async () => {
    // 보류는 `status = 'active'` 를 그대로 둔다 — `findActiveSubscriptionsByUserPk` 가 잡는다.
    // 등급은 이미 free 지만 그룹 접근이 사라지므로 `plan_changed` 대상이다(해체 규칙 그대로).
    await seedFamily('suspended');

    const purged = await purgeA();

    expect(purged.planChangedUserIds).toEqual([B_PK]);
    expect((await one(`SELECT status FROM subscriptions WHERE id = 'sub-b'`)).status).toBe('cancelled');
    expect((await one(`SELECT plan FROM users WHERE id = ?`, [B_PK])).plan).toBe('free');
  });

  it('떠나는 사람이 남의 그룹 멤버이기만 하면 아무도 등급이 바뀌지 않는다', async () => {
    // C 가 주인, A 가 멤버. A 의 탈퇴는 C 의 등급을 바꾸지 않는다.
    await run(`INSERT INTO users (id, google_id, email, name, plan) VALUES (?, ?, 'a@example.com', '떠나는멤버', 'family')`, [
      A_PK,
      A_LOGIN,
    ]);
    await run(`INSERT INTO users (id, email, name, plan) VALUES (?, 'c@example.com', '주인', 'family')`, [C_PK]);
    await run(`INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g-c', ?, ?, 6)`, [C_PK, FAMILY]);
    await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-c', 'g-c', ?, 'owner')`, [C_PK]);
    await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-a', 'g-c', ?, 'member')`, [A_PK]);
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
       VALUES ('sub-c', ?, ?, 'g-c', 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      [C_PK, FAMILY],
    );
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
       VALUES ('sub-a', ?, ?, 'g-c', 'active', '2026-09-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      [A_PK, FAMILY],
    );

    const purged = await purgeA();

    expect(purged.planChangedUserIds).toEqual([]);
    expect((await one(`SELECT plan FROM users WHERE id = ?`, [C_PK])).plan).toBe('family');
    expect((await one(`SELECT status FROM subscriptions WHERE id = 'sub-c'`)).status).toBe('active');
  });
  it('주인 구독이 이미 끝났는데 남은 소유 그룹의 멤버도 목록에 있다(코덱스 #841)', async () => {
    // 레거시 복구(`repairFamilyPlanGroupForUser`)가 멤버의 옛 가족 구독을 다시 붙인 그룹처럼,
    // 주인 구독은 `cancelled` 인데 그룹·멤버십이 남은 모양. 취소는 아무도 돌려주지 않지만 파기
    // 묶음이 그 멤버십·그룹을 지우므로 멤버의 그룹 접근이 바뀐다 — 알려야 한다.
    await seedFamily();
    await run(`UPDATE subscriptions SET status = 'cancelled' WHERE id = 'sub-a'`);

    const purged = await purgeA();

    expect(purged.planChangedUserIds).toEqual([B_PK]);
    // 그룹·멤버십은 실제로 사라졌다(알린 사실과 같다).
    expect(await one(`SELECT COUNT(*) AS n FROM plan_group_members WHERE user_id = ?`, [B_PK])).toEqual({ n: 0 });
    expect(await one(`SELECT COUNT(*) AS n FROM plan_groups WHERE id = 'g-a'`)).toEqual({ n: 0 });
    expect(await queued()).toEqual([B_PK]);
  });

  it('파기가 롤백되면 대기열에도 아무도 남지 않는다(통지와 파기는 같이 커밋된다)', async () => {
    await seedFamily();
    await expect(
      withWriteTransaction(db, async (tx) => {
        await purgeUserAccount(tx, A_PK, A_LOGIN, false);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await queued()).toEqual([]);
    expect((await one(`SELECT COUNT(*) AS n FROM users WHERE id = ?`, [A_PK])).n).toBe(1);
  });
});
