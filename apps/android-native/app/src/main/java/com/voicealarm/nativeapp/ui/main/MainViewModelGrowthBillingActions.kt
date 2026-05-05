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


internal fun MainViewModel.refreshCharacterAndBilling() {
    refreshCharacterAndBillingData(showMessage = true)
}

internal fun MainViewModel.preloadCharacterAndBilling() {
    if (authSession == null || characterBusy || billingBusy) return
    refreshCharacterAndBillingData(showMessage = false)
}

private fun MainViewModel.refreshCharacterAndBillingData(showMessage: Boolean) {
    val authorization = bearerOrMessage("성장 정보를 불러오려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        characterBusy = true
        billingBusy = true
        runCatching {
            CharacterBillingSnapshot(
                character = api.getCharacter(authorization),
                subscription = api.getSubscription(authorization),
                vouchers = api.listVouchers(authorization).vouchers,
            )
        }.onSuccess { snapshot ->
            characterResponse = snapshot.character
            subscriptionResponse = snapshot.subscription
            vouchers = snapshot.vouchers
            if (showMessage) message = "캐릭터와 플랜 정보를 불러왔어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to load character or billing", error)
            if (showMessage) message = userFacingError(error, "성장 정보를 불러오지 못했어요")
        }
        characterBusy = false
        billingBusy = false
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
            message = "코드를 등록했어요${response.type?.let { ": ${codeTypeLabel(it)}" } ?: ""}"
            refreshSocial()
            refreshCharacterAndBilling()
        }.onFailure { error ->
            Log.e(TAG, "Failed to register code", error)
            message = userFacingError(error, "코드 등록에 실패했어요")
        }
        billingBusy = false
    }
}

internal fun MainViewModel.refreshNotes() {
    val authorization = bearerOrMessage("음성 메시지를 불러오려면 먼저 로그인해 주세요") ?: return
    viewModelScope.launch {
        noteBusy = true
        runCatching {
            api.listReceivedNotes(authorization, limit = 20, offset = 0).notes
        }.onSuccess { notes ->
            receivedNotes = notes
            message = "받은 메시지 ${notes.size}개를 불러왔어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to refresh notes", error)
            message = userFacingError(error, "음성 메시지를 불러오지 못했어요")
        }
        noteBusy = false
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
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to checkout plan key=$planKey gift=$gift", error)
            message = userFacingError(error, "구매에 실패했어요")
        }
        billingBusy = false
    }
}
