// **그룹 해체·보류 전파는 멤버 수와 무관하게 왕복 두 번이다**(2026-09-20).
//
// 예전에는 멤버마다 조회·취소·강등·클론 반납·보관 기한을 따로 왕복해, 멤버 넷인 가족
// 그룹 하나를 해체하는 데 40번 넘게 오갔다. 워커 한 실행의 subrequest 는 ~50 이라 해체를
// 품은 요청(가족 → 개인 전환, 체인 넘겨받기, 만료)이 롤백되고 재시도해도 같은 자리에서
// 죽었다. 묶음으로 바꾸면서 **결과는 그대로여야 한다** — 이 파일이 그 결과를 고정한다.
// (도입 PR 에서 예전 구현과 무작위 상태 500개 × 해체·보류·복구·이탈 = 2,000회를 대조해
// 불일치 0 을 확인했다.)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/lib/migrations';
import { withWriteTransaction } from '../src/lib/transactions';
import {
  cancelSubscriptionImmediate,
  propagateGroupMemberPlans,
  retentionSyncStatements,
  syncPaidVoiceRetention,
} from '../src/lib/billing-cancel';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-group-batch-'));
const raw = createClient({ url: `file:${join(directory, 'test.db')}` });
let roundTrips = 0;
/** DB 왕복 하나 = subrequest 하나. 트랜잭션 안의 문장·묶음·커밋을 센다. */
const counted = new Proxy(raw, {
  get(target, prop, receiver) {
    if (prop === 'transaction') {
      return async (mode: 'read' | 'write') => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(t, p) {
            if (p === 'execute' || p === 'batch') {
              return async (...args: unknown[]) => {
                roundTrips += 1;
                return (t[p] as (...a: unknown[]) => unknown).apply(t, args);
              };
            }
            const v = Reflect.get(t, p);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as Client;

const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-09-20T00:00:00.000Z');
const OWNER = 'owner';
const OWNER_SUB = {
  subscriptionId: 'sub-owner', userPk: OWNER, planId: FAMILY, planType: 'family',
  planKey: 'family', planGroupId: 'g1', cancelAtPeriodEnd: false,
};

async function run(sql: string, args: (string | number | null)[] = []) {
  await raw.execute({ sql, args });
}

async function seedGroup(members: string[]) {
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, 'o', 'family')`, [OWNER, 'o@t.test']);
  await run(`INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g1', ?, ?, 5)`, [OWNER, FAMILY]);
  await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pm-o', 'g1', ?, 'owner')`, [OWNER]);
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
     VALUES ('sub-owner', ?, ?, 'g1', 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    [OWNER, FAMILY],
  );
  for (const m of members) {
    await run(`INSERT INTO users (id, google_id, email, name, plan) VALUES (?, ?, ?, 'm', 'family')`, [m, `g-${m}`, `${m}@t.test`]);
    await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id) VALUES (?, 'g1', ?)`, [`pm-${m}`, m]);
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
       VALUES (?, ?, ?, 'g1', 'active', '2026-09-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      [`sub-${m}`, m, FAMILY],
    );
  }
}

async function personalSub(user: string, entitlement: 'entitled' | 'suspended') {
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, entitlement_state)
     VALUES (?, ?, ?, 'active', '2026-09-03T00:00:00.000Z', '2099-01-01T00:00:00.000Z', ?)`,
    [`own-${user}`, user, PERSONAL, entitlement],
  );
}

async function one<T = Record<string, unknown>>(sql: string, args: (string | number | null)[] = []) {
  return (await raw.execute({ sql, args })).rows[0] as T | undefined;
}

beforeAll(async () => { await runMigrations(raw); });
beforeEach(async () => {
  await run('PRAGMA foreign_keys = OFF');
  for (const table of [
    'alarms', 'messages', 'voice_profiles', 'pending_external_deletions', 'paid_voice_retention',
    'voucher_codes', 'plan_group_members', 'subscriptions', 'plan_groups', 'users',
  ]) await run(`DELETE FROM ${table}`);
  await run('PRAGMA foreign_keys = ON');
  roundTrips = 0;
});
afterAll(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });

describe('그룹 해체 — 멤버마다 남은 권한으로 다시 정한다', () => {
  it('자기 개인 구독이 있는 멤버는 개인으로 남고, 목소리를 건드리지 않는다', async () => {
    await seedGroup(['m1']);
    await personalSub('m1', 'entitled');
    await run(`INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, is_shared) VALUES ('vp1', 'm1', 'v', 'el-1', 1)`);
    await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('m1', '2026-09-21T00:00:00.000Z')`);
    await withWriteTransaction(counted, (tx) => cancelSubscriptionImmediate(tx, OWNER_SUB, NOW));
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm1'`))!.plan).toBe('plus');
    expect(await one(`SELECT elevenlabs_voice_id, is_shared FROM voice_profiles WHERE id = 'vp1'`)).toMatchObject({ elevenlabs_voice_id: 'el-1', is_shared: 1 });
    // 여전히 유료라 보관 기한을 지운다(거짓 삭제 예고가 되지 않게).
    expect(await one(`SELECT 1 FROM paid_voice_retention WHERE user_id = 'm1'`)).toBeUndefined();
  });

  it('보류 중인 개인 구독만 남은 멤버는 무료로 내리되 공유 구조는 정리하지 않는다(회복형)', async () => {
    await seedGroup(['m1']);
    await personalSub('m1', 'suspended');
    await run(`INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, is_shared) VALUES ('vp1', 'm1', 'v', 'el-1', 1)`);
    await withWriteTransaction(counted, (tx) => cancelSubscriptionImmediate(tx, OWNER_SUB, NOW));
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm1'`))!.plan).toBe('free');
    expect(await one(`SELECT elevenlabs_voice_id, is_shared FROM voice_profiles WHERE id = 'vp1'`)).toMatchObject({ elevenlabs_voice_id: 'el-1', is_shared: 1 });
    // 살아 있는 구독 행(보류)이 있으니 보관 기한을 걸지 않는다 — `hasActivePaidEntitlement` 규칙.
    expect(await one(`SELECT 1 FROM paid_voice_retention WHERE user_id = 'm1'`)).toBeUndefined();
  });

  it('남은 권한이 없는 멤버는 무료 강등 + 클론 반납 + 공유 해제 + 남의 알람 강등 + 보관 기한', async () => {
    await seedGroup(['m1']);
    await run(`INSERT INTO users (id, email, name) VALUES ('x1', 'x1@t.test', 'x')`);
    // 로그인 id 로 적힌 클론도 멤버 것이다(주인 id 가 users.id 가 아니라 FK 를 잠시 끄고 넣는다).
    await run('PRAGMA foreign_keys = OFF');
    await run(`INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, is_shared) VALUES ('vp1', 'g-m1', 'v', 'el-1', 1)`);
    await run('PRAGMA foreign_keys = ON');
    await run(`INSERT INTO alarms (id, user_id, time, mode, voice_profile_id) VALUES ('a-other', 'x1', '07:00', 'tts', 'vp1')`);
    await run(`INSERT INTO alarms (id, user_id, time, mode, voice_profile_id) VALUES ('a-own', 'm1', '07:00', 'tts', 'vp1')`);
    await run(
      `INSERT INTO voucher_codes (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id, expires_at)
       VALUES ('vc1', 'C1', 'H1', ?, 'm1', 'sub-m1', '2026-10-01T00:00:00.000Z')`,
      [FAMILY],
    );
    const affected = await withWriteTransaction(counted, (tx) => cancelSubscriptionImmediate(tx, OWNER_SUB, NOW));
    expect(affected).toEqual(expect.arrayContaining([OWNER, 'm1']));
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm1'`))!.plan).toBe('free');
    expect(await one(`SELECT status, canceled_at FROM subscriptions WHERE id = 'sub-m1'`)).toMatchObject({ status: 'cancelled', canceled_at: NOW.toISOString() });
    expect((await one<{ status: string }>(`SELECT status FROM voucher_codes WHERE id = 'vc1'`))!.status).toBe('expired');
    expect(await one(`SELECT elevenlabs_voice_id, evicted_provider_voice_id, is_shared FROM voice_profiles WHERE id = 'vp1'`))
      .toMatchObject({ elevenlabs_voice_id: null, evicted_provider_voice_id: 'el-1', is_shared: 0 });
    expect(await one(`SELECT ref FROM pending_external_deletions WHERE kind = 'elevenlabs_voice'`)).toMatchObject({ ref: 'el-1' });
    expect(await one(`SELECT mode, voice_profile_id FROM alarms WHERE id = 'a-other'`)).toMatchObject({ mode: 'sound-only', voice_profile_id: null });
    // 자기 알람은 그대로다 — 강등 대상은 '타인 소유' 알람뿐이다.
    expect(await one(`SELECT mode, voice_profile_id FROM alarms WHERE id = 'a-own'`)).toMatchObject({ mode: 'tts', voice_profile_id: 'vp1' });
    expect(await one(`SELECT delete_after FROM paid_voice_retention WHERE user_id = 'm1'`)).toMatchObject({ delete_after: '2026-09-23T00:00:00.000Z' });
    expect(await one(`SELECT 1 FROM plan_group_members WHERE plan_group_id = 'g1'`)).toBeUndefined();
  });

  it('멤버가 하나든 넷이든 해체의 왕복 수는 같다', async () => {
    await seedGroup(['m1']);
    await withWriteTransaction(counted, (tx) => cancelSubscriptionImmediate(tx, OWNER_SUB, NOW));
    const withOne = roundTrips;
    await run('PRAGMA foreign_keys = OFF');
    for (const table of ['plan_group_members', 'subscriptions', 'plan_groups', 'users']) await run(`DELETE FROM ${table}`);
    await run('PRAGMA foreign_keys = ON');
    roundTrips = 0;
    await seedGroup(['m1', 'm2', 'm3', 'm4']);
    await withWriteTransaction(counted, (tx) => cancelSubscriptionImmediate(tx, OWNER_SUB, NOW));
    expect(roundTrips).toBe(withOne);
  });
});

