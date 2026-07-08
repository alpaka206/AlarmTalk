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
                familyVoices = snapshot.familyVoices
                // 공유 목소리 목록을 '신선하게' 받았고 내 음성 목록도 로드돼 있을 때만, 접근권을 잃은
                // 공유/본인 목소리를 쓰는 '내 소유' 알람을 sound-only 로 강등한다(감사 B-3 LOCAL_OWNED
                // 좀비). 로드 실패 시 옛 목록을 유지하므로, 신선 로드만 신뢰해 정상 음성알람 오강등을 막는다.
                if (snapshot.familyVoicesFresh && voiceProfiles.isNotEmpty()) {
                    val accessibleVoiceIds =
                        (voiceProfiles.map { it.id } + snapshot.familyVoices.map { it.id }).toSet()
                    viewModelScope.launch {
                        runCatching { repository.degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds) }
                            .onSuccess { count ->
                                if (count > 0) Log.i(TAG, "Degraded $count alarm(s) using inaccessible voice")
                            }
                            .onFailure { error ->
                                Log.w(TAG, "Failed to reconcile inaccessible-voice alarms", error)
                            }
                    }
                }
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
