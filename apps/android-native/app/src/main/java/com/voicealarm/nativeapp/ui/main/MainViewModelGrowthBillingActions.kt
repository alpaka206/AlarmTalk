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
import com.voicealarm.nativeapp.network.CancelSubscriptionRequest
import com.voicealarm.nativeapp.network.ChangePlanRequest
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.NoteAudioResponse
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
            }.onSuccess { snapshot ->
                characterResponse = snapshot.character
                subscriptionResponse = snapshot.subscription
                vouchers = snapshot.vouchers
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
    viewModelScope.launch {
        characterBusy = true
        runCatching {
            repository.syncCharacterEvents(api, session.token)
        }.onSuccess { result ->
            message = "XP 동기화: 완료 ${result.synced}개, 실패 ${result.failed}개"
            refreshCharacterAndBilling()
        }.onFailure { error ->
            Log.e(TAG, "Character event sync failed", error)
            message = userFacingError(error, "XP 동기화에 실패했어요")
        }
        characterBusy = false
    }
}

internal fun MainViewModel.registerCode(code: String) {
    val authorization = bearerOrMessage("코드를 등록하려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.registerCode(authorization, CodeRegisterRequest(code.trim()))
        }.onSuccess { response ->
            message = "코드를 등록했어요"
            refreshSocial()
            refreshCharacterAndBilling()
            refreshAppSession()
            navigateHomeTick++
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
    val trimmedText = text.trim()
    if (receiverId.isBlank()) {
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
                request = SendNoteRequest(receiverId = receiverId, text = trimmedText),
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
    val trimmedText = text.trim()
    if (receiverId.isBlank()) {
        message = "받는 사람을 선택해 주세요"
        return
    }
    if (trimmedText.isBlank()) {
        message = "메시지를 입력해 주세요"
        return
    }
    if (trimmedText.length > 200) {
        message = "목소리 메시지는 200자까지 보낼 수 있어요"
        return
    }
    if (voiceProfileId.isBlank()) {
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
                        voiceProfileId = voiceProfileId,
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
                    receiverId = receiverId,
                    text = trimmedText,
                    audioUrl = audioUrl,
                ),
            )
        }.onSuccess {
            message = "목소리 메시지를 보냈어요"
            refreshNotes()
        }.onFailure { error ->
            Log.e(TAG, "Failed to send TTS note", error)
            message = userFacingError(error, "목소리 메시지 전송에 실패했어요")
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
    val authorization = bearerOrMessage("구독을 변경하려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.checkoutPlan(authorization, CheckoutRequest(planKey = planKey, gift = gift))
        }.onSuccess { response ->
            if (!gift) response.subscription?.let { subscription ->
                subscriptionResponse = BillingSubscriptionResponse(
                    subscription = subscription,
                    plan = response.plan,
                )
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
                "${response.plan.name} 이용권을 만들었어요"
            } else {
                "${response.plan.name} 플랜을 적용했어요"
            }
            if (!gift) {
                refreshAppSession()
                refreshSocial()
                navigateHomeTick++
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to checkout plan key=$planKey gift=$gift", error)
            message = userFacingError(error, "구매에 실패했어요")
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
            refreshSocial()
            refreshCharacterAndBilling()
        }.onFailure { error ->
            Log.e(TAG, "Failed to ensure family share code", error)
            message = userFacingError(error, "$planLabel 공유 코드를 불러오지 못했어요")
        }
        billingBusy = false
    }
}

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
                "구독을 해지했어요"
            }
            refreshCharacterAndBilling()
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to cancel subscription mode=$mode", error)
            message = userFacingError(error, "해지에 실패했어요")
        }
        billingBusy = false
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
                "다음 결제일에 플랜을 변경하도록 예약했어요"
            } else {
                "플랜을 변경했어요"
            }
            refreshCharacterAndBilling()
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            Log.e(TAG, "Failed to change plan key=$planKey mode=$mode", error)
            message = userFacingError(error, "플랜 변경에 실패했어요")
        }
        billingBusy = false
    }
}