describe('보류·복구 전파 — 멤버 수와 무관하게 왕복 두 번', () => {
  it('보류는 그룹 구독만 빼고 다시 계산하고, 바뀐 사람만 알린다', async () => {
    await seedGroup(['m1', 'm2']);
    await personalSub('m2', 'entitled');
    await run(`UPDATE users SET plan = 'family' WHERE id IN ('m1', 'm2')`);
    const affected = await withWriteTransaction(counted, (tx) => propagateGroupMemberPlans(tx, 'g1', OWNER, true));
    // m2 는 자기 결제가 있어 개인으로 남는다 — 등급은 바뀌었으니(가족 → 개인) 알린다.
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm1'`))!.plan).toBe('free');
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm2'`))!.plan).toBe('plus');
    expect(affected.sort()).toEqual(['m1', 'm2']);
    expect((await one<{ e: string }>(`SELECT entitlement_state AS e FROM subscriptions WHERE id = 'sub-m1'`))!.e).toBe('suspended');
    expect(roundTrips).toBe(2);
  });

  it('복구는 이 그룹의 보류만 풀고, 안 바뀐 멤버는 알리지 않는다', async () => {
    await seedGroup(['m1', 'm2']);
    await run(`UPDATE subscriptions SET entitlement_state = 'suspended' WHERE plan_group_id = 'g1' AND user_id <> ?`, [OWNER]);
    await run(`UPDATE users SET plan = 'free' WHERE id = 'm1'`);
    await run(`UPDATE users SET plan = 'family' WHERE id = 'm2'`);
    const affected = await withWriteTransaction(counted, (tx) => propagateGroupMemberPlans(tx, 'g1', OWNER, false));
    expect((await one<{ plan: string }>(`SELECT plan FROM users WHERE id = 'm1'`))!.plan).toBe('family');
    expect(affected).toEqual(['m1']);
    expect(roundTrips).toBe(2);
  });
});

