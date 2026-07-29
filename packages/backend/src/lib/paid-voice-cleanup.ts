import type { DbExecutor } from './transactions';
import { enqueueExternalDeletion, enqueueUserVoiceArtifacts } from './audio-retention';

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function placeholders(ids: string[]): string {
  return ids.map(() => '?').join(',');
}

/** 이 정리로 sound-only 로 강등된 알람 하나. 호출자가 커밋 후 신호를 보낸다. */
export interface DowngradedAlarm {
  alarmId: string;
  /**
   * 이 알람이 실제로 울리는 기기의 주인.
   *
   * 가족알람(POST /family/alarms/voice)은 alarms.user_id 가 **발신자**, target_user_id 가
   * **수신자**다(family-alarm.ts). 캐시해 둔 녹음으로 울리는 쪽은 수신자이므로 target 을
   * 우선한다. 일반 알람은 target 이 없어 소유자로 떨어진다.
   */
  ownerUserId: string;
}

/** 강등 대상 알람의 id 와 '울리는 기기의 주인'을 강등 전에 모은다. */
async function collectDowngradeTargets(
  db: DbExecutor,
  sql: string,
  args: string[],
): Promise<DowngradedAlarm[]> {
  const rows = await db.execute({ sql, args });
  return rows.rows
    .map((r) => ({
      alarmId: String(r.id ?? ''),
      ownerUserId: String(r.owner_user_id ?? ''),
    }))
    .filter((x) => x.alarmId && x.ownerUserId);
}

/**
 * 삭제될 voice_profiles 를 가리키는 호칭/관계 행을 먼저 지운다.
 *
 * voice_profile_relationships.voice_profile_id 는 voice_profiles FK 라(마이그레이션 #37),
 * 프로필을 먼저 지우면 FK 가 켜져 있을 때 삭제가 던져 보관 정리가 통째로 중단되고
 * (paid_voice_retention 행이 안 지워져 만료 처리가 매번 같은 자리에서 멈춘다), 꺼져 있으면
 * 사라진 프로필을 가리키는 호칭 행이 남는다. account-deletion.ts 가 같은 이유로 이미
 * 자식-우선으로 지운다.
 *
 * 다만 스코프는 계정 삭제보다 좁다 — '삭제되는 프로필을 참조하는' 행만 지운다. 이 사용자가
 * 남의 공유 목소리에 붙여 둔 호칭은 계정이 살아 있으므로 그대로 둔다.
 */
async function deleteRelationshipsForOwnedProfiles(db: DbExecutor, ids: string[], ph: string) {
  await db.execute({
    sql: `DELETE FROM voice_profile_relationships
          WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    args: ids,
  });
}

/**
 * 이 사용자의 업로드 오브젝트를 참조하는 '수신자 소유' 가족알람 메시지를 끊는다.
 *
 * POST /family/alarms/voice 는 발신자의 voice_uploads.object_key 를 **수신자 소유**
 * messages.audio_url 에 담는다(family-alarm.ts). 소유자 기준 강등/삭제는 발신자 id·발신자
 * 프로필로만 고르므로 그 메시지를 건드리지 못하는데, 아래 정리는 그 오브젝트를 R2 에서
 * 지운다. 그대로 두면 서버는 '음성 있음'으로 광고하지만 /tts/messages/:id/audio 가 실패해,
 * 수신자 앱이 조용히 기본음 알람으로 되돌아간다(사용자에겐 목소리가 사라진 것처럼 보인다).
 *
 * 오브젝트를 지우기 전에 알람을 sound-only 로 명시 강등하고 audio_url 을 비워, 서버 상태와
 * 클라 폴백이 같은 말을 하게 한다. 메시지 행 자체는 수신자 데이터라 지우지 않는다.
 *
 * @returns 강등된 알람들 — 호출자가 정리 커밋 후 신호를 보내 즉시 반영시킨다.
 */
async function detachFamilyAlarmMessagesUsingOwnedUploads(
  db: DbExecutor,
  ids: string[],
  ph: string,
): Promise<DowngradedAlarm[]> {
  const affectedMessages = `SELECT id FROM messages
     WHERE audio_url IS NOT NULL
       AND audio_url IN (SELECT object_key FROM voice_uploads WHERE user_id IN (${ph}))`;
  // 강등 '전에' 대상을 모아 둔다 — UPDATE 가 message_id 를 끊고 나면 다시 찾을 수 없다.
  const owners = await collectDowngradeTargets(
    db,
    `SELECT id, COALESCE(target_user_id, user_id) AS owner_user_id FROM alarms
      WHERE message_id IN (${affectedMessages})`,
    ids,
  );
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only',
              wake_mode = 'sound_then_voice',
              message_id = NULL,
              voice_profile_id = NULL
          WHERE message_id IN (${affectedMessages})`,
    args: ids,
  });
  await db.execute({
    sql: `UPDATE messages SET audio_url = NULL WHERE id IN (${affectedMessages})`,
    args: ids,
  });
  return owners;
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
  await detachFamilyAlarmMessagesUsingOwnedUploads(db, ids, ph);

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

  await deleteRelationshipsForOwnedProfiles(db, ids, ph);
  await db.execute({
    sql: `DELETE FROM voice_profiles WHERE user_id IN (${ph})`,
    args: ids,
  });
}

