package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.EmailVerificationConfirmRequest
import com.alarmtalk.app.network.EmailVerificationRequest
import com.alarmtalk.app.network.GoogleLoginRequest
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.PasswordResetConfirmRequest
import com.alarmtalk.app.network.PasswordResetRequest
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import kotlinx.coroutines.launch


internal fun MainViewModel.login(email: String, password: String) {
    val normalizedEmail = email.trim()
    if (normalizedEmail.isBlank() || password.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_email_password_required)
        return
    }
    viewModelScope.launch {
        authBusy = true
        loginError = null
        authNotice = null
        runCatching {
            api.login(LoginRequest(email = normalizedEmail, password = password))
        }.onSuccess { response ->
            authSession = authSessionStore.saveAppSession(response)
            onSignedIn()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Email login failed", error)
            val app = getApplication<android.app.Application>()
            // 스낵바(전역 message) 대신 로그인 화면 인라인 에러로 — 키보드가 열려 있어도 보인다.
            // 서버는 미가입/비밀번호 불일치를 구분하지 않고 AUTH_INVALID_CREDENTIALS 401 하나로
            // 응답한다(계정 존재 여부 노출 방지) — 안내 문구도 이메일·비밀번호를 함께 확인하게 쓴다.
            loginError = when (com.alarmtalk.app.network.apiError(error).code) {
                "AUTH_INVALID_CREDENTIALS" -> app.getString(R.string.auth_error_invalid_credentials)
                else -> userFacingError(error, app.getString(R.string.msg_login_failed))
            }
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
        registerError = null
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
            AlarmTalkLog.reportError("Email verification request failed", error)
            // 스낵바는 키보드에 가려 '아무 반응 없음'처럼 보인다 — 화면 인라인으로 안내한다.
            // AUTH_EMAIL_TAKEN 은 로그인 화면으로 전환되므로 안내를 authNotice 로 넘긴다.
            val friendly = duplicateEmailMessage(error)
            if (authRedirectToLogin) {
                authNotice = friendly
            } else {
                registerError = friendly
                    ?: userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_verification_code_send_failed))
            }
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
        "AUTH_EMAIL_SOCIAL" -> app.getString(R.string.msg_register_email_social_google)
        else -> null
    }
}

internal fun MainViewModel.confirmEmailVerification(email: String, code: String) {
    val normalizedEmail = email.trim().lowercase()
    if (normalizedEmail.isBlank() || code.trim().length != 6) {
        registerError = getApplication<android.app.Application>().getString(R.string.msg_verification_code_six_digits_required)
        return
    }
    viewModelScope.launch {
        authBusy = true
        registerError = null
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
            AlarmTalkLog.reportError("Email verification confirm failed", error)
            registerError = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_verification_code_mismatch))
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
        registerError = getApplication<android.app.Application>().getString(R.string.msg_register_all_fields_required)
        return
    }
    if (registerEmailVerified != normalizedEmail) {
        registerError = getApplication<android.app.Application>().getString(R.string.msg_register_verify_email_first)
        return
    }
    viewModelScope.launch {
        authBusy = true
        registerError = null
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
            onSignedIn()
            message = getApplication<android.app.Application>().getString(R.string.msg_register_success, response.user.email)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Email registration failed", error)
            val friendly = duplicateEmailMessage(error)
            if (authRedirectToLogin) {
                authNotice = friendly
            } else {
                registerError = friendly
                    ?: userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_register_failed))
            }
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
            AlarmTalkLog.reportError("Password reset request failed", error)
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
            AlarmTalkLog.reportError("Password reset confirm failed", error)
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
            onSignedIn()
            message = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Google token exchange failed", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_google_login_failed))
        }
        authBusy = false
    }
}

/**
 * 로그인 성공 직후 공통 처리. 세 경로(이메일 로그인·이메일 가입·구글)가 같은 일을 하므로
 * 한 곳으로 모은다 — 경로마다 손으로 나열하면 새 로그인 방식이 생길 때 하나씩 빠진다.
 *
 * 알람 재예약이 여기 있는 이유: 로그아웃은 이 기기의 AlarmManager 예약을 전부 취소하지만
 * Room 행은 켜진 채로 둔다(detachAlarmsOnSignOut). 앱을 다시 켜지 않고 그대로 다시
 * 로그인하면 목록에는 알람이 돌아오는데 예약이 없어 하나도 울리지 않는다. 예전에는
 * MainViewModel.init 의 시작 시 재예약에만 기대고 있었다.
 */
