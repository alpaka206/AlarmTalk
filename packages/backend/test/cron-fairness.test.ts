// **크론이 한 건에 막혀 나머지를 굶기지 않는다**(2026-09-20 실측으로 찾은 것들).
//
// 1) 결제 보류 중인 가족 하나가 만료 배치(5자리)를 매 틱 통째로 차지했다 — 보류 소유자 행은
//    `active` 인 채 만료가 지나 소유자 우선 정렬로 맨 앞에 오고, 멤버 행 넷이 나머지를
//    채웠다(소유자가 살아 있어 매번 건너뛰는데도). 한도와 무관하게 **다른 사람의 만료가
//    영영 안 돌았다.**
// 2) 보관 기한 스윕이 한 사람을 문장마다 따로 커밋해, 중간에 끊기면 삭제 큐에는 올렸는데
//    행은 반쯤 남았다 — 다음 틱의 큐 비우기가 그 큐 행만 지워 **파일이 영영 남았다.**
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/lib/migrations';
import { processSubscriptionExpiry, sweepPaidVoiceRetention } from '../src/lib/billing-cancel';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-cron-fairness-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-09-20T00:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

async function run(sql: string, args: (string | number | null)[] = []) {
  await db.execute({ sql, args });
}
async function count(sql: string, args: (string | number | null)[] = []) {
  return Number((await db.execute({ sql, args })).rows[0]!.n);
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  await run('PRAGMA foreign_keys = OFF');
  for (const table of [
    'pending_external_deletions', 'message_library', 'messages', 'generated_audio_assets', 'voice_uploads',
    'voice_profiles', 'paid_voice_retention', 'store_transactions', 'plan_group_members', 'subscriptions',
    'plan_groups', 'users',
  ]) await run(`DELETE FROM ${table}`);
  await run('PRAGMA foreign_keys = ON');
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('만료 크론 — 보류 중인 가족이 배치를 차지하지 않는다', () => {
  it('보류 가족(소유자 + 멤버 4) 이 있어도 다른 사람의 만료가 같은 틱에 돈다', async () => {
    for (const id of ['o', 'm1', 'm2', 'm3', 'm4', 'plain']) {
      await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, 'u', ?)`, [id, `${id}@t.test`, id === 'plain' ? 'plus' : 'free']);
    }
    await run(`INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g', 'o', ?, 5)`, [FAMILY]);
    // 보류 소유자: 행은 살아 있고 만료는 지났다. 스토어 재확인은 매번 '아직 모름' 이라 건너뛴다.
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at, entitlement_state)
       VALUES ('sub-o', 'o', ?, 'g', 'active', ?, ?, 'suspended')`,
      [FAMILY, ago(24 * 30), ago(24)],
    );
    await run(
      `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key, subscription_id)
       VALUES ('st-o', 'o', 'apple', 'chain-o', 'com.alarmtalk.app.family_monthly', 'family', 'sub-o')`,
    );
    for (const m of ['m1', 'm2', 'm3', 'm4']) {
      await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id) VALUES (?, 'g', ?)`, [`pm-${m}`, m]);
      await run(
        `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at, entitlement_state)
         VALUES (?, ?, ?, 'g', 'active', ?, ?, 'suspended')`,
        [`sub-${m}`, m, FAMILY, ago(24 * 30), ago(24)],
      );
    }
    // 스토어 없는 개인 이용권(쿠폰 등) — 한 시간 전에 끝났다.
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
       VALUES ('sub-plain', 'plain', ?, 'active', ?, ?)`,
      [PERSONAL, ago(24 * 30), ago(1)],
    );

    await processSubscriptionExpiry(db, {}, NOW);

    expect((await db.execute(`SELECT status FROM subscriptions WHERE id = 'sub-plain'`)).rows[0]!.status).not.toBe('active');
    expect((await db.execute(`SELECT plan FROM users WHERE id = 'plain'`)).rows[0]!.plan).toBe('free');
    // 보류 가족은 그대로다 — 스토어가 확인해 줄 때까지 건드리지 않는다.
    expect(await count(`SELECT COUNT(*) AS n FROM subscriptions WHERE plan_group_id = 'g' AND status = 'active'`)).toBe(5);
  });
});

/** `sql` 을 포함한 문장을 트랜잭션 안에서 실행하려 하면 던진다 — 틱 중간에 한도에 걸린 상황. */
function failingOn(sql: string): Client {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return async (mode: 'read' | 'write') => {
          const tx = await target.transaction(mode);
          return new Proxy(tx, {
            get(t, p) {
              if (p === 'execute') {
                return async (stmt: { sql: string }) => {
                  if (stmt.sql.includes(sql)) throw new Error('Too many subrequests by single Worker invocation.');
                  return t.execute(stmt as never);
                };
              }
              const v = Reflect.get(t, p);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Client;
}

async function seedExpiredVoiceOwner(user: string, deleteAfter: string, clips: number) {
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, 'u', 'free')`, [user, `${user}@t.test`]);
  await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, ?)`, [user, deleteAfter]);
  await run(`INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id) VALUES (?, ?, 'v', ?)`, [`vp-${user}`, user, `el-${user}`]);
  await run(
    `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes, voice_profile_id) VALUES (?, ?, ?, 'audio/m4a', 1, ?)`,
    [`up-${user}`, user, `uploads/${user}.m4a`, `vp-${user}`],
  );
  for (let i = 0; i < clips; i++) {
    await run(`INSERT INTO messages (id, user_id, voice_profile_id, text) VALUES (?, ?, ?, 't')`, [`msg-${user}-${i}`, user, `vp-${user}`]);
    await run(
      `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id, model_id, language, request_hash, text, audio_object_key)
       VALUES (?, ?, ?, ?, 'el', 'pv', 'm', 'ko', ?, 't', ?)`,
      [`ga-${user}-${i}`, user, `vp-${user}`, `msg-${user}-${i}`, `h-${user}-${i}`, `tts/${user}/${i}.mp3`],
    );
  }
}

describe('보관 기한 스윕 — 한 사람의 정리는 한 트랜잭션', () => {
  it('중간에 끊기면 통째로 되돌아가고(큐에도 안 남는다), 다음 틱이 처음부터 끝낸다', async () => {
    await seedExpiredVoiceOwner('u1', ago(1), 24);

    await sweepPaidVoiceRetention(failingOn('DELETE FROM messages'), NOW);
    // 끊긴 회차는 아무것도 남기지 않는다 — 큐만 올라가고 행이 남는 반쪽 상태가 없다.
    expect(await count(`SELECT COUNT(*) AS n FROM pending_external_deletions`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM generated_audio_assets`)).toBe(24);
    expect(await count(`SELECT COUNT(*) AS n FROM paid_voice_retention`)).toBe(1);

    await sweepPaidVoiceRetention(db, NOW);
    // 클론 1 + 원본 1 + 생성 음성 24 가 전부 삭제 큐에 오르고 행은 모두 지워진다.
    expect(await count(`SELECT COUNT(*) AS n FROM pending_external_deletions`)).toBe(26);
    expect(await count(`SELECT COUNT(*) AS n FROM generated_audio_assets`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM messages`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM voice_profiles`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM paid_voice_retention`)).toBe(0);
  });

  it('한 틱에 두 명씩, 기한이 먼저 온 순서로', async () => {
    await seedExpiredVoiceOwner('late', ago(1), 0);
    await seedExpiredVoiceOwner('early', ago(48), 0);
    await seedExpiredVoiceOwner('mid', ago(24), 0);
    await sweepPaidVoiceRetention(db, NOW);
    const left = await db.execute(`SELECT user_id FROM paid_voice_retention`);
    expect(left.rows.map((r) => String(r.user_id))).toEqual(['late']);
  });
});
