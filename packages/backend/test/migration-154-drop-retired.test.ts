import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';

// #154 는 되돌릴 수 없는 정리라(#149·#152 와 같은 이유로) "정말 사라졌는가" 와 "남길 것은 남았는가" 를 실제 스키마로 본다.
// 대상은 2026-11-23 에 코드째 없앤 관리자 기간 지급(`plan_grants`)과 추가 음성팩(표 셋, 사용 기록의 `pack_id` 칸)뿐이다.
// 프로모 코드 이력(`promo_codes`·`promo_code_redemptions`)은 오너가 보존 의무를 확인하기 전이라 남는다.

const DROPPED_TABLES = ['plan_grants', 'voice_pack_events', 'voice_pack_clips', 'voice_packs'];
const DROPPED_INDEXES = ['idx_plan_grants_user', 'idx_plan_grants_unsettled', 'idx_voice_pack_events_pack'];

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [name] });
  return res.rows.length > 0;
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`, args: [name] });
  return res.rows.length > 0;
}

async function columnsOf(db: Client, table: string): Promise<string[]> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.map((row) => String(row.name));
}

describe('#154 — 은퇴한 관리자 기간 지급·추가 음성팩의 표와 칸을 지운다', () => {
  it('새 DB 에는 지운 표·색인·칸이 없고, 프로모 코드 이력과 사용 기록의 살아 있는 칸은 남는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    for (const table of DROPPED_TABLES) expect(await tableExists(db, table), table).toBe(false);
    for (const index of DROPPED_INDEXES) expect(await indexExists(db, index), index).toBe(false);
    const usageColumns = await columnsOf(db, 'usage_events');
    expect(usageColumns).not.toContain('pack_id');
    expect(usageColumns).toEqual(
      expect.arrayContaining(['id', 'user_id', 'type', 'occurred_at', 'step', 'is_first', 'prepared', 'entitlement_source']),
    );
    expect(await tableExists(db, 'promo_codes')).toBe(true);
    expect(await tableExists(db, 'promo_code_redemptions')).toBe(true);
    db.close();
  });

  it('옛 DB(1..153)에서 돌리면 그 표·칸만 잃고 남길 행은 남으며, 다시 돌려도 지나간다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 153);
    for (const table of DROPPED_TABLES) expect(await tableExists(db, table), table).toBe(true);
    expect(await columnsOf(db, 'usage_events')).toContain('pack_id');
    // DROP COLUMN 은 그 칸을 이름으로 부르는 색인·트리거·뷰가 있으면 실패한다 — 없어야 한다.
    const referencing = await db.execute(
      `SELECT type, name FROM sqlite_master
        WHERE type IN ('index', 'trigger', 'view') AND tbl_name = 'usage_events' AND sql LIKE '%pack_id%'`,
    );
    expect(referencing.rows).toEqual([]);

    await db.batch([
      `INSERT INTO users (id, email, plan) VALUES ('u-1', 'a@example.com', 'free')`,
      `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, granted_by, request_key)
       VALUES ('g-1', 'u-1', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z', 'support', 'admin-console', 'k-1')`,
      `INSERT INTO voice_packs (id, voice_id, speaker_name, language) VALUES ('p-1', 'v-1', '화자', 'ko')`,
      `INSERT INTO voice_pack_clips (id, pack_id, category, variant, text, audio_key, audio_format, sha256, size_bytes)
       VALUES ('c-1', 'p-1', 'cheer', 1, '문구', 'k', 'mp3', 'h', 1)`,
      `INSERT INTO voice_pack_events (id, pack_id, action, actor) VALUES ('e-1', 'p-1', 'import', 'admin-script')`,
      `INSERT INTO usage_events (id, user_id, type, occurred_at, step, pack_id)
       VALUES ('ev-1', 'u-1', 'voice_selected', '2026-11-01T00:00:00Z', 'pick', 'mina')`,
      `INSERT INTO promo_codes (id, code, plan_id, duration_days) VALUES ('promo-1', 'WELCOME', 'plan-x', 30)`,
      `INSERT INTO promo_code_redemptions (id, promo_code_id, user_id) VALUES ('pr-1', 'promo-1', 'u-1')`,
    ]);

    expect(await runMigrationsRange(db, 154, 154)).toEqual(['154_drop-retired-plan-grants-and-voice-packs']);
    for (const table of DROPPED_TABLES) expect(await tableExists(db, table), table).toBe(false);
    expect(await columnsOf(db, 'usage_events')).not.toContain('pack_id');
    // 사용 기록은 그 칸만 잃고 행은 그대로다.
    expect((await db.execute(`SELECT id, type, step FROM usage_events WHERE id = 'ev-1'`)).rows).toEqual([
      expect.objectContaining({ id: 'ev-1', type: 'voice_selected', step: 'pick' }),
    ]);
    expect((await db.execute(`SELECT id, plan FROM users WHERE id = 'u-1'`)).rows).toEqual([
      expect.objectContaining({ id: 'u-1', plan: 'free' }),
    ]);
    expect((await db.execute(`SELECT id FROM promo_code_redemptions`)).rows.map((r) => r.id)).toEqual(['pr-1']);
    expect((await db.execute(`SELECT id FROM promo_codes`)).rows.map((r) => r.id)).toEqual(['promo-1']);

    // 원장이 어긋난 DB(이미 지웠는데 기록이 없다)에서 다시 돌아도 IF EXISTS·'no such column' 관용으로 지나간다.
    await db.execute(`DELETE FROM _migrations WHERE id = 154`);
    expect(await runMigrationsRange(db, 154, 154)).toHaveLength(1);
    db.close();
  });
});
