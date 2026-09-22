// **실패한 클립이 무엇이었는지 로그에 남아야 한다** — 회귀 방지(ALARMTALK-BACKEND-9).
//
// `runPrerenderBatch` 는 클립 1건이 실패해도 나머지를 계속 굽는다(그 격리는 이미 정상이고
// 여기서 바꾸지 않는다 — 아래 첫 테스트가 그대로 고정한다). 문제는 관측 쪽이었다:
// `onClipError` 가 **에러 하나만** 넘겨서, Sentry 에 줄이 떠도 어느 목소리의 어느
// 카테고리·몇 번째 문구였는지 알 길이 없었다. 실제로 그 때문에 사고 1건의 대상을 끝내
// 특정하지 못했다.
//
// 그리고 원인 갈래(내용 위반 vs 전송 실패)도 함께 넘긴다. 둘은 **봐야 할 곳이 정반대**다 —
// 전자는 프롬프트·가드, 후자는 상류·쿼터·자격증명이다.
//
// ⚠ 식별자만 넘긴다. 낭독 문구·seed 원문은 개인 목소리 콘텐츠라 관측 파이프라인에
//   올리지 않는다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 몇 번째 클립에서 문구 생성이 실패할지 + 무엇으로 실패할지. */
let failOnCall: number | null = null;
let failWith: (() => Error) | null = null;
let generateCalls = 0;

vi.mock('../src/lib/r2-storage', () => ({
  R2VoiceStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.storeAtKey = vi.fn().mockResolvedValue(undefined);
    this.delete = vi.fn().mockResolvedValue(undefined);
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
      synthesize: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/mpeg',
        outputFormat: 'mp3',
        provider: 'elevenlabs',
        providerVoiceId: profile.elevenlabs_voice_id,
        modelId: 'test-model',
      }),
    },
  ],
}));

// 문구 생성만 바꿔 끼운다 — `alarmTextRejectionReasonOf` 와 에러 클래스는 원본 그대로라
// `instanceof` 판정이 실제 코드와 같은 물건을 본다.
vi.mock('../src/lib/vertex-translate', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/vertex-translate')>();
  return {
    ...original,
    generatePrerenderClipText: async () => {
      generateCalls += 1;
      if (failOnCall !== null && generateCalls === failOnCall) throw failWith!();
      // 회차마다 다른 문구 — 같은 글자면 캐시 키가 겹쳐 두 클립이 한 R2 오브젝트를 공유한다.
      return { text: `[cheerfully] 좋은 아침이에요. 잘 잤어요? 오늘도 ${generateCalls}`, tag: 'cheerfully' };
    },
  };
});

import { runPrerenderBatch, type PrerenderClipFailure } from '../src/lib/stock-clips';
import { AlarmTextPreparationInvalidError } from '../src/lib/vertex-translate';

const ENV = { VOICE_BUCKET: {}, ELEVENLABS_API_KEY: 'k' } as never;

