// **낡은 재렌더는 게시하지 않는다** — 회귀 방지(Codex #703 P1).
//
// 목소리 교체는 preset 행을 **덮어쓴다**(`refresh_existing`). 그런데 마지막 인가 검사
// (합성 직후)와 실제 커밋 사이에는 R2 업로드가 통째로 들어간다. 그 창에서 교체가 한 번 더
// 일어나면 큐가 리셋되고(claim_token = NULL → 새 워커가 새 토큰으로 재클레임) 프로필의
// provider 보이스가 갈리는데, 앞선 워커는 그것을 모른 채 **옛 목소리**를 게시했다.
// 조건부 INSERT 에 붙은 claim 가드는 교체 회차에서 언제나 0행이라(같은 preset 이 이미
// 있다) 아무것도 막지 못했고, 덮어쓰기 UPDATE 에는 가드가 아예 없었다.
//
// 그 결과: 새 목소리로 만든 클립이 옛 목소리로 덮이고, 뒤이은 정리가 **방금 게시된 새 R2
// 오브젝트**를 지우며, 큐는 이미 done 이라 다시 만들 길이 없다(`enqueuePrerender` 는
// ON CONFLICT DO NOTHING, 재시도 경로는 status='failed' 만 되살린다).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deletedKeys: string[] = [];
/**
 * **마지막 인가 검사와 커밋 사이**에 세상이 바뀌는 것을 재현하는 훅.
 * 그 사이에 있는 것은 R2 업로드뿐이라 업로드 시점에 건다 — 합성 직후에 걸면
 * `assertCloneAuthorization` 이 먼저 잡아 이 창을 재현하지 못한다.
 */
let duringUpload: (() => Promise<void>) | null = null;

vi.mock('../src/lib/r2-storage', () => ({
  R2VoiceStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.storeAtKey = vi.fn().mockImplementation(async () => {
      await duringUpload?.();
    });
    this.delete = vi.fn().mockImplementation(async (key: string) => {
      deletedKeys.push(key);
    });
  }),
}));

vi.mock('../src/lib/voice-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/voice-provider')>()),
  createSynthesisAttempts: ({ profile }: { profile: { elevenlabs_voice_id: string } }) => [
    {
      provider: 'elevenlabs',
      providerVoiceId: profile.elevenlabs_voice_id,
      modelId: 'test-model',
      outputFormat: 'mp3',
      synthesize: async () => {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/mpeg',
          outputFormat: 'mp3',
          provider: 'elevenlabs',
          providerVoiceId: profile.elevenlabs_voice_id,
          modelId: 'test-model',
        };
      },
    },
  ],
}));

vi.mock('../src/lib/vertex-translate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/vertex-translate')>()),
  generatePrerenderClipText: async () => ({ text: '옛 목소리 문구', tags: [] }),
}));

import { generateStockClip, PrerenderSupersededError } from '../src/lib/stock-clips';

const ENV = { VOICE_BUCKET: {}, ELEVENLABS_API_KEY: 'k' } as never;