private suspend fun MainViewModel.onSignedIn() {
    restoreAccessSnapshotForCurrentUser()
    RemoteAlarmSyncScheduler.ensurePeriodic(getApplication())
    RemoteAlarmSyncScheduler.runOnce(getApplication())
    com.alarmtalk.app.fcm.AlarmTalkMessagingService.registerCurrentToken(getApplication())
    val currentUserId = authSession?.user?.id?.takeIf { it.isNotBlank() }
    // 앞 세션이 '다른 계정'이었다면 그 계정이 끝날 때 소유자를 못 새겼을 수 있다(쓰기 실패,
    // 뒤처리 전 프로세스 종료 등). 아래 cancelAlarmsNotOwnedBy 는 소유자가 기록된 행만 보므로,
    // 그 전에 마저 새겨야 앞 계정의 살아 있는 예약이 내려간다. 이미 새겨졌으면 no-op 이고,
    // 실패하면 마커가 남아 reschedulePendingAlarms 안에서 다시 시도한다.
    runCatching { repository.settlePendingAlarmOwnership() }
        .onFailure { error -> Log.w(TAG, "Failed to settle alarm ownership before sign-in cleanup", error) }
    // 자동 401 은 알람 예약을 그대로 두므로, 그 뒤 다른 계정으로 들어오면 앞 계정 예약이
    // 살아 있다. 목록에서는 소유자 필터가 감춰 끌 수도 없으니 여기서 내린다.
    runCatching { repository.cancelAlarmsNotOwnedBy(currentUserId) }
        .onFailure { error -> Log.w(TAG, "Failed to cancel other account alarm reservations", error) }
    runCatching { repository.reschedulePendingAlarms() }
        .onSuccess { scheduled -> Log.i(TAG, "Rescheduled $scheduled alarms after sign-in") }
        .onFailure { error -> AlarmTalkLog.reportError("Failed to reschedule alarms after sign-in", error) }
}

