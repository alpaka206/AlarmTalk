// #129 소급 — 이미 탈퇴 유예인 계정에 '모든 기기 로그아웃' 을 적용한다(코덱스 #904).
//
// 이 배포 전에 신청한 유예 행은 세대가 그대로라, 한 기기가 로그인해 철회하는 순간 신청 전의 토큰을 든 다른 기기가 다시
// 통과하고 옛 푸시 등록도 남는다. 실제 SQLite 에 행을 심고 결과 상태로 본다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), `alarmtalk-pending-revoke-${process.pid}.db`);
let db: Client;

beforeAll(async () => {
  rmSync(DB_PATH, { force: true });
  db = createClient({ url: `file:${DB_PATH}` });
  // #128 까지만 적용한 DB(배포 전의 운영 DB)에 유예 행을 심고, #129 를 적용한다.
  await runMigrationsRange(db, 1, 128);
  await db.execute(`INSERT INTO users (id, google_id, email, deletion_status, token_epoch, family_alarm_quiet_windows)
    VALUES ('pending', 'pending', 'p@example.test', 'pending_deletion', 2, '[]'),
           ('active', 'active', 'a@example.test', 'active', 5, '[]')`);
  await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES
    ('t1', 'pending', 'tok-p1', 'android'), ('t2', 'pending', 'tok-p2', 'ios'), ('t3', 'active', 'tok-a', 'android')`);
  await runMigrationsRange(db, 129, 129);
  // 남은 것까지 다 적용해도(이미 적용한 #129 는 건너뛴다) 결과는 같다.
  await runMigrations(db);
});

afterAll(() => {
  db.close();
  rmSync(DB_PATH, { force: true });
});

describe('#129 pending-deletion-revoke-sessions-backfill', () => {
  it('유예 계정의 세대를 올리고 푸시 등록을 지운다', async () => {
    const pending = await db.execute("SELECT token_epoch FROM users WHERE id = 'pending'");
    expect(Number(pending.rows[0]!.token_epoch)).toBeGreaterThan(2);
    const tokens = await db.execute("SELECT token FROM push_tokens WHERE user_id = 'pending'");
    expect(tokens.rows).toHaveLength(0);
  });

  it('active 계정은 건드리지 않는다', async () => {
    const active = await db.execute("SELECT token_epoch FROM users WHERE id = 'active'");
    expect(Number(active.rows[0]!.token_epoch)).toBe(5);
    const tokens = await db.execute("SELECT token FROM push_tokens WHERE user_id = 'active'");
    expect(tokens.rows.map((r) => r.token)).toEqual(['tok-a']);
  });
});
