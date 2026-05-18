import type { DbExecutor } from './transactions';

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

  await db.execute({
    sql: `DELETE FROM alarms
          WHERE user_id IN (${ph})
             OR target_user_id IN (${ph})
             OR voice_profile_id IN (
               SELECT id FROM voice_profiles WHERE user_id IN (${ph})
             )
             OR message_id IN (
               SELECT id FROM messages
               WHERE user_id IN (${ph})
                  OR voice_profile_id IN (
                    SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                  )
             )`,
    args: [...ids, ...ids, ...ids, ...ids, ...ids],
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
