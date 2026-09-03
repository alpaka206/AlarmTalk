import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrations } from '../src/lib/migrations';

/**
 * **이미 적용된 마이그레이션은 고칠 수 없다.**
 *
 * ## 왜 있는가
 *
 * 러너(`_migrations`)는 **id 만** 보고 재실행하지 않는다. 그래서 적용된 마이그레이션의
 * 본문이나 이름을 나중에 고치면 **새 DB 와 기존 DB 의 스키마가 갈라진다** — 새로 만든
 * DB 는 고친 내용으로, dev/prod 는 옛 내용으로 남고, 그 차이는 아무 데서도 드러나지
 * 않는다. 이 저장소에는 실제로 그런 전례가 있다(`schema-fresh.test.ts` 머리말의
 * `perso_voice_id` 드리프트).
 *
 * 2026-09-03 리뷰에서 그 구멍이 다시 드러났다: 스톡 문구 지문을 마이그레이션 이름에
 * 박아 "문구를 고치면 새 마이그레이션을 만들 수밖에 없게" 만들었는데, **적용된
 * 마이그레이션의 이름을 고쳐 버리면** 그 강제가 통째로 우회됐다. 지문이 이름에 사는 한
 * 그 이름의 불변성이 곧 그 장치의 근거다.
 *
 * ## 값을 갱신해야 할 때
 *
 * **새 마이그레이션을 추가할 때만** 잠금이 늘어난다. 기존 항목이 바뀌었다는 것은
 * 이미 나간 마이그레이션을 고쳤다는 뜻이므로, 그때는 **되돌리고 새 마이그레이션을
 * 추가**해야 한다. 정말로 잠금을 다시 떠야 한다면(예: 아직 어디에도 배포되지 않은
 * 마이그레이션의 오타) `UPDATE_MIGRATION_LOCK=1` 로 이 테스트를 돌린다.
 */
const LOCK_PATH = join(__dirname, 'migrations.lock.json');

type LockEntry = { name: string; sha: string };

function fingerprintOf(statements: readonly string[]): string {
  return createHash('sha256').update(statements.join('\n')).digest('hex').slice(0, 16);
}

describe('적용된 마이그레이션 불변', () => {
  it('기존 마이그레이션의 이름·본문이 그대로다', () => {
    const current: Record<string, LockEntry> = {};
    for (const m of migrations) {
      current[String(m.id)] = { name: m.name, sha: fingerprintOf(m.statements) };
    }

    if (process.env.UPDATE_MIGRATION_LOCK === '1') {
      writeFileSync(LOCK_PATH, JSON.stringify(current, null, 2) + '\n');
      return;
    }

    const locked: Record<string, LockEntry> = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
    const changed: string[] = [];
    for (const [id, entry] of Object.entries(locked)) {
      const now = current[id];
      if (!now) {
        changed.push(`#${id}(${entry.name}): 사라졌다 — 적용된 마이그레이션은 지울 수 없다`);
        continue;
      }
      if (now.name !== entry.name) {
        changed.push(`#${id}: 이름이 바뀌었다 '${entry.name}' → '${now.name}'`);
      }
      if (now.sha !== entry.sha) {
        changed.push(`#${id}(${entry.name}): 본문이 바뀌었다`);
      }
    }

    expect(
      changed,
      '이미 적용된 마이그레이션을 고쳤다. 러너는 id 만 보고 재실행하지 않으므로 ' +
        '**새 DB 와 dev/prod 의 스키마가 갈라진다.** 되돌리고 새 마이그레이션을 추가하라. ' +
        '(아직 아무 데도 배포되지 않은 것이 확실하면 UPDATE_MIGRATION_LOCK=1 로 잠금을 다시 뜬다.)',
    ).toEqual([]);
  });

  it('새 마이그레이션은 잠금에 추가하면 통과한다', () => {
    const locked: Record<string, LockEntry> = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
    const missing = migrations
      .filter((m) => !locked[String(m.id)])
      .map((m) => `#${m.id}(${m.name})`);
    expect(
      missing,
      '새 마이그레이션이 잠금에 없다. `UPDATE_MIGRATION_LOCK=1 npx vitest run ' +
        'test/migrations-immutable.test.ts` 로 잠금을 갱신하고 함께 커밋하라.',
    ).toEqual([]);
  });
});
