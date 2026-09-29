package com.alarmtalk.app.network

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.hasLockedPaidVoice
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
            // 무료 잠금으로 기본 목소리가 된 알람은 비어 있는 문구·테마를 서버에서도 지운다 —
            // 안 지우면 클론의 message_id·bucket_id 가 기본 목소리 옆에 남는다(Codex #820).
            clearsMissingVoiceReferences = alarm.hasLockedPaidVoice(),
        )
    }

    fun repeatMaskToDays(mask: Int): List<Int> =
        (0..6).filter { day -> mask and (1 shl day) != 0 }

    fun isRemoteAudioUrl(value: String): Boolean =
        value.startsWith("https://", ignoreCase = true) ||
            value.startsWith("r2://", ignoreCase = true)
}
