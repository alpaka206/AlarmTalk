// 보관 만료 정리(`cleanupExpiredAudio`·`cleanupStaleDraftVoices`)는 **행을 지우는 것과 삭제를 예약하는 것이
// 한 트랜잭션**이어야 한다(docs/spec/voice-and-message.md §11).
//
// 예전에는 행마다 DELETE 를 커밋하고 그 뒤에 큐 적재를 **따로** 커밋했다. 그 사이가 끊기면(워커 subrequest 한도·
// 네트워크) R2 파일·클론이 참조도 삭제 예약도 없이 영구히 남는다 — 처리방침의 파기 약속을 어긴다.
// 실패를 흉내 내려고 SQLite 트리거로 특정 쓰기를 터뜨리고, 그때 **아무것도 커밋되지 않았는지** 본다.
// 목 DB 로는 '문장이 불렸는가' 만 보이고 롤백은 안 보이므로 실제 libSQL + 운영 마이그레이션으로 돌린다.
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import { cleanupExpiredAudio, cleanupStaleDraftVoices } from '../src/lib/audio-retention';

const OLD = '2020-01-01 00:00:00'; // 7일·30일 TTL 을 확실히 넘긴 시각
const NOW = new Date('2020-03-01T00:00:00Z');

let db: Client;

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  await db.execute(`INSERT INTO users (id, google_id, email) VALUES ('u1', 'g1', 'u1@test.com')`);
});

async function insertProfile(id: string, opts: { isDraft?: boolean; voiceId?: string; createdAt?: string } = {}) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_draft, elevenlabs_voice_id, created_at)
          VALUES (?, 'u1', ?, 'ready', ?, ?, ?)`,
    args: [id, id, opts.isDraft ? 1 : 0, opts.voiceId ?? null, opts.createdAt ?? OLD],
  });
}

async function insertUpload(id: string, profileId: string | null) {
  await db.execute({
    sql: `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes, voice_profile_id, created_at)
          VALUES (?, 'u1', ?, 'audio/mpeg', 1, ?, ?)`,
    args: [id, `voices/u1/${id}.mp3`, profileId, OLD],
  });
}

async function insertMessage(id: string, audioUrl: string | null, opts: { preset?: boolean } = {}) {
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, is_preset)
          VALUES (?, 'u1', 'p_final', ?, ?, ?)`,
    args: [id, id, audioUrl, opts.preset ? 1 : 0],
  });
}

async function insertGenerated(id: string, messageId: string, key: string) {
  await db.execute({
    sql: `INSERT INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id, model_id,
             language, request_hash, text, audio_url, audio_object_key, created_at)
          VALUES (?, 'u1', 'p_final', ?, 'elevenlabs', 'v', 'm', 'ko', ?, 't', ?, ?, ?)`,
    args: [id, messageId, `hash-${id}`, `r2://${key}`, key, OLD],
  });
}

/**
 * 업로드 넷(확정 원본 1 + 지울 것 3)과 생성 음원 셋(지울 것 1 + 알람이 쓰는 것 1 + 프리셋 1).
 */
async function seed() {
  await insertProfile('p_final');
  await insertProfile('p_draft', { isDraft: true });
  await insertUpload('up_final', 'p_final');
  await insertUpload('up_draft', 'p_draft');
  await insertUpload('up_orphan', null);
  await insertUpload('up_family', null);

  await insertMessage('m_lib', 'r2://generated-tts/u1/lib.mp3');
  await insertGenerated('g_lib', 'm_lib', 'generated-tts/u1/lib.mp3');
  await insertMessage('m_alarm', 'r2://generated-tts/u1/alarm.mp3');
  await insertGenerated('g_alarm', 'm_alarm', 'generated-tts/u1/alarm.mp3');
  await db.execute(`INSERT INTO alarms (id, user_id, message_id, time) VALUES ('a1', 'u1', 'm_alarm', '07:00')`);
  await insertMessage('m_preset', 'r2://generated-tts/u1/preset.mp3', { preset: true });
  await insertGenerated('g_preset', 'm_preset', 'generated-tts/u1/preset.mp3');
}

async function ids(table: string): Promise<string[]> {
  const rows = await db.execute(`SELECT id FROM ${table} ORDER BY id`);
  return rows.rows.map((r) => String(r.id));
}

