package com.alarmtalk.app

import android.app.Application
import android.content.Context
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
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.DuplicateAlarmTimeException
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.usesFreeSystemVoiceAlarm
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyAlarmTalkRequest
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.RemoteAlarmWriteRequest
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

private fun MainViewModel.alarmPermissionBlockedMessage(target: PermissionTarget): String {
    val app = getApplication<Application>()
    return when (target) {
        PermissionTarget.Notifications -> app.getString(R.string.msg_permission_notifications_required)
        PermissionTarget.ExactAlarms -> app.getString(R.string.msg_permission_exact_alarms_required)
        PermissionTarget.FullScreenIntent -> app.getString(R.string.msg_permission_full_screen_intent_required)
        PermissionTarget.RecordAudio -> app.getString(R.string.msg_permission_record_audio_required)
    }
}

/**
 * 무료 플랜의 음성 알람 허용 여부 — 시스템 스톡 보이스 TTS 알람(녹음/파일 없음)이면
 * 무료여도 저장할 수 있다. 백엔드 alarm-mutation 의 usesOnlySystemStockVoice 와 동일 규칙.
 */
private fun MainViewModel.voiceAlarmAllowed(draft: AlarmDraft): Boolean {
    if (draft.playMode == AlarmPlayModes.ALARM_ONLY) return true
    if (hasPaidVoiceAccess(subscriptionResponse)) return true
    return draft.usesFreeSystemVoiceAlarm()
}

internal fun MainViewModel.createAlarm(
    draft: AlarmDraft,
    replaceExisting: Boolean = false,
    onDone: () -> Unit,
) {
    if (!voiceAlarmAllowed(draft)) {
        message = getApplication<Application>().getString(R.string.msg_custom_voice_alarm_paid_only)
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
    viewModelScope.launch {
        if (!draft.targetUserId.isNullOrBlank()) {
            createFamilyTargetAlarm(draft, onDone)
            return@launch
        }
        runCatching {
            repository.createAlarm(draft, replaceExisting)
        }.onSuccess { alarm ->
            message = getApplication<Application>().getString(R.string.msg_alarm_saved, timeUntilAlarmLabel(getApplication<Application>(), alarm.fireAtMillis))
            onDone()
        }.onFailure { error ->
            if (error is DuplicateAlarmTimeException) {
                // 같은 시각 알람이 있으면 교체 여부를 모달로 묻고, 동의 시 교체로 재시도.
                promptReplaceDuplicateAlarm(error) { createAlarm(draft, replaceExisting = true, onDone) }
            } else {
                AlarmTalkLog.reportError("Failed to create alarm", error)
                message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_save_failed))
            }
        }
    }
}

private suspend fun MainViewModel.createFamilyTargetAlarm(draft: AlarmDraft, onDone: () -> Unit) {
    val session = authSession
    if (session == null) {
        message = getApplication<Application>().getString(R.string.msg_family_alarm_login_required)
        return
    }
    if (!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)) {
        message = getApplication<Application>().getString(R.string.msg_family_alarm_couple_family_only)
        return
    }
    runCatching {
        withContext(Dispatchers.IO) {
            if (draft.shouldUploadLocalVoiceForFamilyAlarm()) {
                val audioStore = AlarmAudioStore(getApplication<Application>())
                val localAudio = draft.toCachedLocalAudio(getApplication<Application>(), audioStore)
                val resolvedDurationMillis = localAudio.durationMillis
                    ?: throw IllegalArgumentException(
                        getApplication<Application>().getString(R.string.msg_voice_duration_unknown),
                    )
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
                        wakeAt = String.format(java.util.Locale.US, "%02d:%02d", draft.hour, draft.minute),
                        voiceUploadId = upload.id,
                        label = draft.label.trimmedOrNull()
                            ?: getApplication<Application>().getString(R.string.msg_family_voice_default_label),
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
        val target = draft.targetUserName?.takeIf { it.isNotBlank() }
            ?: getApplication<Application>().getString(R.string.msg_family_alarm_target_fallback)
        message = getApplication<Application>().getString(R.string.msg_family_alarm_set_for_target, target)
        onDone()
    }.onFailure { error ->
        AlarmTalkLog.reportError("Failed to create family target alarm target=${draft.targetUserId}", error)
        message = userFacingError(error, getApplication<Application>().getString(R.string.msg_family_alarm_set_failed))
    }
}

private fun AlarmDraft.shouldUploadLocalVoiceForFamilyAlarm(): Boolean =
    playMode != AlarmPlayModes.ALARM_ONLY &&
        voiceSource == VoiceSources.LOCAL_AUDIO &&
        !localAudioUri.isNullOrBlank() &&
        rawAudioUri?.let(RemoteAlarmMapper::isRemoteAudioUrl) != true

private fun AlarmDraft.toCachedLocalAudio(context: Context, audioStore: AlarmAudioStore): CachedAlarmAudio {
    val resolvedLocalAudioUri = requireNotNull(localAudioUri)
    // 가족 음성 알람 업로드는 백엔드가 INVALID_DURATION 으로 0L 을 거부하므로
    // 캐시된 로컬 파일에서 실제 길이를 읽어와 채워야 한다.
    val durationMillis = runCatching {
        audioStore.readDurationMillis(resolvedLocalAudioUri.toUri())
    }.getOrNull()
    return CachedAlarmAudio(
        localAudioUri = resolvedLocalAudioUri,
        rawAudioUri = rawAudioUri,
        displayName = audioFileLabel(context, resolvedLocalAudioUri),
        durationMillis = durationMillis,
        cacheKey = audioCacheKey,
    )
}

private fun AlarmDraft.toRemoteAlarmWriteRequest(): RemoteAlarmWriteRequest {
    val rawAudioUrl = rawAudioUri?.takeIf(RemoteAlarmMapper::isRemoteAudioUrl)
        ?.takeUnless { ttsMessageId != null }
    val hasRemoteVoice = ttsMessageId != null || rawAudioUrl != null
    return RemoteAlarmWriteRequest(
        time = String.format(java.util.Locale.US, "%02d:%02d", hour, minute),
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
        timezone = java.util.TimeZone.getDefault().id,
    )
}

internal fun MainViewModel.updateAlarm(
    alarmId: String,
    draft: AlarmDraft,
    replaceExisting: Boolean = false,
    onDone: () -> Unit,
) {
    if (!voiceAlarmAllowed(draft)) {
        message = getApplication<Application>().getString(R.string.msg_custom_voice_alarm_paid_only)
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
    viewModelScope.launch {
        runCatching {
            repository.updateAlarm(alarmId, draft, replaceExisting)
        }.onSuccess { alarm ->
            message = getApplication<Application>().getString(R.string.msg_changes_saved, timeUntilAlarmLabel(getApplication<Application>(), alarm.fireAtMillis))
            onDone()
        }.onFailure { error ->
            if (error is DuplicateAlarmTimeException) {
                promptReplaceDuplicateAlarm(error) {
                    updateAlarm(alarmId, draft, replaceExisting = true, onDone)
                }
            } else {
                AlarmTalkLog.reportError("Failed to update alarm id=$alarmId", error)
                message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_update_failed))
            }
        }
    }
}