internal fun MainViewModel.logout(signOutGoogle: suspend () -> Unit = {}) {
    val session = authSession
    val shouldSignOutGoogle = session?.provider == AuthSessionStore.PROVIDER_GOOGLE
    viewModelScope.launch {
        authBusy = true
        // 서버에 로그아웃을 알려 token_epoch 를 올린다(남아있던 토큰 전부 401 TOKEN_REVOKED).
        // 네트워크 실패가 로컬 로그아웃을 막지 않도록 best-effort 로 처리한다.
        if (session != null) {
            // token_epoch 를 올리기 전에(=세션 토큰 유효할 때) 이 기기 FCM 토큰을 서버에서 먼저 제거한다.
            // 로그아웃한(또는 공유) 기기에 이 계정의 알람 push 가 계속 오는 것을 막는다.
            runCatching {
                com.alarmtalk.app.fcm.AlarmTalkMessagingService.unregisterCurrentToken(session.token)
            }.onFailure { error -> Log.w(TAG, "FCM unregister on logout failed (continuing)", error) }
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
        // 알람 분리·기본 목소리 초기화·세션 클리어는 모든 종료 경로 공용(clearSignedInSession).
        clearSignedInSession()
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
            // 삭제 신청이 '성공한 뒤에만' 이 기기 FCM 토큰을 제거한다(유예 기간 동안 push 방지). 신청이
            // 실패하면 사용자는 로그인 유지 상태이므로 토큰을 지우지 않아 즉시 push 를 계속 받게 한다.
            // /me/deletion 은 token_epoch 를 올리지 않아(user.ts) 신청 후에도 세션 토큰이 유효하다.
            runCatching {
                com.alarmtalk.app.fcm.AlarmTalkMessagingService.unregisterCurrentToken(session.token)
            }.onFailure { error -> Log.w(TAG, "FCM unregister on deletion failed (continuing)", error) }
            if (shouldSignOutGoogle) {
                runCatching { signOutGoogle() }.onFailure { Log.w(TAG, "Google sign-out failed", it) }
            }
            clearSignedInSession()
            pendingDeletion = false
            dismissDeleteAccount()
            message = getApplication<android.app.Application>().getString(R.string.msg_account_deletion_requested)
        } catch (error: Throwable) {
            AlarmTalkLog.reportError("Failed to request account deletion", error)
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
            // 철회로 계정이 'active' 로 복구됐으니, 삭제 신청 때 제거됐던 이 기기 FCM 토큰을 다시 등록한다.
            // (pending 중엔 로그인해도 게이트가 /push/register 를 막아 등록이 안 됐다.) 그래야 가족 알람
            // push 가 이 기기에 다시 온다 — active 복구 후라 등록 게이트를 통과한다.
            com.alarmtalk.app.fcm.AlarmTalkMessagingService.registerCurrentToken(getApplication())
            message = getApplication<android.app.Application>().getString(R.string.msg_account_deletion_cancelled)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to cancel account deletion", error)
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
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to update nickname", error)
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
            AlarmTalkLog.reportError("Failed to update family alarm settings", error)
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
            AlarmTalkLog.reportError("Failed to update dynamic prompt settings", error)
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
            clearSignedInSession()
            dismissDeleteAccount()
            message = if (revokeError == null) {
                getApplication<android.app.Application>().getString(R.string.msg_account_deleted)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_account_deleted_google_unlink_failed)
            }
        } catch (error: Throwable) {
            AlarmTalkLog.reportError("Failed to delete account", error)
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
            // 강제(min_supported 미달) → IMMEDIATE + 폴백 차단 화면. 권장(latest 미달) → FLEXIBLE.
            // 이 판정 결과를 InAppUpdateManager 가 그대로 소비한다(버전 비교 중복 구현 금지).
            updateRequired = appVersionCode in 1 until policy.minSupportedVersion
            updateRecommended = appVersionCode in 1 until policy.latestVersion
        }.onFailure { error ->
            Log.w(TAG, "Failed to check app version", error)
            updateRequired = false
            updateRecommended = false
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
            // 화면이 무엇을 그리고 무엇을 제출할지는 서버가 정한다. 구버전 서버(collect 없음)와
            // 섞여 돌 수 있으니 비어 있으면 missing 으로 폴백한다.
            consentCollect = status.collect.ifEmpty { status.missing }
            consentOptional = status.optional
            sensitiveConsentMissing = status.sensitiveMissing
            consentIsReconsent = status.hasPriorConsent
            consentNeedsCollection = status.needsCollection
            // 받을 게 남아 있으면(선택 동의 재수집 포함) '완료' 로 캐시하지 않는다.
            // 캐시가 완료로 남으면 다음 실행에서 서버 응답 전에 consentChecked=true 가 되어
            // 권한·웰컴 오버레이가 먼저 소진되고, 상태 조회가 실패하면 그 실행에서는
            // 수집 화면이 아예 안 뜬다. 완료 표시는 제출 성공 시에만 한다.
            val nothingLeftToCollect =
                !status.needsConsent && !status.needsCollection && status.collect.isEmpty()
            rememberConsentDone(userId, nothingLeftToCollect, status.policyVersion)
        }.onFailure { error ->
            if (authSession?.user?.id != userId) return@launch
            Log.w(TAG, "Failed to check consent status", error)
            // 캐시로 이미 통과시킨 게 아니면 네트워크 실패가 앱 진입을 막지 않게 한다.
            if (!isConsentCachedDone(userId)) needsConsent = false
        }
        if (authSession?.user?.id == userId) consentChecked = true
    }
}

/**
 * 동의 화면 제출.
 *
 * **화면에 실제로 띄운 유형만 보낸다**(consentCollect). 안 띄운 유형은 이미 유효한 동의가
 * 있다는 뜻이므로 건드리지 않는다 — 전부 덮어쓰면 정책 개정 때마다 사용자가 켜뒀던
 * 마케팅 수신 설정이 체크 안 된 상태로 재기록돼 조용히 꺼진다.
 *
 * [agreedOptional] 은 화면에서 사용자가 실제로 체크한 '선택' 유형(마케팅·음성 생체정보)이다.
 * 여기 없는 선택 유형은 **거절로 기록한다** — 거절도 유효한 응답이라 다음 로그인에서 다시
 * 묻지 않아야 하고, 동의로 슬쩍 기록하면 묻지도 않은 동의를 받아 버린다.
 *
 * overseas_transfer 는 가입 필수라 이 화면에서 함께 받는다. voice_biometric 은 선택이라
 * 거절하고 통과할 수 있고, 그 사람은 목소리 등록 화면에서 인라인으로 다시 만난다
 * ([submitVoiceConsents]).
 */
