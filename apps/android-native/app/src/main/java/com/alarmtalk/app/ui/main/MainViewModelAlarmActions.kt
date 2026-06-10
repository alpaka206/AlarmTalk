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
import androidx.core.net.toUri
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyAlarmTalkRequest
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.RemoteAlarmWriteRequest
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
        message = "유료 이용권에서 사용할 수 있어요."
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
        message = "상대 알람을 설정하려면 먼저 로그인해 주세요"
        return
    }
    if (!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)) {
        message = "상대 알람은 커플/가족 이용권에서 사용할 수 있어요"
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
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    audio = voiceUploadPart(localAudio),
                    durationMs = resolvedDurationMillis.toString().toRequestBody("text/plain".toMediaType()),
                    originalName = localAudio.displayName.toRequestBody("text/plain".toMediaType()),
                ).upload
                api.createFamilyAlarmTalk(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    request = FamilyAlarmTalkRequest(
                        recipientUserId = requireNotNull(draft.targetUserId.trimmedOrNull()),
                        wakeAt = "%02d:%02d".format(draft.hour, draft.minute),
                        voiceUploadId = upload.id,
                        label = draft.label.trimmedOrNull() ?: "가족이 보낸 음성",
                        repeatDays = RemoteAlarmMapper.repeatMaskToDays(draft.repeatDaysMask),
                    ),
                ).alarm
            } else {
                api.createAlarm(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    request = draft.toRemoteAlarmWriteRequest(),
                ).alarm
            }
        }
    }.onSuccess {
        val target = draft.targetUserName?.takeIf { it.isNotBlank() } ?: "상대"
        message = "${target}에게 알람을 설정했어요"
        onDone()
    }.onFailure { error ->
        Log.e(TAG, "Failed to create family target alarm target=${draft.targetUserId}", error)
        message = userFacingError(error, "상대 알람 설정에 실패했어요")
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
        message = "유료 이용권에서 사용할 수 있어요."
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
