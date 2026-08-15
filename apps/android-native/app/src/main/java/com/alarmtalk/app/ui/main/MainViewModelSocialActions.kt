package com.alarmtalk.app

import com.alarmtalk.app.data.DowngradeNoticeStore
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

internal fun MainViewModel.refreshSocial() {
    refreshSocialData(showMessage = true)
}

internal fun MainViewModel.preloadSocial() {
    if (authSession == null || socialBusy) return
    refreshSocialData(showMessage = false)
}

private fun MainViewModel.refreshSocialData(showMessage: Boolean) {
    if (socialBusy) return
    val authorization = bearerOrMessage("Login is required to load shared plan data.") ?: return
    // **이 조회를 시작한 계정과 세대.** 응답이 늦게 도착하는 사이 로그아웃·계정 전환이 있었으면
    // 그 응답은 지금 계정의 것이 아니다 — 반영하면 A 의 목록이 B 의 상태로 자리 잡고, 이어지는
    // 강등이 A 의 목록으로 B 의 알람을 훑어 목소리를 영구히 벗긴다(Codex #665 P1).
    val requestOwner = authSession?.user?.id
    val startGeneration = authSessionStore.sessionGeneration()
    socialBusy = true
    // 새 소셜 로드 시작 — 신선-로드 플래그를 내려, 로드 완료 전 fetchVoiceProfiles 가 옛 상태로
    // 강등 판단하지 않게 한다(성공 시 snapshot.familyVoicesFresh 로 다시 설정).
    familyVoicesLoadedFresh = false
    viewModelScope.launch {
        try {
            runCatching {
                coroutineScope {
                    val group = async { api.getFamilyGroup(authorization) }
                    val sharedVoices = async {
                        runCatching {
                            api.listFamilyVoiceProfiles(authorization).profiles
                        }.onFailure { error ->
                            Log.w(TAG, "Failed to refresh family voice profiles", error)
                        }
                    }
                    val sharedVoicesResult = sharedVoices.await()
                    SocialSnapshot(
                        familyGroup = group.await(),
                        familyVoices = sharedVoicesResult.getOrElse { familyVoices },
                        familyVoicesFresh = sharedVoicesResult.isSuccess,
                    )
                }
            }.onSuccess { snapshot ->
                if (!responseStillBelongsToRequester(requestOwner, startGeneration)) {
                    Log.i(TAG, "Dropping stale social snapshot: session ended or switched")
                    return@onSuccess
                }
                familyGroup = snapshot.familyGroup
                saveFamilyGroupSnapshot(snapshot.familyGroup)
                // 공유 목소리 목록이 실제로 바뀌면(새로 공유받음/회수) 스톡 매니페스트도 새로 받는다.
                // 매니페스트는 세션 캐시라 안 갱신하면 새 공유 보이스의 미리듣기가 '준비 중'에 머물고
                // 편집기의 오프라인 프리셋 버킷도 바인딩되지 않는다.
                val sharedIdsChanged = snapshot.familyVoicesFresh &&
                    snapshot.familyVoices.map { it.id }.toSet() != familyVoices.map { it.id }.toSet()
                familyVoices = snapshot.familyVoices
                familyVoicesLoadedFresh = snapshot.familyVoicesFresh
                if (sharedIdsChanged) loadStockClips(forceReload = true)
                // 접근권 잃은 목소리 알람 강등 — 내 음성·공유 목소리 두 로드 중 늦게 끝난 쪽에서
                // 실행되도록 헬퍼로 위임한다(한쪽이 먼저 끝나 스킵돼도 재실행됨).
                // **목록을 가져온 계정을 그대로 넘긴다** — '지금 계정' 이 아니다.
                reconcileInaccessibleVoiceAlarms(requestOwner)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to refresh social data", error)
                if (showMessage) {
                    message = userFacingError(error, "Failed to load shared plan data")
                }
            }
        } finally {
            socialBusy = false
        }
    }
}

