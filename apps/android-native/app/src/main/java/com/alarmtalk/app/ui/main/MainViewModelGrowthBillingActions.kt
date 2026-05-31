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
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.alarm.SocialNotificationTracker
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CancelSubscriptionRequest
import com.alarmtalk.app.network.ChangePlanRequest
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.NoteAudioResponse
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.SendNoteRequest
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessage
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.VoiceAlarmApiClient
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
import com.alarmtalk.app.network.VoucherItem
import com.alarmtalk.app.network.trimmedOrNull
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


internal fun MainViewModel.refreshCharacterAndBilling() {
    refreshCharacterAndBillingData(showMessage = true)
}

internal suspend fun MainViewModel.refreshShareCodeData(): List<VoucherItem> {
    val authorization = bearerOrMessage("공유 코드 정보를 불러오려면 먼저 로그인해 주세요") ?: return vouchers
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
        message = userFacingError(error, "공유 코드 정보를 불러오지 못했어요")
        vouchers
    } finally {
        billingBusy = false
        socialBusy = false
    }
}

internal fun MainViewModel.preloadCharacterAndBilling() {
    if (authSession == null || characterBusy || billingBusy) return
    refreshCharacterAndBillingData(showMessage = false)
}

private fun MainViewModel.refreshCharacterAndBillingData(showMessage: Boolean) {
    if (characterBusy || billingBusy) return
    val authorization = bearerOrMessage("성장 정보를 불러오려면 먼저 로그인해 주세요") ?: return
    characterBusy = true
    billingBusy = true
    viewModelScope.launch {
        try {
            runCatching {
                loadCharacterBillingSnapshot(authorization)
            }.onSuccess { snapshot ->
                applyCharacterBillingSnapshot(snapshot)
            }.onFailure { error ->
                Log.e(TAG, "Failed to load character or billing", error)
                if (showMessage) message = userFacingError(error, "성장 정보를 불러오지 못했어요")
            }
        } finally {
            characterBusy = false
            billingBusy = false
        }
    }
}

internal fun MainViewModel.syncCharacterEvents() {
    val session = authSession
    if (session == null) {
        message = "성장 기록을 동기화하려면 먼저 로그인해 주세요"
        return
    }
    if (characterBusy) return
    viewModelScope.launch {
        characterBusy = true
        val syncResult = runCatching {
            repository.syncCharacterEvents(api, session.token)
        }
        characterBusy = false
        syncResult.onSuccess { result ->
            message = "성장 기록을 반영했어요. 실패한 기록 ${result.failed}개는 다시 시도해 주세요."
            refreshCharacterAndBillingData(showMessage = false)
        }.onFailure { error ->
            Log.e(TAG, "Character event sync failed", error)
            message = userFacingError(error, "성장 기록을 반영하지 못했어요")
        }
    }
}

private suspend fun MainViewModel.loadCharacterBillingSnapshot(
    authorization: String,
): CharacterBillingSnapshot =
    coroutineScope {
        val character = async { api.getCharacter(authorization) }
        val subscription = async { api.getSubscription(authorization) }
        val vouchers = async { api.listVouchers(authorization).vouchers }
        CharacterBillingSnapshot(
            character = character.await(),
            subscription = subscription.await(),
            vouchers = vouchers.await(),
        )
    }

private fun MainViewModel.applyCharacterBillingSnapshot(snapshot: CharacterBillingSnapshot) {
    characterResponse = snapshot.character
    subscriptionResponse = snapshot.subscription
    saveSubscriptionSnapshot(snapshot.subscription)
    vouchers = snapshot.vouchers
}

private suspend fun MainViewModel.refreshCharacterBillingAfterMutation(
    authorization: String,
    reason: String,
) {
    runCatching {
        loadCharacterBillingSnapshot(authorization)
    }.onSuccess { snapshot ->
        applyCharacterBillingSnapshot(snapshot)
    }.onFailure { error ->
        Log.w(TAG, "Failed to refresh character or billing after $reason", error)
    }
}

