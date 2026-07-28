// 신규 DB 스키마 회귀 가드.
//
// migrations.ts 는 "빈 DB 에 처음부터 전부 적용해서 현재 스키마가 나오는" 단일 출처여야
// 한다. 그런데 이 저장소에는 **이미 적용된 마이그레이션의 본문을 나중에 수정한** 전례가
// 있다 — 커밋 6f092a0c 가 #1 의 `voice_profiles.perso_voice_id` 를 지웠지만, 원장
// (_migrations)은 id 만 보고 재실행하지 않으므로 이미 적용된 dev/prod 에는 컬럼이 그대로
// 남았다. 그래서 "신규 DB"와 "운영 DB"의 스키마가 조용히 갈라진다.
//
// 이 스위트는 신규 DB 경로 자체가 깨지지 않도록 지킨다:
//   1. 전체 마이그레이션 체인이 빈 DB 에서 끝까지 적용된다
//   2. 재실행이 멱등하다 (두 번째 호출은 0개)
//   3. integrity_check / foreign_key_check 통과
//   4. **깨진 뷰가 없다** — libSQL 의 ALTER TABLE DROP COLUMN 은 스키마의 모든 뷰를
//      검증하므로, 참조 테이블이 사라진 _kst 뷰가 하나라도 남으면 이후의 모든
//      DROP COLUMN 마이그레이션이 실패한다 (#79 주석 참조).
//   5. DROP 된 테이블의 잔재(뷰/인덱스)가 남지 않는다
//
// 운영 DB 와의 드리프트 비교가 필요하면 자격증명을 주고 실행한다:
//   SCHEMA_DIFF_ENV_FILE=.dev.vars.prod npx vitest run test/schema-fresh.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { runMigrations, migrations } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), `alarmtalk-schema-fresh-${process.pid}.db`);
let db: Client;
let applied: string[];

interface Snapshot {
  columns: Map<string, Set<string>>;
  indexes: Set<string>;
  views: Set<string>;
}

async function snapshot(client: Client): Promise<Snapshot> {
  const master = await client.execute(
    `SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','view')`,
  );
  const columns = new Map<string, Set<string>>();
  const indexes = new Set<string>();
  const views = new Set<string>();
  for (const r of master.rows) {
    const name = String(r.name);
    if (r.type === 'index') indexes.add(name);
    else if (r.type === 'view') views.add(name);
    else {
      const info = await client.execute(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
      columns.set(name, new Set(info.rows.map((c) => String(c.name))));
    }
  }
  return { columns, indexes, views };
}

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
  db = createClient({ url: `file:${DB_PATH}` });
  applied = await runMigrations(db);
});

describe('신규 DB 스키마 (migrations.ts 전체 적용)', () => {
  it('빈 DB 에 전체 마이그레이션 체인이 적용된다', () => {
    expect(applied.length).toBe(migrations.length);
  });

  it('재실행이 멱등하다', async () => {
    const again = await runMigrations(db);
    expect(again).toEqual([]);
  });

  it('integrity_check 를 통과한다', async () => {
    const r = await db.execute('PRAGMA integrity_check');
    expect(r.rows.map((x) => String(x[0]))).toEqual(['ok']);
  });

  it('foreign_key_check 위반이 없다', async () => {
    const r = await db.execute('PRAGMA foreign_key_check');
    expect(r.rows).toEqual([]);
  });

  // libSQL 의 DROP COLUMN 은 전체 스키마의 모든 뷰를 검증한다. 참조 테이블이 사라진 뷰가
  // 하나라도 있으면 이후 어떤 DROP COLUMN 마이그레이션도 'no such table' 로 실패한다.
  // 실제로 #77 이 캐릭터 테이블만 지우고 _kst 뷰를 남겨 #79 의 ALTER 가 깨졌었다.
  it('참조 테이블이 사라진 깨진 뷰가 없다', async () => {
    const { views } = await snapshot(db);
    const dangling: string[] = [];
    for (const v of views) {
      try {
        await db.execute(`SELECT * FROM "${v.replace(/"/g, '""')}" LIMIT 0`);
      } catch {
        dangling.push(v);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('DROP 된 테이블의 인덱스·뷰 잔재가 없다', async () => {
    const { columns, indexes, views } = await snapshot(db);
    const tables = new Set(columns.keys());
    // 뷰 이름 규약: "<table>_kst"
    const orphanViews = [...views].filter((v) => v.endsWith('_kst') && !tables.has(v.slice(0, -4)));
    expect(orphanViews).toEqual([]);
    // 인덱스는 DROP TABLE 이 함께 지우므로 남아 있으면 안 된다.
    const master = await db.execute(
      `SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`,
    );
    const orphanIndexes = master.rows
      .filter((r) => !tables.has(String(r.tbl_name)))
      .map((r) => String(r.name));
    expect(orphanIndexes).toEqual([]);
    expect(indexes.size).toBeGreaterThan(0);
  });

  it('마이그레이션 id 가 중복 없이 오름차순이다', () => {
    const ids = migrations.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// 원격 운영 DB 와의 드리프트 비교 — 자격증명이 주어졌을 때만 실행한다.
const DIFF_ENV_FILE = process.env.SCHEMA_DIFF_ENV_FILE;
describe.skipIf(!DIFF_ENV_FILE)('원격 DB 스키마 드리프트', () => {
  it('신규 DB 와 원격 스키마가 일치한다', async () => {
    const path = join(process.cwd(), DIFF_ENV_FILE!);
    if (!existsSync(path)) throw new Error(`env 파일 없음: ${path}`);
    const env: Record<string, string> = {};
    for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[line.slice(0, eq).trim()] = v;
    }
    const remote = createClient({
      url: env.TURSO_DATABASE_URL!,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    const fresh = await snapshot(db);
    const live = await snapshot(remote);

    const drift: string[] = [];
    const cmp = (label: string, a: Set<string>, b: Set<string>) => {
      for (const n of b) if (!a.has(n)) drift.push(`원격에만: ${label} ${n}`);
      for (const n of a) if (!b.has(n)) drift.push(`신규에만: ${label} ${n}`);
    };
    cmp('테이블', new Set(fresh.columns.keys()), new Set(live.columns.keys()));
    for (const [t, freshCols] of fresh.columns) {
      const liveCols = live.columns.get(t);
      if (!liveCols) continue;
      cmp(`컬럼 ${t}.`, freshCols, liveCols);
    }
    cmp('인덱스', fresh.indexes, live.indexes);
    cmp('뷰', fresh.views, live.views);

    expect(drift).toEqual([]);
  });
});
