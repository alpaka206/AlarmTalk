package com.alarmtalk.app

import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
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
                        }.getOrElse {
                            familyVoices
                        }
                    }
                    SocialSnapshot(
                        familyGroup = group.await(),
                        familyVoices = sharedVoices.await(),
                    )
                }
            }.onSuccess { snapshot ->
                familyGroup = snapshot.familyGroup
                saveFamilyGroupSnapshot(snapshot.familyGroup)
                familyVoices = snapshot.familyVoices
            }.onFailure { error ->
                Log.e(TAG, "Failed to refresh social data", error)
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
            refreshSocial()
            refreshCharacterAndBilling()
            refreshAppSession()
        }.onFailure { error ->
            Log.e(TAG, "Failed to leave family group id=$groupId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_leave_group_failed))
        }
        socialBusy = false
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
            refreshSocial()
            refreshCharacterAndBilling()
        }.onFailure { error ->
            Log.e(TAG, "Failed to remove family member group=$groupId user=$userId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_remove_member_failed))
        }
        socialBusy = false
    }
}
