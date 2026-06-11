/**
 * 음성 데이터 수명주기 관리.
 *
 * 1) pending_external_deletions 큐
 *    - DB 트랜잭션 안에서는 외부 API(ElevenLabs/R2)를 호출할 수 없으므로,
 *      행을 지우기 *전에* 외부 참조(클론 voice_id, R2 object key)를 큐에 적재한다.
 *    - cron 의 drainExternalDeletions 가 배치로 실제 삭제 후 큐에서 제거한다.
 *      실패 시 attempts 를 올리고 남겨 다음 주기에 재시도한다.
 *
 * 2) R2 TTL 정리 (cleanupExpiredAudio)
 *    - voice_uploads(클론 학습용 원본): 클론 완료 후에는 불필요 → 7일 경과 시 삭제.
 *    - generated_audio_assets(TTS 캐시): 기기들이 로컬 캐싱하므로 서버 보관은
 *      전달용 버퍼다 → 30일 경과 시 삭제. 단 알람 raw_audio_url 이 참조 중인
 *      오브젝트는 건너뛴다 (기기 재설치 시 재다운로드 경로 보존).
 *
 * Workers free plan 의 invocation 당 subrequest 상한(~50)을 고려해 배치 크기를
 * 보수적으로 제한한다 (cron 5분 주기라 누적 처리량은 충분).
 */
import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import type { DbExecutor } from './transactions';
import { ElevenLabsClient } from './elevenlabs';
import { logStructured } from './logger';

export const VOICE_UPLOAD_TTL_DAYS = 7;
export const GENERATED_TTS_TTL_DAYS = 30;

const DRAIN_BATCH_SIZE = 10;
const TTL_BATCH_SIZE = 10;
const MAX_DELETE_ATTEMPTS = 10;

export type ExternalDeletionKind = 'elevenlabs_voice' | 'r2_object';

/** 큐 적재 — 트랜잭션 내부에서 호출 가능. 동일 (kind, ref) 는 무시(idempotent). */
export async function enqueueExternalDeletion(
  tx: DbExecutor,
  kind: ExternalDeletionKind,
  ref: string | null | undefined,
): Promise<void> {
  const trimmed = ref?.trim();
  if (!trimmed) return;
  await tx.execute({
    sql: `INSERT OR IGNORE INTO pending_external_deletions (id, kind, ref)
          VALUES (?, ?, ?)`,
    args: [crypto.randomUUID(), kind, trimmed],
  });
}

/**
 * 사용자의 음성 외부 자원(클론 voice + R2 오브젝트) 전부를 큐에 적재한다.
 * purgeUserAccount / deletePaidVoiceDataForUser 가 행을 지우기 전에 호출해야 한다.
 */
