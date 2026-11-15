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
  /** 서버가 강등한 알람 — 서버 알람 사본을 지운 뒤(#147)로는 언제나 비어 있다. */
  downgradedAlarms: RevokedAlarmTarget[];
  /**
   * 목소리 접근권을 잃은 계정들.
   *
   * 알람은 기기에만 있다(#147) — 발사는 로컬이고 울림 시점에 '이 목소리를 아직 쓸 수 있는가' 를
   * 보는 게이트도 없다. 그래서 **이 계정들**을 깨워 각 기기가 다시 판단하게 한다
   * (`VoiceAccessSyncWorker` / iOS `onAuthoritativeRefresh`).
   */
  voiceAccessRevokedUserIds: string[];
};

export type RevokeDeletedVoicesOptions = {
  /** 사라진 목소리들. **클론만** 넘긴다 — 스톡(is_system)은 없어지지 않는다. */
  voiceProfileIds: string[];
  /** 그 목소리들의 주인. 언제나 깨운다(아래 제외 목록만 뺀다). */
  ownerUserIds: string[];
  /**
   * 알림에서 뺄 계정. 탈퇴처럼 **주인 계정이 곧 사라지는** 경우에만 채운다 —
   * 이미 없어진 기기에 철회 푸시를 보내지 않기 위해서다.
   */
  excludeOwnerUserIds?: string[];
};


/**
 * **목소리가 사라졌을 때 도는 단 하나의 로직.**

 * 호출부는 셋이고 전부 "이 클론 목소리가 이제 없다" 는 같은 사실을 말한다:
 *  - `DELETE /voice-profiles/:id` — 사용자가 직접 지웠다
 *  - `purgeUserAccount` — 탈퇴로 내 클론이 전부 파기된다
 *  - 플랜 강등 스윕(`paid-voice-cleanup`) — 유료 권한을 잃어 클론이 회수된다
 * ⚠ **여기 말고 다른 곳에서 알릴 대상을 정하지 말 것.** 예전에는 탈퇴가 자기만의 갈래를 갖고 있었고, 목소리 삭제는
 * **푸시를 아예 안 보냈다** — 같은 사건인데 결과가 셋으로 갈렸다.
 *
 * ## 무엇을 하는가
 * **목소리 주인을 깨울 계정 목록을 정한다** — 그뿐이다. 서버 알람 사본은 2026-10-29 에 지웠다(#147): 알람의 원본은 기기이고,
 * 그 목소리로 울던 알람을 기본 목소리로 내리는 것도 기기다(`VoiceAccessSyncWorker` / iOS `onAuthoritativeRefresh`). 그래서
 * `downgradedAlarms` 는 언제나 비어 있다 — 받는 쪽(`notifyDowngradedAlarms`)이 계정 단위로 접어 보내므로 그대로 둔다.
 * 깨우는 계정은 목소리 주인과 **그 목소리로 만든 문구의 주인**이다. 문구를 지우기 **전에** 불러야 그 주인을 찾는다(호출부의
 * 순서 규약 — 철회 판정 → 구독 취소 → 행 삭제).
 */
export async function revokeDeletedVoices(
  tx: DbExecutor,
  { voiceProfileIds, ownerUserIds, excludeOwnerUserIds = [] }: RevokeDeletedVoicesOptions,
): Promise<VoiceRevocationNotifications> {
  if (voiceProfileIds.length === 0) {
    return { downgradedAlarms: [], voiceAccessRevokedUserIds: [] };
  }
  const excluded = new Set(excludeOwnerUserIds);
  // 현재 기기만 로컬 cascade를 했다고 끝이 아니다. 같은 계정의 다른 기기에만 있는 알람도
  // 그 목소리로 울 수 있으므로 소유자는 언제나 접근권 재확인을 받는다.
  // 탈퇴처럼 계정 자체가 사라지는 경우만 excludeOwnerUserIds로 제외한다.
  const voiceAccessRevokedUserIds = new Set(ownerUserIds.filter((id) => !excluded.has(id)));
  // ⚠ **그 목소리로 만든 문구를 가진 다른 계정도 깨운다**(2026-10-29). 예전에는 서버 알람 사본의 주인으로 찾았다 — 목소리
  //   공유가 있던 시절 남이 내 클론으로 만든 문구가 남아 있을 수 있다. 사본을 지운 뒤로는 문구의 주인으로 찾는다.
  const placeholders = voiceProfileIds.map(() => '?').join(', ');
  const messageOwners = await tx.execute({
    sql: `SELECT DISTINCT user_id FROM messages WHERE voice_profile_id IN (${placeholders}) AND user_id IS NOT NULL`,
    args: voiceProfileIds,
  });
  for (const row of messageOwners.rows) {
    const userId = String(row.user_id ?? '');
    if (userId && !excluded.has(userId)) voiceAccessRevokedUserIds.add(userId);
  }

  // ⚠ **서버에는 알람 행이 없다**(2026-10-29, #147 — 사본을 지웠다). 알람의 원본은 기기이고, 걷어내는 것도 기기다 — 목소리
  //   주인을 깨우면 각 기기가 접근권을 다시 확인해 그 목소리의 알람을 기본 목소리로 내린다. 그래서 강등 대상 목록은 늘 비어 있다.
  return {
    downgradedAlarms: [],
    voiceAccessRevokedUserIds: Array.from(voiceAccessRevokedUserIds),
  };
}
