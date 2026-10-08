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
      preview_text TEXT,
      speech_style TEXT,
      voice_energy TEXT,
      pitch_semitones REAL,
      pitch_model_id TEXT,
      speech_style_status TEXT,
      updated_at TEXT,
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
      retired_at TEXT,
      audio_url TEXT
    );
    CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ko',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      claim_token TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- 마이그레이션 #101. 교체 회차인지(기존 preset 을 덮어쓸지) 나른다.
      refresh_existing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE generated_audio_assets (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      voice_profile_id TEXT,
      provider_voice_id TEXT NOT NULL,
      audio_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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
      { voiceProfileId: 'clone-ready', ownerUserId: 'owner-1', language: 'en', claimToken: 'c1' },
      { voiceProfileId: 'clone-draft', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c2' },
      {
        voiceProfileId: 'clone-processing',
        ownerUserId: 'owner-1',
        language: 'ko',
        claimToken: 'c3',
      },
      { voiceProfileId: 'clone-deleted', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c4' },
      { voiceProfileId: 'sys-voice', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c5' },
    ]);

    expect(voices.map((v) => v.id)).toEqual(['clone-ready']);
    expect(voices[0]!.ownerUserId).toBe('owner-1');
    expect(voices[0]!.languageOverride).toBe('en');
    expect(voices[0]!.claimToken).toBe('c1');
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
    claimToken: 'claim-current',
    ...over,
  });

  it('클론은 CLONE_CLIP_SEEDS 전량을 앱 언어 1개로, toneAdapt·관계/호칭·소유자를 실어 생성', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });

    const targets = await findMissingStockTargets(db, [cloneVoice()]);

    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS);
    expect(new Set(targets.map((t) => t.category))).toEqual(
      new Set(['greeting', 'weather', 'fortune', 'cheer', 'medication']),
    );
    // languageOverride='ko' → 앱 언어 1개만(비용 곱연산 회피).
    expect(new Set(targets.map((t) => t.language))).toEqual(new Set(['ko']));
    // 클론은 전부 톤 적응 + 관계/호칭 전달 + 실소유자.
    expect(targets.every((t) => t.toneAdapt === true)).toBe(true);
    expect(
      targets.every((t) => t.relationshipLabel === '할머니' && t.listenerTitle === '규원아'),
    ).toBe(true);
    expect(targets.every((t) => t.ownerUserId === 'owner-1')).toBe(true);
    expect(targets.every((t) => t.voiceProfileId === 'clone-ready')).toBe(true);
    expect(targets.every((t) => t.claimToken === 'claim-current')).toBe(true);
    // baseText 는 최종 문구가 아니라 **생성 seed(지시문)** 이다 — 그 성질만 고정한다.
    // ⚠ 낱말이나 어미에 묶지 말 것. 예전에는 `'알리'` 를 찾았는데, 시드를 다듬으며
    //   '알린 뒤' 가 되자 실패했다 — '알린' 은 '알리'+'ㄴ' 이 아니라 별개 음절이라
    //   부분문자열이 아니다. 고정할 것은 "완성 문구가 아니라 **지시문**" 이라는 계약이다.
    const weatherSeed = targets.find((t) => t.category === 'weather')?.baseText ?? '';
    expect(weatherSeed.length).toBeGreaterThan(20);
    // 지시문은 '~한다/~준다/~권한다' 로 끝난다(완성 대사는 그렇게 끝나지 않는다).
    expect(weatherSeed).toMatch(/(한다|준다|챙긴다)\.?$/);
    // 완성 대사와 달리 delivery 태그가 없다 — 태그는 생성 결과에 붙는다.
    expect(weatherSeed).not.toMatch(/\[[a-z]/i);
  });

  // ⚠ **먼저 쓸 것부터 만든다**(2026-08-20). 사전렌더는 5분 주기 배치라 풀셋이 채워지기까지
  // 십수 분이 걸리는데, 그동안 사용자가 부딪히는 건 처음 고르는 문구 하나다. 예전에는 시드
  // 선언 순서(날씨 9개 먼저)라 인사말 하나 들으려고 날씨 아홉 개를 기다렸다.
  it('첫 배치가 인사말·약부터 만들도록 대상이 정렬된다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready' });

    const targets = await findMissingStockTargets(db, [cloneVoice()]);

    expect(targets[0]?.category).toBe('greeting');
    const categoryOrder = targets.map((t) => t.category);
    expect(categoryOrder.indexOf('medication')).toBeLessThan(categoryOrder.indexOf('weather'));
    expect(categoryOrder.indexOf('weather')).toBeLessThan(categoryOrder.indexOf('fortune'));

    // 같은 카테고리 안의 variant 순서는 **계약**이다(날씨 variant = 조건 인덱스).
    // 정렬이 안정적이지 않으면 사전렌더 인덱스와 클라 매칭이 어긋난다.
    const weatherVariants = targets
      .filter((t) => t.category === 'weather')
      .map((t) => t.variantIndex);
    expect(weatherVariants).toEqual([...weatherVariants].sort((a, b) => a - b));
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

  it('교체 배치는 새 provider로 게시된 항목을 건너뛰고 남은 클립부터 이어간다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready', voiceId: 'el-new' });
    await db.execute({
      sql: `INSERT INTO messages
              (id, user_id, voice_profile_id, category, language, variant, is_preset, audio_url)
            VALUES ('m-new', 'owner-1', 'clone-ready', 'greeting', 'ko', 0, 1, 'r2://new')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO generated_audio_assets (id, message_id, provider_voice_id, audio_url)
            VALUES ('ga-new', 'm-new', 'el-new', 'r2://new')`,
      args: [],
    });

    const targets = await findMissingStockTargets(db, [cloneVoice({ elevenlabsVoiceId: 'el-new' })], true);

    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS - 1);
    expect(targets.find((t) => t.category === 'greeting' && t.variantIndex === 0)).toBeUndefined();
  });

  // ⚠ **같은 보이스로 다시 굽는 회차**(Codex #802) — 말투 분석이 늦게 도착하면 보이스는 그대로라
  // 보이스 대조만으로는 옛 클립이 '이미 있다' 로 세어져 아무것도 다시 굽지 않는다. 요청 뒤에 게시된 것만 센다.
  it('말투 재렌더 회차는 요청 전에 게시된 같은 보이스 클립을 다시 굽고, 요청 뒤 것은 건너뛴다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready', voiceId: 'el-same' });
    await db.execute(`INSERT INTO messages
              (id, user_id, voice_profile_id, category, language, variant, is_preset, audio_url)
            VALUES ('m-old', 'owner-1', 'clone-ready', 'weather', 'ko', 0, 1, 'r2://old'),
                   ('m-new', 'owner-1', 'clone-ready', 'weather', 'ko', 1, 1, 'r2://new')`);
    await db.execute(`INSERT INTO generated_audio_assets (id, message_id, provider_voice_id, audio_url, created_at)
            VALUES ('ga-old', 'm-old', 'el-same', 'r2://old', datetime('now', '-1 hour')),
                   ('ga-new', 'm-new', 'el-same', 'r2://new', datetime('now', '+1 minute'))`);
    await db.execute(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, refresh_existing, requested_at)
            VALUES ('clone-ready', 'owner-1', 'ko', 1, datetime('now'))`);

    const targets = await findMissingStockTargets(db, [cloneVoice({ elevenlabsVoiceId: 'el-same' })], true);
    expect(targets.find((t) => t.category === 'weather' && t.variantIndex === 0)).toBeDefined();
    expect(targets.find((t) => t.category === 'weather' && t.variantIndex === 1)).toBeUndefined();
    expect(targets).toHaveLength(CLONE_TOTAL_SEEDS - 1);

    // 다시 굽는 회차가 아니면 게시 시각은 보지 않는다(평소 회차는 있는 것을 건너뛴다).
    const normal = await findMissingStockTargets(db, [cloneVoice({ elevenlabsVoiceId: 'el-same' })], false);
    expect(normal).toHaveLength(CLONE_TOTAL_SEEDS - 2);
  });

  // ⚠ **대장은 해시마다 한 행이다**(Codex #802). 두 프리셋이 우연히 같은 문장이면 같은 음원·같은 대장 행을
  // 나눠 쓰고, 그 행은 먼저 기록한 메시지에만 묶인다. message_id 로만 찾으면 나머지 하나는 영영 '빠진 것' 이라
  // 다시 굽기 회차가 끝나지 않는다.
  it('같은 음원을 나눠 쓰는 두 프리셋은 대장 행 하나로 둘 다 게시된 것으로 센다', async () => {
    const db = await setupDb();
    await insertVoice(db, { id: 'clone-ready', voiceId: 'el-same' });
    await db.execute(`INSERT INTO messages
              (id, user_id, voice_profile_id, category, language, variant, is_preset, audio_url)
            VALUES ('m-a', 'owner-1', 'clone-ready', 'weather', 'ko', 0, 1, 'r2://shared'),
                   ('m-b', 'owner-1', 'clone-ready', 'weather', 'ko', 1, 1, 'r2://shared')`);
    await db.execute(`INSERT INTO generated_audio_assets
              (id, message_id, voice_profile_id, provider_voice_id, audio_url, created_at)
            VALUES ('ga-shared', 'm-a', 'clone-ready', 'el-same', 'r2://shared', datetime('now', '+1 minute'))`);
    await db.execute(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, refresh_existing, requested_at)
            VALUES ('clone-ready', 'owner-1', 'ko', 1, datetime('now'))`);

    const targets = await findMissingStockTargets(db, [cloneVoice({ elevenlabsVoiceId: 'el-same' })], true);
    expect(targets.find((t) => t.category === 'weather' && t.variantIndex === 0)).toBeUndefined();
    expect(targets.find((t) => t.category === 'weather' && t.variantIndex === 1)).toBeUndefined();
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
      { voiceProfileId: 'clone-ready', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c1' },
    ]);
    expect(voices[0]!.isClone).toBe(true);
    expect(voices[0]!.relationshipLabel).toBe('아빠');
    expect(voices[0]!.listenerTitle).toBe('아들');
    const targets = await findMissingStockTargets(db, voices);
    expect(targets.every((t) => t.toneAdapt && t.relationshipLabel === '아빠')).toBe(true);
  });

  it('확정된 preview_text 는 styleReference 로 실려 모든 톤 적응 대상에 전달된다', async () => {
    const db = await setupDb();
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_system, is_draft, relationship_label, listener_title, preview_text)
            VALUES ('clone-style', 'owner-1', 'clone-style', 'el_y', 'ready', 0, 0, '엄마', '딸', '딸, 좋은 아침이야. 오늘도 잘 보내자.')`,
      args: [],
    });
    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: 'clone-style', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c2' },
    ]);
    expect(voices[0]!.styleReference).toBe('딸, 좋은 아침이야. 오늘도 잘 보내자.');
    const targets = await findMissingStockTargets(db, voices);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.styleReference === '딸, 좋은 아침이야. 오늘도 잘 보내자.')).toBe(true);
  });

  it('등록 때 고른 목소리의 결(voice_energy)이 말투 분석보다 앞서 모든 톤 적응 대상에 실린다', async () => {
    const db = await setupDb();
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_system, is_draft, relationship_label, listener_title, speech_style, voice_energy)
            VALUES ('clone-calm', 'owner-1', 'clone-calm', 'el_z', 'ready', 0, 0, '남자친구', '자기', ?, 'calm')`,
      args: [JSON.stringify({ dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false, energy: 'lively' })],
    });
    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: 'clone-calm', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c3' },
    ]);
    expect(voices[0]!.speechStyle?.energy).toBe('calm');
    expect(voices[0]!.speechStyle?.register).toBe('banmal');
    const targets = await findMissingStockTargets(db, voices);
    expect(targets.every((t) => t.speechStyle?.energy === 'calm')).toBe(true);
  });
  // 목소리 높이(#128) — 클론의 등록 높이가 모든 클립에 구워져야 한다(스펙 voice-and-message §4-3).
  it('등록 때 고른 목소리 높이가 그 모델과 함께 모든 대상에 실린다', async () => {
    const db = await setupDb();
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_system, is_draft, pitch_semitones, pitch_model_id)
            VALUES ('clone-low', 'owner-1', 'clone-low', 'el_low', 'ready', 0, 0, -1.5, 'eleven_v4_turbo'),
                   ('clone-plain', 'owner-1', 'clone-plain', 'el_plain', 'ready', 0, 0, NULL, NULL)`,
      args: [],
    });
    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: 'clone-low', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c4' },
      { voiceProfileId: 'clone-plain', ownerUserId: 'owner-1', language: 'ko', claimToken: 'c5' },
    ]);
    const low = voices.find((v) => v.id === 'clone-low')!;
    const plain = voices.find((v) => v.id === 'clone-plain')!;
    expect(low.pitch).toEqual({ semitones: -1.5, modelId: 'eleven_v4_turbo' });
    expect(plain.pitch).toBeNull();
    const targets = await findMissingStockTargets(db, voices);
    const lowTargets = targets.filter((t) => t.voiceProfileId === 'clone-low');
    expect(lowTargets.length).toBe(CLONE_TOTAL_SEEDS);
    expect(lowTargets.every((t) => t.pitch?.semitones === -1.5 && t.pitch.modelId === 'eleven_v4_turbo')).toBe(true);
    expect(targets.filter((t) => t.voiceProfileId === 'clone-plain').every((t) => t.pitch === null)).toBe(true);
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
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      voiceProfileId: 'v1',
      ownerUserId: 'owner-1',
      language: 'en',
    });
    await markPrerenderDone(db, 'v1', claimed[0]!.claimToken);
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
    const claimed = await claimPendingPrerenderVoices(db, 5);
    expect(claimed).toHaveLength(1);

    await releasePrerenderClaim(db, 'v1', claimed[0]!.claimToken);

    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });

  it('markPrerenderFailed 는 attempts 를 올리고 5회 초과 시 failed 로 내려 무한 재시도를 막는다', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'ko');
    for (let i = 0; i < 4; i += 1) {
      const [claim] = await claimPendingPrerenderVoices(db, 5);
      expect(claim).toBeDefined();
      await markPrerenderFailed(db, 'v1', claim!.claimToken);
      // 4회까지는 pending 유지 → 계속 claim 가능.
      const row = await db.execute(
        "SELECT status FROM voice_prerender_queue WHERE voice_profile_id = 'v1'",
      );
      expect(row.rows[0]!.status).toBe('pending');
    }
    const [lastClaim] = await claimPendingPrerenderVoices(db, 5);
    await markPrerenderFailed(db, 'v1', lastClaim!.claimToken); // 5회째 → failed
    expect(await claimPendingPrerenderVoices(db, 5)).toEqual([]);
  });
  // #124 는 굽혀 있던 클론 전부를 한꺼번에 다시 넣는다 — 새 등록이 그 뒤에 몇 시간씩 서면 안 된다.
  it('새 등록(refresh_existing = 0)을 다시 굽는 회차보다 먼저 잡는다 — 같은 갈래 안에서는 요청 순서', async () => {
    const db = await setupDb();
    await db.execute(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, refresh_existing, requested_at)
                      VALUES ('bulk-1', 'owner-1', 1, '2026-09-30 00:00:00.000'),
                             ('bulk-2', 'owner-2', 1, '2026-09-30 00:00:00.001'),
                             ('new-late', 'owner-3', 0, '2026-09-30 05:00:00'),
                             ('new-early', 'owner-4', 0, '2026-09-30 04:00:00')`);
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const [claim] = await claimPendingPrerenderVoices(db, 1);
      order.push(claim!.voiceProfileId);
    }
    expect(order).toEqual(['new-early', 'new-late', 'bulk-1', 'bulk-2']);
  });

  // 한 번에 여럿을 잡으면 배치는 **돌려준 순서**로 몫을 쓴다 — RETURNING 의 순서는 정해져 있지 않으므로(id 순으로
  // 나오곤 한다) 잡은 기준으로 다시 세워 돌려줘야 새 등록이 다시 굽는 회차보다 먼저 몫을 쓴다.
  it('여럿을 한 번에 잡아도 새 등록 먼저, 같은 갈래는 요청 순서로 돌려준다', async () => {
    const db = await setupDb();
    await db.execute(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, refresh_existing, requested_at)
                      VALUES ('a-bulk', 'owner-1', 1, '2026-09-30 00:00:00'),
                             ('b-new-late', 'owner-2', 0, '2026-09-30 05:00:00'),
                             ('c-new-early', 'owner-3', 0, '2026-09-30 04:00:00.500'),
                             ('d-bulk-late', 'owner-4', 1, '2026-09-30 01:00:00')`);
    const claimed = await claimPendingPrerenderVoices(db, 4);
    expect(claimed.map((c) => c.voiceProfileId)).toEqual(['c-new-early', 'b-new-late', 'a-bulk', 'd-bulk-late']);
  });

  it('rejects stale claim tokens after a lease is reclaimed', async () => {
    const db = await setupDb();
    await enqueuePrerender(db, 'v1', 'owner-1', 'ko');
    const [staleClaim] = await claimPendingPrerenderVoices(db, 1);
    await db.execute(
      `UPDATE voice_prerender_queue SET claimed_at = datetime('now', '-16 minutes') WHERE voice_profile_id = 'v1'`,
    );
    const [currentClaim] = await claimPendingPrerenderVoices(db, 1);

    expect(currentClaim!.claimToken).not.toBe(staleClaim!.claimToken);
    await releasePrerenderClaim(db, 'v1', staleClaim!.claimToken);
    await markPrerenderDone(db, 'v1', staleClaim!.claimToken);
    expect(await claimPendingPrerenderVoices(db, 1)).toEqual([]);

    await releasePrerenderClaim(db, 'v1', currentClaim!.claimToken);
    expect(await claimPendingPrerenderVoices(db, 1)).toHaveLength(1);
  });
});
