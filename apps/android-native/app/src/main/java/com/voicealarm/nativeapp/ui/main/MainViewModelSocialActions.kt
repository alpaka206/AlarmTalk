package com.voicealarm.nativeapp

import android.util.Log
import androidx.lifecycle.viewModelScope
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import kotlinx.coroutines.launch

internal fun MainViewModel.refreshSocial() {
    refreshSocialData(showMessage = true)
}

internal fun MainViewModel.preloadSocial() {
    if (authSession == null || socialBusy) return
    refreshSocialData(showMessage = false)
}

private fun MainViewModel.refreshSocialData(showMessage: Boolean) {
    val authorization = bearerOrMessage("Login is required to load shared plan data.") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            val group = api.getFamilyGroup(authorization)
            val sharedVoices = runCatching {
                api.listFamilyVoiceProfiles(authorization).profiles
            }.onFailure { error ->
                Log.w(TAG, "Failed to refresh family voice profiles", error)
            }.getOrElse {
                familyVoices
            }
            SocialSnapshot(
                familyGroup = group,
                familyVoices = sharedVoices,
            )
        }.onSuccess { snapshot ->
            familyGroup = snapshot.familyGroup
            familyVoices = snapshot.familyVoices
        }.onFailure { error ->
            Log.e(TAG, "Failed to refresh social data", error)
            if (showMessage) {
                message = userFacingError(error, "Failed to load shared plan data")
            }
        }
        socialBusy = false
    }
}

internal fun MainViewModel.leaveFamilyGroup(groupId: String) {
    val authorization = bearerOrMessage("플랜에서 나가려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.leaveFamilyGroup(authorization, groupId, emptyMap())
        }.onSuccess {
            message = "플랜에서 나갔어요. 무료 플랜으로 전환됐어요."
            refreshSocial()
            refreshCharacterAndBilling()
            refreshAppSession()
        }.onFailure { error ->
            Log.e(TAG, "Failed to leave family group id=$groupId", error)
            message = userFacingError(error, "플랜에서 나가지 못했어요")
        }
        socialBusy = false
    }
}

internal fun MainViewModel.removeFamilyMember(groupId: String, userId: String) {
    val authorization = bearerOrMessage("멤버를 내보내려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.removeFamilyMember(authorization, groupId, userId)
        }.onSuccess {
            message = "멤버를 내보냈어요"
            refreshSocial()
            refreshCharacterAndBilling()
        }.onFailure { error ->
            Log.e(TAG, "Failed to remove family member group=$groupId user=$userId", error)
            message = userFacingError(error, "멤버를 내보내지 못했어요")
        }
        socialBusy = false
    }
}