describe('보관 기한 문장 = syncPaidVoiceRetention', () => {
  // 묶음 안에서는 JS 판정을 못 끼우니 SQL 로 옮겼다. 같은 상태에서 두 경로가 같아야 한다.
  const plans = ['free', 'plus', 'family', null] as const;
  const subs = ['none', 'active-future', 'active-past', 'cancelled-future', 'suspended-future'] as const;
  for (const plan of plans) {
    for (const sub of subs) {
      for (const existing of [false, true]) {
        it(`plan=${plan} sub=${sub} 기존행=${existing}`, async () => {
          const snapshot = async (via: 'fn' | 'sql') => {
            await run('PRAGMA foreign_keys = OFF');
            for (const table of ['paid_voice_retention', 'subscriptions', 'users']) await run(`DELETE FROM ${table}`);
            await run('PRAGMA foreign_keys = ON');
            await run(`INSERT INTO users (id, email, name, plan) VALUES ('u', 'u@t.test', 'u', ?)`, [plan]);
            if (sub !== 'none') {
              await run(
                `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, entitlement_state)
                 VALUES ('s', 'u', ?, ?, '2026-01-01T00:00:00.000Z', ?, ?)`,
                [
                  PERSONAL,
                  sub === 'cancelled-future' ? 'cancelled' : 'active',
                  sub === 'active-past' ? '2020-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
                  sub === 'suspended-future' ? 'suspended' : 'entitled',
                ],
              );
            }
            if (existing) await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('u', '2026-09-21T00:00:00.000Z')`);
            await withWriteTransaction(raw, async (tx) => {
              if (via === 'fn') await syncPaidVoiceRetention(tx, 'u', NOW);
              else await tx.batch(retentionSyncStatements('u', NOW));
            });
            return (await raw.execute(`SELECT user_id, delete_after FROM paid_voice_retention`)).rows.map((r) => ({ ...r }));
          };
          expect(await snapshot('sql')).toEqual(await snapshot('fn'));
        });
      }
    }
  }
});
