// 사전렌더가 **클론의 등록 높이를 모든 클립에 굽는다**(스펙 voice-and-message §4-3) — 그리고 높이를 굽는 클립은 한
// 틱의 몫을 둘로 센다. 높이 바꾸기(PSOLA)는 합성보다 무겁고, 크론 한 틱의 CPU 한도(30초)를 다른 일과 나눠 쓴다. 한도를
// 넘기면 워커가 통째로 죽어(1102) 실패 기록조차 남지 않는다. 음량 올리기(§10)·MP3 만들기는 모든 클립이 거치지만
// 가벼워(오디오 1초당 ≈4 ms — 잰 값과 몫 셈은 §4-3 「굽는 길」) 높이 없는 클립은 몫 1 그대로다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoicePitch } from '../src/lib/voice-pitch';

/** 사전렌더가 합성에 넘긴 높이 — 클립마다 한 줄. */
const pitchesSeen: Array<VoicePitch | null | undefined> = [];

vi.mock('../src/lib/r2-storage', () => ({
  R2VoiceStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.storeAtKey = vi.fn().mockResolvedValue(undefined);
    this.delete = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../src/lib/voice-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/voice-provider')>()),
  createSynthesisAttempts: ({
    profile,
    pitch,
  }: {
    profile: { elevenlabs_voice_id: string };
    pitch?: VoicePitch | null;
  }) => {
    pitchesSeen.push(pitch);
    return [
      {
        provider: 'elevenlabs',
        providerVoiceId: profile.elevenlabs_voice_id,
        modelId: 'eleven_v4_turbo',
        outputFormat: 'mp3',
        pitchSemitones: pitch?.semitones ?? 0,
        synthesize: async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/mpeg',
          outputFormat: 'mp3',
          provider: 'elevenlabs',
          providerVoiceId: profile.elevenlabs_voice_id,
          modelId: 'eleven_v4_turbo',
        }),
      },
    ];
  },
}));

let generateCalls = 0;
vi.mock('../src/lib/vertex-translate', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/vertex-translate')>();
  return {
    ...original,
    generatePrerenderClipText: async () => {
      generateCalls += 1;
      return { text: `좋은 아침이에요. 잘 잤어요? 오늘도 ${generateCalls}` };
    },
  };
});

import { runPrerenderBatch } from '../src/lib/stock-clips';

const ENV = { VOICE_BUCKET: {}, ELEVENLABS_API_KEY: 'k' } as never;

async function prerenderDb(pitch: { semitones: number; modelId: string } | null): Promise<{ db: Client; path: string }> {
  // ⚠ `:memory:` 는 커넥션마다 다른 빈 DB 라 쓰기 트랜잭션이 테이블을 못 본다 — 파일 DB 를 쓴다.
  const path = join(tmpdir(), `alarmtalk-prerender-pitch-${crypto.randomUUID()}.db`);
  const db = createClient({ url: `file:${path}` });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, elevenlabs_voice_id TEXT,
      status TEXT DEFAULT 'ready', is_system INTEGER DEFAULT 0, is_draft INTEGER DEFAULT 0,
      relationship_label TEXT DEFAULT '', listener_title TEXT DEFAULT '',
      preview_text TEXT, speech_style TEXT, voice_energy TEXT, speech_style_status TEXT,
      pitch_semitones REAL, pitch_model_id TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, voice_profile_id TEXT NOT NULL,
      text TEXT, synthesis_text TEXT, delivery_tags_json TEXT, category TEXT, language TEXT,
      variant INTEGER DEFAULT 0, is_preset INTEGER DEFAULT 0, audio_url TEXT, retired_at TEXT
    );
    CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, language TEXT DEFAULT 'ko',
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT, claim_token TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT, refresh_existing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE generated_audio_assets (
      id TEXT PRIMARY KEY, user_id TEXT, voice_profile_id TEXT, message_id TEXT,
      provider TEXT, provider_voice_id TEXT, model_id TEXT, language TEXT,
      request_hash TEXT UNIQUE, text TEXT, audio_url TEXT, audio_object_key TEXT,
      audio_format TEXT, mime_type TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE user_consents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, consent_type TEXT NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '5', agreed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE pending_external_deletions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT,
      UNIQUE(kind, ref)
    );
    INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, status)
      VALUES ('vp1', 'u1', 'pending');
    INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
      VALUES ('c1','u1','voice_biometric','5',1), ('c2','u1','overseas_transfer','5',1);
  `);
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, pitch_semitones, pitch_model_id)
          VALUES ('vp1', 'u1', '엄마 목소리', 'eleven-1', ?, ?)`,
    args: [pitch?.semitones ?? null, pitch?.modelId ?? null],
  });
  return { db, path };
}

function cleanup(db: Client, path: string) {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
}

