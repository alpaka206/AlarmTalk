package com.voicealarm.nativeapp.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "alarms")
data class AlarmEntity(
    @PrimaryKey val id: String,
    val label: String,
    val hour: Int,
    val minute: Int,
    val fireAtMillis: Long,
    val repeatDaysMask: Int,
    val holidayOff: Boolean,
    val snoozeEnabled: Boolean,
    val snoozeMinutes: Int,
    val snoozeRepeatLimit: Int,
    val snoozeCount: Int,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String,
    val localAudioUri: String?,
    val audioCacheKey: String?,
    val rawAudioUri: String?,
    val voiceSource: String,
    val voiceProfileId: String?,
    val voiceText: String?,
    val voiceCategory: String?,
    val voiceLanguage: String?,
    val ttsMessageId: String?,
    val remoteAlarmId: String?,
    val lastSyncedAtMillis: Long?,
    val syncState: String,
    val enabled: Boolean,
    val state: String,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
)

object AlarmStates {
    const val SCHEDULED = "scheduled"
    const val RINGING = "ringing"
    const val SNOOZED = "snoozed"
    const val DISMISSED = "dismissed"
    const val DISABLED = "disabled"
    const val FAILED = "failed"
}

object AlarmSyncStates {
    const val LOCAL_ONLY = "local_only"
    const val SYNCED = "synced"
    const val DIRTY = "dirty"
    const val FAILED = "sync_failed"
}

object VibrationPatterns {
    const val DEFAULT = "default"
    const val STRONG = "strong"
    const val NONE = "none"

    val all = listOf(DEFAULT, STRONG, NONE)
}

object AlarmPlayModes {
    const val ALARM_ONLY = "alarm_only"
    const val VOICE_ONLY = "voice_only"
    const val ALARM_VOICE = "alarm_voice"

    val all = listOf(ALARM_ONLY, VOICE_ONLY, ALARM_VOICE)
}

object SnoozeRepeatLimits {
    const val THREE = 3
    const val FIVE = 5
    const val FOREVER = 0

    val all = listOf(THREE, FIVE, FOREVER)
}

object VoiceSources {
    const val LOCAL_AUDIO = "local_audio"
    const val TTS_PROFILE = "tts_profile"
    const val SERVER_TTS = "server_tts"

    val all = listOf(LOCAL_AUDIO, TTS_PROFILE, SERVER_TTS)
}

object DefaultAlarmSounds {
    const val BUNDLED_DEFAULT = "bundled_default"
}

data class AlarmDraft(
    val label: String,
    val hour: Int,
    val minute: Int,
    val targetUserId: String? = null,
    val targetUserName: String? = null,
    val repeatDaysMask: Int,
    val holidayOff: Boolean = false,
    val snoozeEnabled: Boolean = true,
    val snoozeMinutes: Int,
    val snoozeRepeatLimit: Int = SnoozeRepeatLimits.THREE,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String = DefaultAlarmSounds.BUNDLED_DEFAULT,
    val localAudioUri: String? = null,
    val audioCacheKey: String? = null,
    val rawAudioUri: String? = null,
    val voiceSource: String = VoiceSources.LOCAL_AUDIO,
    val voiceProfileId: String? = null,
    val voiceText: String? = null,
    val voiceCategory: String? = null,
    val voiceLanguage: String? = null,
    val ttsMessageId: String? = null,
)
