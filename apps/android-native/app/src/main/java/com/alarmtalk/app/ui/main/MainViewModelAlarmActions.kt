package com.alarmtalk.app

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.DuplicateAlarmTimeException
import com.alarmtalk.app.data.usesFreeSystemVoiceAlarm
import kotlinx.coroutines.launch

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
    // 유일 판정기 — 모르면 잠그지 않는다(저장은 되돌릴 수 있는 쪽이다).
    if (isPaidVoiceEntitledOptimistic()) return true
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
 * **기다리는 시간에는 상한이 있다** — 저장 단계(`alarmSaving`)에서 타는 네트워크는
 * 이 호출 하나라, 인터넷이 느리면 그만큼 저장이 멈춘다. 상한(`WEATHER_RESOLVE_TIMEOUT_MILLIS`, 8초)은
 * `AlarmRepository.resolveWeatherVariantForDraft` 안에 있고, 넘기면 실패와 같은 null 이라
 * 이 함수는 두 경우를 가르지 않는다 — 드래프트를 그대로 돌려줘 미해결로 저장되고, 저장
 * 경로가 거는 `runOnce` 워커가 뒤에서 채운다.
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

/**
 * 알람을 켠 순간의 하단 안내 "N 후에 울려요."(`docs/spec/alarm-editor.md` §7)의 대상 — 알람 하나와 그 예약 시각.
 * 문장은 화면이 띄우는 순간 홈 헤드라인과 같은 함수(`ringInSentence`)로 만든다.
 */
data class RingInNotice(val alarmId: String, val fireAtMillis: Long)

/**
 * 저장·켜기가 **반영된 뒤의 행**으로 안내를 정한다 — 켜진 행이면 그 알람의 예약 시각, 꺼진 행이면 null(울릴 시각이 없다).
 * 지난 날짜라 켜지지 않은 날짜 알람은 저장소가 예외로 돌려보내 여기까지 오지 않는다(그때는 알럿이 말한다).
 */
internal fun ringInNoticeFor(alarm: AlarmEntity): RingInNotice? =
    if (alarm.enabled) RingInNotice(alarm.id, alarm.fireAtMillis) else null

private fun MainViewModel.announceRingIn(saved: AlarmEntity) {
    ringInNoticeFor(saved)?.let { ringInNotice = it }
}

/** 끄거나 지운 알람의 안내가 떠 있으면 거둔다 — 남기면 꺼진 알람을 두고 "N 후에 울려요" 라고 말한다. 다른 알람의 안내는 둔다. */
private fun MainViewModel.withdrawRingIn(alarmId: String) {
    if (ringInNotice?.alarmId == alarmId) ringInNotice = null
}

/** 저장 시도의 끝(`alarm_ready`) — OS 예약과 오디오 파일이 둘 다 갖춰졌을 때만. 기록 실패는 저장을 막지 않는다. */
private fun MainViewModel.recordAlarmReadyIfReady(saved: com.alarmtalk.app.data.AlarmEntity) {
    val ready = runCatching { repository.isReadyToRing(saved) }.getOrDefault(false)
    if (ready) com.alarmtalk.app.data.AlarmSaveAttempts.ready(getApplication(), saved.id)
}