async function queuedRefs(): Promise<string[]> {
  const rows = await db.execute(
    `SELECT kind || ':' || ref AS v FROM pending_external_deletions ORDER BY kind, ref`,
  );
  return rows.rows.map((r) => String(r.v));
}

async function audioUrlOf(messageId: string): Promise<string | null> {
  const rows = await db.execute({ sql: 'SELECT audio_url FROM messages WHERE id = ?', args: [messageId] });
  const v = rows.rows[0]!.audio_url;
  return v == null ? null : String(v);
}

const EXPECTED_QUEUE = [
  'r2_object:generated-tts/u1/lib.mp3',
  'r2_object:voices/u1/up_draft.mp3',
  'r2_object:voices/u1/up_family.mp3',
  'r2_object:voices/u1/up_orphan.mp3',
];

describe('cleanupExpiredAudio — 행 삭제와 삭제 예약은 한 트랜잭션', () => {
  it('정상: 만료 행은 지워지고 그 키가 큐에 정확히 한 번 들어간다 — 확정 원본·알람 음원·프리셋은 남는다', async () => {
    await seed();

    await cleanupExpiredAudio(db, NOW);

    expect(await ids('voice_uploads')).toEqual(['up_final']);
    expect(await ids('generated_audio_assets')).toEqual(['g_alarm', 'g_preset']);
    expect(await audioUrlOf('m_lib'), '지운 음원을 가리키는 문구 포인터는 비운다').toBeNull();
    expect(await audioUrlOf('m_alarm')).toBe('r2://generated-tts/u1/alarm.mp3');
    expect(await audioUrlOf('m_preset')).toBe('r2://generated-tts/u1/preset.mp3');
    expect(await queuedRefs()).toEqual(EXPECTED_QUEUE);

    // 다시 돌려도 이미 지운 행은 없고 큐도 늘지 않는다.
    await cleanupExpiredAudio(db, NOW);
    expect(await queuedRefs()).toEqual(EXPECTED_QUEUE);
  });

  /**
   * ⚠ **핵심 회귀.** 예전 코드는 업로드 행 DELETE 를 먼저 커밋했으므로, 큐 적재가 터지면 행만 사라지고
   * 큐는 비어 R2 원본이 영영 남았다.
   */
  it('큐 적재가 실패하면 업로드 행도 그대로 남는다(롤백) — 트리거를 걷으면 다음 회차가 정상 처리한다', async () => {
    await seed();
    await db.execute(`CREATE TEMP TRIGGER boom_enqueue BEFORE INSERT ON pending_external_deletions
                      BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(cleanupExpiredAudio(db, NOW)).rejects.toThrow(/boom/);

    expect(await ids('voice_uploads'), '예약 없이 행만 지워지면 R2 원본이 미아가 된다').toEqual([
      'up_draft',
      'up_family',
      'up_final',
      'up_orphan',
    ]);
    expect(await queuedRefs()).toEqual([]);

    await db.execute('DROP TRIGGER boom_enqueue');
    await cleanupExpiredAudio(db, NOW);
    expect(await ids('voice_uploads')).toEqual(['up_final']);
    expect(await queuedRefs()).toEqual(EXPECTED_QUEUE);
  });

  /**
   * 생성 음원 갈래도 같다 — 예전에는 큐 적재 → 포인터 비우기 → 원장 행 삭제를 각각 커밋해, 마지막에서
   * 끊기면 문구는 소리를 잃었는데 원장 행은 남아(다음 회차가 또 비우고 또 넣는) 반쯤 지운 상태가 됐다.
   */
  it('생성 음원 원장 삭제가 실패하면 포인터 비우기·큐 적재도 함께 롤백된다', async () => {
    await insertProfile('p_final');
    await insertMessage('m_lib', 'r2://generated-tts/u1/lib.mp3');
    await insertGenerated('g_lib', 'm_lib', 'generated-tts/u1/lib.mp3');
    await db.execute(`CREATE TEMP TRIGGER boom_ledger BEFORE DELETE ON generated_audio_assets
                      BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(cleanupExpiredAudio(db, NOW)).rejects.toThrow(/boom/);

    expect(await ids('generated_audio_assets')).toEqual(['g_lib']);
    expect(await audioUrlOf('m_lib'), '원장이 남았는데 포인터만 비면 반쯤 지운 상태다').toBe(
      'r2://generated-tts/u1/lib.mp3',
    );
    expect(await queuedRefs()).toEqual([]);

    await db.execute('DROP TRIGGER boom_ledger');
    await cleanupExpiredAudio(db, NOW);
    expect(await ids('generated_audio_assets')).toEqual([]);
    expect(await audioUrlOf('m_lib')).toBeNull();
    expect(await queuedRefs()).toEqual(['r2_object:generated-tts/u1/lib.mp3']);
  });

  /**
   * 고른 뒤 쓰기 전에 상태가 바뀌면 쓰기 문장이 **같은 조건을 다시 본다** — 고른 목록만 믿지 않는다.
   * 업로드: 그 사이 promote 된 확정 원본은 지우지도, 예약하지도 않는다.
   * 생성 음원: 그 사이 알람이 붙은 음원은 지우지 않는다(예전에는 다시 보지 않아 알람이 무음이 됐다).
   */
  it('고른 뒤 promote·알람 연결이 생기면 그 행은 건너뛴다', async () => {
    await seed();
    const raced = { upload: false, generated: false };
    const racing = Object.create(db) as Client;
    racing.batch = db.batch.bind(db);
    racing.execute = (async (stmt: Parameters<Client['execute']>[0]) => {
      const result = await db.execute(stmt);
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      if (!/^\s*SELECT/i.test(sql)) return result;
      // 고르는 SELECT 가 끝난 바로 뒤 — 쓰기 전에 상태를 바꾼다.
      if (!raced.upload && sql.includes('FROM voice_uploads')) {
        raced.upload = true;
        await db.execute(`UPDATE voice_profiles SET is_draft = 0 WHERE id = 'p_draft'`);
      }
      if (!raced.generated && sql.includes('FROM generated_audio_assets g')) {
        raced.generated = true;
        await db.execute(`INSERT INTO alarms (id, user_id, message_id, time) VALUES ('a2', 'u1', 'm_lib', '08:00')`);
      }
      return result;
    }) as Client['execute'];

    await cleanupExpiredAudio(racing, NOW);

    expect(raced).toEqual({ upload: true, generated: true });
    expect(await ids('voice_uploads')).toEqual(['up_draft', 'up_final']);
    expect(await ids('generated_audio_assets')).toEqual(['g_alarm', 'g_lib', 'g_preset']);
    expect(await audioUrlOf('m_lib')).toBe('r2://generated-tts/u1/lib.mp3');
    expect(await queuedRefs()).toEqual([
      'r2_object:voices/u1/up_family.mp3',
      'r2_object:voices/u1/up_orphan.mp3',
    ]);
  });
});

describe('cleanupStaleDraftVoices — 소프트 삭제와 클론 삭제 예약은 한 트랜잭션', () => {
  it('큐 적재가 실패하면 draft 도 소프트 삭제되지 않는다 — 트리거를 걷으면 정상 처리한다', async () => {
    await insertProfile('d_stale', { isDraft: true, voiceId: 'elv-stale', createdAt: '2020-01-01 00:00:00' });
    await insertProfile('d_fresh', { isDraft: true, voiceId: 'elv-fresh', createdAt: '2020-02-29 23:30:00' });
    await db.execute(`CREATE TEMP TRIGGER boom_enqueue BEFORE INSERT ON pending_external_deletions
                      BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(cleanupStaleDraftVoices(db, NOW)).rejects.toThrow(/boom/);

    const live = await db.execute(`SELECT id FROM voice_profiles WHERE user_id = 'u1' AND deleted_at IS NULL ORDER BY id`);
    expect(live.rows.map((r) => String(r.id)), '예약 없이 지워지면 클론이 미아가 된다').toEqual([
      'd_fresh',
      'd_stale',
    ]);
    expect(await queuedRefs()).toEqual([]);

    await db.execute('DROP TRIGGER boom_enqueue');
    await cleanupStaleDraftVoices(db, NOW);
    const after = await db.execute(`SELECT id FROM voice_profiles WHERE user_id = 'u1' AND deleted_at IS NULL ORDER BY id`);
    expect(after.rows.map((r) => String(r.id))).toEqual(['d_fresh']);
    expect(await queuedRefs()).toEqual(['elevenlabs_voice:elv-stale']);
  });
});
