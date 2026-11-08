import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';

// #149·#150 은 되돌릴 수 없는 정리라(#125 와 같은 이유로) "정말 사라졌는가" 와 "남길 것은 남았는가" 를 실제 스키마로 본다.
// 대상은 2026-11-09 안 쓰는 DB 감사에서 '안 읽힌다'·'지워도 안전하다' 두 갈래 검증을 통과한 것뿐이다.

const DROPPED: Array<[table: string, column: string]> = [
  ['event_likes', 'updated_at'],
  ['tts_synthesis_usage', 'updated_at'],
  ['manual_tts_usage', 'updated_at'],
  ['voice_profile_change_ledger', 'updated_at'],
  ['voice_profile_change_ledger', 'created_at'],
  ['retained_billing_records', 'amount_currency'],
  ['voice_uploads', 'duration_ms'],
  ['voice_packs', 'updated_at'],
  ['stock_content_releases', 'released_at'],
  ['plans', 'created_at'],
  ['paid_voice_retention', 'created_at'],
];

async function columnsOf(db: Client, table: string): Promise<string[]> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.map((row) => String(row.name));
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [name] });
  return res.rows.length > 0;
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`, args: [name] });
  return res.rows.length > 0;
}

describe('#149·#150 — 안 쓰는 칸·표·색인을 지운다', () => {
  it('새 DB 에는 지운 칸·표·색인이 없고, 같은 표의 살아 있는 칸은 남는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).not.toContain(column);
    }
    expect(await tableExists(db, 'weather_region_daily')).toBe(false);
    expect(await tableExists(db, 'weather_region_daily_official')).toBe(true);
    expect(await indexExists(db, 'idx_generated_audio_assets_user')).toBe(false);
    // 대신 user_id 로 시작하는 조회를 받는 색인(#139)은 남는다.
    expect(await indexExists(db, 'idx_generated_audio_assets_logical')).toBe(true);
    // 지금도 읽고 쓰는 칸.
    expect(await columnsOf(db, 'manual_tts_usage')).toEqual(expect.arrayContaining(['pool_key', 'usage_month', 'used_count']));
    expect(await columnsOf(db, 'voice_uploads')).toEqual(expect.arrayContaining(['object_key', 'size_bytes', 'voice_profile_id']));
    expect(await columnsOf(db, 'event_likes')).toEqual(expect.arrayContaining(['event_id', 'subject_id', 'count']));
    db.close();
  });

  it('옛 DB 에서 돌리면 그 칸만 잃고 행은 남으며, 다시 돌려도 지나간다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 148);
    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).toContain(column);
    }
    // DROP COLUMN 은 그 칸을 이름으로 부르는 색인·트리거·뷰가 있으면 실패한다 — 없어야 한다.
    for (const [table, column] of DROPPED) {
      const referencing = await db.execute({
        sql: `SELECT type, name FROM sqlite_master
               WHERE type IN ('index', 'trigger', 'view') AND tbl_name = ? AND sql LIKE ?`,
        args: [table, `%${column}%`],
      });
      expect(referencing.rows, `${table}.${column}`).toEqual([]);
    }

    await db.execute(`INSERT INTO event_likes (event_id, subject_id, count) VALUES ('ev-1', 'subj-1', 3)`);
    await db.execute(`INSERT INTO manual_tts_usage (pool_key, usage_month, used_count) VALUES ('pk-1', '2026-11', 2)`);

    expect(await runMigrationsRange(db, 149, 150)).toEqual([
      '149_drop-unused-columns-and-weather-region-daily',
      '150_drop-redundant-generated-audio-user-index',
    ]);
    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).not.toContain(column);
    }
    expect((await db.execute(`SELECT * FROM event_likes`)).rows).toEqual([
      expect.objectContaining({ event_id: 'ev-1', subject_id: 'subj-1', count: 3 }),
    ]);
    expect((await db.execute(`SELECT * FROM manual_tts_usage`)).rows).toEqual([
      expect.objectContaining({ pool_key: 'pk-1', usage_month: '2026-11', used_count: 2 }),
    ]);

    // 원장이 어긋난 DB(이미 지웠는데 기록이 없다)에서 다시 돌아도 'no such column' 관용으로 지나간다.
    await db.execute(`DELETE FROM _migrations WHERE id IN (149, 150)`);
    expect(await runMigrationsRange(db, 149, 150)).toHaveLength(2);
    db.close();
  });
});
