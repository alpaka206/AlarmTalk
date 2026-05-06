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
    val authorization = bearerOrMessage("Login is required to leave the shared plan.") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.leaveFamilyGroup(authorization, groupId, emptyMap())
        }.onSuccess {
            message = "Shared plan left. Your plan is now free."
            refreshSocial()
            refreshCharacterAndBilling()
            refreshAppSession()
        }.onFailure { error ->
            Log.e(TAG, "Failed to leave family group id=$groupId", error)
            message = userFacingError(error, "Failed to leave the shared plan")
        }
        socialBusy = false
    }
}
