import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { cleanupStaleDraftVoices, drainExternalDeletions } from '../src/lib/audio-retention';

// 실제 libSQL(인메모리)로 검증한다 — created_at 은 datetime('now')(공백 구분) 포맷이고
// cutoff 는 ISO(T 구분)라, 원시 텍스트 비교로 회귀하면 같은 날짜의 방금 만든 draft 까지
// 쓸려나가는 미묘한 버그가 있어 mock 으로는 잡히지 않는다.
async function setupDb() {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      elevenlabs_voice_id TEXT,
      status TEXT DEFAULT 'processing',
      is_draft INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE pending_external_deletions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_pending_external_deletions_ref
      ON pending_external_deletions(kind, ref);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      audio_url TEXT
    );
  `);
  return db;
}

async function insertProfile(
  db: Awaited<ReturnType<typeof setupDb>>,
  params: {
    id: string;
    isDraft: boolean;
    voiceId?: string | null;
    ageModifier: string; // 예: '-2 hours', '-10 minutes'
    deletedAt?: string | null;
  },
) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, is_draft, deleted_at, created_at)
          VALUES (?, 'user-1', ?, ?, ?, ?, datetime('now', ?))`,
    args: [
      params.id,
      params.id,
      params.voiceId ?? null,
      params.isDraft ? 1 : 0,
      params.deletedAt ?? null,
      params.ageModifier,
    ],
  });
}

describe('cleanupStaleDraftVoices', () => {
  it('TTL(1시간) 지난 고아 draft 만 소프트 삭제하고 클론 voice 를 외부 삭제 큐에 적재한다', async () => {
    const db = await setupDb();
    // 고아 draft (2시간 전, 클론 완료) → 정리 + 큐 적재 대상
    await insertProfile(db, { id: 'stale-ready', isDraft: true, voiceId: 'elv-stale', ageModifier: '-2 hours' });
    // 고아 draft (2시간 전, 클론 실패로 voice 없음) → 정리 대상, 큐 적재 없음
    await insertProfile(db, { id: 'stale-processing', isDraft: true, ageModifier: '-2 hours' });
    // 방금 만든 draft (10분 전, 같은 날짜) → 보존 — 텍스트 비교 회귀 시 여기가 깨진다
    await insertProfile(db, { id: 'fresh-draft', isDraft: true, voiceId: 'elv-fresh', ageModifier: '-10 minutes' });
    // 오래된 일반(non-draft) 보이스 → 보존
    await insertProfile(db, { id: 'old-normal', isDraft: false, voiceId: 'elv-normal', ageModifier: '-30 days' });
    // 이미 삭제된 draft → 재처리 없음
    await insertProfile(db, {
      id: 'already-deleted',
      isDraft: true,
      voiceId: 'elv-deleted',
      ageModifier: '-2 hours',
      deletedAt: '2026-07-01 00:00:00',
    });

    await cleanupStaleDraftVoices(db, new Date());

    const remaining = await db.execute(
      `SELECT id FROM voice_profiles WHERE deleted_at IS NULL ORDER BY id`,
    );
    expect(remaining.rows.map((r) => String(r.id))).toEqual(['fresh-draft', 'old-normal']);

    const queued = await db.execute(
      `SELECT kind, ref FROM pending_external_deletions ORDER BY ref`,
    );
    expect(queued.rows.map((r) => `${r.kind}:${r.ref}`)).toEqual(['elevenlabs_voice:elv-stale']);
  });

  it('멱등 — 두 번 실행해도 큐가 중복 적재되지 않는다', async () => {
    const db = await setupDb();
    await insertProfile(db, { id: 'stale', isDraft: true, voiceId: 'elv-1', ageModifier: '-2 hours' });

    await cleanupStaleDraftVoices(db, new Date());
    await cleanupStaleDraftVoices(db, new Date());

    const queued = await db.execute(`SELECT COUNT(*) AS c FROM pending_external_deletions`);
    expect(Number(queued.rows[0]!.c)).toBe(1);
  });
});

describe('drainExternalDeletions — R2 오브젝트', () => {
  function envWith(deleted: string[]) {
    return {
      VOICE_BUCKET: { delete: async (key: string) => { deleted.push(key); } },
    } as never;
  }

  async function queue(
    db: Awaited<ReturnType<typeof setupDb>>,
    id: string,
    ref: string,
    ageModifier: string,
  ) {
    await db.execute({
      sql: `INSERT INTO pending_external_deletions (id, kind, ref, created_at)
            VALUES (?, 'r2_object', ?, datetime('now', ?))`,
      args: [id, ref, ageModifier],
    });
  }

  /**
   * ⚠ **유예가 경합을 닫는다**(2026-09-03 리뷰 11차). R2 키는 cacheKey 에서 결정론적으로
   * 나오므로 '내가 올린 것' 과 '남이 올린 같은 내용' 을 구분할 수 없다. 조회와 삭제 사이에
   * 그 남이 행을 커밋하면 방금 게시된 알람이 없는 음원을 가리킨다 — 렌더 한 회차보다 훨씬
   * 긴 유예를 두어 시간으로 닫는다.
   */
  it('큐에 막 들어온 것은 지우지 않고 다음 회차로 미룬다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/fresh.mp3', '-1 minutes');

    await drainExternalDeletions(db, envWith(deleted));

    expect(deleted).toEqual([]);
    const left = await db.execute('SELECT attempts FROM pending_external_deletions');
    expect(left.rows.length, '큐에 그대로 남는다').toBe(1);
    expect(Number(left.rows[0]!.attempts), '유예는 실패가 아니다 — attempts 를 태우지 않는다').toBe(0);
  });

  it('유예를 넘겼고 아무도 안 쓰면 지운다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/orphan.mp3', '-2 hours');

    await drainExternalDeletions(db, envWith(deleted));

    expect(deleted).toEqual(['voices/orphan.mp3']);
    const left = await db.execute('SELECT id FROM pending_external_deletions');
    expect(left.rows.length).toBe(0);
  });

  /** 그 사이 누가 게시했으면 지우지 않는다 — 지우면 그 알람이 소리를 잃는다. */
  it('메시지가 가리키고 있으면 지우지 않는다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/live.mp3', '-2 hours');
    await db.execute({
      sql: "INSERT INTO messages (id, audio_url) VALUES ('m1', ?)",
      args: ['r2://voices/live.mp3'],
    });

    await drainExternalDeletions(db, envWith(deleted));

    expect(deleted, '게시된 음원을 지웠다').toEqual([]);
  });
});
