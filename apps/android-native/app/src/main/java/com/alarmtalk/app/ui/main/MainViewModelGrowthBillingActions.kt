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
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.alarm.SocialNotificationTracker
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CancelSubscriptionRequest
import com.alarmtalk.app.network.ChangePlanRequest
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.GooglePlayConfirmRequest
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.NoteAudioResponse
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
import com.alarmtalk.app.network.trimmedOrNull
import com.alarmtalk.app.R
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue


internal fun MainViewModel.refreshBilling() {
    refreshBillingData(showMessage = true)
}

internal suspend fun MainViewModel.refreshShareCodeData(): List<VoucherItem> {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_share_code_info)) ?: return vouchers
    if (billingBusy || socialBusy) return vouchers
    billingBusy = true
    socialBusy = true
    return try {
        coroutineScope {
            val subscription = async { api.getSubscription(authorization) }
            val freshVouchers = async { api.listVouchers(authorization).vouchers }
            val group = async {
                runCatching {
                    api.getFamilyGroup(authorization)
                }.onFailure { error ->
                    Log.w(TAG, "Failed to refresh family group before voucher share", error)
                }.getOrNull()
            }
            val updatedSubscription = subscription.await()
            val updatedVouchers = freshVouchers.await()
            val updatedGroup = group.await()
            subscriptionResponse = updatedSubscription
            saveSubscriptionSnapshot(updatedSubscription)
            vouchers = updatedVouchers
            updatedGroup?.let {
                familyGroup = it
                saveFamilyGroupSnapshot(it)
            }
            updatedVouchers
        }
    } catch (error: Throwable) {
        Log.e(TAG, "Failed to refresh share code data", error)
        message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_info_load_failed))
        vouchers
    } finally {
        billingBusy = false
        socialBusy = false
    }
}

internal fun MainViewModel.preloadBilling() {
    if (authSession == null || billingRefreshing || billingBusy) return
    refreshBillingData(showMessage = false)
}

// read-only 새로고침은 billingRefreshing 만 올린다 — billingBusy 를 쓰면 패널 진입
// 직후 구매 버튼이 네트워크 호출이 끝날 때까지 비활성화되는 문제가 있었다.
private fun MainViewModel.refreshBillingData(showMessage: Boolean) {
    if (billingRefreshing || billingBusy) return
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_growth_info)) ?: return
    billingRefreshing = true
    viewModelScope.launch {
        try {
            runCatching {
                loadBillingSnapshot(authorization)
            }.onSuccess { snapshot ->
                applyBillingSnapshot(snapshot)
            }.onFailure { error ->
                Log.e(TAG, "Failed to load billing", error)
                if (showMessage) message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_growth_info_load_failed))
            }
        } finally {
            billingRefreshing = false
        }
    }
}

private suspend fun MainViewModel.loadBillingSnapshot(
    authorization: String,
): BillingSnapshot =
    coroutineScope {
        val subscription = async { api.getSubscription(authorization) }
        val vouchers = async { api.listVouchers(authorization).vouchers }
        BillingSnapshot(
            subscription = subscription.await(),
            vouchers = vouchers.await(),
        )
    }

private fun MainViewModel.applyBillingSnapshot(snapshot: BillingSnapshot) {
    subscriptionResponse = snapshot.subscription
    saveSubscriptionSnapshot(snapshot.subscription)
    vouchers = snapshot.vouchers
}

private suspend fun MainViewModel.refreshBillingAfterMutation(
    authorization: String,
    reason: String,
) {
    runCatching {
        loadBillingSnapshot(authorization)
    }.onSuccess { snapshot ->
        applyBillingSnapshot(snapshot)
    }.onFailure { error ->
        Log.w(TAG, "Failed to refresh billing after $reason", error)
    }
}

private fun billingFailureMessage(context: android.content.Context, errorCode: String?, fallback: String): String =
    when (errorCode) {
        "SAME_PLAN" -> context.getString(R.string.msg2_billing_fail_same_plan)
        "NO_ACTIVE_SUBSCRIPTION" -> context.getString(R.string.msg2_billing_fail_no_active_subscription)
        "PLAN_NOT_FOUND" -> context.getString(R.string.msg2_billing_fail_plan_not_found)
        "PLAN_INACTIVE" -> context.getString(R.string.msg2_billing_fail_plan_inactive)
        "FREE_NOT_BILLABLE" -> context.getString(R.string.msg2_billing_fail_free_not_billable)
        "GIFT_PERSONAL_ONLY" -> context.getString(R.string.msg2_billing_fail_gift_personal_only)
        "CHECKOUT_DISABLED" -> context.getString(R.string.msg2_billing_fail_checkout_disabled)
        "USER_NOT_FOUND" -> context.getString(R.string.msg2_billing_fail_user_not_found)
        else -> fallback
    }

