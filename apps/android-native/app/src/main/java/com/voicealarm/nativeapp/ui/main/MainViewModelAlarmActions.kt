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
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceAlarmRequest
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.RemoteAlarmMapper
import com.voicealarm.nativeapp.network.RemoteAlarmWriteRequest
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


internal fun MainViewModel.createAlarm(draft: AlarmDraft, onDone: () -> Unit) {
    viewModelScope.launch {
        if (!draft.targetUserId.isNullOrBlank()) {
            createFamilyTargetAlarm(draft, onDone)
            return@launch
        }
        runCatching {
            repository.createAlarm(draft)
        }.onSuccess { alarm ->
            message = "알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            onDone()
        }.onFailure { error ->
            Log.e(TAG, "Failed to create alarm", error)
            message = userFacingError(error, "알람 저장에 실패했어요")
        }
    }
}

private suspend fun MainViewModel.createFamilyTargetAlarm(draft: AlarmDraft, onDone: () -> Unit) {
    val session = authSession
    if (session == null) {
        message = "상대방 알람을 설정하려면 먼저 로그인해 주세요"
        return
    }
    if (!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)) {
        message = "상대방 알람은 커플/가족 이용권에서 사용할 수 있어요"
        return
    }
    runCatching {
        withContext(Dispatchers.IO) {
            if (draft.shouldUploadLocalVoiceForFamilyAlarm()) {
                val localAudio = draft.toCachedLocalAudio()
                val upload = api.uploadVoiceAudio(
                    authorization = VoiceAlarmApiClient.bearer(session.token),
                    audio = voiceUploadPart(localAudio),
                    durationMs = (localAudio.durationMillis ?: 0L).toString().toRequestBody("text/plain".toMediaType()),
                    originalName = localAudio.displayName.toRequestBody("text/plain".toMediaType()),
                ).upload
                api.createFamilyVoiceAlarm(
                    authorization = VoiceAlarmApiClient.bearer(session.token),
                    request = FamilyVoiceAlarmRequest(
                        recipientUserId = requireNotNull(draft.targetUserId),
                        wakeAt = "%02d:%02d".format(draft.hour, draft.minute),
                        voiceUploadId = upload.id,
                        label = draft.label.ifBlank { "가족이 보낸 음성" },
                        repeatDays = RemoteAlarmMapper.repeatMaskToDays(draft.repeatDaysMask),
                    ),
                ).alarm
            } else {
                api.createAlarm(
                    authorization = VoiceAlarmApiClient.bearer(session.token),
                    request = draft.toRemoteAlarmWriteRequest(),
                ).alarm
            }
        }
    }.onSuccess {
        val target = draft.targetUserName?.takeIf { it.isNotBlank() } ?: "상대방"
        message = "${target}에게 알람을 설정했어요"
        onDone()
    }.onFailure { error ->
        Log.e(TAG, "Failed to create family target alarm target=${draft.targetUserId}", error)
        message = userFacingError(error, "상대방 알람 설정에 실패했어요")
    }
}

private fun AlarmDraft.shouldUploadLocalVoiceForFamilyAlarm(): Boolean =
    playMode != AlarmPlayModes.ALARM_ONLY &&
        voiceSource == VoiceSources.LOCAL_AUDIO &&
        !localAudioUri.isNullOrBlank() &&
        rawAudioUri?.let(RemoteAlarmMapper::isRemoteAudioUrl) != true

private fun AlarmDraft.toCachedLocalAudio(): CachedAlarmAudio =
    CachedAlarmAudio(
        localAudioUri = requireNotNull(localAudioUri),
        rawAudioUri = rawAudioUri,
        displayName = localAudioUri?.let(::audioFileLabel) ?: "family_alarm_voice",
        durationMillis = null,
        cacheKey = audioCacheKey,
    )

private fun AlarmDraft.toRemoteAlarmWriteRequest(): RemoteAlarmWriteRequest {
    val rawAudioUrl = rawAudioUri?.takeIf(RemoteAlarmMapper::isRemoteAudioUrl)
        ?.takeUnless { ttsMessageId != null }
    val hasRemoteVoice = ttsMessageId != null || rawAudioUrl != null
    return RemoteAlarmWriteRequest(
        time = "%02d:%02d".format(hour, minute),
        repeatDays = RemoteAlarmMapper.repeatMaskToDays(repeatDaysMask),
        snoozeMinutes = snoozeMinutes,
        mode = if (hasRemoteVoice) "tts" else "sound-only",
        vibrationPattern = vibrationPattern,
        wakeMode = when (playMode) {
            AlarmPlayModes.VOICE_ONLY -> "voice_only"
            else -> "sound_then_voice"
        },
        isActive = true,
        messageId = ttsMessageId,
        voiceProfileId = voiceProfileId.takeIf { voiceSource != VoiceSources.LOCAL_AUDIO },
        rawAudioUrl = rawAudioUrl,
        rawAudioDurationMs = null,
        targetUserId = targetUserId,
    )
}

internal fun MainViewModel.updateAlarm(alarmId: String, draft: AlarmDraft, onDone: () -> Unit) {
    viewModelScope.launch {
        runCatching {
            repository.updateAlarm(alarmId, draft)
        }.onSuccess { alarm ->
            message = "변경사항을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            onDone()
        }.onFailure { error ->
            Log.e(TAG, "Failed to update alarm id=$alarmId", error)
            message = userFacingError(error, "알람 수정에 실패했어요")
        }
    }
}

internal fun MainViewModel.setAlarmEnabled(alarmId: String, enabled: Boolean) {
    viewModelScope.launch {
        runCatching {
            repository.setEnabled(alarmId, enabled)
        }.onSuccess {
            message = null
        }.onFailure { error ->
            Log.e(TAG, "Failed to change alarm enabled id=$alarmId", error)
            message = userFacingError(error, "알람 상태 변경에 실패했어요")
        }
    }
}

internal fun MainViewModel.deleteAlarm(alarmId: String) {
    viewModelScope.launch {
        runCatching {
            repository.deleteAlarm(alarmId)
        }.onSuccess {
            message = "알람을 삭제했어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to delete alarm id=$alarmId", error)
            message = userFacingError(error, "알람 삭제에 실패했어요")
        }
    }
}

internal fun MainViewModel.copyAlarm(alarmId: String) {
    viewModelScope.launch {
        runCatching {
            repository.copyAlarm(alarmId)
        }.onSuccess { alarm ->
            message = "알람을 10분 뒤로 복사했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
        }.onFailure { error ->
            Log.e(TAG, "Failed to copy alarm id=$alarmId", error)
            message = userFacingError(error, "알람 복사에 실패했어요")
        }
    }
}

internal fun MainViewModel.createTestAlarm(delayMinutes: Int) {
    viewModelScope.launch {
        runCatching {
            repository.createTestAlarm(delayMinutes)
        }.onSuccess { alarm ->
            message = "테스트 알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
        }.onFailure { error ->
            Log.e(TAG, "Failed to create test alarm", error)
            message = userFacingError(error, "테스트 알람 예약에 실패했어요")
        }
    }
}
