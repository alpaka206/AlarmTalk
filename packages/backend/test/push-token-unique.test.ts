// 마이그레이션 #71(push_tokens token 전역 UNIQUE) + /push/register 원자 UPSERT 실동작 검증.
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고, 라우트가 쓰는 것과 동일한 SQL 로
// '계정 전환 시 마지막 등록이 유일 승자' 불변식을 DB 제약 수준에서 확인한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations, runMigrations } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-push-token-unique.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

const migration71 = migrations.find((m) => m.id === 71)!;

// 라우트(push.ts /register)와 동일한 트랜잭션 재배정(DELETE 타소유자 + UPSERT(user_id, token))
async function registerLike(userId: string, token: string, platform = 'android') {
  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: 'DELETE FROM push_tokens WHERE token = ? AND user_id != ?',
      args: [token, userId],
    });
    await tx.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(user_id, token) DO UPDATE SET
              platform = excluded.platform,
              updated_at = datetime('now')`,
      args: [crypto.randomUUID(), userId, token, platform],
    });
    await tx.commit();
  } finally {
    if (!tx.closed) tx.close();
  }
}

async function ownersOf(token: string): Promise<string[]> {
  const res = await db.execute({
    sql: 'SELECT user_id FROM push_tokens WHERE token = ? ORDER BY user_id',
    args: [token],
  });
  return res.rows.map((r) => String(r.user_id));
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute('DELETE FROM push_tokens');
  for (const u of ['pt-a', 'pt-b']) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: [u, u, `${u}@test`],
    });
  }
});

describe('push_tokens 전역 단일 소유 (마이그레이션 #71 + 원자 UPSERT)', () => {
  it('같은 토큰을 다른 계정이 등록하면 소유자가 교체된다 — 항상 1행', async () => {
    await registerLike('pt-a', 'tok-shared');
    expect(await ownersOf('tok-shared')).toEqual(['pt-a']);
    await registerLike('pt-b', 'tok-shared', 'web');
    expect(await ownersOf('tok-shared')).toEqual(['pt-b']);
    const row = await db.execute({
      sql: 'SELECT platform FROM push_tokens WHERE token = ?',
      args: ['tok-shared'],
    });
    expect(row.rows[0]!.platform).toBe('web');
  });

  it('토큰 UNIQUE 제약이 소유자 2행 삽입을 DB 수준에서 차단한다', async () => {
    await registerLike('pt-a', 'tok-guard');
    await expect(
      db.execute({
        sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`,
        args: [crypto.randomUUID(), 'pt-b', 'tok-guard'],
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('한 사용자의 여러 기기(서로 다른 토큰)는 그대로 공존한다', async () => {
    await registerLike('pt-a', 'tok-device-1');
    await registerLike('pt-a', 'tok-device-2');
    const res = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = 'pt-a' AND token LIKE 'tok-device-%'",
      args: [],
    });
    expect(Number(res.rows[0]!.n)).toBe(2);
  });

  it('#71 dedupe 는 레이스로 남은 중복 소유 행에서 최신(updated_at) 행만 남긴다', async () => {
    // 레거시 상태 재현: 유니크 인덱스를 잠시 내리고 중복 소유 2행 삽입
    await db.execute('DROP INDEX IF EXISTS idx_push_tokens_token');
    await db.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
            VALUES ('dup-old', 'pt-a', 'tok-dup', 'android', datetime('now','-2 hours'), datetime('now','-2 hours'))`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
            VALUES ('dup-new', 'pt-b', 'tok-dup', 'android', datetime('now','-1 hour'), datetime('now','-1 hour'))`,
      args: [],
    });
    expect((await ownersOf('tok-dup')).length).toBe(2);

    for (const sql of migration71.statements) {
      await db.execute(sql);
    }
    expect(await ownersOf('tok-dup')).toEqual(['pt-b']);
    // 인덱스가 유니크로 복원됐는지 — 중복 삽입이 다시 막혀야 한다
    await expect(
      db.execute({
        sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, 'pt-a', 'tok-dup', 'android')`,
        args: [crypto.randomUUID()],
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('#71 dedupe 는 타임스탬프 동률이면 나중에 삽입된 행(rowid)이 이긴다 — UUID 순서에 좌우되지 않음', async () => {
    // 레이스 중복은 대부분 같은 초에 찍힌다. id(UUID) DESC 타이브레이커라면 'z-first' 가
    // 남았을 어긋난 케이스: 먼저 삽입된 행의 UUID 가 사전순으로 더 크게 만들어 둔다.
    await db.execute('DROP INDEX IF EXISTS idx_push_tokens_token');
    const sameTime = "datetime('now','-30 minutes')";
    await db.execute(
      `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
       VALUES ('z-first', 'pt-a', 'tok-tie', 'android', ${sameTime}, ${sameTime})`,
    );
    await db.execute(
      `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
       VALUES ('a-second', 'pt-b', 'tok-tie', 'android', ${sameTime}, ${sameTime})`,
    );

    for (const sql of migration71.statements) {
      await db.execute(sql);
    }
    // 나중 INSERT(pt-b, rowid 큼)가 유일 승자 — 마지막 등록 보존 의도와 일치.
    expect(await ownersOf('tok-tie')).toEqual(['pt-b']);
  });
});