private fun codeRegistrationFailureMessage(context: android.content.Context, errorCode: String?, fallback: String): String =
    when (errorCode) {
        "CODE_REQUIRED" -> context.getString(R.string.msg2_code_fail_code_required)
        "INVALID_FORMAT" -> context.getString(R.string.msg2_code_fail_invalid_format)
        "CODE_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_code_not_found)
        "CODE_EXPIRED" -> context.getString(R.string.msg2_code_fail_code_expired)
        "CODE_ALREADY_USED" -> context.getString(R.string.msg2_code_fail_code_already_used)
        "CODE_ALREADY_REDEEMED_BY_YOU" -> context.getString(R.string.msg2_code_fail_code_already_redeemed_by_you)
        "SELF_ISSUED" -> context.getString(R.string.msg2_code_fail_self_issued)
        "GROUP_FULL" -> context.getString(R.string.msg2_code_fail_group_full)
        "INVALID_GIFT_PLAN", "INVALID_INVITE_PLAN" -> context.getString(R.string.msg2_code_fail_invalid_plan_type)
        "PLAN_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_plan_not_found)
        "USER_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_user_not_found)
        else -> fallback
    }

internal fun MainViewModel.registerCode(code: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_register_code)) ?: return
    val trimmedCode = code.trim()
    if (trimmedCode.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_code_input_required_period)
        return
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.registerCode(authorization, CodeRegisterRequest(trimmedCode))
        }.onSuccess { response ->
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_code_registered)
            refreshBillingAfterMutation(authorization, "code registration")
            refreshSocial()
            refreshAppSession()
            if (response.type == "invite" || trimmedCode.startsWith("INV-", ignoreCase = true)) {
                navigateSharedPassTick++
            } else {
                navigateHomeTick++
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to register code", error)
            message = codeRegistrationFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_code_register_failed)),
            )
        }
        billingBusy = false
    }
}

internal fun MainViewModel.refreshNotes() {
    refreshNotesData(showMessage = true)
}

internal fun MainViewModel.refreshNotesSilently() {
    refreshNotesData(showMessage = false)
}

internal fun MainViewModel.preloadNotes() {
    if (authSession == null || noteBusy) return
    refreshNotesData(showMessage = false)
}

private fun MainViewModel.refreshNotesData(showMessage: Boolean) {
    if (noteBusy) return
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_load_voice_messages)) ?: return
    noteBusy = true
    viewModelScope.launch {
        try {
            runCatching {
                api.listReceivedNotes(authorization, limit = 20, offset = 0).notes
            }.onSuccess { notes ->
                SocialNotificationTracker.notifyNewNotes(
                    context = getApplication(),
                    notes = notes,
                    allowInitialNotify = false,
                )
                receivedNotes = notes
            }.onFailure { error ->
                Log.e(TAG, "Failed to refresh notes", error)
                if (showMessage) message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_voice_messages_load_failed))
            }
        } finally {
            noteBusy = false
        }
    }
}

internal fun MainViewModel.sendNote(receiverId: String, text: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_send_message)) ?: return
    val normalizedReceiverId = receiverId.trim()
    val trimmedText = text.trim()
    if (normalizedReceiverId.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_receiver_required)
        return
    }
    if (trimmedText.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_message_input_required)
        return
    }
    viewModelScope.launch {
        noteBusy = true
        runCatching {
            api.sendNote(
                authorization = authorization,
                request = SendNoteRequest(receiverId = normalizedReceiverId, text = trimmedText),
            )
        }.onSuccess {
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_message_sent)
            refreshNotes()
        }.onFailure { error ->
            Log.e(TAG, "Failed to send note", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_message_send_failed))
        }
        noteBusy = false
    }
}

