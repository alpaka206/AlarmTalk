// 마이그레이션 #124 실동작 검증 — eleven_v4_turbo 전환 때 **굽혀 있는 클론 클립을 다시 굽게** 큐에 다시 넣는다.
//
// 시스템 스톡은 여기서 건드리지 않는다(은퇴시키면 모든 앱이 차단 화면을 띄운다) — `publish:stock` 이 같은
// message_id 에 소리만 갈아 끼운다. 클론은 서버 cron 이 굽으므로 큐에 `refresh_existing = 1` 로 다시 넣으면
// 기존 경로(말투 재렌더와 같은 모양)가 같은 message_id 로 덮어쓴다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { migrations, runMigrationsRange } from '../src/lib/migrations';
import { CLONE_CLIP_SEEDS, findMissingStockTargets, listReadyCloneVoices } from '../src/lib/stock-clips';

const DB_PATH = join(tmpdir(), 'alarmtalk-migration-v4-turbo-requeue.db');
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const USER = '12400000-0000-4000-9000-000000000001';
const migration124 = migrations.find((m) => m.id === 124)!;

type VoiceSeed = {
  id: string;
  isSystem?: number;
  isDraft?: number;
  status?: string;
  providerVoiceId?: string | null;
  deletedAt?: string | null;
  /** 이 목소리에 굽혀 있는 프리셋 클립 — null 이면 없다, 'retired' 면 은퇴한 것만 있다. */
  clip?: 'live' | 'retired' | null;
  queueStatus?: string | null;
};

const VOICES: Record<string, VoiceSeed> = {
  // 다시 굽는다: 준비된 클론 + 굽혀 있는 클립 + 큐 done.
  doneClone: { id: '12400000-0000-4000-9000-000000000101', clip: 'live', queueStatus: 'done' },
  // 다시 굽는다: 굽다 실패했어도 클립이 남아 있으면(일부만 굽혔다) 옛 모델 클립을 바꿔야 한다.
  partialFailedClone: { id: '12400000-0000-4000-9000-000000000102', clip: 'live', queueStatus: 'failed' },
  // 그대로: 클립이 하나도 없는 실패 행 — 바꿀 옛 클립이 없다.
  emptyFailedClone: { id: '12400000-0000-4000-9000-000000000103', clip: null, queueStatus: 'failed' },
  // 그대로: 은퇴한 클립만 있다.
  retiredOnlyClone: { id: '12400000-0000-4000-9000-000000000104', clip: 'retired', queueStatus: 'done' },
  // 그대로: 시스템 목소리(publish:stock 몫).
  systemVoice: { id: '12400000-0000-4000-9000-000000000105', isSystem: 1, clip: 'live', queueStatus: 'done' },
  // 그대로: 초안·밀려남(보이스 없음)·지운 목소리.
  draftClone: { id: '12400000-0000-4000-9000-000000000106', isDraft: 1, clip: 'live', queueStatus: 'done' },
  evictedClone: { id: '12400000-0000-4000-9000-000000000107', providerVoiceId: null, clip: 'live', queueStatus: 'done' },
  deletedClone: { id: '12400000-0000-4000-9000-000000000108', deletedAt: '2026-09-01 00:00:00', clip: 'live', queueStatus: 'done' },
};

async function queueRow(voiceId: string) {
  const res = await db.execute({
    sql: 'SELECT status, attempts, refresh_existing, requested_at, claim_token FROM voice_prerender_queue WHERE voice_profile_id = ?',
    args: [voiceId],
  });
  return res.rows[0];
}

