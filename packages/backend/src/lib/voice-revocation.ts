import type { DbExecutor } from './transactions';

/**
 * 목소리가 사라졌을 때 걷어내야 할 알람 하나. 그대로 `notifyDowngradedAlarms` 의 target 이다.
 */
type RevokedAlarmTarget = {
  alarmId: string;
  ownerUserId: string;
};

/** 커밋 후 보내야 할 알림. 그대로 `notifyDowngradedAlarms` 의 3·4번째 인자다. */
export type VoiceRevocationNotifications = {
  /** 서버가 실제로 찾아낸 강등 대상. 그 알람의 주인 기기가 목소리 접근권을 다시 확인한다. */
  downgradedAlarms: RevokedAlarmTarget[];
  /**
   * 알람 행과 **무관하게** 목소리 접근권을 잃은 계정들.
   *
   * 알람의 원본은 기기다 — 아직 서버로 올라오지 않은 알람은 위 목록에 안 잡히는데,
   * 발사는 로컬이고 울림 시점에 '이 목소리를 아직 쓸 수 있는가' 를 보는 게이트도 없다.
   * 그래서 **목소리 주인**을 깨워 각 기기가 다시 판단하게 한다
   * (`VoiceAccessSyncWorker` / iOS `onAuthoritativeRefresh`).
   */
  voiceAccessRevokedUserIds: string[];
};

export type RevokeDeletedVoicesOptions = {
  /** 사라진 목소리들. **클론만** 넘긴다 — 스톡(is_system)은 없어지지 않는다. */
  voiceProfileIds: string[];
  /** 그 목소리들의 주인. 알람 행이 하나도 안 잡혀도 이 계정들은 깨운다. */
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
 *  - `purgeUserAccount` — 탈퇴로 내 클론이 전부 파기된다
 *  - 플랜 강등 스윕(`paid-voice-cleanup`) — 유료 권한을 잃어 클론이 회수된다
 *
 * ⚠ **여기 말고 다른 곳에서 알람의 목소리를 벗기지 말 것.** 예전에는 탈퇴가 자기만의
 * 갈래를 갖고 있었고, 목소리 삭제는 알람 행만 조용히 내리고 **푸시를 아예 안 보냈다** —
 * 같은 사건인데 결과가 셋으로 갈렸다.
 *
 * ## 무엇을 걷어내는가
 *
 * **그 목소리를 쓰는 알람만.** 스톡 목소리로 만든 알람은 그대로 둔다 — 파기해야 할 것은
 * **생체정보(녹음)** 이지 기상 시각이 아니다. 알람은 지우지 않고 목소리만 떼어 기본 알람음으로
 * 내린다 — 기대고 자던 알람이 사라지면 그날 못 일어난다.
 *
 * 훑을 때 알람 주인을 가리지 않는다. 호출부는 이 뒤에 그 목소리로 만든 문구의 음원을 비우거나
 * 문구 행까지 지우는데, 그 문구를 가리키던 알람이 하나라도 남으면 없는 음원을 받으러 가는 알람이 된다.
 */
export async function revokeDeletedVoices(
  tx: DbExecutor,
  { voiceProfileIds, ownerUserIds, excludeOwnerUserIds = [] }: RevokeDeletedVoicesOptions,
): Promise<VoiceRevocationNotifications> {
  if (voiceProfileIds.length === 0) {
    return { downgradedAlarms: [], voiceAccessRevokedUserIds: [] };
  }
  const excluded = new Set(excludeOwnerUserIds);
  // 현재 기기만 로컬 cascade를 했다고 끝이 아니다. 같은 계정의 다른 기기에만 있는
  // 미동기화 알람은 서버 행 조회로 찾을 수 없으므로 소유자도 접근권 재확인을 받아야 한다.
  // 탈퇴처럼 계정 자체가 사라지는 경우만 excludeOwnerUserIds로 제외한다.
  const voiceAccessRevokedUserIds = new Set(ownerUserIds.filter((id) => !excluded.has(id)));

  // `message_id` 갈래를 빼먹지 말 것 — 알람이 목소리를 **직접** 가리키지 않고 그
  // 목소리로 만든 문구를 가리키는 경우가 있다.
  const vph = placeholders(voiceProfileIds);
  const scope = `(voice_profile_id IN (${vph})
                  OR message_id IN (SELECT id FROM messages WHERE voice_profile_id IN (${vph})))`;
  const scopeArgs = [...voiceProfileIds, ...voiceProfileIds];
  const liveAlarms = await tx.execute({
    sql: `SELECT id, user_id AS owner_user_id FROM alarms WHERE ${scope}`,
    args: scopeArgs,
  });
  const targets = new Map<string, RevokedAlarmTarget>();
  for (const row of liveAlarms.rows) {
    const ownerUserId = String(row.owner_user_id);
    // 주인이 곧 사라지는 계정이면 알리지 않는다 — 받을 기기가 없다.
    if (excluded.has(ownerUserId)) continue;
    const alarmId = String(row.id);
    targets.set(`${alarmId}:${ownerUserId}`, { alarmId, ownerUserId });
  }
  await tx.execute({
    sql: `UPDATE alarms SET ${DOWNGRADE_COLUMNS} WHERE ${scope}`,
    args: scopeArgs,
  });

  return {
    downgradedAlarms: Array.from(targets.values()),
    voiceAccessRevokedUserIds: Array.from(voiceAccessRevokedUserIds),
  };
}
