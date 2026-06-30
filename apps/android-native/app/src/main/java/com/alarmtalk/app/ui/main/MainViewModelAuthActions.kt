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
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.EmailVerificationConfirmRequest
import com.alarmtalk.app.network.EmailVerificationRequest
import com.alarmtalk.app.network.GoogleLoginRequest
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.PasswordResetConfirmRequest
import com.alarmtalk.app.network.PasswordResetRequest
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
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
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
        message = getApplication<android.app.Application>().getString(R.string.msg_login_email_password_required)
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.login(LoginRequest(email = normalizedEmail, password = password))
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            restoreAccessSnapshotForCurrentUser()
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = getApplication<android.app.Application>().getString(R.string.msg_login_success, response.user.email)
        }.onFailure { error ->
            Log.e(TAG, "Email login failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_login_failed))
        }
        authBusy = false
    }
}

internal fun MainViewModel.requestEmailVerification(email: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_email_required)
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
                ?.takeIf { BuildConfig.DEBUG && it.isNotBlank() }
                ?.let { getApplication<android.app.Application>().getString(R.string.msg_verification_code_debug, it) }
                ?: getApplication<android.app.Application>().getString(R.string.msg_verification_code_sent)
        }.onFailure { error ->
            Log.e(TAG, "Email verification request failed", error)
            message = duplicateEmailMessage(error)
                ?: userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_verification_code_send_failed))
        }
        authBusy = false
    }
}

// 이미 가입된 이메일로 회원가입을 시도하면 백엔드가 409 로 막는다. 가입 방식에 맞는 안내
// 메시지를 돌려주고, 비밀번호 계정(AUTH_EMAIL_TAKEN)이면 로그인 화면으로 전환을 요청한다.
// 중복/소셜이 아니면 null 을 돌려 호출자가 기본 메시지를 쓰게 한다.
private fun MainViewModel.duplicateEmailMessage(error: Throwable): String? {
    val app = getApplication<android.app.Application>()
    val parsed = com.alarmtalk.app.network.apiError(error)
    return when (parsed.code) {
        "AUTH_EMAIL_TAKEN" -> {
            authRedirectToLogin = true
            app.getString(R.string.msg_register_email_taken)
        }
        "AUTH_EMAIL_SOCIAL" -> when (parsed.provider) {
            "apple" -> app.getString(R.string.msg_register_email_social_apple)
            else -> app.getString(R.string.msg_register_email_social_google)
        }
        else -> null
    }
}

internal fun MainViewModel.confirmEmailVerification(email: String, code: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank() || code.trim().length != 6) {
        message = getApplication<android.app.Application>().getString(R.string.msg_verification_code_six_digits_required)
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
            message = getApplication<android.app.Application>().getString(R.string.msg_email_verification_completed)
        }.onFailure { error ->
            Log.e(TAG, "Email verification confirm failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_verification_code_mismatch))
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
        message = getApplication<android.app.Application>().getString(R.string.msg_register_all_fields_required)
        return
    }
    if (registerEmailVerified != normalizedEmail) {
        message = getApplication<android.app.Application>().getString(R.string.msg_register_verify_email_first)
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
            restoreAccessSnapshotForCurrentUser()
            registerEmailVerificationSentTo = null
            registerEmailVerified = null
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = getApplication<android.app.Application>().getString(R.string.msg_register_success, response.user.email)
        }.onFailure { error ->
            Log.e(TAG, "Email registration failed", error)
            message = duplicateEmailMessage(error)
                ?: userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_register_failed))
        }
        authBusy = false
    }
}

// 비밀번호 재설정 코드 요청. 백엔드는 계정 존재 여부를 노출하지 않으므로(비번 계정에만 발송),
// 응답은 항상 성공이다. 코드를 보낸 이메일을 기억해 다음 단계(코드+새 비번)를 노출한다.
internal fun MainViewModel.requestPasswordReset(email: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_email_required)
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.requestPasswordReset(PasswordResetRequest(email = normalizedEmail))
        }.onSuccess { response ->
            passwordResetCodeSentTo = normalizedEmail
            message = response.debugCode
                ?.takeIf { BuildConfig.DEBUG && it.isNotBlank() }
                ?.let { getApplication<android.app.Application>().getString(R.string.msg_verification_code_debug, it) }
                ?: getApplication<android.app.Application>().getString(R.string.msg_password_reset_code_sent)
        }.onFailure { error ->
            Log.e(TAG, "Password reset request failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_verification_code_send_failed))
        }
        authBusy = false
    }
}

