import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_PROVIDER_CLONE_VOICES,
  evictLruClonesIfOverCap,
  hasCloneSlotCapacity,
} from '../src/lib/voice-slots';

// 실제 libSQL 로 검증한다 — F1 상한 로직은 카운트/후보 쿼리 두 개의 조건이 정확히
// 일치해야 하고(불일치 시 조용한 상한 초과), mock FIFO 로는 그 정합을 못 잡는다.
// `:memory:` 는 연결마다 별도 DB 라 withWriteTransaction 이 스키마를 못 본다
// (alarm-guard.test.ts 와 동일 이슈) → 임시 파일 DB + 테스트마다 스키마 리셋.
const DB_PATH = join(tmpdir(), 'alarmtalk-voice-slots.db');
const sharedDb = createClient({ url: `file:${DB_PATH}` });

async function setupDb() {
  const db = sharedDb;
  await db.executeMultiple(`
    DROP TABLE IF EXISTS voice_profiles;
    DROP TABLE IF EXISTS pending_external_deletions;
    CREATE TABLE voice_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      elevenlabs_voice_id TEXT,
      evicted_provider_voice_id TEXT,
      status TEXT DEFAULT 'processing',
      is_system INTEGER DEFAULT 0,
      is_shared INTEGER DEFAULT 0,
      is_draft INTEGER DEFAULT 0,
      last_used_at TEXT,
      evicted_at TEXT,
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

async function insertClone(
  db: Awaited<ReturnType<typeof setupDb>>,
  params: {
    id: string;
    voiceId?: string | null;
    isShared?: boolean;
    isDraft?: boolean;
    isSystem?: boolean;
    lastUsedAt?: string | null;
    createdAt?: string;
  },
) {
  await db.execute({
    sql: `INSERT INTO voice_profiles
          (id, user_id, name, elevenlabs_voice_id, status, is_system, is_shared, is_draft, last_used_at, created_at)
          VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
    args: [
      params.id,
      `user-${params.id}`,
      params.id,
      params.voiceId === undefined ? `el-${params.id}` : params.voiceId,
      params.isSystem ? 1 : 0,
      params.isShared ? 1 : 0,
      params.isDraft ? 1 : 0,
      params.lastUsedAt ?? null,
      params.createdAt ?? '2026-07-01 00:00:00',
    ],
  });
}

async function fillToCap(
  db: Awaited<ReturnType<typeof setupDb>>,
  opts: { shared?: boolean } = {},
) {
  for (let i = 0; i < MAX_PROVIDER_CLONE_VOICES; i++) {
    await insertClone(db, {
      id: `v${String(i).padStart(3, '0')}`,
      isShared: opts.shared ?? false,
      lastUsedAt: `2026-07-10 00:${String(i % 60).padStart(2, '0')}:00`,
    });
  }
}

describe('hasCloneSlotCapacity', () => {
  it('returns true while under the cap', async () => {
    const db = await setupDb();
    await insertClone(db, { id: 'a' });
    expect(await hasCloneSlotCapacity(db)).toBe(true);
  });

  it('returns true at cap when an unprotected LRU victim exists', async () => {
    const db = await setupDb();
    await fillToCap(db);
    expect(await hasCloneSlotCapacity(db)).toBe(true);
  });

  it('returns false at cap when every candidate is protected (all shared)', async () => {
    const db = await setupDb();
    await fillToCap(db, { shared: true });
    expect(await hasCloneSlotCapacity(db)).toBe(false);
  });

  it('ignores system voices and evicted (voice_id NULL) rows in the count', async () => {
    const db = await setupDb();
    await fillToCap(db, { shared: true });
    // 시스템 보이스와 이미 evict 된 행은 활성 카운트에 안 들어간다 → 여전히 꽉 참(false) 판정 유지.
    await insertClone(db, { id: 'sys', isSystem: true });
    await insertClone(db, { id: 'evicted', voiceId: null });
    expect(await hasCloneSlotCapacity(db)).toBe(false);
  });
});

