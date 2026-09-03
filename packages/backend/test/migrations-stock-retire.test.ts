// 마이그레이션 #110 실동작 검증 — **지우지 않고 은퇴시키는지**(2026-09-03 리뷰 7차).
//
// #70·#109 는 옛 프리셋을 `DELETE FROM messages` 하고 참조 알람을 sound-only 로 뗐다.
// #110 을 그 패턴으로 쓰려다 되돌렸다 — 그 방식은 세 가지를 한꺼번에 부순다:
//  1) 버킷 없이 클립 하나만 물린 **옛 알람**은 클라 재바인더 두 갈래 어디에도 안 걸려
//     영구히 sound-only 로 남는다,
//  2) `generated_audio_assets` 행을 지우면 R2 키를 찾을 방법이 사라져(그 행이 유일한
//     원장이다) 동의 철회·목소리 삭제에도 오디오를 파기하지 못한다,
//  3) 배포 직후 기본 목소리 클립이 0개가 된다.
//
// 은퇴(`is_preset = 0`)는 셋을 한 번에 없앤다. 이 테스트가 그 의미론을 고정한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { migrations, runMigrationsRange } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-migration-stock-retire.db');
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const USER = '11000000-0000-4000-9000-000000000001';
const SYSTEM_VOICE = '11000000-0000-4000-9000-000000000101';
const CLONE_VOICE = '11000000-0000-4000-9000-000000000102';

const migration110 = migrations.find((m) => m.id === 110)!;

beforeAll(async () => {
  // #110 직전까지 세운 뒤 씨앗을 심고 #110 의 문장만 돌린다.
  await runMigrationsRange(db, 1, 109);
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, 'retire@test')`,
    args: [USER, USER],
  });
  for (const [id, isSystem] of [[SYSTEM_VOICE, 1], [CLONE_VOICE, 0]] as const) {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system)
            VALUES (?, ?, 'v', 'ready', ?)`,
      args: [id, USER, isSystem],
    });
  }
  for (const [id, voice] of [['sys-preset', SYSTEM_VOICE], ['clone-preset', CLONE_VOICE]] as const) {
    await db.execute({
      sql: `INSERT INTO messages
            (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
             category, language, variant, is_preset, audio_url)
            VALUES (?, ?, ?, '옛 대사', '옛 대사', '[]', 'weather', 'ko', 0, 1, 'r2://x/x.mp3')`,
      args: [id, USER, voice],
    });
    await db.execute({
      sql: `INSERT INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
             model_id, language, request_hash, text, audio_url, audio_object_key,
             audio_format)
            VALUES (?, ?, ?, ?, 'elevenlabs', 'v', 'eleven_v3', 'ko', ?, '옛 대사',
                    'r2://x/x.mp3', ?, 'mp3')`,
      args: [`ga-${id}`, USER, voice, id, `hash-${id}`, `voices/${id}.mp3`],
    });
    await db.execute({
      sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
      args: [`lib-${id}`, USER, id],
    });
  }
  // ① 버킷 알람(재바인더가 갈아탈 수 있는 형태) ② 버킷 없이 클립 하나만 물린 **옛 행**.
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, message_id, time, mode, bucket_id)
          VALUES ('bucket-alarm', ?, 'sys-preset', '07:00', 'tts', 'weather')`,
    args: [USER],
  });
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, message_id, time, mode)
          VALUES ('legacy-alarm', ?, 'sys-preset', '08:00', 'tts')`,
    args: [USER],
  });

  for (const sql of migration110.statements) {
    await db.execute(sql);
  }
});

describe('migration #110 — 프리셋은 지우지 않고 은퇴시킨다', () => {
  it('참조 알람을 sound-only 로 떼지 않는다', async () => {
    const rows = await db.execute(
      "SELECT id, mode, message_id FROM alarms ORDER BY id",
    );
    // ⚠ **옛 행(`legacy-alarm`)이 핵심이다.** 버킷이 없어 클라 재바인더가 손댈 수 없으므로,
    //   여기서 떼면 그 알람은 영구히 sound-only 다.
    for (const row of rows.rows) {
      expect(row.mode, `${row.id} 의 mode`).toBe('tts');
      expect(row.message_id, `${row.id} 의 message_id`).toBe('sys-preset');
    }
    expect(rows.rows.map((r) => String(r.id))).toEqual(['bucket-alarm', 'legacy-alarm']);
  });

  it('messages 행은 남고 is_preset 만 내려간다', async () => {
    const rows = await db.execute(
      "SELECT id, is_preset FROM messages WHERE id IN ('sys-preset','clone-preset') ORDER BY id",
    );
    expect(rows.rows.map((r) => [String(r.id), Number(r.is_preset)])).toEqual([
      ['clone-preset', 0],
      ['sys-preset', 0],
    ]);
  });

  it('R2 원장(generated_audio_assets)을 지우지 않는다', async () => {
    // 이 행이 R2 키의 **유일한** 출처다 — 지우면 동의 철회에도 오디오를 파기하지 못한다.
    const rows = await db.execute(
      "SELECT audio_object_key FROM generated_audio_assets ORDER BY id",
    );
    expect(rows.rows.map((r) => String(r.audio_object_key))).toEqual([
      'voices/clone-preset.mp3',
      'voices/sys-preset.mp3',
    ]);
  });

  it('문구 보관함에서는 내린다', async () => {
    // ⚠ 이 문장은 은퇴(`is_preset = 0`)보다 **먼저** 돌아야 한다 — 서브쿼리가
    //   `is_preset = 1` 로 거르므로, 순서를 뒤집으면 0행에 걸려 조용히 남는다.
    const rows = await db.execute('SELECT id FROM message_library');
    expect(rows.rows).toHaveLength(0);
  });

  it('은퇴한 행은 매니페스트·재시딩 대상에서 빠진다', async () => {
    // 매니페스트(`GET /tts/stock-clips`)와 findMissingStockTargets 둘 다 is_preset = 1 만 본다.
    const rows = await db.execute(
      'SELECT COUNT(*) AS n FROM messages WHERE COALESCE(is_preset, 0) = 1',
    );
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });
});