// 비밀번호 재설정 확정(코드+새 비밀번호). 성공 시 로그인 화면으로 돌아가도록 onSuccess 콜백을 호출한다.
internal fun MainViewModel.confirmPasswordReset(
    email: String,
    code: String,
    newPassword: String,
    onSuccess: () -> Unit,
) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank() || code.trim().length != 6 || newPassword.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_register_all_fields_required)
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.confirmPasswordReset(
                PasswordResetConfirmRequest(
                    email = normalizedEmail,
                    code = code.trim(),
                    password = newPassword,
                ),
            )
        }.onSuccess {
            passwordResetCodeSentTo = null
            message = getApplication<android.app.Application>().getString(R.string.msg_password_reset_done)
            onSuccess()
        }.onFailure { error ->
            Log.e(TAG, "Password reset confirm failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_password_reset_failed))
        }
        authBusy = false
    }
}

internal fun MainViewModel.finishGoogleLogin(idToken: String) {
    if (idToken.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_google_login_not_confirmed)
        return
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.loginGoogle(GoogleLoginRequest(idToken = idToken))
        }.onSuccess { response ->
            authSession = authSessionStore.saveGoogleSession(response)
            restoreAccessSnapshotForCurrentUser()
            RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
            RemoteAlarmSyncScheduler.runOnce(getApplication())
            message = null
        }.onFailure { error ->
            Log.e(TAG, "Google token exchange failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_google_login_failed))
        }
        authBusy = false
    }
}

internal fun MainViewModel.logout(signOutGoogle: suspend () -> Unit = {}) {
    val session = authSession
    val shouldSignOutGoogle = session?.provider == AuthSessionStore.PROVIDER_GOOGLE
    viewModelScope.launch {
        authBusy = true
        // 서버에 로그아웃을 알려 token_epoch 를 올린다(남아있던 토큰 전부 401 TOKEN_REVOKED).
        // 네트워크 실패가 로컬 로그아웃을 막지 않도록 best-effort 로 처리한다.
        if (session != null) {
            runCatching {
                api.logout(com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token))
            }.onFailure { error ->
                Log.w(TAG, "Server logout failed (continuing local sign-out)", error)
            }
        }
        if (shouldSignOutGoogle) {
            runCatching {
                signOutGoogle()
            }.onFailure { error ->
                Log.w(TAG, "Failed to sign out Google account", error)
            }
        }
        authSessionStore.clear()
        clearUserScopedRemoteState() // 동의/탈퇴 게이트 상태(needsConsent·consentChecked·pendingDeletion)도 여기서 초기화된다
        authSession = null
        message = getApplication<android.app.Application>().getString(R.string.msg_logout_success)
        authBusy = false
    }
}

// 회원 탈퇴(유예) 신청 — 즉시 삭제 대신 POST /me/deletion 으로 30일 유예 상태로 둔다.
// 유예 기간 내 다시 로그인해 철회하면 복구된다. 신청 후에는 로그아웃 처리한다(구글 revoke 안 함).
internal fun MainViewModel.requestAccountDeletion(signOutGoogle: suspend () -> Unit = {}) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    val shouldSignOutGoogle = session.provider == AuthSessionStore.PROVIDER_GOOGLE
    viewModelScope.launch {
        authBusy = true
        try {
            api.requestAccountDeletion(authorization)
            if (shouldSignOutGoogle) {
                runCatching { signOutGoogle() }.onFailure { Log.w(TAG, "Google sign-out failed", it) }
            }
            clearCurrentDefaultVoicePreferences()
            authSessionStore.clear()
            clearUserScopedRemoteState()
            authSession = null
            pendingDeletion = false
            dismissDeleteAccount()
            message = getApplication<android.app.Application>().getString(R.string.msg_account_deletion_requested)
        } catch (error: Throwable) {
            Log.e(TAG, "Failed to request account deletion", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_account_deletion_request_failed))
        } finally {
            authBusy = false
        }
    }
}

// 로그인 후 탈퇴 유예 상태인지 확인한다. pending_deletion 이면 복구 화면을 띄운다.
// (GET /me 는 유예 상태에서도 허용되는 엔드포인트) 실패 시 앱 진입을 막지 않는다.
internal fun MainViewModel.checkAccountStatus() {
    val session = authSession ?: return
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        runCatching {
            api.me(authorization)
        }.onSuccess { response ->
            pendingDeletion = response.user.deletionStatus == "pending_deletion"
        }.onFailure { error ->
            Log.w(TAG, "Failed to check account status", error)
        }
    }
}