internal fun MainViewModel.createAlarm(
    draft: AlarmDraft,
    replaceExisting: Boolean = false,
    onDone: () -> Unit,
) {
    if (!voiceAlarmAllowed(draft)) {
        message = getApplication<Application>().getString(R.string.plan_gate_paid_message)
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
    // 저장을 시작한 계정 — 아래 성공 기록(`content_selected`)은 그 계정의 것이다(날씨 조회를 기다리는 사이 계정이 바뀌어도).
    val ownerUserId = authSession?.user?.id
    // 여기부터가 '저장 중' 이다 — 아래는 전부 비동기고, 날씨 버킷이면 네트워크까지 탄다.
    // 내리는 건 finally 한 곳뿐: 실패로 편집기가 남았는데 켜진 채면 다시 저장할 길이 없다.
    alarmSaving = true
    viewModelScope.launch {
      try {
        runCatching {
            repository.createAlarm(withResolvedWeatherVariant(draft), replaceExisting)
        }.onSuccess { saved ->
            recordAlarmReadyIfReady(saved)
            rememberVoiceUsed(draft.voiceProfileId)
            rememberMessageChoiceUsed(draft)
            com.alarmtalk.app.data.recordContentSelected(getApplication(), saved, ownerUserId)
            com.alarmtalk.app.data.recordPackSelected(getApplication(), saved, ownerUserId)
            requestCloneCheerSupplementIfNeeded(saved, previous = null)
            // '저장했어요' 같은 성공 토스트는 띄우지 않는다 — 리스트에 행이 생기는 것이 곧 결과다. 대신 그 알람이
            // 언제 우는지를 화면 아래에 잠깐 말한다(`docs/spec/alarm-editor.md` §7 — 전체의 다음 알람이 아니라 이 알람).
            announceRingIn(saved)
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
      } finally {
        alarmSaving = false
      }
    }
}

internal fun MainViewModel.updateAlarm(
    alarmId: String,
    draft: AlarmDraft,
    replaceExisting: Boolean = false,
    onDone: () -> Unit,
) {
    if (!voiceAlarmAllowed(draft)) {
        message = getApplication<Application>().getString(R.string.plan_gate_paid_message)
        return
    }
    if (!requireAlarmPermissionsForMutation()) return
    val ownerUserId = authSession?.user?.id
    // 고치기 전의 행 — 응원 보충은 테마·목소리를 새로 골랐을 때만 알린다(`needsCloneCheerSupplement`).
    val previous = alarms.value.firstOrNull { it.id == alarmId }
    // 생성과 같은 규약 — 아래 [MainViewModel.alarmSaving] 주석 참고.
    alarmSaving = true
    viewModelScope.launch {
      try {
        runCatching {
            repository.updateAlarm(alarmId, withResolvedWeatherVariant(draft), replaceExisting)
        }.onSuccess { saved ->
            recordAlarmReadyIfReady(saved)
            rememberVoiceUsed(draft.voiceProfileId)
            rememberMessageChoiceUsed(draft)
            com.alarmtalk.app.data.recordContentSelected(getApplication(), saved, ownerUserId)
            com.alarmtalk.app.data.recordPackSelected(getApplication(), saved, ownerUserId)
            requestCloneCheerSupplementIfNeeded(saved, previous)
            // 생성과 동일 — 성공 토스트는 생략하고, 고친 알람이 언제 우는지만 아래에 잠깐(§7).
            announceRingIn(saved)
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
      } finally {
        alarmSaving = false
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
        }.onSuccess { updated ->
            message = null
            // 반영된 뒤에야 말한다(§7) — 켰으면 그 알람이 언제 우는지, 껐으면 떠 있던 그 알람의 안내를 거둔다.
            if (enabled) announceRingIn(updated) else withdrawRingIn(alarmId)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to change alarm enabled id=$alarmId", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_toggle_failed))
        }
    }
}

internal fun MainViewModel.deleteAlarm(alarmId: String) {
    viewModelScope.launch {
        runCatching {
            repository.deleteAlarm(alarmId)
        }.onSuccess {
            // 성공 토스트 생략 — 행이 리스트에서 사라지는 것이 곧 결과다(실패 안내만 유지).
            withdrawRingIn(alarmId)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to delete alarm id=$alarmId", error)
            message = userFacingError(error, getApplication<Application>().getString(R.string.msg_alarm_delete_failed))
        }
    }
}

/**
 * 내 클론으로 응원 알람을 저장했으면 서버에 보충을 알린다(`needsCloneCheerSupplement` — 스펙 voice-and-message §5-4).
 * 답을 기다리지 않고 실패해도 저장은 그대로다 — 잃는 것은 보충이 한 번 늦는 것뿐이고, 다음 응원 저장이 다시 알린다.
 */
private fun MainViewModel.requestCloneCheerSupplementIfNeeded(
    saved: com.alarmtalk.app.data.AlarmEntity,
    previous: com.alarmtalk.app.data.AlarmEntity?,
) {
    if (!com.alarmtalk.app.data.needsCloneCheerSupplement(saved, previous)) return
    val session = authSession ?: return
    val voiceId = saved.voiceProfileId ?: return
    viewModelScope.launch {
        runCatching {
            api.requestVoiceContentSupplement(
                com.alarmtalk.app.network.AlarmTalkApiClient.bearer(session.token),
                voiceId,
                com.alarmtalk.app.network.VoiceContentSupplementRequest(theme = com.alarmtalk.app.data.CHEER_BUCKET_ID),
            )
        }.onFailure { error ->
            if (error is kotlin.coroutines.cancellation.CancellationException) throw error
            android.util.Log.i("AlarmActions", "Cheer supplement request failed; the next cheer save asks again", error)
        }
    }
}