internal fun MainViewModel.submitConsents(agreedOptional: Set<String>) {
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
    // collect 가 비어 있는 건 status 응답을 못 받은 경우다 — 이때만 필수 3종으로 폴백한다.
    val collect = consentCollect.ifEmpty { GENERAL_REQUIRED_CONSENT_TYPES }
    // 구버전 서버(optional 없음) 폴백은 화면과 같은 기준을 써야 한다 — 여기만 다르면
    // 화면에서 선택으로 그린 항목이 제출에서 필수로 둔갑해 동의로 기록된다.
    val optionalTypes = consentOptional.ifEmpty { listOf("marketing") }.toSet()
    val consents = collect.map { type ->
        com.alarmtalk.app.network.ConsentItemRequest(
            type = type,
            // 필수 유형은 화면을 통과한 시점에 이미 체크됐다. 선택 유형만 사용자 선택값.
            agreed = type !in optionalTypes || type in agreedOptional,
            version = policyVersion,
        )
    }
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.recordConsents(
                authorization,
                com.alarmtalk.app.network.RecordConsentsRequest(consents = consents),
            )
        }.onSuccess {
            needsConsent = false
            // 방금 받은 유형은 더 받을 게 없다. 비우지 않으면 showConsentScreen 이 계속 true 라
            // 화면이 닫히지 않는다.
            consentCollect = emptyList()
            consentOptional = emptyList()
            consentNeedsCollection = false
            // 방금 화면에서 **동의로** 기록한 유형은 서버 상태와 맞춘다 — 이걸 안 지우면
            // 목소리 등록 화면이 이미 받은 동의를 또 묻는다. 거절한 유형은 그대로 남아
            // 등록 화면에서 다시 만난다(그게 이 설계의 핵심이다).
            val agreedNow = consents.filter { it.agreed }.map { it.type }.toSet()
            sensitiveConsentMissing = sensitiveConsentMissing - agreedNow
            consentChecked = true
            // 방금 서버에 보낸 그 버전으로 로컬 캐시도 기록해 서버·클라 상태를 일치시킨다.
            // 모르면(직전 status 실패) 다음 콜드스타트에서 서버로 재확인하므로 캐시하지 않는다.
            policyVersion?.let { rememberConsentDone(session.user.id, true, it) }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to record consents", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_consent_record_failed))
        }
        authBusy = false
    }
}

/**
 * 목소리 등록 시점의 민감 동의 기록. 시트에서 '동의하고 음성 만들기' 를 누르면 호출된다.
 *
 * 성공하면 붙들어 뒀던 등록 요청을 그대로 이어서 실행한다 — 사용자가 동의 후 등록 버튼을
 * 다시 찾아 누르게 만들지 않는다. 실패하면 시트를 닫지 않아 재시도할 수 있게 둔다.
 */
internal fun MainViewModel.submitVoiceConsents() {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_login_required_to_use)
        return
    }
    val request = pendingSensitiveConsent ?: return
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    val policyVersion = cachedPolicyVersion()
    // 이 요청을 시작한 계정. 코루틴이 request 를 지역 변수로 붙들고 있어, 응답이 오는 사이
    // 401 로 세션이 끊기고 다른 계정이 로그인해도 이 continuation 은 그대로 살아 있다.
    // 세션 정리에서 pendingSensitiveConsent 를 비우는 것만으로는 못 막는다 — 그때 이어서
    // 등록하면 앞 계정이 녹음한 음성이 뒤 계정으로 올라간다(Codex #660).
    val ownerUserId = session.user.id
    viewModelScope.launch {
        authBusy = true
        runCatching {
            api.recordConsents(
                authorization,
                com.alarmtalk.app.network.RecordConsentsRequest(
                    // 시트가 실제로 물어본 유형만 기록한다 — 국외 이전만 요구된 자리에서
                    // 음성 생체정보까지 함께 넣으면 묻지도 않은 동의를 받아 버린다.
                    consents = request.types.map { type ->
                        com.alarmtalk.app.network.ConsentItemRequest(
                            type = type,
                            agreed = true,
                            version = policyVersion,
                        )
                    },
                ),
            )
        }.onSuccess {
            authBusy = false
            // 응답이 오는 사이 세션이 바뀌었으면 아무것도 이어가지 않는다. 동의 기록 자체는
            // 앞 계정의 토큰으로 나갔으니 그 계정에 정상적으로 남는다.
            if (authSession?.user?.id != ownerUserId) return@onSuccess
            sensitiveConsentMissing = sensitiveConsentMissing - request.types.toSet()
            pendingSensitiveConsent = null
            // 목소리 등록에서 온 경우에만 이어서 만든다. 시스템 목소리 TTS 처럼 붙들어 둔
            // 요청이 없으면 동의만 기록하고 끝낸다(사용자가 다시 시도하면 이제 통과한다).
            request.resumeVoiceDrafts?.let { createVoiceProfiles(it) }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to record voice consents", error)
            authBusy = false
            if (authSession?.user?.id != ownerUserId) return@onFailure
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_consent_record_failed))
        }
    }
}