// 유예 기간 내 탈퇴 철회 → 계정 복구. 성공 시 복구 화면을 닫고 정상 진입한다.
internal fun MainViewModel.cancelAccountDeletion() {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.cancelAccountDeletion(authorization)
        }.onSuccess {
            pendingDeletion = false
            message = getApplication<android.app.Application>().getString(R.string.msg_account_deletion_cancelled)
        }.onFailure { error ->
            Log.e(TAG, "Failed to cancel account deletion", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_account_deletion_cancel_failed))
        }
        authBusy = false
    }
}

internal fun MainViewModel.updateNickname(name: String) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val trimmed = name.trim()
    if (trimmed.isEmpty() || trimmed.length > 30) {
        message = getApplication<android.app.Application>().getString(R.string.msg_nickname_length_invalid)
        return
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.updateProfile(authorization, com.alarmtalk.app.network.UpdateProfileRequest(name = trimmed))
        }.onSuccess {
            val updated = session.copy(user = session.user.copy(name = trimmed))
            authSession = authSessionStore.save(updated)
            dismissEditNickname()
            message = getApplication<android.app.Application>().getString(R.string.msg_nickname_changed)
        }.onFailure { error ->
            Log.e(TAG, "Failed to update nickname", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_nickname_change_failed))
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
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val normalizedWindows = quietWindows
        .map { window -> window.copy(days = window.days.distinct().filter { it in 0..6 }.sorted()) }
        .filter { it.days.isNotEmpty() }
        .take(8)
    if (normalizedWindows.any { !isValidTimeText(it.start) || !isValidTimeText(it.end) }) {
        message = getApplication<android.app.Application>().getString(R.string.msg_time_format_required)
        return
    }
    val firstWindow = normalizedWindows.firstOrNull()
        ?: FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.updateProfile(
                authorization,
                com.alarmtalk.app.network.UpdateProfileRequest(
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
            message = getApplication<android.app.Application>().getString(R.string.msg_family_alarm_settings_saved)
        }.onFailure { error ->
            Log.e(TAG, "Failed to update family alarm settings", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_family_alarm_settings_save_failed))
        }
        authBusy = false
    }
}

