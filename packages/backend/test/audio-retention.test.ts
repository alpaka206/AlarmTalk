import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { cleanupStaleDraftVoices } from '../src/lib/audio-retention';

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
