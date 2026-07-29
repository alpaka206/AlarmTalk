// #86 백필 회귀 가드 (Codex #647 P2).
//
// #647 이전의 '해지 시 클론 반납'은 elevenlabs_voice_id 만 비우고 evicted_at 을 안 남겼다.
// tts.ts 의 복구 게이트가 `voice id 없음 AND evicted_at 있음` 이라, 그 행들은 3일 보관 안에
// 다시 구독해도 재클론 경로를 못 타고 NO_VOICE_ID 로 떨어진다 — 재클론에 쓸 원본은 남아 있는데도.
//
// 문자열 매칭이 아니라 실제 SQLite 에 행을 심고 결과 상태로 검증한다. 조건이 하나만 어긋나도
// '클론이 있던 적 없는 행'이 evict 로 표시돼 애먼 재클론이 돌기 때문이다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrationsRange } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), `alarmtalk-evicted-backfill-${process.pid}.db`);
const RELEASED_AT = '2026-07-20 00:00:00';
let db: Client;

/** 프로필 1개 + (원하면) 그 프로필에 연결된 원본 업로드 1개를 심는다. */
async function seedProfile(opts: {
  id: string;
  status: 'ready' | 'processing' | 'failed';
  voiceId: string | null;
  evictedAt?: string | null;
  deletedAt?: string | null;
  isSystem?: boolean;
  withUpload: boolean;
}) {
  await db.execute({
    sql: `INSERT INTO voice_profiles
            (id, user_id, name, elevenlabs_voice_id, status, evicted_at, deleted_at,
             is_system, updated_at)
          VALUES (?, 'u-1', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      opts.id,
      opts.id,
      opts.voiceId,
      opts.status,
      opts.evictedAt ?? null,
      opts.deletedAt ?? null,
      opts.isSystem ? 1 : 0,
      RELEASED_AT,
    ],
  });
  if (opts.withUpload) {
    await db.execute({
      sql: `INSERT INTO voice_uploads
              (id, user_id, object_key, mime_type, size_bytes, voice_profile_id)
            VALUES (?, 'u-1', ?, 'audio/mp4', 1000, ?)`,
      args: [`up-${opts.id}`, `voices/${opts.id}.m4a`, opts.id],
    });
  }
}

async function evictedAtOf(id: string): Promise<string | null> {
  const r = await db.execute({
    sql: 'SELECT evicted_at FROM voice_profiles WHERE id = ?',
    args: [id],
  });
  return (r.rows[0]?.evicted_at as string | null) ?? null;
}

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
  db = createClient({ url: `file:${DB_PATH}` });

  // 백필 직전 상태까지만 적용해 두고 대상 행을 심는다.
  await runMigrationsRange(db, 1, 85);
  await db.execute(`INSERT INTO users (id, google_id, email) VALUES ('u-1', 'g-1', 'u1@test.com')`);

  // 백필 대상: 해지로 반납된 행(ready + 원본 있음 + voice id 도 표식도 없음).
  await seedProfile({ id: 'released', status: 'ready', voiceId: null, withUpload: true });
  // 제외 대상들.
  await seedProfile({ id: 'active', status: 'ready', voiceId: 'el-1', withUpload: true });
  await seedProfile({ id: 'no-upload', status: 'ready', voiceId: null, withUpload: false });
  await seedProfile({ id: 'processing', status: 'processing', voiceId: null, withUpload: true });
  await seedProfile({ id: 'failed', status: 'failed', voiceId: null, withUpload: true });
  await seedProfile({
    id: 'deleted',
    status: 'ready',
    voiceId: null,
    deletedAt: '2026-07-01 00:00:00',
    withUpload: true,
  });
  await seedProfile({
    id: 'already-evicted',
    status: 'ready',
    voiceId: null,
    evictedAt: '2026-07-10 00:00:00',
    withUpload: true,
  });
  // 다른 조건은 전부 통과하지만 기본(시스템) 목소리인 행 — is_system 가드만 남는 경우.
  await seedProfile({
    id: 'system',
    status: 'ready',
    voiceId: null,
    isSystem: true,
    withUpload: true,
  });

  await runMigrationsRange(db, 86, 86);
});

afterAll(() => {
  db?.close();
  // Windows 는 close 직후에도 핸들이 남아 EPERM 이 난다. 임시 파일이라 남아도 무해하고,
  // 다음 실행의 beforeAll 이 어차피 지운다(schema-fresh.test.ts 와 같은 방식).
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`${DB_PATH}${suffix}`, { force: true });
    } catch {
      /* 무시 */
    }
  }
});

describe('#86 해지로 반납된 클론에 evicted_at 백필', () => {
  it('원본이 남아 있는 반납 행에 표식을 채운다 — 재구독 시 재클론이 돈다', async () => {
    // 값은 실제 반납 시각(updated_at)이어야 한다.
    expect(await evictedAtOf('released')).toBe(RELEASED_AT);
  });

  it('클론이 살아 있는 행은 건드리지 않는다', async () => {
    expect(await evictedAtOf('active')).toBeNull();
  });

  it('재클론에 쓸 원본이 없으면 표식을 찍지 않는다', async () => {
    expect(await evictedAtOf('no-upload')).toBeNull();
  });

  it('기본(시스템) 목소리는 다른 조건을 다 만족해도 제외한다', async () => {
    expect(await evictedAtOf('system')).toBeNull();
  });

  it('진행 중·실패 프로필은 되살리지 않는다', async () => {
    expect(await evictedAtOf('processing')).toBeNull();
    expect(await evictedAtOf('failed')).toBeNull();
  });

  it('이미 지운 행은 건드리지 않는다', async () => {
    expect(await evictedAtOf('deleted')).toBeNull();
  });

  it('기존 evict 표식을 덮어쓰지 않는다', async () => {
    expect(await evictedAtOf('already-evicted')).toBe('2026-07-10 00:00:00');
  });

  it('재실행해도 아무것도 바뀌지 않는다 (원장 밖에서 다시 돌려도 안전)', async () => {
    const before = await db.execute('SELECT id, evicted_at FROM voice_profiles ORDER BY id');
    await db.execute({ sql: 'DELETE FROM _migrations WHERE id = ?', args: [86] });
    await runMigrationsRange(db, 86, 86);
    const after = await db.execute('SELECT id, evicted_at FROM voice_profiles ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });
});