export async function enqueueUserVoiceArtifacts(
  tx: DbExecutor,
  ownerIds: string[],
): Promise<void> {
  if (ownerIds.length === 0) return;
  const ph = ownerIds.map(() => '?').join(',');

  const voices = await tx.execute({
    sql: `SELECT elevenlabs_voice_id FROM voice_profiles
          WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
    args: ownerIds,
  });
  for (const row of voices.rows) {
    await enqueueExternalDeletion(tx, 'elevenlabs_voice', row.elevenlabs_voice_id as string);
  }

  const uploads = await tx.execute({
    sql: `SELECT object_key FROM voice_uploads WHERE user_id IN (${ph})`,
    args: ownerIds,
  });
  for (const row of uploads.rows) {
    await enqueueExternalDeletion(tx, 'r2_object', row.object_key as string);
  }

  const generated = await tx.execute({
    sql: `SELECT audio_object_key FROM generated_audio_assets
          WHERE audio_object_key IS NOT NULL
            AND (user_id IN (${ph})
                 OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph})))`,
    args: [...ownerIds, ...ownerIds],
  });
  for (const row of generated.rows) {
    await enqueueExternalDeletion(tx, 'r2_object', row.audio_object_key as string);
  }

  // 알람에 직접 연결된 사용자 녹음 원본 (r2://<key>).
  const rawAlarms = await tx.execute({
    sql: `SELECT raw_audio_url FROM alarms
          WHERE raw_audio_url LIKE 'r2://%'
            AND (user_id IN (${ph}) OR target_user_id IN (${ph}))`,
    args: [...ownerIds, ...ownerIds],
  });
  for (const row of rawAlarms.rows) {
    const url = String(row.raw_audio_url ?? '');
    await enqueueExternalDeletion(tx, 'r2_object', url.replace(/^r2:\/\//, ''));
  }
}

/** 큐를 배치로 비운다 — cron 전용. 외부 API 호출이 있으므로 트랜잭션 밖에서 실행. */
export async function drainExternalDeletions(db: Client, env: Env): Promise<void> {
  const pending = await db.execute({
    sql: `SELECT id, kind, ref, attempts FROM pending_external_deletions
          WHERE attempts < ?
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [MAX_DELETE_ATTEMPTS, DRAIN_BATCH_SIZE],
  });
  if (pending.rows.length === 0) return;

  const bucket = env.VOICE_BUCKET;
  const elevenLabs = env.ELEVENLABS_API_KEY ? new ElevenLabsClient(env.ELEVENLABS_API_KEY) : null;
  let succeeded = 0;

  for (const row of pending.rows) {
    const id = String(row.id);
    const kind = String(row.kind) as ExternalDeletionKind;
    const ref = String(row.ref);
    try {
      if (kind === 'elevenlabs_voice') {
        if (!elevenLabs) throw new Error('ELEVENLABS_API_KEY unset');
        try {
          await elevenLabs.deleteVoice(ref);
        } catch (err) {
          // 이미 삭제된 voice 는 성공으로 취급.
          if (!String(err).includes('404')) throw err;
        }
      } else {
        if (!bucket) throw new Error('VOICE_BUCKET unset');
        await bucket.delete(ref);
      }
      await db.execute({
        sql: 'DELETE FROM pending_external_deletions WHERE id = ?',
        args: [id],
      });
      succeeded += 1;
    } catch (err) {
      await db.execute({
        sql: `UPDATE pending_external_deletions
              SET attempts = attempts + 1, last_error = ?
              WHERE id = ?`,
        args: [String(err).slice(0, 300), id],
      });
    }
  }

  logStructured('info', {
    at: 'audio-retention.drain',
    processed: pending.rows.length,
    succeeded,
  });
}

/**
 * TTL 경과 오디오를 큐에 적재하고 DB 행을 정리한다 — cron 전용.
 * 실제 R2 삭제는 다음 drain 주기가 처리한다 (큐 적재만 하므로 가볍다).
 */
export async function cleanupExpiredAudio(db: Client, now: Date): Promise<void> {
  const uploadCutoff = new Date(
    now.getTime() - VOICE_UPLOAD_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const generatedCutoff = new Date(
    now.getTime() - GENERATED_TTS_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 1) 클론 학습용 업로드 원본 — 클론 완료 후 보관 불필요.
  const uploads = await db.execute({
    sql: `SELECT id, object_key FROM voice_uploads
          WHERE created_at <= ?
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [uploadCutoff, TTL_BATCH_SIZE],
  });
  for (const row of uploads.rows) {
    const uploadId = String(row.id);
    await enqueueExternalDeletion(db, 'r2_object', row.object_key as string);
    await db.execute({
      sql: 'DELETE FROM voice_speakers WHERE upload_id = ?',
      args: [uploadId],
    });
    await db.execute({
      sql: 'DELETE FROM voice_uploads WHERE id = ?',
      args: [uploadId],
    });
  }

  // 2) TTS 캐시 — 알람 raw_audio_url 이 참조 중인 오브젝트는 보존.
  const generated = await db.execute({
    sql: `SELECT g.id, g.audio_object_key FROM generated_audio_assets g
          WHERE g.created_at <= ?
            AND g.audio_object_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM alarms a
              WHERE a.raw_audio_url = 'r2://' || g.audio_object_key
            )
          ORDER BY g.created_at ASC
          LIMIT ?`,
    args: [generatedCutoff, TTL_BATCH_SIZE],
  });
  for (const row of generated.rows) {
    await enqueueExternalDeletion(db, 'r2_object', row.audio_object_key as string);
    await db.execute({
      sql: 'DELETE FROM generated_audio_assets WHERE id = ?',
      args: [String(row.id)],
    });
  }

  if (uploads.rows.length > 0 || generated.rows.length > 0) {
    logStructured('info', {
      at: 'audio-retention.ttl',
      expired_uploads: uploads.rows.length,
      expired_generated: generated.rows.length,
    });
  }
}
