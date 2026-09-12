/**
 * 마이그레이션 **베이스라인 생성기** — 스쿼시(1번부터 재시작)를 준비한다.
 *
 * 실제 DB 의 `sqlite_master` 를 읽어 지금 스키마를 그대로 만드는 마이그레이션 한 벌을
 * 찍어 낸다. **손으로 쓰지 않는 것이 핵심이다** — 마이그레이션 98개를 눈으로 접어
 * 옮기면 새 환경이 조용히 갈라진다.
 *
 * ```
 * node --experimental-strip-types scripts/generate-baseline-migration.ts --env-file .dev.vars.prod
 * ```
 *
 * ⚠ **아직 실행할 때가 아니다.** 조건은 `docs/ops/migrations.md` 에 있다. 요약:
 *  1. prod·dev 가 **둘 다** 코드의 마지막 id 까지 적용돼 있을 것(지금은 prod 93 / dev 97).
 *  2. 합칠 구간에 **데이터 마이그레이션(UPDATE/INSERT)이 없을 것**. 있으면 그것만
 *     베이스라인 뒤에 남긴다 — 안 그러면 이미 지난 DB 가 그 UPDATE 를 영영 건너뛴다.
 *  3. 베이스라인 id 는 **기존 DB 가 이미 지난 번호**(예: 1). 그래야 기존 DB 는 건너뛰고
 *     새 DB 만 실행한다.
 *
 * 이 스크립트는 **파일을 쓰지 않는다.** 만들어진 코드를 표준출력으로 내보내니, 눈으로
 * 확인한 뒤 `src/lib/migrations.ts` 에 붙인다.
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

function loadEnv(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
}

const envFileIndex = process.argv.indexOf('--env-file');
if (envFileIndex < 0 || !process.argv[envFileIndex + 1]) {
  console.error('사용법: --env-file .dev.vars.prod');
  process.exit(1);
}
const vars = loadEnv(process.argv[envFileIndex + 1]!);
const db = createClient({
  url: vars.TURSO_DATABASE_URL!,
  authToken: vars.TURSO_AUTH_TOKEN,
});

// `_migrations` 는 러너가 직접 만든다(마이그레이션이 아니다). sqlite 내부 객체도 제외.
const EXCLUDED = new Set(['_migrations']);

const rows = await db.execute(
  `SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
);

const statements: string[] = [];
for (const row of rows.rows) {
  const name = String(row.name);
  const type = String(row.type);
  if (EXCLUDED.has(name)) continue;
  let sql = String(row.sql).trim();
  // 재실행해도 죽지 않게 IF NOT EXISTS 를 넣는다(러너가 같은 문장을 다시 만날 수 있다).
  sql = sql
    .replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, 'CREATE $1INDEX IF NOT EXISTS ')
    .replace(/^CREATE VIEW (?!IF NOT EXISTS)/i, 'CREATE VIEW IF NOT EXISTS ');
  // ⚠ **템플릿 리터럴에 넣을 것은 세 가지를 순서대로 이스케이프한다**(CodeQL
  // `js/incomplete-sanitization`, 2026-08-19). 예전에는 백틱만 처리했다:
  //   · 역슬래시를 **먼저** — 나중에 하면 우리가 넣은 이스케이프까지 다시 건드린다.
  //   · 백틱 — 리터럴이 여기서 끊긴다.
  //   · `${` — 안 막으면 스키마 문자열이 **생성된 코드의 보간식**이 된다.
  // 입력이 우리 DB 의 `sqlite_master` 라 공격자가 넣는 값은 아니지만, 결과물은
  // `migrations.ts` 에 그대로 붙는 소스다 — 깨진 코드가 곧 깨진 마이그레이션이다.
  const escaped = sql
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  statements.push(`      \`${escaped}\`,  // ${type}`);
}

const applied = await db.execute('SELECT MAX(id) AS max FROM _migrations');
const maxApplied = Number(applied.rows[0]?.max ?? 0);

console.log(`// 이 DB 의 마지막 적용 id: ${maxApplied}`);
console.log(`// 아래를 \`migrations\` 배열의 **맨 앞**에 두고, 합친 구간(1..${maxApplied})을 지운다.`);
console.log(`// ⚠ 데이터 마이그레이션(UPDATE/INSERT)이 그 구간에 있으면 **그것만 남긴다**.`);
console.log(`  {`);
console.log(`    // 스키마 베이스라인 — prod 실제 스키마에서 생성(손으로 쓰지 않았다).`);
console.log(`    // 기존 DB 는 id 1 을 이미 적용했으므로 건너뛰고, 새 DB 만 이걸 실행한다.`);
console.log(`    id: 1,`);
console.log(`    name: 'baseline-schema',`);
console.log(`    statements: [`);
console.log(statements.join('\n'));
console.log(`    ],`);
console.log(`  },`);
console.error(`\n[요약] 테이블·인덱스·뷰 ${statements.length}개를 찍었다.`);
