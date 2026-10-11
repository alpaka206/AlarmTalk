// `publish:stock` 의 교체 갈래 — 같은 message_id 에 소리만 갈아 끼운다(2026-09-30, eleven_v4_turbo 전환).
//
// 행을 은퇴시키면(#110) 모든 앱이 새 id 로 다시 묶을 때까지 차단 화면을 띄운다. 교체는 알람이 물고 있는
// message_id 를 그대로 두고 `audio_url` 만 바꾼다 — 비교 후 교체(CAS)라 겹친 게시가 서로를 덮지 않는다.
import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerAudioUrlFor, replaceStockClipInPlace, type StockClipReplacement } from '../src/lib/stock-clip-replace';

const OWNER = '70000000-0000-4000-9000-000000000001';
const VOICE = '70000000-0000-4000-9000-000000000102';
const OLD_KEY = `generated-tts/${OWNER}/${'a'.repeat(64)}.mp3`;
const NEW_KEY = `generated-tts/${OWNER}/${'b'.repeat(64)}.mp3`;

async function setupDb() {
  // ⚠ 쓰기 트랜잭션은 커넥션이 따로라 `:memory:` 로는 테이블을 못 본다 — 파일 DB 를 쓴다.
  const path = join(tmpdir(), `alarmtalk-stock-replace-${crypto.randomUUID()}.db`);
  const db = createClient({ url: `file:${path}` });
  await db.executeMultiple(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, voice_profile_id TEXT NOT NULL,
      text TEXT, synthesis_text TEXT, delivery_tags_json TEXT, category TEXT, language TEXT,
      variant INTEGER DEFAULT 0, is_preset INTEGER DEFAULT 0, audio_url TEXT, retired_at TEXT
    );
    CREATE TABLE generated_audio_assets (
      id TEXT PRIMARY KEY, user_id TEXT, voice_profile_id TEXT, message_id TEXT,
      provider TEXT, provider_voice_id TEXT, model_id TEXT, language TEXT,
      request_hash TEXT UNIQUE, text TEXT, audio_url TEXT, audio_object_key TEXT,
      audio_format TEXT, created_at TEXT
    );
    CREATE TABLE pending_external_deletions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(kind, ref)
    );
    INSERT INTO messages (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
                          category, language, variant, is_preset, audio_url)
      VALUES ('m1', '${OWNER}', '${VOICE}', '약 먹을 시간이에요.', '[warmly] 약 먹을 시간이에요.', '["warmly"]',
              'medication', 'ko', 0, 1, 'r2://${OLD_KEY}');
    INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                                        model_id, language, request_hash, text, audio_url, audio_object_key, audio_format)
      VALUES ('ga-old', '${OWNER}', '${VOICE}', 'm1', 'elevenlabs', 'el-mina', 'eleven_v3', 'ko', '${'a'.repeat(64)}',
              '[warmly] 약 먹을 시간이에요.', 'r2://${OLD_KEY}', '${OLD_KEY}', 'mp3');
    -- 새 키가 예전에 삭제 예약된 적이 있다(결정론적 키) — 게시가 그 예약을 소비해야 한다.
    INSERT INTO pending_external_deletions (id, kind, ref) VALUES ('p-new', 'r2_object', '${NEW_KEY}');
  `);
  return {
    db,
    cleanup: () => {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    },
  };
}

function replacement(overrides: Partial<StockClipReplacement> = {}): StockClipReplacement {
  return {
    messageId: 'm1',
    previousAudioUrl: `r2://${OLD_KEY}`,
    ownerUserId: OWNER,
    voiceProfileId: VOICE,
    provider: 'elevenlabs',
    providerVoiceId: 'el-mina',
    modelId: 'eleven_v4_turbo',
    language: 'ko',
    cacheKey: 'b'.repeat(64),
    objectKey: NEW_KEY,
    outputFormat: 'mp3',
    displayText: '약 먹을 시간이에요.',
    synthesisText: '약 먹을 시간이에요.',
    deliveryTagsJson: '[]',
    ...overrides,
  };
}

