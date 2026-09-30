import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import {
  cleanupStaleDraftVoices,
  drainExternalDeletions,
  enqueueExternalDeletion,
  enqueueExternalDeletionsBatch,
} from '../src/lib/audio-retention';

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
  /**
   * `uploadedMinutesAgo` 가 null 이면 오브젝트가 **없는** 상태(head → null).
   * 유예는 큐 나이가 아니라 **오브젝트 업로드 시각**에 걸린다(리뷰 12차).
   */
  function envWith(deleted: string[], uploadedMinutesAgo: number | null) {
    return {
      VOICE_BUCKET: {
        head: async () =>
          uploadedMinutesAgo == null
            ? null
            : { uploaded: new Date(Date.now() - uploadedMinutesAgo * 60_000) },
        delete: async (key: string) => { deleted.push(key); },
      },
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
  it('방금 올라온 오브젝트는 지우지 않고 다음 회차로 미룬다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    // ⚠ **큐는 오래됐는데 오브젝트는 방금 올라온** 경우가 핵심이다. 삭제가 실패해
    //   attempts 만 오른 행은 `created_at` 이 갱신되지 않으므로, 큐 나이로 재면 그 사이
    //   새로 올라온 오브젝트를 지운다(리뷰 12차).
    await queue(db, 'p1', 'voices/fresh.mp3', '-2 hours');

    await drainExternalDeletions(db, envWith(deleted, 1));

    expect(deleted).toEqual([]);
    const left = await db.execute('SELECT attempts FROM pending_external_deletions');
    expect(left.rows.length, '큐에 그대로 남는다').toBe(1);
    expect(Number(left.rows[0]!.attempts), '유예는 실패가 아니다 — attempts 를 태우지 않는다').toBe(0);
  });

  it('유예를 넘겼고 아무도 안 쓰면 지운다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/orphan.mp3', '-2 hours');

    await drainExternalDeletions(db, envWith(deleted, 120));

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

    await drainExternalDeletions(db, envWith(deleted, 120));

    expect(deleted, '게시된 음원을 지웠다').toEqual([]);
  });

  /**
   * ⚠ **업로더가 예약을 취소했으면 지우지 않는다**(2026-09-03 리뷰 13차).
   *
   * 렌더는 올리기 전에 자기 키의 삭제 예약을 지운다(`generateStockClip`). 예약이
   * 사라졌다는 것은 **누군가 이 키를 지금 쓰고 있다**는 뜻이므로 물러선다.
   */
  it('삭제 직전에 예약이 사라졌으면 지우지 않는다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/contended.mp3', '-2 hours');
    // 드레인이 목록을 읽은 뒤, 삭제 직전 사이에 렌더가 예약을 취소한 상황을 만든다.
    const bucket = {
      head: async () => {
        await db.execute("DELETE FROM pending_external_deletions WHERE id = 'p1'");
        return { uploaded: new Date(Date.now() - 120 * 60_000) };
      },
      delete: async (key: string) => { deleted.push(key); },
    };
    await drainExternalDeletions(db, { VOICE_BUCKET: bucket } as never);

    expect(deleted, '업로더가 쓰고 있는 키를 지웠다').toEqual([]);
  });

  /**
   * ⚠ **참조를 본 뒤 마지막 참조가 끊기며 같은 키가 다시 예약되면, 드레인의 옛 판단이 그 예약을 지우면 안 된다**
   * (Codex #840). 두 프리셋이 한 오브젝트를 나눠 쓰는 클론 재렌더에서 실제로 겹친다: 드레인이 '아직 참조가
   * 있다' 고 본 직후 두 번째 자리가 교체되며 같은 키를 다시 넣는다. 예전(`INSERT OR IGNORE`)에는 옛 예약이 있어
   * 무시됐고, 드레인은 그 예약을 id 로 지웠다 — 오브젝트는 참조도 예약도 없는 미아가 됐다.
   */
  it('참조 확인 뒤 같은 키가 다시 예약되면 그 예약은 남고, 다음 회차가 지운다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/shared.mp3', '-2 hours');
    await db.execute({ sql: "INSERT INTO messages (id, audio_url) VALUES ('m2', ?)", args: ['r2://voices/shared.mp3'] });

    let raced = false;
    const racing = Object.create(db) as typeof db;
    racing.execute = (async (stmt: Parameters<typeof db.execute>[0]) => {
      const result = await db.execute(stmt);
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      if (!raced && sql.includes('SELECT 1 FROM messages WHERE audio_url = ?')) {
        raced = true;
        // 드레인이 '아직 참조가 있다' 를 읽은 바로 뒤 — 두 번째 자리가 교체되며 같은 키를 다시 예약한다.
        await db.execute("UPDATE messages SET audio_url = 'r2://voices/new.mp3' WHERE id = 'm2'");
        await enqueueExternalDeletion(db, 'r2_object', 'voices/shared.mp3');
      }
      return result;
    }) as typeof db.execute;

    await drainExternalDeletions(racing, envWith(deleted, 120));

    expect(raced).toBe(true);
    expect(deleted, '그 회차는 참조가 있다고 봤으니 지우지 않는다').toEqual([]);
    const left = await db.execute('SELECT id, ref FROM pending_external_deletions');
    expect(left.rows.map((r) => String(r.ref)), '마지막 삭제 요청이 사라지면 오브젝트가 미아가 된다').toEqual([
      'voices/shared.mp3',
    ]);
    expect(String(left.rows[0]!.id), '다시 넣은 예약은 새 id 다').not.toBe('p1');

    await drainExternalDeletions(db, envWith(deleted, 120));
    expect(deleted).toEqual(['voices/shared.mp3']);
    expect((await db.execute('SELECT id FROM pending_external_deletions')).rows).toHaveLength(0);
  });

  it('같은 키를 두 번 예약해도 한 행이다 — id 만 새로 바뀐다(일괄 적재도 같다)', async () => {
    const db = await setupDb();
    await enqueueExternalDeletion(db, 'r2_object', 'voices/a.mp3');
    const first = String((await db.execute('SELECT id FROM pending_external_deletions')).rows[0]!.id);
    await enqueueExternalDeletionsBatch(db, 'r2_object', ['voices/a.mp3', 'voices/b.mp3']);
    const rows = (await db.execute('SELECT id, ref FROM pending_external_deletions ORDER BY ref')).rows;
    expect(rows.map((r) => String(r.ref))).toEqual(['voices/a.mp3', 'voices/b.mp3']);
    expect(String(rows[0]!.id)).not.toBe(first);
  });

  /** 오브젝트가 이미 없으면 지울 것도 없다 — 큐에서 내린다(무한 재시도 방지). */
  it('오브젝트가 이미 없으면 큐에서 내린다', async () => {
    const db = await setupDb();
    const deleted: string[] = [];
    await queue(db, 'p1', 'voices/gone.mp3', '-2 hours');

    await drainExternalDeletions(db, envWith(deleted, null));

    expect(deleted).toEqual([]);
    const left = await db.execute('SELECT id FROM pending_external_deletions');
    expect(left.rows.length).toBe(0);
  });
});
