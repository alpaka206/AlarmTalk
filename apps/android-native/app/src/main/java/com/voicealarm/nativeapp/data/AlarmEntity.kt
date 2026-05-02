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
    val snoozeMinutes: Int,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String,
    val localAudioUri: String?,
    val rawAudioUri: String?,
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

object DefaultAlarmSounds {
    const val BUNDLED_DEFAULT = "bundled_default"
}

data class AlarmDraft(
    val label: String,
    val hour: Int,
    val minute: Int,
    val repeatDaysMask: Int,
    val snoozeMinutes: Int,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String = DefaultAlarmSounds.BUNDLED_DEFAULT,
    val localAudioUri: String? = null,
    val rawAudioUri: String? = null,
)
