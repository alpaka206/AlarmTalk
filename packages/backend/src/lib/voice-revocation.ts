import type { DbExecutor } from './transactions';

/**
 * 목소리가 사라졌을 때 걷어내야 할 알람 하나. 그대로 `notifyDowngradedAlarms` 의 target 이다.
 */
export type RevokedAlarmTarget = {
  alarmId: string;
  ownerUserId: string;
  isReceived: boolean;
};

/** 커밋 후 보내야 할 알림. 그대로 `notifyDowngradedAlarms` 의 3·4번째 인자다. */
export type VoiceRevocationNotifications = {
  /** 서버가 실제로 찾아낸 강등 대상. 받은 알람이면 pull, 본인 알람이면 접근권 재확인. */
  downgradedAlarms: RevokedAlarmTarget[];
  /**
   * 알람 행과 **무관하게** 목소리 접근권을 잃은 계정들.
   *
   * 알람의 원본은 기기다 — 아직 서버로 올라오지 않은 알람은 위 목록에 안 잡히는데,
   * 발사는 로컬이고 울림 시점에 '이 목소리를 아직 쓸 수 있는가' 를 보는 게이트도 없다.
   * 그래서 **그 목소리를 볼 수 있었던 사람 전부**를 깨워 각자 다시 판단하게 한다
   * (`VoiceAccessSyncWorker` / iOS `onAuthoritativeRefresh`).
   */
  voiceAccessRevokedUserIds: string[];
};

export type RevokeDeletedVoicesOptions = {
  /** 사라진 목소리들. **클론만** 넘긴다 — 스톡(is_system)은 없어지지 않는다. */
  voiceProfileIds: string[];
  /** 그 목소리들의 주인. 같은 플랜 그룹에 있던 사람을 찾는 기준이다. */
  ownerUserIds: string[];
  /**
   * 알림에서 뺄 계정. 탈퇴처럼 **주인 계정이 곧 사라지는** 경우에만 채운다 —
   * 이미 없어진 기기에 철회 푸시를 보내지 않기 위해서다.
   */
  excludeOwnerUserIds?: string[];
};

const DOWNGRADE_COLUMNS = `mode = 'sound-only', wake_mode = 'sound_then_voice',
                           message_id = NULL, voice_profile_id = NULL`;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

/**
 * **목소리가 사라졌을 때 도는 단 하나의 로직.**
 *
 * 호출부는 셋이고 전부 "이 클론 목소리가 이제 없다" 는 같은 사실을 말한다:
 *  - `DELETE /voice-profiles/:id` — 사용자가 직접 지웠다
 *  - `purgeUserAccount` — 탈퇴로 내 목소리가 전부 파기된다
 *  - 플랜 강등 스윕(`paid-voice-cleanup`) — 유료 권한을 잃어 클론이 회수된다
 *
 * ⚠ **여기 말고 다른 곳에서 알람의 목소리를 벗기지 말 것.** 예전에는 탈퇴가 자기만의
 * 갈래를 갖고 있었고(보낸 알람을 목소리와 무관하게 전부 철회), 목소리 삭제는 알람 행만
 * 조용히 내리고 **푸시를 아예 안 보냈다** — 같은 사건인데 결과가 셋으로 갈렸다.
 *
 * ## 무엇을 걷어내는가
 *
 * **그 목소리를 쓰는 알람만.** 스톡 목소리로 만든 알람은 보낸 사람이 탈퇴해도 그대로
 * 둔다 — 파기해야 할 것은 **생체정보(내 녹음)** 이지 남의 기상 시각이 아니다. 받은
 * 알람은 받은 순간부터 받은 사람 것이라(`docs/spec/family-alarm.md`), 지울 근거가
 * 목소리 말고는 없다.
 *
 * ## 두 갈래를 모두 봐야 하는 이유
 *
 * 대상은 두 곳에 나뉘어 있다. 하나만 보면 절반이 남는다:
 *  1. **살아 있는 `alarms` 행** — 아직 수신 확인이 안 된 보낸 알람, 그리고 내 목소리를
 *     공유받아 **자기 알람**에 골라 둔 그룹 멤버의 행.
 *  2. **tombstone**(`alarm_recipient_state.voice_profile_id`) — 이미 전달이 끝나 행이
 *     지워진 알람. 수신자 기기에는 그대로 살아 있고 캐시된 녹음으로 계속 운다.
 *     행이 없으니 1번 조회로는 **영영 못 찾는다**.
 */
