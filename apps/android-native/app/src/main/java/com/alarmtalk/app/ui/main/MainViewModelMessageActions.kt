package com.alarmtalk.app

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
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.SendNoteRequest
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessage
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
import com.alarmtalk.app.network.VoucherItem
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


internal fun MainViewModel.showGoogleSetupRequired() {
    message = getApplication<android.app.Application>().getString(R.string.r3misc_google_signin_unavailable)
}

internal fun MainViewModel.showGoogleSignInFailed(reason: String? = null) {
    message = reason ?: getApplication<android.app.Application>().getString(R.string.r3misc_google_signin_failed)
}

internal fun MainViewModel.clearMessage() {
    message = null
}

internal fun MainViewModel.refreshAppSession() {
    val session = authSession ?: return
    viewModelScope.launch {
        runCatching {
            api.me(AlarmTalkApiClient.bearer(session.token)).user
        }.onSuccess { user ->
            val response = AuthTokenResponse(
                token = session.token,
                user = user,
            )
            authSession = if (session.provider == AuthSessionStore.PROVIDER_GOOGLE) {
                authSessionStore.saveGoogleSession(response)
            } else {
                authSessionStore.saveAppSession(response)
            }
        }.onFailure { error ->
            Log.w(TAG, "Auth refresh failed", error)
        }
    }
}

internal fun MainViewModel.bearerOrMessage(fallbackMessage: String): String? {
    val session = authSession
    if (session == null) {
        message = fallbackMessage
        return null
    }
    return AlarmTalkApiClient.bearer(session.token)
}
