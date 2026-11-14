import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations, migrations } from '../src/lib/migrations';

/**
 * **INSERT 가 쓰는 컬럼이 실제 스키마에 있는가.**
 *
 * ## 왜 있는가
 *
 * 2026-09-02 에 `generated_audio_assets.mime_type` 을 "아무도 안 읽는다" 는 이유로
 * DROP 했는데, **쓰는 곳이 3군데 살아 있었다**(`tts.ts` 의 TTS 합성, `stock-clips.ts` 의
 * 스톡 클립 생성 2곳). 읽는 곳만 확인하고 **쓰는 곳을 확인하지 않은** 것이다.
 * 그대로 배포됐으면 마이그레이션이 도는 순간 모든 TTS 합성이 `no such column` 으로
 * 500 이 됐다.
 *
 * 기존 검사로는 못 잡는다:
 *  - `check-insert-not-null.py` 는 **NOT NULL 인데 안 쓰는** 컬럼을 찾는다. 정반대다.
 *  - 타입체크는 SQL 문자열 안을 보지 않는다.
 *  - 단위 테스트는 그 INSERT 경로를 실제 스키마로 돌리지 않는다.
 *
 * 그래서 **최종 스키마 × 소스의 모든 INSERT** 를 직접 대조한다.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** `INSERT [OR IGNORE|REPLACE] INTO <table> ( col, col, ... )` 를 뽑는다. */
const INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gis;

describe('INSERT 컬럼이 스키마에 실재한다', () => {
  it('소스의 모든 INSERT 가 최종 스키마에 있는 컬럼만 쓴다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    const tables = (
      await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    ).rows.map((r) => String(r.name));
    const columnsOf = new Map<string, Set<string>>();
    for (const table of tables) {
      const info = await db.execute(`PRAGMA table_info(${table})`);
      columnsOf.set(table, new Set(info.rows.map((r) => String(r.name))));
    }

    const problems: string[] = [];
    for (const file of sourceFiles(join(__dirname, '../src'))) {
      // 마이그레이션 본문은 **그 시점의** 스키마를 쓰므로 제외한다(과거는 불변이다).
      if (file.endsWith('migrations.ts')) continue;
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(INSERT_RE)) {
        const table = match[1]!;
        const known = columnsOf.get(table);
        // ⚠ 표가 없는 것도 문제다 — 건너뛰면 **지운 표**(#147 `alarms` 처럼)에 쓰는 곳이 남아도 조용히 통과한다.
        //   src 에는 임시 표·CTE 에 넣는 INSERT 가 없다. 생기면 여기서 그 이름만 따로 허용할 것.
        if (!known) {
          problems.push(`${file.split('/packages/')[1]}: ${table} 표가 스키마에 없다`);
          continue;
        }
        const cols = match[2]!
          .split(',')
          .map((c) => c.trim().replace(/^["'`\[]|["'`\]]$/g, ''))
          .filter((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c));
        for (const col of cols) {
          if (!known.has(col)) {
            problems.push(`${file.split('/packages/')[1]}: ${table}.${col} 이 스키마에 없다`);
          }
        }
      }
    }

    expect(
      problems,
      '컬럼을 DROP 하면서 **쓰는 곳**을 남겼다. 읽는 곳만 확인하지 말 것 — ' +
        '마이그레이션이 도는 순간 그 INSERT 가 no such column 으로 500 이 된다.',
    ).toEqual([]);
  });

  // 표를 통째로 지울 때도 같다(2026-10-29 #147 — 서버 알람 사본 `alarms`). 쓰는 곳뿐 아니라 읽고 고치는 곳(FROM·JOIN·
  // UPDATE)이 하나라도 남으면 마이그레이션이 도는 순간 그 경로가 `no such table` 로 500 이 된다.
  it('소스의 SQL 이 마이그레이션이 지운 표를 부르지 않는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    const live = new Set(
      (await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).rows.map((r) => String(r.name)),
    );
    const dropped = new Set<string>();
    for (const migration of migrations) {
      for (const statement of migration.statements) {
        for (const match of statement.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
          if (!live.has(match[1]!)) dropped.add(match[1]!);
        }
      }
    }
    expect(dropped, '지운 표 목록을 마이그레이션에서 뽑지 못했다 — 검사가 헛돈다').toContain('alarms');

    const problems: string[] = [];
    for (const file of sourceFiles(join(__dirname, '../src'))) {
      // 마이그레이션 본문은 **그 시점의** 스키마를 쓰므로 제외한다(과거는 불변이다).
      if (file.endsWith('migrations.ts')) continue;
      // 주석 줄은 뺀다 — 이 저장소는 주석에 옛 SQL 을 인용한다("예전에는 `UPDATE alarms` …"). 블록 주석을 정규식으로
      // 통째로 걷지 않는 것은 문자열에 `/*` 가 있어서다(라우트 glob·MIME) — 그러면 실제 코드까지 삼킨다.
      const code = readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join('\n');
      for (const table of dropped) {
        // 표 이름은 위 마이그레이션에서 뽑은 식별자다([A-Za-z0-9_] 뿐 — 정규식 특수문자가 없다).
        const reference = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${table}\\b`);
        if (reference.test(code)) problems.push(`${file.split('/packages/')[1]}: ${table}`);
      }
    }
    expect(problems, '지운 표를 부르는 SQL 이 남았다').toEqual([]);
  });

  it('가장 최근 refresh 마이그레이션의 문장이 최종 스키마에서 실제로 돈다', async () => {
    // ⚠ 러너는 `no such column` 을 "이미 적용됨" 으로 **삼킨다**(isIdempotentDDLError).
    //   그래서 문장이 죽어 있어도 마이그레이션은 성공으로 기록되고 다시는 재시도되지
    //   않는다 — 배포는 초록불인데 그 안전 단계만 조용히 빠진다. 실제로 #109 의
    //   `UPDATE alarms` 가 #84 가 DROP 한 컬럼을 참조하고 있었다.
    //   refresh 는 수렴형이라 재실행해도 안전하므로, 여기서 **날것으로** 돌려 확인한다.
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    const latest = migrations
      .filter((m) => m.name.startsWith('refresh-stock-clips-'))
      .reduce((newest, m) => (m.id > newest.id ? m : newest));

    for (const statement of latest.statements) {
      await expect(
        db.execute(statement),
        `${latest.name} 의 문장이 최종 스키마에서 실패한다:\n${statement.slice(0, 200)}`,
      ).resolves.toBeDefined();
    }
  });
});