export async function revokeDeletedVoices(
  tx: DbExecutor,
  { voiceProfileIds, ownerUserIds, excludeOwnerUserIds = [] }: RevokeDeletedVoicesOptions,
): Promise<VoiceRevocationNotifications> {
  const targets: RevokedAlarmTarget[] = [];
  const voiceAccessRevokedUserIds: string[] = [];
  if (voiceProfileIds.length === 0) {
    return { downgradedAlarms: targets, voiceAccessRevokedUserIds };
  }
  const vph = placeholders(voiceProfileIds);

  // ── 1. 이 목소리를 볼 수 있었던 사람 ──────────────────────────────────────────
  //
  // 플랜 그룹이 해체되기 **전에** 뽑아야 한다(탈퇴 경로가 곧 지운다). 스코프는 공유
  // 목소리 조회와 같은 '같은 그룹 동석' 기준이다. 과다발송해도 각자 목록을 다시 받아
  // 확인하므로 안전하다 — 반대로 빠뜨리면 지워진 녹음이 계속 운다.
  if (ownerUserIds.length > 0) {
    const oph = placeholders(ownerUserIds);
    const members = await tx.execute({
      sql: `SELECT DISTINCT m2.user_id
              FROM plan_group_members m1
              JOIN plan_group_members m2 ON m2.plan_group_id = m1.plan_group_id
             WHERE m1.user_id IN (${oph}) AND m2.user_id NOT IN (${oph})`,
      args: [...ownerUserIds, ...ownerUserIds],
    });
    for (const row of members.rows) voiceAccessRevokedUserIds.push(String(row.user_id));
  }

  // ── 2. 이미 전달이 끝난 알람(tombstone) ──────────────────────────────────────
  //
  // 수신자는 `GET /alarm/declined` 의 `revoked_alarm_ids` 로 이걸 읽고 **목소리만**
  // 걷어낸다(알람은 남긴다 — 기대고 자던 알람이 사라지면 그날 못 일어난다, #675).
  const revokedTombstones = await tx.execute({
    sql: `SELECT alarm_id, recipient_user_id FROM alarm_recipient_state
           WHERE voice_profile_id IN (${vph})`,
    args: voiceProfileIds,
  });
  for (const row of revokedTombstones.rows) {
    targets.push({
      alarmId: String(row.alarm_id),
      ownerUserId: String(row.recipient_user_id),
      isReceived: true,
    });
  }
  // 소비했으므로 목소리 참조는 지운다 — 곧 사라질(또는 이미 사라진) 행을 가리키는
  // 값을 남겨 둘 이유가 없고, 남기면 다음 삭제가 같은 알람을 또 집는다.
  await tx.execute({
    sql: `UPDATE alarm_recipient_state
             SET revoked = 1, voice_profile_id = NULL, updated_at = datetime('now')
           WHERE voice_profile_id IN (${vph})`,
    args: voiceProfileIds,
  });

  // ── 3. 아직 서버에 살아 있는 알람 행 ────────────────────────────────────────
  //
  // `message_id` 갈래를 빼먹지 말 것 — 알람이 목소리를 **직접** 가리키지 않고 그
  // 목소리로 만든 문구를 가리키는 경우가 있다.
  const scope = `(voice_profile_id IN (${vph})
                  OR message_id IN (SELECT id FROM messages WHERE voice_profile_id IN (${vph})))`;
  const scopeArgs = [...voiceProfileIds, ...voiceProfileIds];
  const liveAlarms = await tx.execute({
    sql: `SELECT id, user_id, target_user_id,
                 COALESCE(target_user_id, user_id) AS owner_user_id,
                 target_user_id IS NOT NULL AS is_received
            FROM alarms
           WHERE ${scope}`,
    args: scopeArgs,
  });
  const excluded = new Set(excludeOwnerUserIds);
  for (const row of liveAlarms.rows) {
    const ownerUserId = String(row.owner_user_id);
    // 주인이 곧 사라지는 계정이면 알리지 않는다 — 받을 기기가 없다.
    if (excluded.has(ownerUserId)) continue;
    targets.push({
      alarmId: String(row.id),
      ownerUserId,
      isReceived: Number(row.is_received) === 1,
    });
  }
  // **아직 수신 확인 전이라도 tombstone 을 남긴다.** 이 행은 곧 알람음으로 내려가지만
  // (또는 탈퇴로 통째로 지워지지만), 수신자가 이미 pull 로 받아 로컬에 세워 뒀을 수 있다.
  // 그 창에서는 행을 고치는 것만으로는 그 기기에 닿지 못한다.
  await tx.execute({
    sql: `INSERT INTO alarm_recipient_state
            (alarm_id, recipient_user_id, declined, revoked, created_at, updated_at)
          SELECT id, target_user_id, 0, 1, datetime('now'), datetime('now')
            FROM alarms
           WHERE target_user_id IS NOT NULL AND ${scope}
          ON CONFLICT(alarm_id, recipient_user_id)
            DO UPDATE SET revoked = 1, voice_profile_id = NULL, updated_at = datetime('now')`,
    args: scopeArgs,
  });
  await tx.execute({
    sql: `UPDATE alarms SET ${DOWNGRADE_COLUMNS} WHERE ${scope}`,
    args: scopeArgs,
  });

  return { downgradedAlarms: targets, voiceAccessRevokedUserIds };
}

/**
 * 알람 하나가 쓰는 **클론** 목소리를 찾는다. 스톡(is_system)이면 null 을 돌려준다 —
 * 없어지지 않는 목소리를 tombstone 에 적어 두면 "걷어낼 것이 있다" 는 거짓 근거가 된다.
 *
 * 재생되는 음원이 있는 알람은 **문구를 만든 목소리**(`messages.voice_profile_id`)가 기준이다.
 * 구형 클라이언트가 `alarms.voice_profile_id`에 다른 값을 함께 보내도, 수신자가 실제로 받은
 * 음성은 message 쪽이므로 그 클론을 tombstone에 남긴다. message가 없을 때만 알람의 직접
 * 참조를 쓴다.
 */
export async function resolveClonedVoiceForAlarm(
  tx: DbExecutor,
  alarmId: string,
): Promise<string | null> {
  const res = await tx.execute({
    sql: `SELECT vp.id AS voice_profile_id
            FROM alarms a
            LEFT JOIN messages m ON m.id = a.message_id
            JOIN voice_profiles vp ON vp.id = COALESCE(m.voice_profile_id, a.voice_profile_id)
           WHERE a.id = ? AND COALESCE(vp.is_system, 0) = 0
           LIMIT 1`,
    args: [alarmId],
  });
  if (res.rows.length === 0) return null;
  const value = res.rows[0]!.voice_profile_id;
  return value == null ? null : String(value);
}
