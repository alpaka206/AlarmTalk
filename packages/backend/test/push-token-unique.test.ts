// 마이그레이션 #71(push_tokens token 전역 UNIQUE) + /push/register 원자 UPSERT 실동작 검증.
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고, **라우트가 보내는 바로 그 문장**
// (`pushRegisterStatements`)으로 '계정 전환 시 마지막 등록이 유일 승자' 불변식을 DB 제약 수준에서 확인한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations, runMigrations } from '../src/lib/migrations';
import { pushRegisterStatements, type PushPlatform } from '../src/routes/push';

const DB_PATH = join(tmpdir(), 'alarmtalk-push-token-unique.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

const migration71 = migrations.find((m) => m.id === 71)!;

// 라우트(push.ts /register)가 하는 그대로 — 그 문장들을 원자적 쓰기 batch 하나로 보낸다.
// ⚠ 예전에는 여기에 라우트의 SQL 을 **손으로 베껴** 두었다. 그러면 라우트가 무엇으로 바뀌든 이
// 파일은 초록이다 — 2026-10-11 에 라우트가 대화형 트랜잭션에서 batch 로 바뀔 때도 그 사본은
// 한 줄도 달라지지 않고 통과했을 것이다.
// (이 클라이언트는 로컬 파일 DB 라 원격의 Hrana 조건부 단계 경로는 타지 않는다 — 문장과
//  '전부 아니면 전무' 를 본다.)
async function registerLike(userId: string, token: string, platform: PushPlatform = 'android') {
  await db.batch(pushRegisterStatements(userId, token, platform), 'write');
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

  // ── 다시 보내도 같은 결과(멱등) — 이 batch 는 게이트웨이 실패에서 재시도된다 ──
  it('같은 계정·같은 토큰을 두 번 등록해도 한 행이다(플랫폼만 새 값)', async () => {
    await registerLike('pt-a', 'tok-twice', 'android');
    await registerLike('pt-a', 'tok-twice', 'web');
    const rows = await db.execute({
      sql: 'SELECT user_id, platform FROM push_tokens WHERE token = ?',
      args: ['tok-twice'],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ user_id: 'pt-a', platform: 'web' });
  });

  // 애매한 5xx 뒤에 첫 회차가 실은 커밋됐을 수 있다 — 재시도는 **같은 문장 배열**을 다시 보낸다.
  it('같은 문장을 그대로 두 번 보내도(응답을 잃은 재시도) 한 행이고 행 id 도 그대로다', async () => {
    const statements = pushRegisterStatements('pt-a', 'tok-retry', 'android');
    await db.batch(statements, 'write');
    const first = await db.execute({
      sql: 'SELECT id FROM push_tokens WHERE token = ?',
      args: ['tok-retry'],
    });
    await db.batch(statements, 'write');
    const second = await db.execute({
      sql: 'SELECT id, user_id FROM push_tokens WHERE token = ?',
      args: ['tok-retry'],
    });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]!.user_id).toBe('pt-a');
    expect(second.rows[0]!.id).toBe(first.rows[0]!.id);
  });

  it('A 등록 → B 등록 → 뒤늦게 온 A 의 중복 등록: 소유자는 언제나 한 행이다', async () => {
    await registerLike('pt-a', 'tok-late');
    await registerLike('pt-b', 'tok-late');
    expect(await ownersOf('tok-late')).toEqual(['pt-b']);
    await registerLike('pt-a', 'tok-late');
    // 마지막 커밋이 유일 승자다 — 두 소유자가 함께 남지 않는다.
    expect(await ownersOf('tok-late')).toEqual(['pt-a']);
  });

  // fail-closed: batch 는 전부 아니면 전무다. UPSERT 가 실패하면 **앞서 실행된 DELETE 도 되돌아간다** —
  // 안 그러면 실패한 등록 한 번이 남의 바인딩만 지우고 끝난다(그 기기는 누구의 푸시도 못 받는다).
  it('UPSERT 가 실패하면 같은 batch 에서 지운 다른 소유자의 행이 그대로 남는다', async () => {
    await registerLike('pt-a', 'tok-atomic');
    await expect(
      // 'windows' 는 push_tokens.platform CHECK 밖이다(라우트는 그 전에 400 으로 막는다).
      registerLike('pt-b', 'tok-atomic', 'windows' as unknown as PushPlatform),
    ).rejects.toThrow(/CHECK/i);
    expect(await ownersOf('tok-atomic')).toEqual(['pt-a']);
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
