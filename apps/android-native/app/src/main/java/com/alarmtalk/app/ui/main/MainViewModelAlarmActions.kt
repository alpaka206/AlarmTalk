package com.alarmtalk.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.viewModelScope
import androidx.core.net.toUri
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.DuplicateAlarmTimeException
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.usesFreeSystemVoiceAlarm
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.FamilyAlarmTalkRequest
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.RemoteAlarmWriteRequest
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.trimmedOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody


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

/**
 * 날씨 버킷 알람이면 저장 전에 그 알람이 울릴 날짜의 조건을 받아 드래프트에 담는다.
 *
 * 저장 후 워커로 해결하던 예전 방식은, 해결 전에 알람이 울리면 '오늘 날씨를 못 받았어요'
 * 안내 클립이 나갔다. 정상(온라인) 상황에서는 고른 그 자리에서 맞는 오디오가 정해진다.
 * 오프라인이면 조용히 미해결로 저장하고(알람 생성을 막지 않는다) 22시 갱신과 알람 전까지의
 * 1시간 재시도가 채운다.
 *
 * 운세는 이 경로가 필요 없다 — 사주+발사일자로 기기에서 결정적으로 계산한다(fortuneThemeIndex).
 */
private suspend fun MainViewModel.withResolvedWeatherVariant(draft: AlarmDraft): AlarmDraft {
    // 이미 값이 들어 있어도 다시 받는다. 편집으로 날짜·지역·목소리가 바뀌면 그 값은 옛 조건
    // 이고, 저장 경로가 어차피 그것을 버린다(resetWeatherVariant). 여기서 새로 받아 두지
    // 않으면 워커가 돌기 전까지 미해결로 남아, 먼저 울리는 알람이 '못 받았어요' 클립을 낸다.
    if (draft.bucketId != "weather") return draft
    val token = authSession?.token ?: return draft
    val resolved = repository.resolveWeatherVariantForDraft(api, token, draft) ?: return draft
    return draft.copy(contextVariantIndex = resolved, contextResolvedNow = true)
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
            repository.createAlarm(withResolvedWeatherVariant(draft), replaceExisting)
        }.onSuccess {
            rememberVoiceUsed(draft.voiceProfileId)
            rememberMessageChoiceUsed(draft)
            // 성공 토스트는 띄우지 않는다 — 저장 즉시 리스트에 행이 생기고 홈 헤더가
            // '몇 시간 후에 울려요'를 이미 말해준다(안내 중복 소음).
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
    val hasRemoteVoice = ttsMessageId != null
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
            repository.updateAlarm(alarmId, withResolvedWeatherVariant(draft), replaceExisting)
        }.onSuccess {
            rememberVoiceUsed(draft.voiceProfileId)
            rememberMessageChoiceUsed(draft)
            // 생성과 동일 — 성공 토스트 생략(리스트/헤더가 결과를 보여준다).
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
            val declineResult = runCatching { api.declineAlarm(authorization, remoteId) }
            // 서버에서 이미 사라진 알람(발신자가 먼저 삭제 등)은 decline 이 404(ALARM_NOT_FOUND) —
            // 멱등 성공으로 보고 로컬 삭제로 진행한다(stale 알람이 안 지워지는 것 방지). 진짜
            // 네트워크/인증 실패만 보류해 재시도하게 한다.
            val declineOk = declineResult.isSuccess ||
                declineResult.exceptionOrNull()?.let { apiErrorCode(it) } == "ALARM_NOT_FOUND"
            if (!declineOk) {
                message = getApplication<Application>().getString(R.string.msg_alarm_delete_failed)
                return@launch
            }
        }
        runCatching {
            repository.deleteAlarm(alarmId)
        }.onSuccess {
            // 성공 토스트 생략 — 행이 리스트에서 사라지는 것이 곧 결과다(실패 안내만 유지).
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
