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
// 알람에 연결되지 않은 raw-alarms 업로드의 유예 시간. 업로드 직후 알람에 붙는
// 정상 흐름은 보존하면서, 이탈로 버려진 클립만 정리할 만큼 넉넉하게 잡는다.
export const RAW_ALARM_UPLOAD_TTL_DAYS = 2;

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

  // 추적된 raw-alarms 업로드(알람에 연결되지 않은 것 포함) — 계정 삭제 시 함께 정리.
  const rawTracked = await tx.execute({
    sql: `SELECT object_key FROM raw_alarm_uploads WHERE user_id IN (${ph})`,
    args: ownerIds,
  });
  for (const row of rawTracked.rows) {
    await enqueueExternalDeletion(tx, 'r2_object', row.object_key as string);
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

  // 2) TTS 캐시 — 알람이 참조 중인 오브젝트는 보존한다.
  //    알람은 (a) raw_audio_url 로 직접, 또는 (b) message_id → messages.audio_url 로
  //    간접 참조할 수 있다. 두 경로를 모두 확인하지 않으면 활성 알람이 쓰는 TTS
  //    오브젝트가 30일 후 삭제되어 알람이 무음이 된다(기존 가드는 (a)만 검사해
  //    generated-tts 키를 한 번도 매칭하지 못하는 dead guard 였다).
  const generated = await db.execute({
    sql: `SELECT g.id, g.audio_object_key FROM generated_audio_assets g
          WHERE g.created_at <= ?
            AND g.audio_object_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM alarms a
              WHERE a.raw_audio_url = 'r2://' || g.audio_object_key
            )
            AND NOT EXISTS (
              SELECT 1 FROM alarms a
              JOIN messages m ON m.id = a.message_id
              WHERE m.audio_url = 'r2://' || g.audio_object_key
            )
            -- 시스템 스톡(프리셋) 클립은 무료 버킷 회전·미리듣기용으로 의도적으로 보관한다.
            -- 다수 variant 가 alarm.message_id 로 직접 참조되지 않으므로 TTL 정리에서 제외한다
            -- (제외 안 하면 30일 후 audio_url 이 비워져 /tts/stock-clips 가 끊기고 재시드 전까지
            -- 무료 음성이 무음이 된다).
            AND NOT EXISTS (
              SELECT 1 FROM messages mp
              WHERE mp.id = g.message_id AND COALESCE(mp.is_preset, 0) = 1
            )
          ORDER BY g.created_at ASC
          LIMIT ?`,
    args: [generatedCutoff, TTL_BATCH_SIZE],
  });
  for (const row of generated.rows) {
    const objectKey = row.audio_object_key as string;
    await enqueueExternalDeletion(db, 'r2_object', objectKey);
    // 라이브러리 메시지가 가리키던 포인터를 비워, 오브젝트 삭제 후 깨진 r2:// 참조
    // (재생 시 404)가 라이브러리에 남지 않도록 한다.
    await db.execute({
      sql: `UPDATE messages SET audio_url = NULL WHERE audio_url = 'r2://' || ?`,
      args: [objectKey],
    });
    await db.execute({
      sql: 'DELETE FROM generated_audio_assets WHERE id = ?',
      args: [String(row.id)],
    });
  }

  // 3) raw-alarms 직접 재생 클립 — 업로드 후 어떤 알람에도 연결되지 않은 채
  //    TTL 이 지나면 정리한다. 알람이 raw_audio_url 로 참조 중이면 보존한다.
  const rawUploadCutoff = new Date(
    now.getTime() - RAW_ALARM_UPLOAD_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rawUploads = await db.execute({
    sql: `SELECT id, object_key FROM raw_alarm_uploads
          WHERE created_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM alarms a
              WHERE a.raw_audio_url = 'r2://' || raw_alarm_uploads.object_key
            )
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [rawUploadCutoff, TTL_BATCH_SIZE],
  });
  for (const row of rawUploads.rows) {
    await enqueueExternalDeletion(db, 'r2_object', row.object_key as string);
    await db.execute({
      sql: 'DELETE FROM raw_alarm_uploads WHERE id = ?',
      args: [String(row.id)],
    });
  }

  if (uploads.rows.length > 0 || generated.rows.length > 0 || rawUploads.rows.length > 0) {
    logStructured('info', {
      at: 'audio-retention.ttl',
      expired_uploads: uploads.rows.length,
      expired_generated: generated.rows.length,
      expired_raw_uploads: rawUploads.rows.length,
    });
  }
}
