import type { DbExecutor } from './transactions';
import { enqueueExternalDeletion, enqueueUserVoiceArtifacts } from './audio-retention';

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
              voice_profile_id = NULL

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

  // 삭제 스코프는 '호출 사용자 소유 데이터'로 한정한다. 나를 target 으로 한 타인(발신자)
  // 소유 알람 행은 발신자의 데이터이므로 삭제하지 않는다 — 그 알람이 내 목소리/메시지를
  // 참조하는 경우는 위 sound-only 강등 UPDATE 가 이미 끊었다. (계정 삭제는 이 함수가 아니라
  // purgeUserAccount(account-deletion.ts)가 자체 스코프로 target 알람까지 정리한다.)
  await db.execute({
    sql: `DELETE FROM alarms WHERE user_id IN (${ph})`,
    args: ids,
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
    sql: `DELETE FROM messages
          WHERE user_id IN (${ph})
             OR voice_profile_id IN (
               SELECT id FROM voice_profiles WHERE user_id IN (${ph})
             )`,
    args: [...ids, ...ids],
  });

  await db.execute({
    sql: `DELETE FROM voice_uploads WHERE user_id IN (${ph})`,
    args: ids,
  });

  await db.execute({
    sql: `DELETE FROM voice_prerender_queue WHERE owner_user_id IN (${ph})`,
    args: ids,
  });

  await db.execute({
    sql: `DELETE FROM voice_profiles WHERE user_id IN (${ph})`,
    args: ids,
  });
}

/**
 * 해지 즉시 '클론 목소리'만 반납한다 — 제공자(ElevenLabs) 보이스를 삭제 큐에 넣고
 * voice_profiles.elevenlabs_voice_id 를 비운다.
 *
 * 원본 업로드(voice_uploads)와 이미 만들어 둔 음성(generated_audio_assets)은 남긴다.
 * 유예 안에 다시 이용권을 등록하면 tts 경로의 recloneEvictedVoiceProfile 이 그 원본으로
 * 클론을 다시 만들어 주므로, 사용자에겐 목소리가 그대로 돌아온 것처럼 보인다.
 * 유예가 지나면 sweepPaidVoiceRetention 이 남은 원본·생성 음성까지 정리한다.
 */
export async function releaseClonedVoicesForUser(
  db: DbExecutor,
  userPk: string,
  userLoginId?: string | null,
): Promise<void> {
  const ids = uniqueIds([userPk, userLoginId]);
  if (ids.length === 0) return;
  const ph = placeholders(ids);
  const voices = await db.execute({
    sql: `SELECT elevenlabs_voice_id FROM voice_profiles
          WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
    args: ids,
  });
  for (const row of voices.rows) {
    await enqueueExternalDeletion(db, 'elevenlabs_voice', row.elevenlabs_voice_id as string);
  }
  // 비워 두면 다음 사용 시점에 재클론 경로가 자동으로 탄다(tts.ts 의 NO_VOICE_ID 폴백).
  await db.execute({
    sql: `UPDATE voice_profiles SET elevenlabs_voice_id = NULL, updated_at = datetime('now')
          WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
    args: ids,
  });
}

export async function deleteSensitiveVoiceDataForUser(
  db: DbExecutor,
  userPk: string,
  userLoginId?: string | null,
): Promise<void> {
  const ids = uniqueIds([userPk, userLoginId]);
  if (ids.length === 0) return;
  const ph = placeholders(ids);

  const providerVoices = await db.execute({
    sql: `SELECT elevenlabs_voice_id FROM voice_profiles
          WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
    args: ids,
  });
  for (const row of providerVoices.rows) {
    await enqueueExternalDeletion(db, 'elevenlabs_voice', row.elevenlabs_voice_id as string);
  }
  const uploadObjects = await db.execute({
    sql: `SELECT object_key FROM voice_uploads WHERE user_id IN (${ph})`,
    args: ids,
  });
  for (const row of uploadObjects.rows) {
    await enqueueExternalDeletion(db, 'r2_object', row.object_key as string);
  }
  const generatedObjects = await db.execute({
    sql: `SELECT audio_object_key FROM generated_audio_assets
          WHERE audio_object_key IS NOT NULL
            AND (user_id IN (${ph}) OR voice_profile_id IN (
              SELECT id FROM voice_profiles WHERE user_id IN (${ph})
            ))`,
    args: [...ids, ...ids],
  });
  for (const row of generatedObjects.rows) {
    await enqueueExternalDeletion(db, 'r2_object', row.audio_object_key as string);
  }

  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only', wake_mode = 'sound_then_voice',
              message_id = NULL, voice_profile_id = NULL
          WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))
             OR message_id IN (
               SELECT id FROM messages
               WHERE user_id IN (${ph}) OR voice_profile_id IN (
                 SELECT id FROM voice_profiles WHERE user_id IN (${ph})
               )
             )`,
    args: [...ids, ...ids, ...ids],
  });
  await db.execute({
    sql: `DELETE FROM generated_audio_assets
          WHERE user_id IN (${ph}) OR voice_profile_id IN (
            SELECT id FROM voice_profiles WHERE user_id IN (${ph})
          )`,
    args: [...ids, ...ids],
  });
  await db.execute({
    sql: `DELETE FROM message_library WHERE message_id IN (
            SELECT id FROM messages
            WHERE user_id IN (${ph}) OR voice_profile_id IN (
              SELECT id FROM voice_profiles WHERE user_id IN (${ph})
            )
          )`,
    args: [...ids, ...ids],
  });
  await db.execute({
    sql: `DELETE FROM messages
          WHERE user_id IN (${ph}) OR voice_profile_id IN (
            SELECT id FROM voice_profiles WHERE user_id IN (${ph})
          )`,
    args: [...ids, ...ids],
  });
  await db.execute({ sql: `DELETE FROM voice_uploads WHERE user_id IN (${ph})`, args: ids });
  await db.execute({
    sql: `DELETE FROM voice_prerender_queue WHERE owner_user_id IN (${ph})`,
    args: ids,
  });
  await db.execute({ sql: `DELETE FROM voice_profiles WHERE user_id IN (${ph})`, args: ids });
}
