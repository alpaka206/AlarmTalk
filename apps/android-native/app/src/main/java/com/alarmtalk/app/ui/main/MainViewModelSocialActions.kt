package com.alarmtalk.app

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
                reconcileInaccessibleVoiceAlarms()
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
internal fun MainViewModel.reconcileInaccessibleVoiceAlarms() {
    if (!familyVoicesLoadedFresh || !voiceProfilesLoadedFresh) return
    val accessibleVoiceIds = (voiceProfiles.map { it.id } + familyVoices.map { it.id }).toSet()
    viewModelScope.launch {
        // 목록을 가져온 계정을 함께 넘긴다 — 강등은 되돌릴 수 없어, 그 사이 계정이 바뀌었으면
        // 저장소가 그만둔다.
        val listOwner = authSession?.user?.id
        runCatching { repository.degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds, listOwner) }
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
            message = getApplication<android.app.Application>().getString(R.string.msg_left_group)
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