internal fun MainViewModel.sendTtsNote(receiverId: String, text: String, voiceProfileId: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_send_message)) ?: return
    val normalizedReceiverId = receiverId.trim()
    val normalizedVoiceProfileId = voiceProfileId.trim()
    val trimmedText = text.trim()
    if (normalizedReceiverId.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_receiver_required)
        return
    }
    if (trimmedText.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_message_input_required)
        return
    }
    if (trimmedText.length > 200) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_voice_message_max_length)
        return
    }
    if (normalizedVoiceProfileId.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_voice_required)
        return
    }
    viewModelScope.launch {
        noteBusy = true
        runCatching {
            val tts = withContext(Dispatchers.IO) {
                api.generateTts(
                    authorization = authorization,
                    request = TtsGenerateRequest(
                        voiceProfileId = normalizedVoiceProfileId,
                        text = trimmedText,
                        category = "custom",
                        language = "ko",
                    ),
                )
            }
            val audioUrl = tts.audioUrl ?: tts.audioObjectKey?.let { "r2://$it" }
                ?: error("Generated TTS audio was not stored.")
            api.sendNote(
                authorization = authorization,
                request = SendNoteRequest(
                    receiverId = normalizedReceiverId,
                    text = trimmedText,
                    audioUrl = audioUrl.trimmedOrNull(),
                ),
            )
        }.onSuccess {
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_voice_message_sent)
            refreshNotes()
        }.onFailure { error ->
            Log.e(TAG, "Failed to send TTS note", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_voice_message_send_failed))
        }
        noteBusy = false
    }
}

internal suspend fun MainViewModel.downloadNoteAudio(noteId: String): NoteAudioResponse {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_play_voice_message))
        ?: throw IllegalStateException("Login is required to play note audio.")
    return withContext(Dispatchers.IO) {
        api.getNoteAudio(authorization, noteId)
    }
}

internal fun MainViewModel.markNoteRead(noteId: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_mark_message_read)) ?: return
    viewModelScope.launch {
        runCatching {
            api.markNoteRead(authorization, noteId)
        }.onSuccess {
            receivedNotes = receivedNotes.map { note ->
                if (note.id == noteId && note.readAt == null) {
                    note.copy(readAt = Instant.now().toString())
                } else {
                    note
                }
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to mark note read id=$noteId", error)
        }
    }
}

internal fun MainViewModel.checkoutPlan(planKey: String, gift: Boolean = false) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_change_plan)) ?: return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.checkoutPlan(authorization, CheckoutRequest(planKey = planKey, gift = gift))
        }.onSuccess { response ->
            if (!gift) response.subscription?.let { subscription ->
                val updatedSubscription = BillingSubscriptionResponse(
                    subscription = subscription,
                    plan = response.plan,
                )
                subscriptionResponse = updatedSubscription
                saveSubscriptionSnapshot(updatedSubscription)
            }
            response.voucher?.let { voucher ->
                vouchers = listOf(
                    VoucherItem(
                        id = voucher.id,
                        code = voucher.code,
                        planKey = response.plan.key,
                        planName = response.plan.name,
                        planType = response.plan.planType,
                        status = "issued",
                        expiresAt = voucher.expiresAt,
                        maxUses = voucher.maxUses,
                        useCount = voucher.useCount,
                    ),
                ) + vouchers
            }
            message = if (gift) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_gift_available, response.plan.name)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_applied_named, response.plan.name)
            }
            refreshBillingAfterMutation(authorization, "checkout")
            if (!gift) {
                refreshAppSession()
                refreshSocial()
                if (response.plan.isSharedPassPlan()) {
                    navigateSharedPassTick++
                } else {
                    navigateHomeTick++
                }
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to checkout plan key=$planKey gift=$gift", error)
            val fallback = if (gift) getApplication<android.app.Application>().getString(R.string.msg_gb_gift_failed) else getApplication<android.app.Application>().getString(R.string.msg_gb_plan_apply_failed)
            message = billingFailureMessage(getApplication<android.app.Application>(), apiErrorCode(error), userFacingError(error, fallback))
        }
        billingBusy = false
    }
}

/**
 * Google Play 구독 결제를 시작한다. 결제 시트 결과(성공/보류/취소)는
 * [MainViewModel.playBilling] 의 리스너로 비동기 전달되어 [confirmGooglePurchase] 로 이어진다.
 */
internal fun MainViewModel.startPlayPurchase(activity: android.app.Activity, productId: String) {
    if (authSession == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_purchase_plan)
        return
    }
    if (billingBusy) return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            playBilling.launchPurchase(activity, productId)
        }.onSuccess { launched ->
            if (!launched) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_google_play_start_failed)
                billingBusy = false
            }
            // launched=true 면 busy 해제는 결제 결과 콜백(onPurchaseReady/Pending/Failed)에서 처리.
        }.onFailure { error ->
            Log.e(TAG, "Failed to launch Play purchase productId=$productId", error)
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_google_play_start_failed)
            billingBusy = false
        }
    }
}

/**
 * Play 구매 토큰을 백엔드(/billing/google/confirm)로 보내 검증·acknowledge·구독 반영을 요청한다.
 * 성공 시 기존 구독 로드 경로를 재사용해 구독 상태를 새로고침한다.
 */
