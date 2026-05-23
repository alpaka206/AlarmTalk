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
import com.voicealarm.nativeapp.network.DynamicPromptSettings
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.EmailVerificationConfirmRequest
import com.voicealarm.nativeapp.network.EmailVerificationRequest
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
import com.voicealarm.nativeapp.sync.RemoteAlarmSyncScheduler
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


internal fun MainViewModel.login(email: String, password: String) {
    val normalizedEmail = email.trim()
    if (normalizedEmail.isBlank() || password.isBlank()) {
        message = "이메일과 비밀번호를 입력해 주세요."
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.login(LoginRequest(email = normalizedEmail, password = password))
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = "${response.user.email} 계정으로 로그인했어요"
        }.onFailure { error ->
            Log.e(TAG, "Email login failed", error)
            message = userFacingError(error, "로그인에 실패했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.requestEmailVerification(email: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank()) {
        message = "이메일을 입력해 주세요"
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.requestEmailVerification(EmailVerificationRequest(email = normalizedEmail))
        }.onSuccess { response ->
            registerEmailVerificationSentTo = normalizedEmail
            registerEmailVerified = null
            message = response.debugCode
                ?.takeIf { it.isNotBlank() }
                ?.let { "개발용 인증 코드: $it" }
                ?: "인증 코드를 보냈어요"
        }.onFailure { error ->
            Log.e(TAG, "Email verification request failed", error)
            message = userFacingError(error, "인증 코드를 보내지 못했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.confirmEmailVerification(email: String, code: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank() || code.trim().length != 6) {
        message = "6자리 인증 코드를 입력해 주세요"
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.confirmEmailVerification(
                EmailVerificationConfirmRequest(
                    email = normalizedEmail,
                    code = code.trim(),
                ),
            )
        }.onSuccess {
            registerEmailVerified = normalizedEmail
            message = "이메일 인증이 완료됐어요"
        }.onFailure { error ->
            Log.e(TAG, "Email verification confirm failed", error)
            message = userFacingError(error, "인증 코드가 맞지 않아요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.register(
    email: String,
    password: String,
    name: String,
    emailVerificationCode: String,
) {
    val normalizedEmail = email.trim().lowercase()
    val trimmedName = name.trim()
    val trimmedCode = emailVerificationCode.trim()
    if (normalizedEmail.isBlank() || password.isBlank() || trimmedName.isBlank() || trimmedCode.isBlank()) {
        message = "회원가입 정보를 모두 입력해 주세요."
        return
    }
    if (registerEmailVerified != normalizedEmail) {
        message = "이메일 인증을 먼저 완료해 주세요"
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.register(
                RegisterRequest(
                    email = normalizedEmail,
                    password = password,
                    name = trimmedName,
                    emailVerificationCode = trimmedCode,
                ),
            )
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            registerEmailVerificationSentTo = null
            registerEmailVerified = null
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = "${response.user.email} 계정을 만들었어요"
        }.onFailure { error ->
            Log.e(TAG, "Email registration failed", error)
            message = userFacingError(error, "회원가입에 실패했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.finishGoogleLogin(idToken: String) {
    if (idToken.isBlank()) {
        message = "Google 로그인 토큰을 확인하지 못했어요."
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.loginGoogle(GoogleLoginRequest(idToken = idToken))
        }.onSuccess { response ->
            authSession = authSessionStore.saveGoogleSession(response)
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = null
        }.onFailure { error ->
            Log.e(TAG, "Google token exchange failed", error)
            message = userFacingError(error, "Google 로그인 세션을 서버에 연결하지 못했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.logout(signOutGoogle: suspend () -> Unit = {}) {
    val shouldSignOutGoogle = authSession?.provider == AuthSessionStore.PROVIDER_GOOGLE
    viewModelScope.launch {
        authBusy = true
        if (shouldSignOutGoogle) {
            runCatching {
                signOutGoogle()
            }.onFailure { error ->
                Log.w(TAG, "Failed to sign out Google account", error)
            }
        }
        authSessionStore.clear()
        authSession = null
        message = "로그아웃했어요"
        authBusy = false
    }
}

internal fun MainViewModel.updateNickname(name: String) {
    val session = authSession
    if (session == null) {
        message = "로그인 후 사용할 수 있어요"
        return
    }
    val trimmed = name.trim()
    if (trimmed.isEmpty() || trimmed.length > 30) {
        message = "닉네임은 1~30자여야 해요"
        return
    }
    val authorization = com.voicealarm.nativeapp.network.VoiceAlarmApiClient.bearer(session.token)
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.updateProfile(authorization, com.voicealarm.nativeapp.network.UpdateProfileRequest(name = trimmed))
        }.onSuccess {
            val updated = session.copy(user = session.user.copy(name = trimmed))
            authSession = authSessionStore.save(updated)
            dismissEditNickname()
            message = "닉네임을 변경했어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to update nickname", error)
            message = userFacingError(error, "닉네임 변경에 실패했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.updateFamilyAlarmSettings(
    allowFamilyAlarms: Boolean,
    quietWindows: List<FamilyAlarmQuietWindow>,
) {
    val session = authSession
    if (session == null) {
        message = "로그인 후 사용할 수 있어요"
        return
    }
    val normalizedWindows = quietWindows
        .map { window -> window.copy(days = window.days.distinct().filter { it in 0..6 }.sorted()) }
        .filter { it.days.isNotEmpty() }
        .take(8)
    if (normalizedWindows.any { !isValidTimeText(it.start) || !isValidTimeText(it.end) }) {
        message = "시간은 HH:mm 형식으로 입력해 주세요"
        return
    }
    val firstWindow = normalizedWindows.firstOrNull()
        ?: FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")
    val authorization = com.voicealarm.nativeapp.network.VoiceAlarmApiClient.bearer(session.token)
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.updateProfile(
                authorization,
                com.voicealarm.nativeapp.network.UpdateProfileRequest(
                    allowFamilyAlarms = allowFamilyAlarms,
                    familyAlarmQuietDays = firstWindow.days,
                    familyAlarmQuietStart = firstWindow.start,
                    familyAlarmQuietEnd = firstWindow.end,
                    familyAlarmQuietWindows = normalizedWindows,
                ),
            )
        }.onSuccess {
            val updated = session.copy(
                user = session.user.copy(
                    allowFamilyAlarms = allowFamilyAlarms,
                    familyAlarmQuietDays = firstWindow.days,
                    familyAlarmQuietStart = firstWindow.start,
                    familyAlarmQuietEnd = firstWindow.end,
                    familyAlarmQuietWindows = normalizedWindows,
                ),
            )
            authSession = authSessionStore.save(updated)
            refreshSocial()
            message = "상대방 알람 설정을 저장했어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to update family alarm settings", error)
            message = userFacingError(error, "상대방 알람 설정을 저장하지 못했어요")
        }
        authBusy = false
    }
}

internal fun MainViewModel.updateDynamicPromptSettings(settings: DynamicPromptSettings) {
    val session = authSession ?: return
    val authorization = com.voicealarm.nativeapp.network.VoiceAlarmApiClient.bearer(session.token)
    viewModelScope.launch {
        runCatching {
            api.updateProfile(
                authorization,
                com.voicealarm.nativeapp.network.UpdateProfileRequest(
                    dynamicPromptSettings = settings,
                ),
            )
        }.onSuccess { response ->
            val updatedSettings = response.dynamicPromptSettings ?: settings
            val updated = session.copy(user = session.user.copy(dynamicPromptSettings = updatedSettings))
            authSession = authSessionStore.save(updated)
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to update dynamic prompt settings", error)
        }
    }
}

private fun isValidTimeText(value: String): Boolean =
    Regex("""^([01]\d|2[0-3]):[0-5]\d$""").matches(value)

internal fun MainViewModel.deleteAccount(revokeGoogleAccess: suspend () -> Unit = {}) {
    val session = authSession
    if (session == null) {
        message = "로그인 후 사용할 수 있어요"
        return
    }
    val authorization = com.voicealarm.nativeapp.network.VoiceAlarmApiClient.bearer(session.token)
    val shouldRevokeGoogle = session.provider == AuthSessionStore.PROVIDER_GOOGLE
    viewModelScope.launch {
        authBusy = true
        try {
            api.deleteAccount(authorization)
            val revokeError = if (shouldRevokeGoogle) {
                runCatching { revokeGoogleAccess() }.exceptionOrNull()
            } else {
                null
            }
            if (revokeError != null) {
                Log.w(TAG, "Failed to revoke Google account access after account deletion", revokeError)
            }
            authSessionStore.clear()
            authSession = null
            dismissDeleteAccount()
            message = if (revokeError == null) {
                "회원 탈퇴가 완료되었어요"
            } else {
                "회원 탈퇴는 완료되었지만 Google 연결 해제에 실패했어요"
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Failed to delete account", error)
            message = userFacingError(error, "회원 탈퇴에 실패했어요")
        } finally {
            authBusy = false
        }
    }
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
            val push = repository.syncWithBackend(api, session.token)
            val pull = repository.pullReceivedAlarms(api, session.token, session.user.id)
            push to pull
        }.onSuccess { (push, pull) ->
            val failed = push.failed + pull.failed
            if (failed > 0) {
                message = alarmSyncFailureMessage(pushFailed = push.failed, pullFailed = pull.failed)
            }
        }.onFailure { error ->
            Log.e(TAG, "Backend sync failed", error)
            message = userFacingError(error, "알람 정보를 불러오거나 서버에 저장하지 못했어요")
        }
        syncBusy = false
    }
}

private fun alarmSyncFailureMessage(pushFailed: Int, pullFailed: Int): String = when {
    pushFailed > 0 && pullFailed > 0 ->
        "알람 변경사항 일부를 서버에 저장하지 못했고, 받은 알람 일부를 불러오지 못했어요."
    pushFailed > 0 ->
        "알람 변경사항 일부를 서버에 저장하지 못했어요. 이 기기의 알람은 그대로 울려요."
    pullFailed > 0 ->
        "받은 알람 일부를 불러오지 못했어요. 잠시 후 다시 동기화해 주세요."
    else -> "알람 동기화에 실패했어요."
}
