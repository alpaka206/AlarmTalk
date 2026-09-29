package com.alarmtalk.app.network

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.hasLockedPaidVoice
import com.alarmtalk.app.data.isSystemVoiceId
import java.util.TimeZone

object RemoteAlarmMapper {
    fun toWriteRequest(alarm: AlarmEntity): RemoteAlarmWriteRequest {
        val hasRemoteVoice = alarm.ttsMessageId != null
        return RemoteAlarmWriteRequest(
            time = String.format(java.util.Locale.US, "%02d:%02d", alarm.hour, alarm.minute),
            repeatDays = repeatMaskToDays(alarm.repeatDaysMask),
            snoozeMinutes = alarm.snoozeMinutes,
            mode = if (hasRemoteVoice) "tts" else "sound-only",
            vibrationPattern = alarm.vibrationPattern,
            wakeMode = when (AlarmPlayModes.normalize(alarm.playMode)) {
                AlarmPlayModes.VOICE_ONLY -> "voice_only"
                else -> "sound_then_voice"
            },
            isActive = alarm.enabled,
            messageId = alarm.ttsMessageId.trimmedOrNull(),
            voiceProfileId = alarm.voiceProfileId
                .takeIf { alarm.voiceSource != VoiceSources.LOCAL_AUDIO }
                .trimmedOrNull(),
            targetUserId = null,
            timezone = TimeZone.getDefault().id,
            bucketId = alarm.bucketId.trimmedOrNull(),
            clientAlarmId = alarm.id,
            // 기본 목소리로 바꿔 둔 알람(무료 잠금 · 잠금 확정 · 목소리를 잃어 미나로 바꾼 알람)은 비어
            // 있는 문구·테마를 서버에서도 지운다 — 안 지우면 클론의 message_id·bucket_id 가 기본 목소리
            // 옆에 남는다(Codex #820) — 기본 목소리 + 클론 `greeting` 테마는 토글마다 400 `INVALID_BUCKET_ID`
            // 다. 기본 목소리 알람에서 비어 있는 문구·테마는 로컬의 사실 그대로라 서버도 비워 두는 것이 맞다.
            // 잠금 확정·미나 전환 뒤에는 보관본이 없어 `hasLockedPaidVoice` 만으로는 못 가린다.
            clearsMissingVoiceReferences = alarm.hasLockedPaidVoice() || alarm.usesSystemVoiceProfile(),
        )
    }

    /** 기본(시스템) 목소리 프로필로 말하는 알람인가 — 녹음(`LOCAL_AUDIO`)은 아니다. */
    private fun AlarmEntity.usesSystemVoiceProfile(): Boolean =
        voiceSource != VoiceSources.LOCAL_AUDIO && isSystemVoiceId(voiceProfileId)

    fun repeatMaskToDays(mask: Int): List<Int> =
        (0..6).filter { day -> mask and (1 shl day) != 0 }

    fun isRemoteAudioUrl(value: String): Boolean =
        value.startsWith("https://", ignoreCase = true) ||
            value.startsWith("r2://", ignoreCase = true)
}
