import type { DbExecutor } from './transactions';
import { enqueueUserVoiceArtifacts } from './audio-retention';

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function placeholders(ids: string[]): string {
  return ids.map(() => '?').join(',');
}

export async function deletePaidVoiceDataForUser(
  db: DbExecutor,
  userPk: string,
  userLoginId?: string | null,
): Promise<void> {
  const ids = uniqueIds([userPk, userLoginId]);
  if (ids.length === 0) return;
  const ph = placeholders(ids);

  // ElevenLabs 클론/R2 오디오 외부 삭제 참조를 행 삭제 전에 큐에 적재 —
  // 다운그레이드로 유료 음성 데이터가 사라질 때 클로닝 본체도 함께 사라지게 한다.
  await enqueueUserVoiceArtifacts(db, ids);

  await db.execute({
    sql: `DELETE FROM notes WHERE sender_id = ? OR receiver_id = ?`,
    args: [userPk, userPk],
  });

  await db.execute({
    sql: `DELETE FROM generated_audio_assets
          WHERE user_id IN (${ph})
             OR voice_profile_id IN (
               SELECT id FROM voice_profiles WHERE user_id IN (${ph})
             )
             OR message_id IN (
               SELECT id FROM messages WHERE user_id IN (${ph})
             )`,
    args: [...ids, ...ids, ...ids],
  });

  // 강등/삭제되는 사용자의 (공유) 목소리를 참조하는 '타인 소유' 알람은 하드 삭제하지 않고
  // sound-only 로 강등한다 — 공유 목소리를 준 사람이 취소해도 수신자의 기상 알람 자체는 보존해야
  // 하므로(voice-profile.ts 명시적 삭제 경로와 동일 정책). 하드 삭제는 본인/본인-대상 알람으로 한정.
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only',
              wake_mode = 'sound_then_voice',
              message_id = NULL,
              voice_profile_id = NULL,
              speaker_id = NULL,
              raw_audio_url = NULL,
              raw_audio_duration_ms = NULL
          WHERE user_id NOT IN (${ph})
            AND (
              voice_profile_id IN (
                SELECT id FROM voice_profiles WHERE user_id IN (${ph})
              )
              OR message_id IN (
                SELECT id FROM messages
                WHERE user_id IN (${ph})
                   OR voice_profile_id IN (
                     SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                   )
              )
            )`,
    args: [...ids, ...ids, ...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM alarms
          WHERE user_id IN (${ph})
             OR target_user_id IN (${ph})`,
    args: [...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM message_library
          WHERE user_id IN (${ph})
             OR message_id IN (
               SELECT id FROM messages
               WHERE user_id IN (${ph})
                  OR voice_profile_id IN (
                    SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                  )
             )`,
    args: [...ids, ...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM gifts
          WHERE sender_id IN (${ph})
             OR recipient_id IN (${ph})
             OR message_id IN (
               SELECT id FROM messages
               WHERE user_id IN (${ph})
                  OR voice_profile_id IN (
                    SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                  )
             )`,
    args: [...ids, ...ids, ...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM messages
          WHERE user_id IN (${ph})
             OR voice_profile_id IN (
               SELECT id FROM voice_profiles WHERE user_id IN (${ph})
             )`,
    args: [...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM voice_speakers
          WHERE upload_id IN (
            SELECT id FROM voice_uploads WHERE user_id IN (${ph})
          )`,
    args: ids,
  });

  await db.execute({
    sql: `DELETE FROM voice_uploads WHERE user_id IN (${ph})`,
    args: ids,
  });

  await db.execute({
    sql: `DELETE FROM voice_profiles WHERE user_id IN (${ph})`,
    args: ids,
  });
}