/**
 * 해지 즉시 '클론 목소리'만 반납한다 — 제공자(ElevenLabs) 보이스를 삭제 큐에 넣고
 * voice_profiles 를 슬롯 상한 eviction 과 **같은 상태**로 만든다.
 *
 * 원본 업로드(voice_uploads)와 이미 만들어 둔 음성(generated_audio_assets)은 남긴다.
 * 유예 안에 다시 이용권을 등록하면 tts 경로가 그 원본으로 클론을 다시 만들어 주므로,
 * 사용자에겐 목소리가 그대로 돌아온 것처럼 보인다. 유예가 지나면 sweepPaidVoiceRetention
 * 이 남은 원본·생성 음성까지 정리한다.
 *
 * 복구 경로가 요구하는 표식을 빠짐없이 남겨야 한다(voice-slots.ts 의 evict 와 동일):
 *  - `evicted_at`: tts.ts 는 `elevenlabs_voice_id IS NULL` **이고** `evicted_at` 이 있을 때만
 *    재클론·캐시프로브 경로를 탄다. 이걸 빼면 복구는커녕 NO_VOICE_ID 로 떨어진다.
 *  - `evicted_provider_voice_id`: 캐시 키가 provider voice id 를 포함하므로, 옛 id 를 남겨
 *    두면 보관 중인 오디오를 재클론 없이 그대로 서빙할 수 있다.
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
  // UPDATE 의 우변은 갱신 전 행 값으로 평가되므로(SQLite 의미론) 같은 문장에서 기존 id 를
  // 안전하게 보관할 수 있다.
  try {
    await db.execute({
      sql: `UPDATE voice_profiles
            SET evicted_provider_voice_id = elevenlabs_voice_id,
                elevenlabs_voice_id = NULL,
                evicted_at = datetime('now'),
                updated_at = datetime('now')
            WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
      args: ids,
    });
  } catch (err) {
    // 배포 → 마이그레이션 순서라 #77 적용 전 짧은 창에서는 이 컬럼이 없다. 그 창에서 해지가
    // 실패하지 않도록 구 스키마 폴백으로 반납 자체는 진행한다(캐시 프로브만 포기).
    // evicted_at 은 이쪽에서도 반드시 찍는다 — 없으면 재클론 경로 자체가 막힌다.
    if (!/no such column/i.test(String(err))) throw err;
    await db.execute({
      sql: `UPDATE voice_profiles
            SET elevenlabs_voice_id = NULL,
                evicted_at = datetime('now'),
                updated_at = datetime('now')
            WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
      args: ids,
    });
  }
}

/**
 * @returns 이 정리로 sound-only 로 강등된 알람들. 호출자가 커밋 후 신호를 보내 즉시
 *          반영시킨다 — 이 스윕은 플랜 변경 3일 뒤에 도는데, 그때까지 앱을 안 켠 수신자는
 *          이미 캐시한 오디오로 계속 울린다. 다음 앱 시작/주기 동기화까지 기다리면 그사이
 *          알람이 먼저 울릴 수 있다(AGENTS.md 의 FCM 상태 동기화).
 */
export async function deleteSensitiveVoiceDataForUser(
  db: DbExecutor,
  userPk: string,
  userLoginId?: string | null,
): Promise<DowngradedAlarm[]> {
  const ids = uniqueIds([userPk, userLoginId]);
  if (ids.length === 0) return [];
  const ph = placeholders(ids);
  const downgraded = new Map<string, DowngradedAlarm>();

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
  for (const target of await detachFamilyAlarmMessagesUsingOwnedUploads(db, ids, ph)) {
    downgraded.set(target.alarmId, target);
  }

  // 공유 목소리를 참조하던 알람도 같은 이유로 강등 전에 대상을 골라 둔다.
  const sharedVoiceTargets = await collectDowngradeTargets(
    db,
    `SELECT id, COALESCE(target_user_id, user_id) AS owner_user_id FROM alarms
      WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))
         OR message_id IN (
           SELECT id FROM messages
           WHERE user_id IN (${ph}) OR voice_profile_id IN (
             SELECT id FROM voice_profiles WHERE user_id IN (${ph})
           )
         )`,
    [...ids, ...ids, ...ids],
  );
  for (const target of sharedVoiceTargets) downgraded.set(target.alarmId, target);
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
  await deleteRelationshipsForOwnedProfiles(db, ids, ph);
  await db.execute({ sql: `DELETE FROM voice_profiles WHERE user_id IN (${ph})`, args: ids });
  return Array.from(downgraded.values());
}