// 접근권을 잃은 공유/본인 목소리를 쓰는 '내 소유' 알람을 sound-only 로 강등한다(감사 B-3 LOCAL_OWNED 좀비).
// 내 음성 목록(voiceProfiles)·공유 목소리 목록(familyVoices)이 둘 다 신선하게 확보됐을 때만 판단한다.
// 두 로드가 비동기라 늦게 끝난 쪽(refreshSocial·fetchVoiceProfiles 성공)에서 이 함수를 호출해, 한쪽이
// 먼저 끝나 스킵돼도 재실행되게 한다. 로드 실패 시 옛 목록을 유지하므로 신선 로드만 신뢰해 오강등을 막는다.
/**
 * @param listOwner 이 목록들을 **가져온 계정**. 호출부가 조회를 시작한 시점의 값을 그대로
 *   넘긴다 — 여기서 `authSession` 을 읽으면 '지금 계정' 이 되어, 늦게 도착한 A 의 목록이
 *   B 의 이름표를 달게 된다. 그러면 저장소 가드(expectedOwnerUserId)가 통과해 **B 의 목소리
 *   참조와 캐시 오디오를 영구히 벗긴다**(Codex #665 P1). 되돌릴 수 없는 변경이다.
 */
internal fun MainViewModel.reconcileInaccessibleVoiceAlarms(listOwner: String?) {
    if (!familyVoicesLoadedFresh || !voiceProfilesLoadedFresh) return
    val accessibleVoiceIds = (voiceProfiles.map { it.id } + familyVoices.map { it.id }).toSet()
    viewModelScope.launch {
        runCatching { repository.degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds, listOwner) }
            .onSuccess { degraded ->
                // 공유가 끊겨 목소리를 잃은 알람 — 이유를 알려 줄 곳이 여기뿐이다.
                DowngradeNoticeStore(getApplication())
                    .record(listOwner, DowngradeNoticeStore.Cause.SHARED_RELEASED, degraded)
            }
            .onSuccess { count ->
                if (count > 0) Log.i(TAG, "Degraded $count alarm(s) using inaccessible voice")
            }
            .onFailure { error ->
                Log.w(TAG, "Failed to reconcile inaccessible-voice alarms", error)
            }
    }
}

internal fun MainViewModel.leaveFamilyGroup(groupId: String) {
    val authorization = bearerOrMessage(
        getApplication<android.app.Application>().getString(R.string.msg_leave_group_login_required),
    ) ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.leaveFamilyGroup(authorization, groupId, emptyMap())
        }.onSuccess {
            // ⚠ **성공 토스트를 다시 넣지 말 것**(2026-08-15 지시).
            // 나가면 이용권 카드가 곧바로 '무료' 로 바뀐다 — 화면이 이미 그 사실을 말한다.
            // 토스트는 같은 말을 한 번 더 하면서 화면을 가리기만 한다.
            // 실패는 계속 알린다(아래 onFailure) — 그건 화면에 안 나타나는 사실이다.
            // 성공 시엔 refreshSocial 이 busy 소유권을 이어받는다. 여기서 먼저 내려
            // refreshSocialData 의 `if (socialBusy) return` 가드를 통과시키고, 이후 무조건적인
            // `socialBusy = false` 로 진행 중인 refresh 의 true 를 덮어쓰지 않는다(가드 무력화 회귀 방지).
            socialBusy = false
            refreshSocial()
            refreshBilling()
            refreshAppSession()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to leave family group id=$groupId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_leave_group_failed))
            // 실패 시에만 여기서 busy 를 리셋(성공 시엔 refreshSocial 이 소유).
            socialBusy = false
        }
    }
}

internal fun MainViewModel.removeFamilyMember(groupId: String, userId: String) {
    val authorization = bearerOrMessage(
        getApplication<android.app.Application>().getString(R.string.msg_remove_member_login_required),
    ) ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.removeFamilyMember(authorization, groupId, userId)
        }.onSuccess {
            message = getApplication<android.app.Application>().getString(R.string.msg_member_removed)
            // 성공 시엔 refreshSocial 이 busy 소유권을 이어받는다. 여기서 먼저 내려
            // refreshSocialData 의 `if (socialBusy) return` 가드를 통과시키고, 이후 무조건적인
            // `socialBusy = false` 로 진행 중인 refresh 의 true 를 덮어쓰지 않는다(가드 무력화 회귀 방지).
            socialBusy = false
            refreshSocial()
            refreshBilling()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to remove family member group=$groupId user=$userId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_remove_member_failed))
            // 실패 시에만 여기서 busy 를 리셋(성공 시엔 refreshSocial 이 소유).
            socialBusy = false
        }
    }
}
