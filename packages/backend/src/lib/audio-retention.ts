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
 *    - voice_uploads(클론 학습용 원본): 확정 목소리는 재생성·말투 분석 재시도용으로
 *      프로필 삭제까지 보관. 미확정 초안·프로필 미연결 원본만 7일 경과 시 삭제.
 *    - generated_audio_assets(TTS 캐시): 기기들이 로컬 캐싱하므로 서버 보관은
 *      전달용 버퍼다 → 30일 경과 시 삭제. 단 알람이 message_id 로 참조 중인
 *      오브젝트와 시스템/클론 프리셋 클립은 건너뛴다.
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
// 화자 분리 후보(draft) 보이스의 유예 시간. 다이얼로그 안에서 몇 분 내 선택/정리되는
// 임시물이라 1시간이면 충분히 넉넉하다 — 앱 강제종료 등으로 클라이언트 정리를 못 거친
// 고아만 걸린다.
export const DRAFT_VOICE_TTL_HOURS = 1;

const DRAIN_BATCH_SIZE = 10;
const TTL_BATCH_SIZE = 10;

export type ExternalDeletionKind = 'elevenlabs_voice' | 'r2_object';

/**
 * 큐 일괄 적재 — ref 하나당 INSERT 를 날리면 자산이 많은 목소리 삭제(사전렌더 21클립×언어
 * 재생성 이력 등)에서 Workers 서브리퀘스트 한도를 넘겨 요청 전체가 500 난다. 청크
 * multi-VALUES 로 묶어 자산 수와 무관하게 상수 수준의 호출로 유지한다.
 */
export async function enqueueExternalDeletionsBatch(
  tx: DbExecutor,
  kind: ExternalDeletionKind,
  refs: Array<string | null | undefined>,
): Promise<void> {
  const unique = Array.from(
    new Set(refs.map((r) => r?.trim()).filter((r): r is string => Boolean(r))),
  );
  const CHUNK = 40;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const values = chunk.map(() => '(?, ?, ?)').join(', ');
    await tx.execute({
      sql: `INSERT OR IGNORE INTO pending_external_deletions (id, kind, ref) VALUES ${values}`,
      args: chunk.flatMap((ref) => [crypto.randomUUID(), kind, ref]),
    });
  }
}

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
 * 대상은 본인 소유 자원뿐이다 — 클론 voice, 클론 학습용 업로드 원본(voice_uploads),
 * 본인 메시지/보이스로 생성된 TTS 오브젝트(generated_audio_assets).
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

}