beforeAll(async () => {
  await runMigrationsRange(db, 1, 122);
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, 'v4t@test')`,
    args: [USER, USER],
  });
  for (const [key, v] of Object.entries(VOICES)) {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system, is_draft, elevenlabs_voice_id, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        v.id, USER, key, v.status ?? 'ready', v.isSystem ?? 0, v.isDraft ?? 0,
        v.providerVoiceId === undefined ? `el-${key}` : v.providerVoiceId, v.deletedAt ?? null,
      ],
    });
    if (v.clip) {
      await db.execute({
        sql: `INSERT INTO messages
              (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
               category, language, variant, is_preset, audio_url, retired_at)
              VALUES (?, ?, ?, '옛 문구', '[warmly] 옛 문구', '["warmly"]', 'greeting', 'ko', 0, 1, ?, ?)`,
        args: [`m-${key}`, USER, v.id, `r2://generated-tts/${USER}/${key}.mp3`, v.clip === 'retired' ? '2026-09-03 00:00:00' : null],
      });
      await db.execute({
        sql: `INSERT INTO generated_audio_assets
              (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
               model_id, language, request_hash, text, audio_url, audio_object_key, audio_format, created_at)
              VALUES (?, ?, ?, ?, 'elevenlabs', ?, 'eleven_v3', 'ko', ?, '[warmly] 옛 문구', ?, ?, 'mp3', '2026-09-20 00:00:00')`,
        args: [
          `ga-${key}`, USER, v.id, `m-${key}`, `el-${key}`, `hash-${key}`,
          `r2://generated-tts/${USER}/${key}.mp3`, `generated-tts/${USER}/${key}.mp3`,
        ],
      });
    }
    if (v.queueStatus) {
      await db.execute({
        sql: `INSERT INTO voice_prerender_queue
              (voice_profile_id, owner_user_id, language, status, attempts, claimed_at, claim_token, requested_at)
              VALUES (?, ?, 'ko', ?, 5, datetime('now'), 'OLD-TOKEN', '2026-09-10 00:00:00')`,
        args: [v.id, USER, v.queueStatus],
      });
    }
  }
  for (const sql of migration124.statements) await db.execute(sql);
});

describe('migration #124 — eleven_v4_turbo 클론 클립 다시 굽기', () => {
  it('굽혀 있는 클립이 있는 준비된 클론만 교체 회차로 다시 넣는다', async () => {
    for (const key of ['doneClone', 'partialFailedClone'] as const) {
      const row = await queueRow(VOICES[key]!.id);
      expect(row, key).toMatchObject({ status: 'pending', attempts: 0, refresh_existing: 1, claim_token: null });
      // 밀리초까지 — '이 요청 뒤에 게시된 클립만 최신' 을 같은 초 안에서도 가른다.
      expect(String(row!.requested_at), key).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/);
    }
    for (const key of ['emptyFailedClone', 'retiredOnlyClone', 'systemVoice', 'draftClone', 'evictedClone', 'deletedClone'] as const) {
      const row = await queueRow(VOICES[key]!.id);
      expect(row, key).toMatchObject({ refresh_existing: 0, claim_token: 'OLD-TOKEN', requested_at: '2026-09-10 00:00:00' });
    }
  });

  it('다시 넣은 클론은 옛 클립을 낡은 것으로 세어 21개 전부 같은 자리에 덮어쓰게 한다', async () => {
    const voices = await listReadyCloneVoices(db, [
      { voiceProfileId: VOICES.doneClone!.id, ownerUserId: USER, language: 'ko', claimToken: 'NEW' },
    ]);
    expect(voices).toHaveLength(1);
    const targets = await findMissingStockTargets(db, voices, true);
    const total = CLONE_CLIP_SEEDS.reduce((n, s) => n + s.seeds.length, 0);
    expect(targets).toHaveLength(total);
    // 굽혀 있던 인사 클립도 대상이고, 제자리에 덮어쓴다(같은 message_id — `generateStockClip` 의 교체 갈래).
    const greeting = targets.find((t) => t.category === 'greeting' && t.variantIndex === 0)!;
    expect(greeting.refreshExisting).toBe(true);
  });

  it('이름 끝의 지문이 무효화 규칙을 따른다 — 시스템 스톡은 은퇴시키지 않는다', () => {
    expect(migration124.name).toMatch(/^refresh-stock-clips-v4-turbo-[0-9a-f]{16}$/);
    expect(migration124.statements.join('\n')).not.toMatch(/retired_at\s*=|DELETE FROM messages/);
  });
});
