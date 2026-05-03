package com.voicealarm.nativeapp

import android.app.Application
import android.util.Log
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.SendNoteRequest
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.TtsMessage
import com.voicealarm.nativeapp.network.TtsMessageAudioResponse
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceProfileUpdateRequest
import com.voicealarm.nativeapp.network.VoucherItem
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue


internal fun MainViewModel.refreshSocial() {
    val authorization = bearerOrMessage("커플/가족 정보를 불러오려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            val group = api.getFamilyGroup(authorization)
            val invites = api.listFamilyInvites(authorization).invites
            val sharedVoices = api.listFamilyVoiceProfiles(authorization).profiles
            SocialSnapshot(
                familyGroup = group,
                familyInvites = invites,
                familyVoices = sharedVoices,
            )
        }.onSuccess { snapshot ->
            familyGroup = snapshot.familyGroup
            familyInvites = snapshot.familyInvites
            familyVoices = snapshot.familyVoices
            message = "커플/가족 정보를 불러왔어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to refresh social data", error)
            message = userFacingError(error, "커플/가족 정보를 불러오지 못했어요")
        }
        socialBusy = false
    }
}

internal fun MainViewModel.createFamilyInvite() {
    val authorization = bearerOrMessage("초대 코드를 만들려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.createFamilyInvite(authorization, emptyMap()).invite
        }.onSuccess { invite ->
            familyInvites = listOf(invite) + familyInvites
            message = "초대 코드 ${invite.code}를 만들었어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to create family invite", error)
            message = userFacingError(error, "초대 코드 생성에 실패했어요")
        }
        socialBusy = false
    }
}

internal fun MainViewModel.acceptFamilyInvite(code: String) {
    val authorization = bearerOrMessage("초대를 수락하려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.acceptFamilyInvite(authorization, code.trim(), emptyMap())
        }.onSuccess {
            message = "초대를 수락했어요"
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to accept family invite", error)
            message = userFacingError(error, "초대 수락에 실패했어요")
        }
        socialBusy = false
    }
}

internal fun MainViewModel.revokeFamilyInvite(code: String) {
    val authorization = bearerOrMessage("초대 코드를 취소하려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.revokeFamilyInvite(authorization, code, emptyMap())
        }.onSuccess {
            message = "초대 코드를 취소했어요"
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to revoke family invite code=$code", error)
            message = userFacingError(error, "초대 코드 취소에 실패했어요")
        }
        socialBusy = false
    }
}
