// `findLegacyBucketHints` — **버킷 없이 클립 하나만 물린 옛 알람**의 테마를 서버가 알려 준다.
//
// 그 행은 클라 재바인더 두 갈래 어디에도 안 걸린다(하나는 `bucketId` 를, 다른 하나는
// `voiceRandomPrompt` 를 요구하는데 둘 다 없다). 그래서 목소리를 갈아도 그 알람만
// **이름은 새 이름인데 소리는 옛 목소리**로 영원히 운다. 무엇으로 갈아탈지는 서버가
// 아는 값이라(그 알람이 문 message 의 `category`) 매니페스트에 실어 보낸다.
//
// ⚠ **기본 목소리의 무료 테마 프리셋 — 지금 것과 은퇴한 것**(2026-10-29 — 서버 알람 사본을 지웠다, #147). 예전에는 그
//   사용자의 서버 알람이 문 클립을 줬다. 사본이 없으니 그 갈래가 고를 수 있던 전부를 준다 — 옛 앱(1.2.16)은 힌트를 이 칸에서만
//   읽는다(코덱스 #977). 사용자를 받지 않으므로 남의 것이 섞일 길도 없다.
//
// 실제 libsql 에 마이그레이션을 올리고 돌린다 — 이 쿼리는 **SQL 의 의미**가 전부라
// 목 DB 로는 아무것도 검증되지 않는다.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { runMigrations } from '../src/lib/migrations';
import { findLegacyBucketHints } from '../src/lib/stock-clips';

const DB_PATH = join(tmpdir(), 'alarmtalk-legacy-bucket-hints.db');
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const ME = '21000000-0000-4000-9000-000000000001';
const SYSTEM_VOICE = '21000000-0000-4000-9000-000000000101';
const CLONE_VOICE = '21000000-0000-4000-9000-000000000102';

async function addMessage(
  id: string,
  voice: string,
  category: string,
  opts: { language?: string; retiredAt?: string } = {},
) {
  await db.execute({
    sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, variant, is_preset, audio_url, retired_at)
          VALUES (?, ?, ?, '문구', '문구', '[]', ?, ?, 0, 1, 'r2://x/x.mp3', ?)`,
    args: [id, ME, voice, category, opts.language ?? 'ko', opts.retiredAt ?? null],
  });
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, 'me@test')`,
    args: [ME, ME],
  });
  for (const [id, isSystem] of [[SYSTEM_VOICE, 1], [CLONE_VOICE, 0]] as const) {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system)
            VALUES (?, ?, 'v', 'ready', ?)`,
      args: [id, ME, isSystem],
    });
  }

  // 지금 쓰는 클립.
  await addMessage('msg-weather', SYSTEM_VOICE, 'weather');
  await addMessage('msg-greeting', SYSTEM_VOICE, 'greeting');
  await addMessage('msg-clone', CLONE_VOICE, 'cheer');
  // 은퇴한 클립.
  await addMessage('msg-retired-cheer', SYSTEM_VOICE, 'cheer', { retiredAt: '2026-09-01 00:00:00' });
  await addMessage('msg-retired-med-ja', SYSTEM_VOICE, 'medication', {
    language: 'ja',
    retiredAt: '2026-10-01 00:00:00',
  });
  await addMessage('msg-retired-greeting', SYSTEM_VOICE, 'greeting', { retiredAt: '2026-10-01 00:00:00' });
  await addMessage('msg-retired-clone', CLONE_VOICE, 'weather', { retiredAt: '2026-10-01 00:00:00' });
});

describe('findLegacyBucketHints — 기본 목소리의 무료 테마 프리셋(지금 것 + 은퇴한 것)', () => {
  it('지금 쓰는 것을 먼저, 은퇴한 것은 최근에 은퇴한 것부터 테마·언어와 함께 준다', async () => {
    expect(await findLegacyBucketHints(db)).toEqual([
      { messageId: 'msg-weather', category: 'weather', language: 'ko' },
      { messageId: 'msg-retired-med-ja', category: 'medication', language: 'ja' },
      { messageId: 'msg-retired-cheer', category: 'cheer', language: 'ko' },
    ]);
  });

  it('지금 쓰는 기본 목소리 클립도 준다 — 옛 앱(1.2.16)은 힌트를 이 칸에서만 읽는다(코덱스 #977)', async () => {
    const ids = (await findLegacyBucketHints(db)).map((h) => h.messageId);
    expect(ids).toContain('msg-weather');
    expect(ids).not.toContain('msg-clone');
  });

  it('`greeting` 과 클론은 지금 것이든 은퇴했든 주지 않는다', async () => {
    const hints = await findLegacyBucketHints(db);
    // greeting 은 버킷이 아니다 — 목소리 미리듣기용 자기소개라 알람 테마가 될 수 없다. 주면 앱이 `bucketId` 에 적어
    // 그 알람이 소개 문구로 운다.
    expect(hints.map((h) => h.category)).not.toContain('greeting');
    expect(hints.map((h) => h.messageId)).not.toContain('msg-greeting');
    expect(hints.map((h) => h.messageId)).not.toContain('msg-retired-greeting');
    // 이번 교체는 기본 목소리만 건드린다. 클론은 사용자의 것이라 시스템 카탈로그가 아니다.
    expect(hints.map((h) => h.messageId)).not.toContain('msg-retired-clone');
  });

  it('`retired_at` 칸이 없으면(#110 배포 창) 빈 목록이다 — 매니페스트를 500 으로 만들지 않는다', async () => {
    // 칸 확인 결과는 모듈에 남는다(한 번 '있다' 면 다시 보지 않는다) — 새 모듈로 처음부터 본다.
    vi.resetModules();
    const { findLegacyBucketHints: fresh } = await import('../src/lib/stock-clips');
    const bare = createClient({ url: ':memory:' });
    await bare.executeMultiple(`
      CREATE TABLE voice_profiles (id TEXT PRIMARY KEY, is_system INTEGER DEFAULT 0);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, voice_profile_id TEXT, category TEXT, language TEXT, is_preset INTEGER DEFAULT 0
      );
    `);
    try {
      expect(await fresh(bare)).toEqual([]);
    } finally {
      bare.close();
    }
  });
});
