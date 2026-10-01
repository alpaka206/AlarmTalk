import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';

// #125 는 되돌릴 수 없는 정리라(#89·#90·#108 과 같은 이유로) "정말 사라졌는가" 를 실제 스키마로 확인한다.
// 그리고 칸에 값이 있던 옛 행이 **그 칸만 잃고** 나머지는 그대로인지도 본다 —
// prod 에는 #840 이전에 등록한 목소리의 태그 값이 남아 있다.

async function columnsOf(db: Client, table: string): Promise<string[]> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.map((row) => String(row.name));
}

async function seedTaggedProfile(db: Client): Promise<void> {
  await db.execute(
    `INSERT INTO users (id, google_id, email, name, plan) VALUES ('user-1', NULL, 'u1@t.test', '사용자', 'plus')`,
  );
  await db.execute({
    sql: `INSERT INTO voice_profiles
            (id, user_id, name, status, elevenlabs_voice_id, is_draft, preview_text, preview_tag,
             relationship_label, listener_title, voice_energy)
          VALUES (?, ?, ?, 'ready', ?, 0, ?, ?, ?, ?, ?)`,
    args: [
      'vp-tagged',
      'user-1',
      '엄마 목소리',
      'el-voice-1',
      '일어나, 아침이야.',
      '[cheerful]',
      '엄마',
      '우리 딸',
      'calm',
    ],
  });
}

describe('#125 — voice_profiles.preview_tag 를 지운다', () => {
  it('새 DB 에서 칸이 사라지고, 살아 있는 미리듣기 칸은 남는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    const columns = await columnsOf(db, 'voice_profiles');
    expect(columns).not.toContain('preview_tag');
    // 같은 #65 가 더한 `preview_text` 는 지금도 읽고 쓰는 칸이다.
    expect(columns).toEqual(expect.arrayContaining(['preview_text', 'previewed_at', 'voice_energy']));
  });

  it('값이 있던 옛 행은 그 칸만 잃고 나머지는 그대로다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 124);
    expect(await columnsOf(db, 'voice_profiles')).toContain('preview_tag');

    // DROP COLUMN 은 그 칸을 참조하는 인덱스·트리거·뷰가 있으면 실패한다. 우리 스키마에는 없다 —
    // 생기면 마이그레이션에 DROP INDEX 등을 먼저 넣어야 한다(#82 와 같은 순서).
    const referencing = await db.execute(
      `SELECT type, name FROM sqlite_master
        WHERE type IN ('index', 'trigger', 'view') AND sql LIKE '%preview_tag%'`,
    );
    expect(referencing.rows).toEqual([]);

    await seedTaggedProfile(db);
    expect(await runMigrationsRange(db, 125, 125)).toEqual(['125_drop-voice-profiles-preview-tag']);

    expect(await columnsOf(db, 'voice_profiles')).not.toContain('preview_tag');
    const row = (await db.execute(`SELECT * FROM voice_profiles WHERE id = 'vp-tagged'`)).rows[0]!;
    expect(row).toMatchObject({
      id: 'vp-tagged',
      user_id: 'user-1',
      name: '엄마 목소리',
      status: 'ready',
      elevenlabs_voice_id: 'el-voice-1',
      preview_text: '일어나, 아침이야.',
      relationship_label: '엄마',
      listener_title: '우리 딸',
      voice_energy: 'calm',
    });
    expect(Object.keys(row)).not.toContain('preview_tag');
  });

  it('두 번 돌려도 안전하다 — 원장이 빠져 다시 돌아도 칸이 이미 없으면 통과한다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    expect(await runMigrations(db)).toEqual([]);

    // 원장(_migrations)과 실제 스키마가 어긋난 DB(#50 이 겪은 경우)에서도 'no such column' 관용으로 통과한다.
    await db.execute(`DELETE FROM _migrations WHERE id = 125`);
    expect(await runMigrations(db)).toEqual(['125_drop-voice-profiles-preview-tag']);
    expect(await columnsOf(db, 'voice_profiles')).not.toContain('preview_tag');
  });

  it('누가 그 칸에 인덱스를 걸어 둔 DB 면 조용히 넘어가지 않고 실패한다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 124);
    await db.execute(`CREATE INDEX ix_manual_preview_tag ON voice_profiles(preview_tag)`);

    await expect(runMigrationsRange(db, 125, 125)).rejects.toThrow();
    // 성공으로 기록되지 않아야 다음 배포에서 다시 시도된다.
    const ledger = await db.execute(`SELECT id FROM _migrations WHERE id = 125`);
    expect(ledger.rows).toEqual([]);
    expect(await columnsOf(db, 'voice_profiles')).toContain('preview_tag');
  });
});
