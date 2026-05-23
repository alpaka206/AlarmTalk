package com.voicealarm.nativeapp.network

import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.VoiceSources

object RemoteAlarmMapper {
    fun toWriteRequest(alarm: AlarmEntity): RemoteAlarmWriteRequest {
        val rawAudioUrl = alarm.rawAudioUri?.takeIf(::isRemoteAudioUrl)
            ?.takeUnless { alarm.ttsMessageId != null }
        val hasRemoteVoice = alarm.ttsMessageId != null || rawAudioUrl != null
        return RemoteAlarmWriteRequest(
            time = "%02d:%02d".format(alarm.hour, alarm.minute),
            repeatDays = repeatMaskToDays(alarm.repeatDaysMask),
            snoozeMinutes = alarm.snoozeMinutes,
            mode = if (hasRemoteVoice) "tts" else "sound-only",
            vibrationPattern = alarm.vibrationPattern,
            wakeMode = when (alarm.playMode) {
                AlarmPlayModes.VOICE_ONLY -> "voice_only"
                else -> "sound_then_voice"
            },
            isActive = alarm.enabled,
            messageId = alarm.ttsMessageId.trimmedOrNull(),
            voiceProfileId = alarm.voiceProfileId
                .takeIf { alarm.voiceSource != VoiceSources.LOCAL_AUDIO }
                .trimmedOrNull(),
            rawAudioUrl = rawAudioUrl,
            rawAudioDurationMs = null,
            targetUserId = null,
        )
    }

    fun repeatMaskToDays(mask: Int): List<Int> =
        (0..6).filter { day -> mask and (1 shl day) != 0 }

    fun isRemoteAudioUrl(value: String): Boolean =
        value.startsWith("https://", ignoreCase = true) ||
            value.startsWith("http://", ignoreCase = true) ||
            value.startsWith("r2://", ignoreCase = true)
}
