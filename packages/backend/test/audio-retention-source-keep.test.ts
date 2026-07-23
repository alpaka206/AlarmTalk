import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { cleanupExpiredAudio } from '../src/lib/audio-retention';

// 확정(promote)된 목소리의 클론 원본 업로드는 API 키/프로바이더 교체 후 재생성용으로 보관해야 하므로
// 7일 TTL 스윕에서 제외된다. 그 외(미승격 draft / 프로필과 무관한 raw 업로드 / 삭제된 프로필 잔여분)만
// 정리된다. 실제 인메모리 libSQL 로 스윕 쿼리를 검증한다.
async function setupDb() {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'ready',
      is_draft INTEGER DEFAULT 0,
      deleted_at TEXT
    );
    CREATE TABLE voice_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
      size_bytes INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER,
      original_name TEXT,
      voice_profile_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE pending_external_deletions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- generated_audio_assets 스윕 파트가 참조하는 테이블(빈 채로 존재만 하면 됨)
    CREATE TABLE generated_audio_assets (
      id TEXT PRIMARY KEY,
      audio_object_key TEXT,
      audio_url TEXT,
      message_id TEXT,
      user_id TEXT,
      voice_profile_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE alarms (id TEXT PRIMARY KEY, raw_audio_url TEXT, message_id TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, audio_url TEXT, is_preset INTEGER DEFAULT 0);
    CREATE TABLE raw_alarm_uploads (id TEXT PRIMARY KEY, object_key TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return db;
}

const OLD = '2020-01-01 00:00:00'; // 확실히 7일 TTL 경과

async function insertProfile(
  db: Awaited<ReturnType<typeof setupDb>>,
  id: string,
  opts: { isDraft?: boolean; deleted?: boolean } = {},
) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, is_draft, deleted_at)
          VALUES (?, 'u1', ?, ?, ?)`,
    args: [id, id, opts.isDraft ? 1 : 0, opts.deleted ? OLD : null],
  });
}

async function insertUpload(
  db: Awaited<ReturnType<typeof setupDb>>,
  id: string,
  profileId: string | null,
) {
  await db.execute({
    sql: `INSERT INTO voice_uploads (id, user_id, object_key, voice_profile_id, created_at)
          VALUES (?, 'u1', ?, ?, ?)`,
    args: [id, `voice-src/${id}.mp3`, profileId, OLD],
  });
}

describe('cleanupExpiredAudio — 확정 목소리 원본 보관', () => {
  it('확정(live·non-draft) 프로필의 원본은 TTL 경과에도 보관하고, 나머지는 정리한다', async () => {
    const db = await setupDb();
    await insertProfile(db, 'p_final'); // 확정
    await insertProfile(db, 'p_draft', { isDraft: true }); // 미승격 draft
    await insertProfile(db, 'p_deleted', { deleted: true }); // 삭제됨

    await insertUpload(db, 'up_final', 'p_final');
    await insertUpload(db, 'up_draft', 'p_draft');
    await insertUpload(db, 'up_deleted', 'p_deleted');
    await insertUpload(db, 'up_orphan', null); // 프로필과 무관한 raw 업로드

    await cleanupExpiredAudio(db, new Date('2020-02-01T00:00:00Z'));

    const remaining = await db.execute('SELECT id FROM voice_uploads ORDER BY id');
    expect(remaining.rows.map((r) => String(r.id))).toEqual(['up_final']);

    // 정리된 3건만 R2 삭제 큐에 적재되고, 확정분 키는 큐에 없다
    const queued = await db.execute(
      `SELECT ref FROM pending_external_deletions WHERE kind = 'r2_object' ORDER BY ref`,
    );
    const refs = queued.rows.map((r) => String(r.ref));
    expect(refs).toEqual([
      'voice-src/up_deleted.mp3',
      'voice-src/up_draft.mp3',
      'voice-src/up_orphan.mp3',
    ]);
    expect(refs).not.toContain('voice-src/up_final.mp3');

    db.close();
  });
});
