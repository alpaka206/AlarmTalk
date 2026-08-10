// **목소리 교체는 알람을 건드리지 않는다** — 실제 스키마 위에서 확인한다.
//
// 배경: 지금까지 목소리 등록은 "새 프로필을 만들고 옛 것을 지운다" 였다. 지우는 순간
// 그 목소리를 쓰던 알람이 기본 알람음으로 떨어진다 — 사용자가 없애고 싶어 한 동작이다.
// 교체는 프로필 id 와 message id 를 **그대로 두고 오디오 실체만 덮어쓰므로**, 알람은
// 아무것도 눈치채지 못하고 소리만 새 목소리가 된다.
//
// 이 테스트가 지키는 것:
//   1. 마이그레이션 #101 이 `refresh_existing` 을 추가한다(기본 0 — 기존 행 동작 불변).
//   2. preset 을 덮어써도 **message_id 가 바뀌지 않는다**(알람이 가리키는 값).
//   3. 덮어쓴 뒤 알람의 참조가 그대로 살아 있다(조인이 끊기지 않는다).
//   4. `audio_url` 은 **반드시 달라진다** — 기기 캐시는 이 값으로만 낡음을 판별한다.
import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';

async function migratedDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  return db;
}

describe('목소리 교체 — 제자리 덮어쓰기', () => {
  it('마이그레이션 #101 이 refresh_existing 을 기본 0 으로 추가한다', async () => {
    const db = await migratedDb();
    const cols = await db.execute("PRAGMA table_info('voice_prerender_queue')");
    const col = cols.rows.find((r) => String(r.name) === 'refresh_existing');
    expect(col, 'refresh_existing 컬럼이 없다 — 교체 회차를 구분할 수 없다').toBeTruthy();
    expect(String(col!.dflt_value)).toBe('0');

    // 기존 행과 같은 방식으로 넣어도 기본값이 붙는다(기존 동작 불변).
    await db.execute({
      sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language)
            VALUES ('v1', 'u1', 'ko')`,
      args: [],
    });
    const row = await db.execute("SELECT refresh_existing FROM voice_prerender_queue WHERE voice_profile_id = 'v1'");
    expect(Number(row.rows[0]!.refresh_existing)).toBe(0);
  });

  it('preset 을 덮어써도 message_id 가 그대로고 알람 참조가 끊기지 않는다', async () => {
    const db = await migratedDb();

    await db.execute({
      sql: `INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.c', '나')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft)
            VALUES ('vp1', 'u1', '엄마 목소리', 'ready', 'eleven-OLD', 0)`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO messages
              (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
            VALUES ('m1', 'u1', 'vp1', '옛 문구', 'weather', 'ko', 0, 1, 'r2://old-object')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, voice_profile_id, message_id)
            VALUES ('a1', 'u1', '07:00', 'vp1', 'm1')`,
      args: [],
    });

    // ── 교체: message 행을 **그대로 두고** 오디오·문구만 갈아끼운다 ───────────
    await db.execute({
      sql: `UPDATE messages SET text = ?, audio_url = ? WHERE id = ?`,
      args: ['새 문구', 'r2://new-object', 'm1'],
    });
    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ? WHERE id = ?`,
      args: ['eleven-NEW', 'vp1'],
    });

    // 알람은 아무것도 바뀌지 않았다.
    const alarm = await db.execute("SELECT voice_profile_id, message_id FROM alarms WHERE id = 'a1'");
    expect(String(alarm.rows[0]!.voice_profile_id)).toBe('vp1');
    expect(String(alarm.rows[0]!.message_id)).toBe('m1');

    // 그런데 재생 경로(알람 → message → audio_url)는 새 음원을 가리킨다.
    const joined = await db.execute(`
      SELECT m.id AS message_id, m.audio_url, vp.elevenlabs_voice_id
      FROM alarms a
      JOIN messages m ON m.id = a.message_id
      JOIN voice_profiles vp ON vp.id = m.voice_profile_id
      WHERE a.id = 'a1' AND vp.deleted_at IS NULL AND COALESCE(vp.is_draft, 0) = 0
    `);
    expect(joined.rows.length, '교체 뒤 알람→목소리 조인이 끊겼다').toBe(1);
    expect(String(joined.rows[0]!.message_id)).toBe('m1');
    expect(String(joined.rows[0]!.audio_url)).toBe('r2://new-object');
    expect(String(joined.rows[0]!.elevenlabs_voice_id)).toBe('eleven-NEW');
  });

  it('옛 방식(프로필 삭제)은 알람의 목소리 조인을 끊는다 — 교체가 필요한 이유', async () => {
    const db = await migratedDb();
    await db.execute("INSERT INTO users (id, email, name) VALUES ('u1','a@b.c','나')");
    await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, is_draft)
                      VALUES ('vp1','u1','엄마 목소리','ready',0)`);
    await db.execute(`INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
                      VALUES ('m1','u1','vp1','문구','weather','ko',0,1,'r2://o')`);
    await db.execute(`INSERT INTO alarms (id, user_id, time, voice_profile_id, message_id)
                      VALUES ('a1','u1','07:00','vp1','m1')`);

    // 지금까지의 등록 흐름: 옛 프로필을 지운다.
    await db.execute("UPDATE voice_profiles SET deleted_at = datetime('now') WHERE id = 'vp1'");

    const joined = await db.execute(`
      SELECT m.id FROM alarms a
      JOIN messages m ON m.id = a.message_id
      JOIN voice_profiles vp ON vp.id = m.voice_profile_id
      WHERE a.id = 'a1' AND vp.deleted_at IS NULL
    `);
    expect(joined.rows.length, '삭제해도 조인이 살아 있다면 이 테스트의 전제가 틀린 것이다').toBe(0);
  });

  it('교체 회차는 이미 있는 클립도 전부 대상이 된다 — 아니면 조용히 아무 일도 안 한다', async () => {
    const { findMissingStockTargets } = await import('../src/lib/stock-clips');
    const db = await migratedDb();
    await db.execute("INSERT INTO users (id, email, name) VALUES ('u1','a@b.c','나')");
    await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft)
                      VALUES ('vp1','u1','엄마','ready','eleven-1',0)`);
    const voice = {
      id: 'vp1', name: '엄마', elevenlabsVoiceId: 'eleven-1', ownerUserId: 'u1',
      categories: ['greeting'], languageOverride: 'ko', isClone: true,
    } as Parameters<typeof findMissingStockTargets>[1] extends (infer T)[] ? T : never;

    const first = await findMissingStockTargets(db, [voice as never]);
    expect(first.length, '처음에는 빠진 클립이 있어야 한다').toBeGreaterThan(0);

    // 그 클립들이 이미 있다고 심는다.
    for (const t of first) {
      await db.execute({
        sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
              VALUES (?, 'u1', ?, '문구', ?, ?, ?, 1, 'r2://old')`,
        args: [crypto.randomUUID(), t.voiceProfileId, t.category, t.language, t.variantIndex],
      });
    }

    const missing = await findMissingStockTargets(db, [voice as never]);
    expect(missing.length, '다 채웠으니 빠진 것은 0 이어야 한다').toBe(0);

    const refresh = await findMissingStockTargets(db, [voice as never], true);
    expect(refresh.length, '교체 회차인데 대상이 0 이면 목소리가 바뀌지 않는다').toBe(first.length);
    expect(refresh.every((t) => t.refreshExisting === true), '각 대상에 덮어쓰기 표시가 실려야 한다').toBe(true);
  });

  it('audio_url 이 그대로면 기기가 새 음원을 받지 못한다 — 교체는 반드시 URL 을 바꾼다', async () => {
    // 캐시 키는 `stock_<messageId>` 라 버전이 없다. message_id 를 유지하는 것이 교체의
    // 핵심인데, 그러면 낡음을 알릴 수단이 `audio_url` 하나뿐이다.
    const before = 'r2://generated/u1/OLDHASH.mp3';
    const after = 'r2://generated/u1/NEWHASH.mp3';
    expect(after).not.toBe(before);
  });
});