/** 같은 시각 알람 충돌 시 교체 확인 모달을 띄운다. 동의하면 [onReplace] 로 교체 재시도. */
private fun MainViewModel.promptReplaceDuplicateAlarm(
    error: DuplicateAlarmTimeException,
    onReplace: () -> Unit,
) {
    duplicateAlarmPrompt = DuplicateAlarmPrompt(
        hour = error.hour,
        minute = error.minute,
        onConfirmReplace = {
            dismissDuplicateAlarmPrompt()
            onReplace()
        },
    )
}

/** 같은 시각 알람 교체 확인 모달의 상태. */
data class DuplicateAlarmPrompt(
    val hour: Int,
    val minute: Int,
    val onConfirmReplace: () -> Unit,
)

internal fun MainViewModel.setAlarmEnabled(alarmId: String, enabled: Boolean) {
    if (enabled && !requireAlarmPermissionsForMutation()) return
    viewModelScope.launch {
        runCatching {
            repository.setEnabled(alarmId, enabled)
        }.onSuccess {
            message = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to change alarm enabled id=$alarmId", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_toggle_failed))
        }
    }
}

internal fun MainViewModel.deleteAlarm(alarmId: String) {
    viewModelScope.launch {
        // 받은(가족) 알람은 로컬 삭제만으로는 다음 동기화에 되살아난다(감사 A-1). 서버에
        // '그만받기'(decline)를 먼저 영구 기록해야 재조회·재설치에도 부활하지 않는다. decline 이
        // 실패하면(오프라인 등) 로컬 삭제도 보류해 '지웠는데 되살아나는' 혼란을 막고 재시도하게 한다.
        val alarm = repository.getAlarm(alarmId)
        val remoteId = alarm?.remoteAlarmId
        if (alarm?.origin == AlarmOrigins.RECEIVED_REMOTE && !remoteId.isNullOrBlank()) {
            val authorization = bearerOrMessage(
                getApplication<Application>().getString(R.string.msg_alarm_delete_failed),
            ) ?: return@launch
            val declined = runCatching { api.declineAlarm(authorization, remoteId) }.isSuccess
            if (!declined) {
                message = getApplication<Application>().getString(R.string.msg_alarm_delete_failed)
                return@launch
            }
        }
        runCatching {
            repository.deleteAlarm(alarmId)
        }.onSuccess {
            message = getApplication<Application>().getString(R.string.msg_alarm_deleted)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to delete alarm id=$alarmId", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_delete_failed))
        }
    }
}

internal fun MainViewModel.copyAlarm(alarmId: String) {
    if (!requireAlarmPermissionsForMutation()) return
    viewModelScope.launch {
        runCatching {
            repository.copyAlarm(alarmId)
        }.onSuccess { alarm ->
            message = getApplication<Application>().getString(R.string.msg_alarm_copied_ten_minutes, timeUntilAlarmLabel(getApplication<Application>(), alarm.fireAtMillis))
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to copy alarm id=$alarmId", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_copy_failed))
        }
    }
}

internal fun MainViewModel.createTestAlarm(delayMinutes: Int) {
    if (!requireAlarmPermissionsForMutation()) return
    viewModelScope.launch {
        runCatching {
            repository.createTestAlarm(delayMinutes)
        }.onSuccess { alarm ->
            message = getApplication<Application>().getString(R.string.msg_test_alarm_saved, timeUntilAlarmLabel(getApplication<Application>(), alarm.fireAtMillis))
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to create test alarm", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_test_alarm_schedule_failed))
        }
    }
}