private fun billingFailureMessage(errorCode: String?, fallback: String): String =
    when (errorCode) {
        "SAME_PLAN" -> "이미 사용 중인 이용권이에요"
        "NO_ACTIVE_SUBSCRIPTION" -> "현재 적용된 이용권이 없어 새 이용권으로 적용할게요"
        "PLAN_NOT_FOUND" -> "이용권 정보를 찾지 못했어요"
        "PLAN_INACTIVE" -> "지금은 선택할 수 없는 이용권이에요"
        "FREE_NOT_BILLABLE" -> "무료 이용권은 여기에서 적용할 수 없어요"
        "GIFT_PERSONAL_ONLY" -> "선물하기는 개인 이용권에서만 사용할 수 있어요"
        "USER_NOT_FOUND" -> "로그인 정보를 다시 확인해 주세요"
        else -> fallback
    }

internal fun MainViewModel.syncPendingCharacterEventsSilently() {
    val session = authSession ?: return
    if (characterBusy) return
    viewModelScope.launch {
        characterBusy = true
        val syncResult = runCatching {
            repository.syncCharacterEvents(api, session.token)
        }
        characterBusy = false
        syncResult.onSuccess { result ->
            if (result.synced > 0) {
                refreshCharacterAndBillingData(showMessage = false)
            }
        }.onFailure { error ->
            Log.e(TAG, "Silent character event sync failed", error)
        }
    }
}

internal fun MainViewModel.registerCode(code: String) {
    val authorization = bearerOrMessage("코드를 등록하려면 먼저 로그인해 주세요") ?: return
    val trimmedCode = code.trim()
    if (trimmedCode.isBlank()) {
        message = "코드를 입력해 주세요."
        return
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.registerCode(authorization, CodeRegisterRequest(trimmedCode))
        }.onSuccess { response ->
            message = "코드를 등록했어요"
            refreshCharacterBillingAfterMutation(authorization, "code registration")
            refreshSocial()
            refreshAppSession()
            if (response.type == "invite" || trimmedCode.startsWith("INV-", ignoreCase = true)) {
                navigateSharedPassTick++
            } else {
                navigateHomeTick++
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to register code", error)
            message = userFacingError(error, "코드 등록에 실패했어요")
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
    val authorization = bearerOrMessage("음성 메시지를 불러오려면 먼저 로그인해 주세요") ?: return
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
                if (showMessage) message = userFacingError(error, "음성 메시지를 불러오지 못했어요")
            }
        } finally {
            noteBusy = false
        }
    }
}

internal fun MainViewModel.sendNote(receiverId: String, text: String) {
    val authorization = bearerOrMessage("메시지를 보내려면 먼저 로그인해 주세요") ?: return
    val normalizedReceiverId = receiverId.trim()
    val trimmedText = text.trim()
    if (normalizedReceiverId.isBlank()) {
        message = "받는 사람을 선택해 주세요"
        return
    }
    if (trimmedText.isBlank()) {
        message = "메시지를 입력해 주세요"
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
            message = "메시지를 보냈어요"
            refreshNotes()
        }.onFailure { error ->
            Log.e(TAG, "Failed to send note", error)
            message = userFacingError(error, "메시지 전송에 실패했어요")
        }
        noteBusy = false
    }
}

internal fun MainViewModel.sendTtsNote(receiverId: String, text: String, voiceProfileId: String) {
    val authorization = bearerOrMessage("메시지를 보내려면 먼저 로그인해 주세요") ?: return
    val normalizedReceiverId = receiverId.trim()
    val normalizedVoiceProfileId = voiceProfileId.trim()
    val trimmedText = text.trim()
    if (normalizedReceiverId.isBlank()) {
        message = "받는 사람을 선택해 주세요"
        return
    }
    if (trimmedText.isBlank()) {
        message = "메시지를 입력해 주세요"
        return
    }
    if (trimmedText.length > 200) {
        message = "음성 메시지는 200자까지 보낼 수 있어요"
        return
    }
    if (normalizedVoiceProfileId.isBlank()) {
        message = "목소리를 선택해 주세요"
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
            message = "음성 메시지를 보냈어요"
            refreshNotes()
        }.onFailure { error ->
            Log.e(TAG, "Failed to send TTS note", error)
            message = userFacingError(error, "음성 메시지 전송에 실패했어요")
        }
        noteBusy = false
    }
}

