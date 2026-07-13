import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import {
  findMissingStockTargets,
  listReadyCloneVoices,
  enqueuePrerender,
  claimPendingPrerenderVoices,
  releasePrerenderClaim,
  markPrerenderDone,
  markPrerenderFailed,
  CLONE_PRERENDER_CATEGORIES,
  CLONE_CLIP_SEEDS,
  type PrerenderVoice,
} from '../src/lib/stock-clips';

// 클론이 앱 언어 1개로 렌더하는 총 클립 수 = 모든 seed 개수 합(greeting+weather+fortune+love+medication).
const CLONE_TOTAL_SEEDS = CLONE_CLIP_SEEDS.reduce((n, s) => n + s.seeds.length, 0);

// 실제 libSQL(인메모리)로 사전렌더 큐/스코프 로직을 검증한다(외부 TTS 호출 없는 DB 계층만).
async function setupDb() {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      elevenlabs_voice_id TEXT,
      status TEXT DEFAULT 'processing',
      is_system INTEGER DEFAULT 0,
      is_draft INTEGER DEFAULT 0,
      relationship_label TEXT DEFAULT '',
      listener_title TEXT DEFAULT '',
      deleted_at TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      voice_profile_id TEXT NOT NULL,
      text TEXT,
      category TEXT,
      language TEXT,
      variant INTEGER DEFAULT 0,
      is_preset INTEGER DEFAULT 0,
      audio_url TEXT
    );
    CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ko',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

async function insertVoice(
  db: Awaited<ReturnType<typeof setupDb>>,
  v: {
    id: string;
    userId?: string;
    voiceId?: string | null;
    status?: string;
    isSystem?: boolean;
    isDraft?: boolean;
    deletedAt?: string | null;
  },
) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_system, is_draft, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      v.id,
      v.userId ?? 'owner-1',
      v.id,
      v.voiceId ?? 'el_' + v.id,
      v.status ?? 'ready',
      v.isSystem ? 1 : 0,
      v.isDraft ? 1 : 0,
      v.deletedAt ?? null,
    ],
  });
}

describe('listReadyCloneVoices', () => {
  it('ready·비시스템·비draft 클론만, ownerUserId·languageOverride 를 실어 반환한다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });
    await insertVoice(db, { id: 'clone-draft', isDraft: true });
    await insertVoice(db, { id: 'clone-processing', status: 'processing' });
    await insertVoice(db, { id: 'clone-deleted', deletedAt: '2026-01-01T00:00:00Z' });
    await insertVoice(db, { id: 'sys-voice', isSystem: true });

    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: 'clone-ready', ownerUserId: 'owner-1', language: 'en' },
      { voiceProfileId: 'clone-draft', ownerUserId: 'owner-1', language: 'ko' },
      { voiceProfileId: 'clone-processing', ownerUserId: 'owner-1', language: 'ko' },
      { voiceProfileId: 'clone-deleted', ownerUserId: 'owner-1', language: 'ko' },
      { voiceProfileId: 'sys-voice', ownerUserId: 'owner-1', language: 'ko' },
    ]);

    expect(voices.map((v) => v.id)).toEqual(['clone-ready']);
    expect(voices[0]!.ownerUserId).toBe('owner-1');
    expect(voices[0]!.languageOverride).toBe('en');
    expect(voices[0]!.categories).toEqual(CLONE_PRERENDER_CATEGORIES);
  });

  it('빈 요청은 빈 배열(전유저 스캔 방지)', async () => {
    const db = await setupDb();
    expect(await listReadyCloneVoices(db, [])).toEqual([]);
  });
});