describe('사전렌더 — 목소리 높이', () => {
  beforeEach(() => {
    pitchesSeen.length = 0;
    generateCalls = 0;
  });

  it('등록 높이를 모든 클립의 합성에 넘기고, 굽는 클립은 한 틱 몫을 둘로 센다', async () => {
    const { db, path } = await prerenderDb({ semitones: -1.5, modelId: 'eleven_v4_turbo' });
    try {
      const result = await runPrerenderBatch(db as never, ENV, { maxClips: 4, maxVoices: 1 });
      expect(result.claimed).toBe(1);
      // 몫 4 = 굽는 클립 2개.
      expect(result.rendered).toBe(2);
      expect(pitchesSeen).toHaveLength(2);
      expect(pitchesSeen.every((p) => p?.semitones === -1.5 && p.modelId === 'eleven_v4_turbo')).toBe(true);
      const published = await db.execute('SELECT COUNT(*) AS n FROM messages WHERE COALESCE(is_preset,0) = 1');
      expect(Number(published.rows[0]!.n)).toBe(2);
    } finally {
      cleanup(db, path);
    }
  });

  it('높이가 없는 목소리는 예전처럼 몫만큼 만든다(음량만 굽는 클립은 몫 1)', async () => {
    const { db, path } = await prerenderDb(null);
    try {
      const result = await runPrerenderBatch(db as never, ENV, { maxClips: 4, maxVoices: 1 });
      expect(result.rendered).toBe(4);
      expect(pitchesSeen).toHaveLength(4);
      expect(pitchesSeen.every((p) => p === null)).toBe(true);
    } finally {
      cleanup(db, path);
    }
  });

  it('등록 때와 모델이 다르면 굽지 않으므로 몫도 하나로 센다', async () => {
    const { db, path } = await prerenderDb({ semitones: -1.5, modelId: 'eleven_v3' });
    try {
      const result = await runPrerenderBatch(db as never, ENV, { maxClips: 4, maxVoices: 1 });
      expect(result.rendered).toBe(4);
    } finally {
      cleanup(db, path);
    }
  });

  // 한 틱에 여럿을 잡으면 **잡은 순서**(새 등록 먼저)로 몫을 쓴다 — 조회 순서(id 순)로 돌면 id 가 작은 다시 굽는
  // 회차가 몫을 다 쓰고 새 등록은 진전 없이 반납된다.
  it('새 등록이 다시 굽는 회차보다 먼저 몫을 쓴다', async () => {
    const { db, path } = await prerenderDb(null);
    try {
      await db.execute(`INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id) VALUES ('vp0', 'u1', '교체', 'eleven-0')`);
      await db.execute(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, status, refresh_existing, requested_at)
                        VALUES ('vp0', 'u1', 'pending', 1, datetime('now', '-1 hour'))`);
      const result = await runPrerenderBatch(db as never, ENV, { maxClips: 2, maxVoices: 2 });
      expect(result.claimed).toBe(2);
      const published = await db.execute(
        'SELECT voice_profile_id, COUNT(*) AS n FROM messages WHERE COALESCE(is_preset,0) = 1 GROUP BY voice_profile_id',
      );
      expect(published.rows.map((r) => [String(r.voice_profile_id), Number(r.n)])).toEqual([['vp1', 2]]);
      const queue = await db.execute(
        "SELECT status, claim_token, attempts FROM voice_prerender_queue WHERE voice_profile_id = 'vp0'",
      );
      // 몫이 없어 손대지 않은 회차는 임대만 반납한다(실패로 세지 않는다).
      expect(String(queue.rows[0]!.status)).toBe('pending');
      expect(queue.rows[0]!.claim_token).toBeNull();
      expect(Number(queue.rows[0]!.attempts)).toBe(0);
    } finally {
      cleanup(db, path);
    }
  });

  it('높이를 굽는 클립과 원래 클립은 원장 키가 다르다', async () => {
    const tuned = await prerenderDb({ semitones: -1.5, modelId: 'eleven_v4_turbo' });
    const plain = await prerenderDb(null);
    try {
      await runPrerenderBatch(tuned.db as never, ENV, { maxClips: 2, maxVoices: 1 });
      generateCalls = 0; // 같은 문구로 굽게 한다
      await runPrerenderBatch(plain.db as never, ENV, { maxClips: 1, maxVoices: 1 });
      const tunedHash = await tuned.db.execute('SELECT request_hash FROM generated_audio_assets');
      const plainHash = await plain.db.execute('SELECT request_hash FROM generated_audio_assets');
      expect(tunedHash.rows).toHaveLength(1);
      expect(plainHash.rows).toHaveLength(1);
      expect(String(tunedHash.rows[0]!.request_hash)).not.toBe(String(plainHash.rows[0]!.request_hash));
    } finally {
      cleanup(tuned.db, tuned.path);
      cleanup(plain.db, plain.path);
    }
  });
});
