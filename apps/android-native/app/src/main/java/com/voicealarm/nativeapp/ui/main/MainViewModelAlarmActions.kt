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
import androidx.core.net.toUri
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmAudioStore
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
import com.voicealarm.nativeapp.network.trimmedOrNull
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


private fun MainViewModel.requireAlarmPermissionsForMutation(): Boolean {
    val snapshot = PermissionSnapshot.read(getApplication<Application>())
    val missingTarget = snapshot.firstMissingAlarmTarget() ?: return true
    requestPermissionGate(missingTarget)
    message = alarmPermissionBlockedMessage(missingTarget)
    return false
}

private fun alarmPermissionBlockedMessage(target: PermissionTarget): String = when (target) {
    PermissionTarget.Notifications -> "알람 화면과 종료 버튼을 표시하려면 알림 권한이 필요해요."
    PermissionTarget.ExactAlarms -> "정해진 시간에 울리려면 정확한 알람 권한이 필요해요."
    PermissionTarget.FullScreenIntent -> "잠금화면 위에 알람 화면을 띄우려면 전체 화면 알람 권한을 켜 주세요."
    PermissionTarget.RecordAudio -> "음성을 녹음하려면 마이크 권한이 필요해요."
}

internal fun MainViewModel.createAlarm(draft: AlarmDraft, onDone: () -> Unit) {
    if (draft.playMode != AlarmPlayModes.ALARM_ONLY && !hasPaidVoiceAccess(subscriptionResponse)) {
        message = "유료 요금제를 사용해야 목소리 알람을 만들 수 있어요."
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
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
                val audioStore = AlarmAudioStore(getApplication<Application>())
                val localAudio = draft.toCachedLocalAudio(audioStore)
                val resolvedDurationMillis = localAudio.durationMillis
                    ?: throw IllegalArgumentException("음성 길이를 확인하지 못했어요. 다시 녹음해 주세요.")
                val upload = api.uploadVoiceAudio(
                    authorization = VoiceAlarmApiClient.bearer(session.token),
                    audio = voiceUploadPart(localAudio),
                    durationMs = resolvedDurationMillis.toString().toRequestBody("text/plain".toMediaType()),
                    originalName = localAudio.displayName.toRequestBody("text/plain".toMediaType()),
                ).upload
                api.createFamilyVoiceAlarm(
                    authorization = VoiceAlarmApiClient.bearer(session.token),
                    request = FamilyVoiceAlarmRequest(
                        recipientUserId = requireNotNull(draft.targetUserId.trimmedOrNull()),
                        wakeAt = "%02d:%02d".format(draft.hour, draft.minute),
                        voiceUploadId = upload.id,
                        label = draft.label.trimmedOrNull() ?: "가족이 보낸 음성",
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

private fun AlarmDraft.toCachedLocalAudio(audioStore: AlarmAudioStore): CachedAlarmAudio {
    val resolvedLocalAudioUri = requireNotNull(localAudioUri)
    // 가족 음성 알람 업로드는 백엔드가 INVALID_DURATION 으로 0L 을 거부하므로
    // 캐시된 로컬 파일에서 실제 길이를 읽어와 채워야 한다.
    val durationMillis = runCatching {
        audioStore.readDurationMillis(resolvedLocalAudioUri.toUri())
    }.getOrNull()
    return CachedAlarmAudio(
        localAudioUri = resolvedLocalAudioUri,
        rawAudioUri = rawAudioUri,
        displayName = audioFileLabel(resolvedLocalAudioUri),
        durationMillis = durationMillis,
        cacheKey = audioCacheKey,
    )
}

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
        messageId = ttsMessageId.trimmedOrNull(),
        voiceProfileId = voiceProfileId.takeIf { voiceSource != VoiceSources.LOCAL_AUDIO }.trimmedOrNull(),
        rawAudioUrl = rawAudioUrl,
        rawAudioDurationMs = null,
        targetUserId = targetUserId.trimmedOrNull(),
    )
}

internal fun MainViewModel.updateAlarm(alarmId: String, draft: AlarmDraft, onDone: () -> Unit) {
    if (draft.playMode != AlarmPlayModes.ALARM_ONLY && !hasPaidVoiceAccess(subscriptionResponse)) {
        message = "유료 요금제를 사용해야 목소리 알람을 만들 수 있어요."
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
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
    if (enabled && !requireAlarmPermissionsForMutation()) return
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
    if (!requireAlarmPermissionsForMutation()) return
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
    if (!requireAlarmPermissionsForMutation()) return
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