internal fun MainViewModel.updateDynamicPromptSettings(settings: DynamicPromptSettings) {
    val session = authSession ?: return
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        runCatching {
            api.updateProfile(
                authorization,
                com.alarmtalk.app.network.UpdateProfileRequest(
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
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
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
            clearCurrentAccessSnapshot()
            clearCurrentDefaultVoicePreferences()
            authSessionStore.clear()
            clearUserScopedRemoteState()
            authSession = null
            dismissDeleteAccount()
            message = if (revokeError == null) {
                getApplication<android.app.Application>().getString(R.string.msg_account_deleted)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_account_deleted_google_unlink_failed)
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Failed to delete account", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_account_delete_failed))
        } finally {
            authBusy = false
        }
    }
}

// 앱 시작 시 백엔드 최소지원버전을 조회한다. 설치 버전이 그 미만이면 updateRequired=true 로
// 두어 AlarmTalkApp 이 업데이트 차단 화면을 띄운다. (로그인 여부와 무관하게 동작)
// 네트워크 실패 시에는 앱 사용을 막지 않는다.
internal fun MainViewModel.checkAppVersion() {
    viewModelScope.launch {
        runCatching {
            api.appVersion("android")
        }.onSuccess { policy ->
            updateStoreUrl = policy.storeUrl
            updateRequired = appVersionCode in 1 until policy.minSupportedVersion
        }.onFailure { error ->
            Log.w(TAG, "Failed to check app version", error)
            updateRequired = false
        }
    }
}

// 로그인 후 필수 동의 여부를 서버에 확인한다. 미동의면 needsConsent=true 로 두어
// AlarmTalkApp 이 동의 화면을 띄운다. 네트워크 실패 시에는 앱 진입을 막지 않는다.
internal fun MainViewModel.checkConsentStatus() {
    val session = authSession ?: return
    val userId = session.user.id
    // 이 기기에서 이미 동의를 마친 사용자는 로딩 없이 바로 통과시키고, 서버로 재확인만 한다.
    // 처음 보는 사용자는 서버 응답이 올 때까지 consentChecked=false 로 두어, 동의 화면이
    // 온보딩·홈보다 먼저 뜨도록 진입을 막는다.
    if (isConsentCachedDone(userId)) {
        needsConsent = false
        consentChecked = true
    } else {
        consentChecked = false
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    viewModelScope.launch {
        runCatching {
            api.consentStatus(authorization)
        }.onSuccess { status ->
            // 응답을 기다리는 사이 로그아웃/계정전환이 일어났으면, 옛 사용자의 결과로
            // 현재(또는 빈) 세션의 동의 상태를 덮어쓰지 않는다.
            if (authSession?.user?.id != userId) return@launch
            needsConsent = status.needsConsent
            rememberConsentDone(userId, !status.needsConsent, status.policyVersion)
        }.onFailure { error ->
            if (authSession?.user?.id != userId) return@launch
            Log.w(TAG, "Failed to check consent status", error)
            // 캐시로 이미 통과시킨 게 아니면 네트워크 실패가 앱 진입을 막지 않게 한다.
            if (!isConsentCachedDone(userId)) needsConsent = false
        }
        if (authSession?.user?.id == userId) consentChecked = true
    }
}

// 동의 화면 제출. 필수 항목은 화면의 체크값으로, marketing(광고성 정보 수신)은
// 사용자 선택값으로 기록한다. 성공 시 동의 화면을 닫는다.
internal fun MainViewModel.submitConsents(
    marketingAgreed: Boolean,
    voiceBiometricAgreed: Boolean,
    overseasTransferAgreed: Boolean,
) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    // 서버에 "현재 정책 버전"으로 기록되도록 직전 checkConsentStatus 가 저장한 버전을 함께 보낸다.
    // version 을 비우면 백엔드가 "1" 로 기록해, 정책이 개정된 뒤엔 옛 버전으로 저장되어
    // 계속 재동의를 요구받고 로컬 캐시(새 버전 만족)와 어긋난다.
    val policyVersion = cachedPolicyVersion()
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.recordConsents(
                authorization,
                com.alarmtalk.app.network.RecordConsentsRequest(
                    consents = listOf(
                        com.alarmtalk.app.network.ConsentItemRequest(type = "terms", agreed = true, version = policyVersion),
                        com.alarmtalk.app.network.ConsentItemRequest(type = "privacy", agreed = true, version = policyVersion),
                        com.alarmtalk.app.network.ConsentItemRequest(type = "age14", agreed = true, version = policyVersion),
                        com.alarmtalk.app.network.ConsentItemRequest(type = "voice_biometric", agreed = voiceBiometricAgreed, version = policyVersion),
                        com.alarmtalk.app.network.ConsentItemRequest(type = "overseas_transfer", agreed = overseasTransferAgreed, version = policyVersion),
                        com.alarmtalk.app.network.ConsentItemRequest(type = "marketing", agreed = marketingAgreed, version = policyVersion),
                    ),
                ),
            )
        }.onSuccess {
            needsConsent = false
            consentChecked = true
            // 방금 서버에 보낸 그 버전으로 로컬 캐시도 기록해 서버·클라 상태를 일치시킨다.
            // 모르면(직전 status 실패) 다음 콜드스타트에서 서버로 재확인하므로 캐시하지 않는다.
            policyVersion?.let { rememberConsentDone(session.user.id, true, it) }
            message = getApplication<android.app.Application>().getString(R.string.msg_consent_completed)
        }.onFailure { error ->
            Log.e(TAG, "Failed to record consents", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_consent_record_failed))
        }
        authBusy = false
    }
}

// 설정 화면 진입 시 현재 마케팅(광고성 정보 수신) 동의 상태를 서버에서 읽어 토글에 반영한다.
// GET /user/consents 는 유형별 최신값을 돌려주므로 marketing 의 agreed 를 그대로 쓴다.
internal fun MainViewModel.loadMarketingConsent() {
    val session = authSession ?: return
    val userId = session.user.id
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    // 이 로드가 시작된 시점의 generation 을 캡처해 둔다. 응답이 늦게 도착하는 사이 사용자가
    // 토글을 바꾸거나 계정이 바뀌면 generation 이 올라가, 낡은 스냅샷을 폐기한다.
    val generation = marketingConsentLoadGeneration
    // 새 시도가 시작되면(진입/재시도) 실패 표시를 지워 UI 가 '로딩 중'으로 돌아가게 한다.
    marketingConsentLoadFailed = false
    viewModelScope.launch {
        runCatching {
            api.listConsents(authorization)
        }.onSuccess { response ->
            if (authSession?.user?.id != userId || generation != marketingConsentLoadGeneration) return@launch
            marketingConsentLoadFailed = false
            marketingConsentAgreed = response.consents.firstOrNull { it.consentType == "marketing" }?.agreed ?: false
        }.onFailure { error ->
            Log.w(TAG, "Failed to load marketing consent", error)
            // 이 로드가 아직 최신이고 같은 사용자일 때만 실패로 표시(레이스/계정전환 무시).
            if (authSession?.user?.id == userId && generation == marketingConsentLoadGeneration) {
                marketingConsentLoadFailed = true
            }
        }
    }
}