// 전체 > 약관 및 개인정보 처리 동의 화면 — 유형별 최신 동의 기록(agreed_at 포함)을 읽는다.
internal suspend fun MainViewModel.loadConsentRecords(): List<com.alarmtalk.app.network.ConsentRecord> {
    val session = authSession ?: return emptyList()
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    return api.listConsents(authorization).consents
}

// 설정 화면 진입 시 현재 마케팅(광고성 정보 수신) 동의 상태를 서버에서 읽어 토글에 반영한다.
// GET /user/consents 는 유형별 최신값을 돌려주므로 marketing 의 agreed 를 그대로 쓴다.
internal fun MainViewModel.loadMarketingConsent() {
    val session = authSession ?: return
    val userId = session.user.id
    val authorization = com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token)
    // 캐시된 직전 서버 확인값으로 토글을 즉시 채운다 → GET 응답 전 '로딩'으로 늦게 뜨지 않게(낙관적 표시).
    // 계정별 키라 다른 계정/미확인이면 null → 안전하게 로딩 상태 유지(잘못된 off 표시 방지).
    if (marketingConsentAgreed == null) {
        marketingConsentAgreed = com.alarmtalk.app.data.MarketingConsentCache(getApplication<android.app.Application>()).read(userId)
    }
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
            val agreed = response.consents.firstOrNull { it.consentType == "marketing" }?.agreed ?: false
            marketingConsentAgreed = agreed
            // 서버 확인값을 캐시에 저장 → 다음 진입 때 즉시 seed.
            com.alarmtalk.app.data.MarketingConsentCache(getApplication<android.app.Application>()).write(userId, agreed)
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
            AlarmTalkLog.reportError("Failed to update marketing consent", error)
        }
        // 완료 사이 계정 전환/더 새로운 토글로 사용자나 generation 이 바뀌었으면 이 결과는 폐기한다
        // (상태·잠금 모두 건드리지 않음 — 현재 소유자가 따로 관리).
        if (authSession?.user?.id != userId || generation != marketingConsentLoadGeneration) return@launch
        result.onSuccess {
            val app = getApplication<android.app.Application>()
            // 확정된 값을 캐시에 저장 → 다음 진입 때 즉시 seed(낙관적 표시).
            com.alarmtalk.app.data.MarketingConsentCache(app).write(userId, agreed)
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
            val pull = repository.pullReceivedAlarms(api, session.token)
            push to pull
        }.onSuccess { (push, pull) ->
            val failed = push.failed + pull.failed
            val app = getApplication<android.app.Application>()
            when {
                failed > 0 ->
                    message = alarmSyncFailureMessage(pushFailed = push.failed, pullFailed = pull.failed)
                // 앱이 열려 있을 때 새로 받은 상대 알람을 인앱으로도 알린다(시스템 알림에만 의존하지 않음).
                // syncNow 는 알람 탭 진입 시 자동 실행되므로, 사용자가 보던 메시지를 덮지 않게 비어 있을 때만.
                pull.imported > 0 && message.isNullOrBlank() ->
                    message = app.resources.getQuantityString(
                        R.plurals.msg_received_alarm_arrived,
                        pull.imported,
                        pull.imported,
                    )
            }
        }.onFailure { error ->
            // syncNow 는 알람 탭 진입 시 자동 실행되고(사용자 조치가 아님) 다음 진입·주기 sync 가
            // 자동 재시도한다. 그래서 전체 실패는 겁주는 토스트 대신 로그만 남긴다 — 특히 첫
            // 로그인 직후 동의 정착 전 GET /alarm 이 잠깐 CONSENT_REQUIRED 로 막히는 게
            // 흔한데(면제 경로 아님), 이건 정상 재시도로 곧 풀린다. 사용자에게 뜨던
            // "알람 정보를 주고받지 못했어요" 토스트를 제거한다.
            if (error is kotlin.coroutines.cancellation.CancellationException) throw error
            // 403 이라도 error_code 로 정확히 CONSENT_REQUIRED 만 강등한다 — CONSENT_STATE_UNAVAILABLE
            // ·ACCOUNT_PENDING_DELETION 같은 실제 인증/동의 파손은 모니터링에 남겨야 한다.
            if (com.alarmtalk.app.network.apiErrorCode(error) == "CONSENT_REQUIRED") {
                Log.i(TAG, "Auto-sync deferred: consent not settled yet, will retry")
            } else {
                AlarmTalkLog.reportError("Backend sync failed", error)
            }
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