/** 큐를 배치로 비운다 — cron 전용. 외부 API 호출이 있으므로 트랜잭션 밖에서 실행. */
export async function drainExternalDeletions(db: Client, env: Env): Promise<void> {
  const pending = await db.execute({
    sql: `WITH
            retry AS (
              SELECT id, kind, ref, attempts, created_at
              FROM pending_external_deletions
              WHERE attempts > 0
              ORDER BY attempts ASC, created_at ASC
              LIMIT ?
            ),
            fresh AS (
              SELECT id, kind, ref, attempts, created_at
              FROM pending_external_deletions
              WHERE attempts = 0
              ORDER BY created_at ASC
              LIMIT ?
            )
          SELECT id, kind, ref, attempts FROM retry
          UNION ALL
          SELECT id, kind, ref, attempts FROM fresh`,
    args: [Math.floor(DRAIN_BATCH_SIZE / 2), Math.ceil(DRAIN_BATCH_SIZE / 2)],
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
 * TTL 이 지난 고아 draft 보이스를 정리한다 — cron 전용.
 *
 * draft(화자 분리 후보)는 목소리 만들기 다이얼로그가 닫힐 때 클라이언트가 지우는
 * 임시물이지만, 앱 강제종료/크래시로 정리를 못 거치면 영구 고아가 된다: 일반 목록은
 * is_draft=0 만 노출해 사용자가 지울 방법이 없고, draft 쿼터(MAX_DRAFT_VOICE_PROFILES)와
 * ElevenLabs 슬롯을 무기한 점유해 이후 draft 생성이 VOICE_LIMIT_REACHED 로 막힌다.
 * → TTL 경과 draft 를 소프트 삭제하고 클론 voice 는 외부 삭제 큐로 회수한다.
 *
 * created_at 은 datetime('now')(공백 구분) 포맷이고 cutoff 는 ISO(T 구분)라, 원시 텍스트
 * 비교는 같은 날짜에서 항상 참이 되어 방금 만든 draft 까지 쓸어버린다 — 반드시
 * datetime() 으로 양쪽을 정규화해 비교한다.
 */
export async function cleanupStaleDraftVoices(db: Client, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DRAFT_VOICE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const stale = await db.execute({
    sql: `SELECT id, elevenlabs_voice_id FROM voice_profiles
          WHERE COALESCE(is_draft, 0) = 1
            AND deleted_at IS NULL
            AND datetime(created_at) <= datetime(?)
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [cutoff, TTL_BATCH_SIZE],
  });
  let expired = 0;
  for (const row of stale.rows) {
    // 소프트 삭제를 먼저 '클레임'하고(가드 재확인), 성공했을 때만 클론 파기를 큐에 넣는다.
    // 순서를 바꾸면 SELECT 와 UPDATE 사이에 promote(is_draft=0)된 정식 보이스의 클론이
    // 큐에 적재돼 파기되는 TOCTOU 레이스가 생긴다.
    const claimed = await db.execute({
      sql: `UPDATE voice_profiles
            SET deleted_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ? AND COALESCE(is_draft, 0) = 1 AND deleted_at IS NULL`,
      args: [String(row.id)],
    });
    if ((claimed.rowsAffected ?? 0) === 0) continue;
    await enqueueExternalDeletion(db, 'elevenlabs_voice', row.elevenlabs_voice_id as string | null);
    expired += 1;
  }
  if (expired > 0) {
    logStructured('info', {
      at: 'audio-retention.stale_drafts',
      expired,
    });
  }
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

  // 1) 클론 학습용 업로드 원본.
  //    최종 확정(promote)된 목소리의 원본은 보관한다 — 나중에 프로바이더/API 키가 바뀌어도
  //    이 원본으로 클론을 재생성할 수 있어야 하기 때문(voice_profile_id 로 연결·live·non-draft).
  //    그 외(미승격 draft, 프로필과 무관한 raw 업로드, 삭제된 프로필의 잔여분)만 7일 후 정리한다.
  //    확정 목소리를 명시적으로 삭제하면 DELETE /voice/:id 가 원본을 함께 cascade 삭제한다.
  const uploads = await db.execute({
    sql: `SELECT id, object_key FROM voice_uploads
          WHERE created_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM voice_profiles vp
              WHERE vp.id = voice_uploads.voice_profile_id
                AND vp.deleted_at IS NULL
                AND COALESCE(vp.is_draft, 0) = 0
            )
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [uploadCutoff, TTL_BATCH_SIZE],
  });
  for (const row of uploads.rows) {
    const uploadId = String(row.id);
    // TOCTOU 하드닝: 위 SELECT 와 이 삭제 사이에 이 업로드의 draft 가 promote 되어 프로필이
    // live·non-draft(확정)가 됐다면 원본을 지우면 안 된다(재생성 소스 유실 방지). 삭제 조건을
    // 다시 걸고, 실제로 지워졌을 때만 R2 삭제를 큐에 적재한다.
    const deletedUpload = await db.execute({
      sql: `DELETE FROM voice_uploads
            WHERE id = ?
              AND NOT EXISTS (
                SELECT 1 FROM voice_profiles vp
                WHERE vp.id = voice_uploads.voice_profile_id
                  AND vp.deleted_at IS NULL
                  AND COALESCE(vp.is_draft, 0) = 0
              )`,
      args: [uploadId],
    });
    if ((deletedUpload.rowsAffected ?? 0) === 0) continue; // 그 사이 확정됨 → 원본 보관
    await enqueueExternalDeletion(db, 'r2_object', row.object_key as string);
  }

  // 2) TTS 캐시 — 알람이 message_id → messages.audio_url 로 참조 중인 오브젝트는
  //    보존한다. 이 가드가 없으면 활성 알람이 쓰는 TTS 오브젝트가 TTL 후 삭제되어
  //    알람이 무음이 된다.
  //
  //    ⚠ **받은(가족) 알람은 이 보존 대상이 아니다.** 수신 확인이 끝나면 서버 행이
  //    지워지므로(`POST /alarm/:id/received`) 이 EXISTS 에 걸리지 않고, 그 음원은 TTL
  //    대로 정리된다. 그래도 되는 이유는 **수신자 기기가 이미 음원을 로컬에 갖고 있기
  //    때문**이다 — ack 는 다운로드가 끝난 뒤에만 나간다. 뒤집어 말하면 클라가 음원
  //    확보 전에 ack 하면 이 정리가 그 알람의 음원을 지워도 아무도 막지 못한다.
  //    (전달 전 알람은 행이 남아 있으므로 여기서 정상적으로 보존된다.)
  const generated = await db.execute({
    sql: `SELECT g.id, g.audio_object_key FROM generated_audio_assets g
          WHERE g.created_at <= ?
            AND g.audio_object_key IS NOT NULL
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

  if (uploads.rows.length > 0 || generated.rows.length > 0) {
    logStructured('info', {
      at: 'audio-retention.ttl',
      expired_uploads: uploads.rows.length,
      expired_generated: generated.rows.length,
    });
  }
}