// 설정의 '광고성 정보 수신' 토글 변경. marketing 동의를 현재 정책 버전으로 재기록한다(누적 저장,
// 최신값이 현재 상태). 낙관적으로 즉시 반영하고, 실패하면 직전 값으로 되돌린다.
internal fun MainViewModel.updateMarketingConsent(agreed: Boolean) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    // 쓰기가 진행 중이면(토글 disable 우회 등) 새 요청을 시작하지 않는다 — 동시 POST 직렬화.
    if (marketingConsentWriteInFlight) return
    val userId = session.user.id
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    val policyVersion = cachedPolicyVersion()
    val previous = marketingConsentAgreed
    // 토글로 사용자가 정한 값이 우선이다. 진행 중이던 로드(GET)의 결과가 이 값을 덮어쓰지 않도록
    // generation 을 올려 무효화한 뒤, 낙관적으로 즉시 반영한다.
    marketingConsentLoadGeneration++
    marketingConsentAgreed = agreed
    marketingConsentWriteInFlight = true
    // 이 쓰기가 시작된 시점의 사용자/generation 을 캡처해 둔다. POST 가 끝나기 전 계정 전환
    // (clearUserScopedRemoteState 가 generation 을 올림)이 일어나면 완료 처리가 새 사용자의
    // 토글 상태를 옛 값으로 덮어쓰지 않도록, 로드(GET) 가드와 동일하게 완료도 가드한다.
    val generation = marketingConsentLoadGeneration
    viewModelScope.launch {
        val result = runCatching {
            api.recordConsents(
                authorization,
                com.alarmtalk.app.network.RecordConsentsRequest(
                    consents = listOf(
                        com.alarmtalk.app.network.ConsentItemRequest(
                            type = "marketing",
                            agreed = agreed,
                            version = policyVersion,
                        ),
                    ),
                ),
            )
        }
        result.exceptionOrNull()?.let { error ->
            Log.e(TAG, "Failed to update marketing consent", error)
        }
        // 완료 사이 계정 전환/더 새로운 토글로 사용자나 generation 이 바뀌었으면 이 결과는 폐기한다
        // (상태·잠금 모두 건드리지 않음 — 현재 소유자가 따로 관리).
        if (authSession?.user?.id != userId || generation != marketingConsentLoadGeneration) return@launch
        result.onSuccess {
            val app = getApplication<android.app.Application>()
            message = if (agreed) {
                app.getString(R.string.msg_marketing_consent_on)
            } else {
                app.getString(R.string.msg_marketing_consent_off)
            }
        }.onFailure { error ->
            marketingConsentAgreed = previous
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_marketing_consent_update_failed))
        }
        // 성공·실패와 무관하게(단, 이 쓰기가 여전히 최신일 때만) 쓰기 잠금 해제 → 다음 토글 허용.
        marketingConsentWriteInFlight = false
    }
}

internal fun MainViewModel.syncNow() {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_sync_login_required)
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
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_sync_failed))
        }
        syncBusy = false
    }
}

private fun MainViewModel.alarmSyncFailureMessage(pushFailed: Int, pullFailed: Int): String = when {
    pushFailed > 0 && pullFailed > 0 ->
        getApplication<android.app.Application>().getString(R.string.msg_sync_push_and_pull_partial_failed)
    pushFailed > 0 ->
        getApplication<android.app.Application>().getString(R.string.msg_sync_push_partial_failed)
    pullFailed > 0 ->
        getApplication<android.app.Application>().getString(R.string.msg_sync_pull_partial_failed)
    else -> getApplication<android.app.Application>().getString(R.string.msg_sync_generic_failed)
}
