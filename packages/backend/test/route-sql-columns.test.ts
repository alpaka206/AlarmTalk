// 라우트의 SQL 이 **실제로 존재하는 컬럼만** 참조하는지 검사한다.
//
// ⚠ 이 테스트가 있는 이유: `SELECT *` 를 컬럼 나열로 바꾸면서 **이미 DROP 된 컬럼**
// (`voice_gender`·`speech_formality`, 마이그레이션 #83 에서 제거)을 그대로 적은 적이
// 있다(2026-08-08 `dd0758a8`). 배포되면 `GET /voice` 가 통째로 500 이 되어 **목소리
// 탭이 빈다.** 기존 1405개 테스트가 전부 통과하는데도 잡히지 않았다 — 그 라우트를
// 실제 스키마 위에서 실행해 보는 테스트가 없었기 때문이다.
//
// 방식: 마이그레이션을 전량 적용한 DB에 라우트 소스에서 뽑은 SELECT 를 그대로 태운다.
// 컬럼이 없으면 SQLite 가 `no such column` 으로 죽는다.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';

const ROUTES_DIR = join(import.meta.dirname, '../src/routes');

/** 라우트 파일에서 컬럼을 명시 나열한 SELECT 만 뽑는다(`SELECT *` 는 검사 대상이 아니다). */
function extractNamedSelects(source: string): string[] {
  const out: string[] = [];
  const re = /SELECT\s+(?!\*)([\s\S]{0,600}?)\s+FROM\s+([a-z_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const cols = m[1]!;
    const table = m[2]!;
    // 템플릿 보간·서브쿼리·집계가 섞인 것은 정적으로 못 세우므로 건너뛴다.
    if (/[${}()]/.test(cols)) continue;
    if (!/^[a-z_0-9,\s]+$/i.test(cols)) continue;
    out.push(`SELECT ${cols} FROM ${table} LIMIT 0`);
  }
  return out;
}

describe('라우트 SQL 이 실재하는 컬럼만 쓴다', () => {
  it('모든 명시 SELECT 가 실제 스키마에서 실행된다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db as never);

    const failures: string[] = [];
    for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
      for (const sql of extractNamedSelects(source)) {
        try {
          await db.execute(sql);
        } catch (err) {
          const message = String(err);
          // 컬럼 부재만 잡는다. 테이블 별칭 등 다른 사유는 이 테스트의 관심사가 아니다.
          if (message.includes('no such column')) {
            failures.push(`${file}: ${message.split('\n')[0]} — ${sql.slice(0, 120)}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