/** 앞선(곧 낡을) 워커가 클레임을 쥔 상태. 합성 전에는 **정상 인가**다. */
async function prerenderDb(): Promise<{ db: Client; path: string }> {
  // ⚠ `:memory:` 는 커넥션마다 **다른 빈 DB** 라 쓰기 트랜잭션이 테이블을 못 본다.
  // `voice-replace-in-place.test.ts` 와 같은 이유로 파일 DB 를 쓴다.
  const path = join(tmpdir(), `alarmtalk-superseded-${crypto.randomUUID()}.db`);
  const db = createClient({ url: `file:${path}` });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, elevenlabs_voice_id TEXT,
      status TEXT DEFAULT 'ready', is_system INTEGER DEFAULT 0, is_draft INTEGER DEFAULT 0,
      deleted_at TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, voice_profile_id TEXT NOT NULL,
      text TEXT, synthesis_text TEXT, delivery_tags_json TEXT, category TEXT, language TEXT,
      variant INTEGER DEFAULT 0, is_preset INTEGER DEFAULT 0, audio_url TEXT
    );
    CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, language TEXT DEFAULT 'ko',
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT, claim_token TEXT, updated_at TEXT, refresh_existing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE generated_audio_assets (
      id TEXT PRIMARY KEY, user_id TEXT, voice_profile_id TEXT, message_id TEXT,
      provider TEXT, provider_voice_id TEXT, model_id TEXT, language TEXT,
      request_hash TEXT UNIQUE, text TEXT, audio_url TEXT, audio_object_key TEXT,
      audio_format TEXT, mime_type TEXT
    );
    CREATE TABLE user_consents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, consent_type TEXT NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '5', agreed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE pending_external_deletions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT
    );
    INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id)
      VALUES ('vp1', 'u1', '엄마 목소리', 'eleven-OLD');
    INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
      VALUES ('m1', 'u1', 'vp1', '옛 클립', 'greeting', 'ko', 0, 1, 'r2://old-object');
    INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, status, claim_token, refresh_existing)
      VALUES ('vp1', 'u1', 'pending', 'TOKEN-1', 1);
    INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
      VALUES ('c1','u1','voice_biometric','5',1), ('c2','u1','overseas_transfer','5',1);
  `);
  return { db, path };
}

function cleanup(db: Client, path: string) {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
}

/** 앞선 워커의 대상 — 자기가 클레임한 토큰과 그때의 provider 보이스를 들고 있다. */
const inFlightTarget = {
  voiceProfileId: 'vp1',
  ownerUserId: 'u1',
  voiceName: '엄마 목소리',
  elevenlabsVoiceId: 'eleven-OLD',
  category: 'greeting',
  language: 'ko',
  variantIndex: 0,
  baseText: '좋은 아침',
  toneAdapt: true,
  claimToken: 'TOKEN-1',
  refreshExisting: true,
} as never;

describe('사전렌더 — 렌더 중에 교체가 한 번 더 일어나면', () => {
  beforeEach(() => {
    deletedKeys.length = 0;
    duringUpload = null;
  });

  it('낡은 렌더는 게시하지 않고 자기 오브젝트만 치운다', async () => {
    const { db, path } = await prerenderDb();
    try {
      // 두 번째 교체가 커밋된다: 큐 리셋 → 새 워커가 재클레임하고 새 목소리로 게시까지 끝냈다.
      duringUpload = async () => {
        await db.execute("UPDATE voice_profiles SET elevenlabs_voice_id = 'eleven-NEW' WHERE id = 'vp1'");
        await db.execute("UPDATE voice_prerender_queue SET claim_token = 'TOKEN-2' WHERE voice_profile_id = 'vp1'");
        await db.execute("UPDATE messages SET text = '새 클립', audio_url = 'r2://new-object' WHERE id = 'm1'");
      };

      await expect(generateStockClip(db as never, ENV, inFlightTarget)).rejects.toBeInstanceOf(
        PrerenderSupersededError,
      );

      const message = await db.execute("SELECT text, audio_url FROM messages WHERE id = 'm1'");
      expect(
        String(message.rows[0]!.audio_url),
        '낡은 렌더가 새 목소리 클립을 덮어썼다',
      ).toBe('r2://new-object');
      expect(String(message.rows[0]!.text)).toBe('새 클립');

      const assets = await db.execute('SELECT COUNT(*) AS n FROM generated_audio_assets');
      expect(Number(assets.rows[0]!.n), '낡은 렌더가 오디오 대장에 남았다').toBe(0);

      expect(
        deletedKeys.some((key) => key.includes('new-object')),
        '낡은 렌더가 **새 렌더의** R2 오브젝트를 지웠다',
      ).toBe(false);
      expect(deletedKeys.length, '자기가 올린 오브젝트는 치워야 한다').toBe(1);

      const queue = await db.execute(
        "SELECT status, claim_token FROM voice_prerender_queue WHERE voice_profile_id = 'vp1'",
      );
      expect(String(queue.rows[0]!.status), '큐를 done 으로 끝내면 새 회차가 영영 안 돈다').toBe('pending');
      expect(String(queue.rows[0]!.claim_token)).toBe('TOKEN-2');
    } finally {
      cleanup(db, path);
    }
  });

  it('클레임이 그대로여도 provider 보이스가 갈렸으면 게시하지 않는다', async () => {
    const { db, path } = await prerenderDb();
    try {
      // LRU 회수 뒤 복구(`voice-recover.ts`)는 큐를 건드리지 않고 보이스만 갈아 끼운다 —
      // 토큰은 여전히 내 것이라 클레임만 보는 가드로는 못 잡는다.
      duringUpload = async () => {
        await db.execute("UPDATE voice_profiles SET elevenlabs_voice_id = 'eleven-NEW' WHERE id = 'vp1'");
      };

      await expect(generateStockClip(db as never, ENV, inFlightTarget)).rejects.toBeInstanceOf(
        PrerenderSupersededError,
      );
      const message = await db.execute("SELECT audio_url FROM messages WHERE id = 'm1'");
      expect(String(message.rows[0]!.audio_url)).toBe('r2://old-object');
    } finally {
      cleanup(db, path);
    }
  });

  it('아무것도 안 바뀌었으면 정상적으로 덮어쓰고 옛 오브젝트를 정리한다', async () => {
    const { db, path } = await prerenderDb();
    try {
      const result = await generateStockClip(db as never, ENV, inFlightTarget);

      expect(result.message_id, '알람이 가리키는 message id 는 바뀌면 안 된다').toBe('m1');
      const message = await db.execute("SELECT audio_url FROM messages WHERE id = 'm1'");
      expect(String(message.rows[0]!.audio_url)).not.toBe('r2://old-object');
      expect(deletedKeys, '밀려난 옛 오브젝트는 커밋 뒤에 정리한다').toEqual(['old-object']);
    } finally {
      cleanup(db, path);
    }
  });
});