internal fun MainViewModel.confirmGooglePurchase(purchaseToken: String, productId: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_apply_plan)) ?: run {
        billingBusy = false
        return
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.confirmGooglePurchase(
                authorization,
                GooglePlayConfirmRequest(
                    purchaseToken = purchaseToken,
                    productId = productId,
                    packageName = getApplication<Application>().packageName,
                ),
            )
        }.onSuccess { response ->
            if (response.success) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_plan_applied)
                refreshBillingAfterMutation(authorization, "google play confirm")
                refreshAppSession()
                refreshSocial()
            } else {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed_retry)
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to confirm Play purchase productId=$productId", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed)),
            )
        }
        billingBusy = false
    }
}

internal fun MainViewModel.ensureFamilyShareCode() {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_create_share_code)) ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_couple)
        "family" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_family)
        else -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_shared)
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.ensureFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_ready, planLabel)
            refreshBillingAfterMutation(authorization, "family share code")
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to ensure family share code", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_load_failed, planLabel)),
            )
        }
        billingBusy = false
    }
}

internal fun MainViewModel.regenerateFamilyShareCode() {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_create_share_code)) ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_couple)
        "family" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_family)
        else -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_shared)
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.regenerateFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            // 새 코드를 즉시 노출. 만료된 옛 코드는 아래 새로고침에서 서버 기준으로 정리된다.
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_regenerated, planLabel)
            refreshBillingAfterMutation(authorization, "regenerate family share code")
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to regenerate family share code", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_load_failed, planLabel)),
            )
        }
        billingBusy = false
    }
}

private fun com.alarmtalk.app.network.BillingPlan.isSharedPassPlan(): Boolean =
    key in setOf("couple", "family") || planType in setOf("couple", "family")

internal fun MainViewModel.cancelSubscription(atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_generic)) ?: return
    val mode = if (atPeriodEnd) "at_period_end" else "immediate"
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.cancelSubscription(authorization, CancelSubscriptionRequest(mode = mode))
        }.onSuccess {
            message = if (atPeriodEnd) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_cancel_at_period_end)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_canceled)
            }
            refreshBillingAfterMutation(authorization, "subscription cancellation")
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to cancel subscription mode=$mode", error)
            message = billingFailureMessage(getApplication<android.app.Application>(), apiErrorCode(error), userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_cancel_failed)))
        }
        billingBusy = false
    }
}

internal fun MainViewModel.applyFreePlanVoiceLock() {
    viewModelScope.launch {
        runCatching {
            repository.deletePaidAlarmTalks()
        }.onSuccess { deletedAlarms ->
            if (voiceProfiles.isNotEmpty()) voiceProfiles = emptyList()
            if (familyVoices.isNotEmpty()) familyVoices = emptyList()
            if (ttsMessages.isNotEmpty()) ttsMessages = emptyList()
            if (receivedNotes.isNotEmpty()) receivedNotes = emptyList()
            if (deletedAlarms > 0) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_free_plan_voice_alarms_deleted)
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to apply free-plan voice lock", error)
        }
    }
}

internal fun MainViewModel.changePlan(planKey: String, atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_generic)) ?: return
    val mode = if (atPeriodEnd) "at_period_end" else "immediate"
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.changePlan(authorization, ChangePlanRequest(planKey = planKey, mode = mode))
        }.onSuccess { response ->
            if (response.requiresCheckout && response.planKey != null) {
                // 즉시 변경: 기존 해지된 상태이므로 곧바로 새 결제 진행.
                billingBusy = false
                checkoutPlan(response.planKey)
                return@onSuccess
            }
            message = if (atPeriodEnd) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_change_scheduled)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_changed)
            }
            refreshBillingAfterMutation(authorization, "plan change")
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to change plan key=$planKey mode=$mode", error)
            val errorCode = apiErrorCode(error)
            if (errorCode == "NO_ACTIVE_SUBSCRIPTION") {
                message = billingFailureMessage(getApplication<android.app.Application>(), errorCode, getApplication<android.app.Application>().getString(R.string.msg_gb_no_active_subscription_apply_new))
                billingBusy = false
                checkoutPlan(planKey)
                return@onFailure
            }
            if (errorCode == "SAME_PLAN") {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_same_plan_in_use)
                refreshBillingAfterMutation(authorization, "same plan check")
                return@onFailure
            }
            message = billingFailureMessage(getApplication<android.app.Application>(), errorCode, userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_plan_change_failed)))
        }
        billingBusy = false
    }
}