/** 클론 1개가 큐에 pending 으로 올라와 있고, 민감 동의는 살아 있는 상태. */
async function prerenderDb(): Promise<{ db: Client; path: string }> {
  // ⚠ `:memory:` 는 커넥션마다 **다른 빈 DB** 라 쓰기 트랜잭션이 테이블을 못 본다
  // (`stock-clips-superseded.test.ts` 와 같은 이유로 파일 DB 를 쓴다).
  const path = join(tmpdir(), `alarmtalk-clip-error-${crypto.randomUUID()}.db`);
  const db = createClient({ url: `file:${path}` });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, elevenlabs_voice_id TEXT,
      status TEXT DEFAULT 'ready', is_system INTEGER DEFAULT 0, is_draft INTEGER DEFAULT 0,
      relationship_label TEXT DEFAULT '', listener_title TEXT DEFAULT '',
      preview_text TEXT, speech_style TEXT, deleted_at TEXT
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
      VALUES ('vp1', 'u1', '엄마 목소리', 'eleven-1');
    INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, status)
      VALUES ('vp1', 'u1', 'pending');
    INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
      VALUES ('c1','u1','voice_biometric','5',1), ('c2','u1','overseas_transfer','5',1);
  `);
  return { db, path };
}

function cleanup(db: Client, path: string) {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
}

describe('사전렌더 배치 — 클립 1건이 실패하면', () => {
  beforeEach(() => {
    generateCalls = 0;
    failOnCall = null;
    failWith = null;
  });

  it('나머지를 계속 굽고, 실패한 대상의 식별자와 원인 갈래를 관측자에게 넘긴다', async () => {
    const { db, path } = await prerenderDb();
    try {
      // 첫 대상은 `greeting` variant 0 이다 — `sortTargetsByFirstUse` 가 먼저 쓸 것부터
      // 정렬하므로(인사말 → 약 → 날씨 …) 실패 대상이 결정적이다.
      failOnCall = 1;
      failWith = () => new AlarmTextPreparationInvalidError('too_long');

      const failures: PrerenderClipFailure[] = [];
      const result = await runPrerenderBatch(db as never, ENV, {
        maxClips: 3,
        maxVoices: 1,
        onClipError: (_err, failure) => failures.push(failure),
      });

      // (b) 격리 — 1건이 실패해도 같은 목소리의 나머지 2건은 그대로 구워진다.
      // ⚠ `rendered` 는 **시도 수**다. 성공 시점으로 옮기지 말 것 — 결정적 실패 1건이
      //    틱을 통째로 먹는다(의도된 설계다).
      expect(result.claimed).toBe(1);
      expect(result.rendered).toBe(3);
      const published = await db.execute(
        "SELECT category, variant FROM messages WHERE COALESCE(is_preset,0) = 1 ORDER BY category, variant",
      );
      expect(published.rows.length, '한 건 실패가 배치 나머지를 막았다').toBe(2);
      expect(published.rows.every((row) => String(row.category) !== 'greeting')).toBe(true);

      // (c) 식별자 — 예전에는 에러 하나만 넘어와 `failure` 가 통째로 없었다.
      expect(failures.length).toBe(1);
      expect(failures[0]).toEqual({
        voiceProfileId: 'vp1',
        category: 'greeting',
        variant: 0,
        language: 'ko',
        reason: 'too_long',
      });

      // 진전이 있었으므로 임대만 반납하고 pending 을 유지한다 — 다음 틱이 이어받는다.
      const queue = await db.execute(
        "SELECT status, claim_token, attempts FROM voice_prerender_queue WHERE voice_profile_id = 'vp1'",
      );
      expect(String(queue.rows[0]!.status)).toBe('pending');
      expect(queue.rows[0]!.claim_token).toBeNull();
      expect(Number(queue.rows[0]!.attempts), '진전이 있으면 attempts 를 올리지 않는다').toBe(0);
    } finally {
      cleanup(db, path);
    }
  });

  it('전송 실패는 내용 위반과 다른 갈래로 넘어간다', async () => {
    const { db, path } = await prerenderDb();
    try {
      failOnCall = 1;
      // 상류가 죽은 경우 — `generatePrerenderClipText` 가 원본 에러를 그대로 올린다.
      failWith = () => new Error('Vertex upstream unreachable (503)');

      const failures: PrerenderClipFailure[] = [];
      await runPrerenderBatch(db as never, ENV, {
        maxClips: 2,
        maxVoices: 1,
        onClipError: (_err, failure) => failures.push(failure),
      });

      expect(failures.length).toBe(1);
      // 내용 위반이 아니므로 사유가 없다 — cron 은 이걸 보고 `transport` 태그를 붙인다.
      expect(failures[0]!.reason).toBeNull();
      expect(failures[0]!.category).toBe('greeting');
    } finally {
      cleanup(db, path);
    }
  });
});