describe('evictLruClonesIfOverCap', () => {
  it('evicts exactly the overflow, LRU first, keeping the new profile', async () => {
    const db = await setupDb();
    await fillToCap(db);
    // v000 이 last_used_at 최솟값(00:00) → LRU 1순위. 새 보이스로 상한+1.
    await insertClone(db, { id: 'newbie', lastUsedAt: '2026-07-20 00:00:00' });
    const result = await evictLruClonesIfOverCap(db, 'newbie');
    expect(result).toEqual({ evicted: 1, shortfall: 0 });
    const victim = (
      await db.execute({
        sql: `SELECT elevenlabs_voice_id, evicted_provider_voice_id, evicted_at, deleted_at
              FROM voice_profiles WHERE id = 'v000'`,
      })
    ).rows[0];
    expect(victim.elevenlabs_voice_id).toBeNull();
    // evict 직전 id 보관 — TTS 가 이 id 로 기존 캐시를 프로브해 재클론 없이 서빙한다(Codex #602).
    expect(victim.evicted_provider_voice_id).toBe('el-v000');
    expect(victim.evicted_at).not.toBeNull();
    // deleted_at 은 NULL 유지 — TTL 스윕이 R2 원본을 보존해야 F3 재클론이 가능하다.
    expect(victim.deleted_at).toBeNull();
    const queued = (
      await db.execute({
        sql: `SELECT ref FROM pending_external_deletions WHERE kind = 'elevenlabs_voice'`,
      })
    ).rows;
    expect(queued.map((r) => r.ref)).toEqual(['el-v000']);
  });

  it('prefers never-used (last_used_at NULL) victims first', async () => {
    const db = await setupDb();
    await fillToCap(db);
    // 상한값이 바뀌어도 동작하도록 '마지막으로 채운' 행을 미사용(NULL)으로 만든다.
    const lastFilled = `v${String(MAX_PROVIDER_CLONE_VOICES - 1).padStart(3, '0')}`;
    await db.execute({
      sql: `UPDATE voice_profiles SET last_used_at = NULL WHERE id = ?`,
      args: [lastFilled],
    });
    await insertClone(db, { id: 'newbie' });
    await evictLruClonesIfOverCap(db, 'newbie');
    const victim = (
      await db.execute({
        sql: `SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = ?`,
        args: [lastFilled],
      })
    ).rows[0];
    expect(victim.elevenlabs_voice_id).toBeNull();
  });

  it('never evicts shared/draft/system rows even when over cap', async () => {
    const db = await setupDb();
    await fillToCap(db, { shared: true });
    await insertClone(db, { id: 'newbie' });
    const result = await evictLruClonesIfOverCap(db, 'newbie');
    // 후보가 전부 보호 대상 → evicted 0 + shortfall 보고. 호출자(등록 완료 tx/재클론 tx)는
    // shortfall 을 보고 새 등록/복원을 되돌려 초과 상태로 커밋하지 않는 게 계약이다.
    expect(result).toEqual({ evicted: 0, shortfall: 1 });
    const touched = (
      await db.execute({
        sql: `SELECT COUNT(*) AS n FROM voice_profiles WHERE evicted_at IS NOT NULL`,
      })
    ).rows[0];
    expect(Number(touched.n)).toBe(0);
  });

  it('does nothing at or under the cap', async () => {
    const db = await setupDb();
    await fillToCap(db);
    expect(await evictLruClonesIfOverCap(db, 'v000')).toEqual({ evicted: 0, shortfall: 0 });
  });

  it('falls back to the pre-76 schema during the deploy→migration window', async () => {
    // 배포 워크플로는 워커 배포 후 마이그레이션을 돌리므로, 76 적용 전 짧은 창에서는
    // evicted_provider_voice_id 컬럼이 없다 — 그래도 eviction(등록)이 실패하면 안 된다(Codex #603).
    const db = await setupDb();
    await db.executeMultiple(`
      DROP TABLE voice_profiles;
      CREATE TABLE voice_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        elevenlabs_voice_id TEXT,
        status TEXT DEFAULT 'processing',
        is_system INTEGER DEFAULT 0,
        is_shared INTEGER DEFAULT 0,
        is_draft INTEGER DEFAULT 0,
        last_used_at TEXT,
        evicted_at TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    await fillToCap(db);
    await insertClone(db, { id: 'newbie' });
    const result = await evictLruClonesIfOverCap(db, 'newbie');
    expect(result).toEqual({ evicted: 1, shortfall: 0 });
    const victim = (
      await db.execute({
        sql: `SELECT elevenlabs_voice_id, evicted_at FROM voice_profiles WHERE id = 'v000'`,
      })
    ).rows[0];
    expect(victim.elevenlabs_voice_id).toBeNull();
    expect(victim.evicted_at).not.toBeNull();
  });
});
