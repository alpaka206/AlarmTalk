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
import com.voicealarm.nativeapp.network.GoogleLoginRequest
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
import retrofit2.HttpException


internal fun MainViewModel.login(email: String, password: String) {
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.login(LoginRequest(email = email.trim(), password = password))
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            message = "${response.user.email} 계정으로 로그인했어요"
        }.onFailure { error ->
            Log.e(TAG, "Email login failed", error)
            message = userFacingError(error, "로그인에 실패했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.register(email: String, password: String, name: String) {
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.register(RegisterRequest(email = email.trim(), password = password, name = name.trim()))
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            message = "${response.user.email} 계정을 만들었어요"
        }.onFailure { error ->
            Log.e(TAG, "Email registration failed", error)
            message = userFacingError(error, "회원가입에 실패했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.finishGoogleLogin(idToken: String, id: String, email: String, name: String) {
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.loginGoogle(GoogleLoginRequest(idToken = idToken))
        }.onSuccess { response ->
            authSession = authSessionStore.saveGoogleSession(response)
            message = null
        }.onFailure { error ->
            if ((error as? HttpException)?.code() == 404) {
                authSession = authSessionStore.saveLegacyGoogleSession(
                    idToken = idToken,
                    id = id,
                    email = email,
                    name = name,
                )
                message = null
            } else {
                Log.e(TAG, "Google token exchange failed", error)
                message = userFacingError(error, "Google 로그인 세션을 서버에 연결하지 못했어요")
            }
        }
        authBusy = false
    }
}

internal fun MainViewModel.logout() {
    authSessionStore.clear()
    authSession = null
    message = "로그아웃했어요"
}

internal fun MainViewModel.syncNow() {
    val session = authSession
    if (session == null) {
        message = "동기화하려면 먼저 로그인해 주세요"
        return
    }
    viewModelScope.launch {
        syncBusy = true
        runCatching {
            repository.syncWithBackend(api, session.token)
        }.onSuccess { result ->
            message = "동기화 완료: 생성 ${result.created}개, 수정 ${result.updated}개, 실패 ${result.failed}개"
        }.onFailure { error ->
            Log.e(TAG, "Backend sync failed", error)
            message = userFacingError(error, "동기화에 실패했어요")
        }
        syncBusy = false
    }
}
