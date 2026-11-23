import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';

// #152·#153 은 되돌릴 수 없는 정리라(#149 와 같은 이유로) "정말 사라졌는가" 와 "남길 것은 남았는가" 를 실제 스키마로 본다.
// 대상은 2026-11-23 감사에서 서버 코드가 쓰기만 하고 읽지 않는다(#152 — 세기만 하던 표 `voice_draft_attempt_usage` 포함),
// 쓰지도 읽지도 않는다(#153)고 확인한 칸뿐이다.

const DROPPED: Array<[table: string, column: string]> = [
  ['users', 'updated_at'],
  ['push_tokens', 'updated_at'],
  ['message_library', 'in_use'],
  ['message_library', 'in_use_updated_at'],
  ['message_library', 'last_used_at'],
  ['weather_region_daily_official', 'dust_level'],
  ['store_download_sync', 'last_success_at'],
  ['store_report_instances', 'ingested_at'],
  ['subscriptions', 'apple_transaction_id'],
  ['subscriptions', 'apple_original_transaction_id'],
  ['subscriptions', 'apple_product_id'],
];

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

describe('#152·#153 — 쓰기만 하거나 아무도 안 쓰는 칸을 지운다', () => {
  it('새 DB 에는 지운 칸이 없고, 같은 표의 살아 있는 칸은 남는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).not.toContain(column);
    }
    expect(await columnsOf(db, 'users')).toEqual(expect.arrayContaining(['id', 'email', 'plan', 'created_at', 'token_epoch', 'kakao_id']));
    expect(await columnsOf(db, 'push_tokens')).toEqual(expect.arrayContaining(['user_id', 'token', 'platform', 'created_at']));
    expect(await tableExists(db, 'voice_draft_attempt_usage')).toBe(false);
    expect(await columnsOf(db, 'message_library')).toEqual(['id', 'user_id', 'message_id']);
    expect(await indexExists(db, 'idx_subscriptions_apple_transaction')).toBe(false);
    expect(await indexExists(db, 'idx_subscriptions_apple_original')).toBe(false);
    // 구독 응답·정합화가 읽는 칸은 남는다.
    expect(await columnsOf(db, 'subscriptions')).toEqual(
      expect.arrayContaining(['id', 'user_id', 'plan_id', 'status', 'expires_at', 'cancel_at_period_end', 'next_plan_id', 'entitlement_state']),
    );
    expect(await indexExists(db, 'idx_subscriptions_user')).toBe(true);
    db.close();
  });

  it('옛 DB 에서 돌리면 그 칸만 잃고 행은 남으며, 다시 돌려도 지나간다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 151);
    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).toContain(column);
    }
    // DROP COLUMN 은 그 칸을 이름으로 부르는 색인·트리거·뷰가 있으면 실패한다 — #152 의 칸에는 없어야 한다.
    // (#153 의 애플 칸에는 색인이 둘 있고, #153 이 그 색인부터 지운다.)
    for (const [table, column] of DROPPED.filter(([table]) => table !== 'subscriptions')) {
      const referencing = await db.execute({
        sql: `SELECT type, name FROM sqlite_master
               WHERE type IN ('index', 'trigger', 'view') AND tbl_name = ? AND sql LIKE ?`,
        args: [table, `%${column}%`],
      });
      expect(referencing.rows, `${table}.${column}`).toEqual([]);
    }

    await db.execute(`INSERT INTO users (id, email, plan) VALUES ('u-1', 'a@example.com', 'plus')`);

    expect(await runMigrationsRange(db, 152, 153)).toEqual([
      '152_drop-write-only-columns',
      '153_drop-unused-subscription-apple-columns',
    ]);
    for (const [table, column] of DROPPED) {
      expect(await columnsOf(db, table), `${table}.${column}`).not.toContain(column);
    }
    expect((await db.execute(`SELECT id, email, plan FROM users WHERE id = 'u-1'`)).rows).toEqual([
      expect.objectContaining({ id: 'u-1', email: 'a@example.com', plan: 'plus' }),
    ]);
    expect(await tableExists(db, 'voice_draft_attempt_usage')).toBe(false);

    // 원장이 어긋난 DB(이미 지웠는데 기록이 없다)에서 다시 돌아도 'no such column' 관용으로 지나간다.
    await db.execute(`DELETE FROM _migrations WHERE id IN (152, 153)`);
    expect(await runMigrationsRange(db, 152, 153)).toHaveLength(2);
    db.close();
  });
});
