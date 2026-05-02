package com.voicealarm.nativeapp.network

import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes

object RemoteAlarmMapper {
    fun toWriteRequest(alarm: AlarmEntity): RemoteAlarmWriteRequest {
        val rawAudioUrl = alarm.rawAudioUri?.takeIf(::isNetworkUrl)
        return RemoteAlarmWriteRequest(
            time = "%02d:%02d".format(alarm.hour, alarm.minute),
            repeatDays = repeatMaskToDays(alarm.repeatDaysMask),
            snoozeMinutes = alarm.snoozeMinutes,
            mode = if (rawAudioUrl == null) "sound-only" else "tts",
            vibrationPattern = alarm.vibrationPattern,
            wakeMode = when (alarm.playMode) {
                AlarmPlayModes.VOICE_ONLY -> "voice_only"
                else -> "sound_then_voice"
            },
            isActive = alarm.enabled,
            rawAudioUrl = rawAudioUrl,
            rawAudioDurationMs = null,
        )
    }

    fun repeatMaskToDays(mask: Int): List<Int> =
        (0..6).filter { day -> mask and (1 shl day) != 0 }

    private fun isNetworkUrl(value: String): Boolean =
        value.startsWith("https://", ignoreCase = true) ||
            value.startsWith("http://", ignoreCase = true)
}