internal suspend fun MainViewModel.downloadNoteAudio(noteId: String): NoteAudioResponse {
    val authorization = bearerOrMessage("음성 메시지를 재생하려면 먼저 로그인해 주세요")
        ?: throw IllegalStateException("Login is required to play note audio.")
    return withContext(Dispatchers.IO) {
        api.getNoteAudio(authorization, noteId)
    }
}

internal fun MainViewModel.markNoteRead(noteId: String) {
    val authorization = bearerOrMessage("메시지를 읽음 처리하려면 먼저 로그인해 주세요") ?: return
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
    val authorization = bearerOrMessage("이용권을 변경하려면 먼저 로그인해 주세요") ?: return
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
                "${response.plan.name} 이용권을 선물할 수 있어요"
            } else {
                "${response.plan.name} 이용권을 적용했어요"
            }
            refreshCharacterBillingAfterMutation(authorization, "checkout")
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
            val fallback = if (gift) "선물하기에 실패했어요" else "이용권 적용에 실패했어요"
            message = billingFailureMessage(apiErrorCode(error), userFacingError(error, fallback))
        }
        billingBusy = false
    }
}

internal fun MainViewModel.ensureFamilyShareCode() {
    val authorization = bearerOrMessage("공유 코드를 만들려면 먼저 로그인해 주세요") ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> "커플"
        "family" -> "가족"
        else -> "공유"
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.ensureFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = "$planLabel 공유 코드를 준비했어요"
            refreshCharacterBillingAfterMutation(authorization, "family share code")
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to ensure family share code", error)
            message = billingFailureMessage(
                apiErrorCode(error),
                userFacingError(error, "$planLabel 공유 코드를 불러오지 못했어요"),
            )
        }
        billingBusy = false
    }
}

private fun com.alarmtalk.app.network.BillingPlan.isSharedPassPlan(): Boolean =
    key in setOf("couple", "family") || planType in setOf("couple", "family")

internal fun MainViewModel.cancelSubscription(atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage("로그인 후 사용할 수 있어요") ?: return
    val mode = if (atPeriodEnd) "at_period_end" else "immediate"
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.cancelSubscription(authorization, CancelSubscriptionRequest(mode = mode))
        }.onSuccess {
            message = if (atPeriodEnd) {
                "다음 결제일까지 사용 후 자동 해지되도록 예약했어요"
            } else {
                "이용권을 해지했어요"
            }
            refreshCharacterBillingAfterMutation(authorization, "subscription cancellation")
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to cancel subscription mode=$mode", error)
            message = billingFailureMessage(apiErrorCode(error), userFacingError(error, "해지에 실패했어요"))
        }
        billingBusy = false
    }
}

internal fun MainViewModel.applyFreePlanVoiceLock() {
    viewModelScope.launch {
        runCatching {
            repository.deletePaidVoiceAlarms()
        }.onSuccess { deletedAlarms ->
            if (voiceProfiles.isNotEmpty()) voiceProfiles = emptyList()
            if (familyVoices.isNotEmpty()) familyVoices = emptyList()
            if (ttsMessages.isNotEmpty()) ttsMessages = emptyList()
            if (receivedNotes.isNotEmpty()) receivedNotes = emptyList()
            if (deletedAlarms > 0) {
                message = "무료 이용권으로 전환되어 목소리 알람을 삭제했어요."
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to apply free-plan voice lock", error)
        }
    }
}

internal fun MainViewModel.changePlan(planKey: String, atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage("로그인 후 사용할 수 있어요") ?: return
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
                "이용권 종료일에 변경하도록 예약했어요"
            } else {
                "이용권을 변경했어요"
            }
            refreshCharacterBillingAfterMutation(authorization, "plan change")
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to change plan key=$planKey mode=$mode", error)
            val errorCode = apiErrorCode(error)
            if (errorCode == "NO_ACTIVE_SUBSCRIPTION") {
                message = billingFailureMessage(errorCode, "현재 적용된 이용권이 없어 새 이용권으로 적용할게요")
                billingBusy = false
                checkoutPlan(planKey)
                return@onFailure
            }
            if (errorCode == "SAME_PLAN") {
                message = "이미 사용 중인 이용권이에요"
                refreshCharacterBillingAfterMutation(authorization, "same plan check")
                return@onFailure
            }
            message = billingFailureMessage(errorCode, userFacingError(error, "이용권 변경에 실패했어요"))
        }
        billingBusy = false
    }
}