describe('replaceStockClipInPlace — 같은 message_id 에 소리만 바꾼다', () => {
  it('행·원장·삭제 큐를 한 번에 바꾼다 — id 는 그대로다', async () => {
    const { db, cleanup } = await setupDb();
    try {
      expect(await replaceStockClipInPlace(db, replacement())).toBe('replaced');

      const message = (await db.execute('SELECT * FROM messages')).rows;
      expect(message).toHaveLength(1);
      expect(message[0]).toMatchObject({
        id: 'm1',
        audio_url: `r2://${NEW_KEY}`,
        synthesis_text: '약 먹을 시간이에요.',
        text: '약 먹을 시간이에요.',
        delivery_tags_json: '[]',
      });

      const ledger = (await db.execute('SELECT message_id, model_id, audio_object_key FROM generated_audio_assets ORDER BY model_id')).rows;
      // 옛 원장 행은 남는다(드레인이 `messages.audio_url` 만 보고 옛 오브젝트를 지운다).
      expect(ledger.map((r) => r.model_id)).toEqual(['eleven_v3', 'eleven_v4_turbo']);
      expect(ledger[1]).toMatchObject({ message_id: 'm1', audio_object_key: NEW_KEY });

      const queue = (await db.execute('SELECT ref FROM pending_external_deletions')).rows.map((r) => r.ref);
      expect(queue).toEqual([OLD_KEY]);
    } finally {
      cleanup();
    }
  });

  it('그 사이 다른 게시가 바꿨으면(비교 후 교체 실패) 아무것도 쓰지 않는다', async () => {
    const { db, cleanup } = await setupDb();
    try {
      await db.execute(`UPDATE messages SET audio_url = 'r2://someone-else.mp3' WHERE id = 'm1'`);
      expect(await replaceStockClipInPlace(db, replacement())).toBe('conflict');
      expect((await db.execute('SELECT audio_url FROM messages')).rows[0]!.audio_url).toBe('r2://someone-else.mp3');
      expect((await db.execute('SELECT COUNT(*) AS n FROM generated_audio_assets')).rows[0]!.n).toBe(1);
      expect((await db.execute('SELECT ref FROM pending_external_deletions')).rows.map((r) => r.ref)).toEqual([NEW_KEY]);
    } finally {
      cleanup();
    }
  });

  it('은퇴한 행은 바꾸지 않는다 — 옛 알람의 소리로 남겨 둔 것이다', async () => {
    const { db, cleanup } = await setupDb();
    try {
      await db.execute(`UPDATE messages SET retired_at = '2026-09-03 00:00:00' WHERE id = 'm1'`);
      expect(await replaceStockClipInPlace(db, replacement())).toBe('conflict');
      expect((await db.execute('SELECT audio_url FROM messages')).rows[0]!.audio_url).toBe(`r2://${OLD_KEY}`);
    } finally {
      cleanup();
    }
  });

  it('같은 해시를 다른 오브젝트가 쥐고 있으면 멈춘다 — 메시지·원장·삭제 큐 모두 그대로(Codex #840)', async () => {
    const { db, cleanup } = await setupDb();
    try {
      // 배포 뒤 게시 전에 누군가 같은 기본 목소리로 같은 문장을 만들었다 — 해시는 같고 오브젝트 키(주인)는 다르다.
      const userKey = `generated-tts/80000000-0000-4000-9000-000000000001/${'b'.repeat(64)}.mp3`;
      await db.execute({
        sql: `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                model_id, language, request_hash, text, audio_url, audio_object_key, audio_format)
              VALUES ('ga-user', '80000000-0000-4000-9000-000000000001', ?, NULL, 'elevenlabs', 'el-mina',
                'eleven_v4_turbo', 'ko', ?, '약 먹을 시간이에요.', ?, ?, 'mp3')`,
        args: [VOICE, 'b'.repeat(64), `r2://${userKey}`, userKey],
      });

      expect(await ledgerAudioUrlFor(db, 'b'.repeat(64))).toBe(`r2://${userKey}`);
      expect(await replaceStockClipInPlace(db, replacement())).toBe('hash-taken');

      expect((await db.execute('SELECT audio_url FROM messages')).rows[0]!.audio_url).toBe(`r2://${OLD_KEY}`);
      const ledger = (await db.execute('SELECT id FROM generated_audio_assets ORDER BY id')).rows.map((r) => r.id);
      expect(ledger).toEqual(['ga-old', 'ga-user']);
      expect((await db.execute('SELECT ref FROM pending_external_deletions')).rows.map((r) => r.ref)).toEqual([NEW_KEY]);
    } finally {
      cleanup();
    }
  });

  it('같은 해시·같은 오브젝트의 원장 행이 있으면 그 행을 쓴다 — 새 행을 만들지 않는다', async () => {
    const { db, cleanup } = await setupDb();
    try {
      // 같은 문장을 나눠 쓰는 다른 프리셋이 먼저 교체돼 원장 행을 남겼다.
      await db.execute({
        sql: `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                model_id, language, request_hash, text, audio_url, audio_object_key, audio_format)
              VALUES ('ga-sibling', ?, ?, 'm0', 'elevenlabs', 'el-mina', 'eleven_v4_turbo', 'ko', ?,
                '약 먹을 시간이에요.', ?, ?, 'mp3')`,
        args: [OWNER, VOICE, 'b'.repeat(64), `r2://${NEW_KEY}`, NEW_KEY],
      });
      expect(await replaceStockClipInPlace(db, replacement())).toBe('replaced');
      expect((await db.execute('SELECT audio_url FROM messages')).rows[0]!.audio_url).toBe(`r2://${NEW_KEY}`);
      expect((await db.execute('SELECT COUNT(*) AS n FROM generated_audio_assets')).rows[0]!.n).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('원장 조회 — 행이 없으면 null', async () => {
    const { db, cleanup } = await setupDb();
    try {
      expect(await ledgerAudioUrlFor(db, 'c'.repeat(64))).toBeNull();
      expect(await ledgerAudioUrlFor(db, 'a'.repeat(64))).toBe(`r2://${OLD_KEY}`);
    } finally {
      cleanup();
    }
  });

  it('두 번 돌려도 한 번만 바뀐다 — 두 번째는 비교 후 교체에서 멈춘다', async () => {
    const { db, cleanup } = await setupDb();
    try {
      expect(await replaceStockClipInPlace(db, replacement())).toBe('replaced');
      expect(await replaceStockClipInPlace(db, replacement())).toBe('conflict');
      expect((await db.execute('SELECT COUNT(*) AS n FROM generated_audio_assets')).rows[0]!.n).toBe(2);
    } finally {
      cleanup();
    }
  });
});