describe('findMissingStockTargets (클론 톤 적응 스코프)', () => {
  const cloneVoice = (over: Partial<PrerenderVoice> = {}): PrerenderVoice => ({
    id: 'clone-ready',
    name: 'clone-ready',
    elevenlabsVoiceId: 'el_clone-ready',
    ownerUserId: 'owner-1',
    categories: CLONE_PRERENDER_CATEGORIES,
    languageOverride: 'ko',
    isClone: true,
    relationshipLabel: '할머니',
    listenerTitle: '규원아',
    ...over,
  });

  it('클론은 CLONE_CLIP_SEEDS 전량을 앱 언어 1개로, toneAdapt·관계/호칭·소유자를 실어 생성', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });

    const targets = await findMissingStockTargets(db, [cloneVoice()]);

    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS);
    expect(new Set(targets.map((t) => t.category))).toEqual(
      new Set(['greeting', 'weather', 'fortune', 'love', 'medication']),
    );
    // languageOverride='ko' → 앱 언어 1개만(비용 곱연산 회피).
    expect(new Set(targets.map((t) => t.language))).toEqual(new Set(['ko']));
    // 클론은 전부 톤 적응 + 관계/호칭 전달 + 실소유자.
    expect(targets.every((t) => t.toneAdapt === true)).toBe(true);
    expect(targets.every((t) => t.relationshipLabel === '할머니' && t.listenerTitle === '규원아')).toBe(
      true,
    );
    expect(targets.every((t) => t.ownerUserId === 'owner-1')).toBe(true);
    expect(targets.every((t) => t.voiceProfileId === 'clone-ready')).toBe(true);
    // baseText 는 최종 문구가 아니라 생성 seed(지시문).
    expect(targets.find((t) => t.category === 'weather')?.baseText).toContain('알리');
  });

  it('languageOverride 를 en 으로 주면 en 으로만 대상 생성', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });
    const targets = await findMissingStockTargets(db, [cloneVoice({ languageOverride: 'en' })]);
    expect(new Set(targets.map((t) => t.language))).toEqual(new Set(['en']));
    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS);
  });

  it('이미 렌더된 (보이스·카테고리·언어·변형) 조합은 seen 으로 건너뛴다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, category, language, variant, is_preset, audio_url)
            VALUES ('m1', 'owner-1', 'clone-ready', 'weather', 'ko', 0, 1, 'r2://x')`,
      args: [],
    });
    const targets = await findMissingStockTargets(db, [cloneVoice()]);
    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS - 1);
    expect(targets.find((t) => t.category === 'weather' && t.variantIndex === 0)).toBeUndefined();
  });

  it('다른 보이스의 기존 클립은 이 보이스 스코프에 영향 없음(전유저 스캔 아님)', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, category, language, variant, is_preset, audio_url)
            VALUES ('m2', 'owner-2', 'other-voice', 'weather', 'ko', 0, 1, 'r2://y')`,
      args: [],
    });
    const targets = await findMissingStockTargets(db, [cloneVoice()]);
    // 다른 보이스 클립은 seen 에 안 잡혀야 함 → 여전히 전량 대상.
    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS);
  });

  it('listReadyCloneVoices 로 만든 클론 보이스는 isClone·관계/호칭이 실려 톤 적응 대상이 된다', async () => {
    const db = await setupDb();
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_system, is_draft, relationship_label, listener_title)
            VALUES ('clone-ready', 'owner-1', 'clone-ready', 'el_x', 'ready', 0, 0, '아빠', '아들')`,
      args: [],
    });
    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: 'clone-ready', ownerUserId: 'owner-1', language: 'ko' },
    ]);
    expect(voices[0]!.isClone).toBe(true);
    expect(voices[0]!.relationshipLabel).toBe('아빠');
    expect(voices[0]!.listenerTitle).toBe('아들');
    const targets = await findMissingStockTargets(db, voices);
    expect(targets.every((t) => t.toneAdapt && t.relationshipLabel === '아빠')).toBe(true);
  });
});

describe('사전렌더 큐 헬퍼', () => {
  it('enqueuePrerender 는 voice_profile_id PK 로 멱등(중복 트리거해도 1행)', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'ko');
    await enqueuePrerender(db, 'v1', 'owner-1', 'ko');
    const rows = await db.execute('SELECT COUNT(*) AS n FROM voice_prerender_queue');
    expect(Number(rows.rows[0]!.n)).toBe(1);
  });

  it('claim → done 후에는 다시 claim 되지 않는다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'en');
    const claimed = await claimPendingPrerenderVoices(db, 5);
    expect(claimed).toEqual([{ voiceProfileId: 'v1', ownerUserId: 'owner-1', language: 'en' }]);
    await markPrerenderDone(db, 'v1');
    expect(await claimPendingPrerenderVoices(db, 5)).toEqual([]);
  });

  it('첫 cron이 임대한 pending 행은 겹친 cron이 다시 claim하지 않는다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'en');

    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
    expect(await claimPendingPrerenderVoices(db, 5)).toEqual([]);
  });

  it('만료된 claim은 다음 cron이 회수한다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'en');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
    await db.execute(
      `UPDATE voice_prerender_queue SET claimed_at = datetime('now', '-16 minutes') WHERE voice_profile_id = 'v1'`,
    );

    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });

  it('부분 렌더 뒤 claim을 해제하면 다음 cron이 즉시 이어받는다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'en');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);

    await releasePrerenderClaim(db, 'v1');

    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });

  it('markPrerenderFailed 는 attempts 를 올리고 5회 초과 시 failed 로 내려 무한 재시도를 막는다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'ko');
    for (let i = 0; i < 4; i += 1) {
      await markPrerenderFailed(db, 'v1');
      // 4회까지는 pending 유지 → 계속 claim 가능.
      expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
    }
    await markPrerenderFailed(db, 'v1'); // 5회째 → failed
    expect(await claimPendingPrerenderVoices(db, 5)).toEqual([]);
  });
});
