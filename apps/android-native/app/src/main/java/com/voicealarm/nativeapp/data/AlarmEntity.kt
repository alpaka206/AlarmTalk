package com.voicealarm.nativeapp.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.time.LocalDate

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
    val voiceRandomPrompt: Boolean,
    val voiceRandomContext: String?,
    val voiceWeatherCountry: String?,
    val voiceWeatherCity: String?,
    val voiceFortuneGender: String?,
    val voiceFortuneBirthDate: String?,
    val voiceFortuneBirthTime: String?,
    val dynamicVoicePreparedForFireAtMillis: Long?,
    val voiceRepeat: Boolean,
    val ttsMessageId: String?,
    val remoteAlarmId: String?,
    val lastSyncedAtMillis: Long?,
    val syncState: String,
    val origin: String,
    val alarmVolumePercent: Int,
    val alarmSoundUri: String?,
    val alarmSoundLabel: String?,
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

object AlarmOrigins {
    const val LOCAL_OWNED = "local_owned"
    const val RECEIVED_REMOTE = "received_remote"

    val all = listOf(LOCAL_OWNED, RECEIVED_REMOTE)
}

object VibrationPatterns {
    const val DEFAULT = "default"
    const val STRONG = "strong"
    const val SHORT = "short"
    const val MEDIUM = "medium"
    const val HEARTBEAT = "heartbeat"
    const val TICKTOCK = "ticktock"
    const val WALTZ = "waltz"
    const val ZIGZAG = "zigzag"
    const val OFF_BEAT = "off_beat"
    const val RIPPLE = "ripple"
    const val SIREN = "siren"
    const val NONE = "none"

    val all = listOf(
        DEFAULT,
        STRONG,
        SHORT,
        MEDIUM,
        HEARTBEAT,
        TICKTOCK,
        WALTZ,
        ZIGZAG,
        OFF_BEAT,
        RIPPLE,
        SIREN,
        NONE,
    )
}

object VibrationPatternLibrary {
    fun waveform(patternName: String): LongArray =
        when (patternName) {
            VibrationPatterns.STRONG -> longArrayOf(0L, 1_000L, 240L, 1_000L, 240L)
            VibrationPatterns.SHORT -> longArrayOf(0L, 260L, 520L)
            VibrationPatterns.MEDIUM -> longArrayOf(0L, 560L, 420L)
            VibrationPatterns.HEARTBEAT -> longArrayOf(0L, 120L, 120L, 240L, 580L)
            VibrationPatterns.TICKTOCK -> longArrayOf(0L, 90L, 210L, 90L, 620L)
            VibrationPatterns.WALTZ -> longArrayOf(0L, 280L, 140L, 150L, 140L, 150L, 620L)
            VibrationPatterns.ZIGZAG -> longArrayOf(0L, 110L, 100L, 180L, 100L, 280L, 520L)
            VibrationPatterns.OFF_BEAT -> longArrayOf(0L, 80L, 260L, 240L, 150L, 110L, 560L)
            VibrationPatterns.RIPPLE -> longArrayOf(0L, 90L, 110L, 160L, 130L, 260L, 620L)
            VibrationPatterns.SIREN -> longArrayOf(0L, 240L, 110L, 240L, 110L, 520L, 360L)
            else -> longArrayOf(0L, 700L, 350L, 900L)
        }
}

object HolidaySeedData {
    fun holidays(countryCode: String, year: Int): List<HolidayDate> =
        when (countryCode.uppercase()) {
            "KR" -> koreanHolidaysByYear[year].orEmpty()
            else -> emptyList()
        }

    private val koreanHolidaysByYear = mapOf(
        2026 to listOf(
            HolidayDate(LocalDate.of(2026, 1, 1), "신정"),
            HolidayDate(LocalDate.of(2026, 2, 16), "설날 연휴"),
            HolidayDate(LocalDate.of(2026, 2, 17), "설날"),
            HolidayDate(LocalDate.of(2026, 2, 18), "설날 연휴"),
            HolidayDate(LocalDate.of(2026, 3, 1), "삼일절"),
            HolidayDate(LocalDate.of(2026, 3, 2), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 5, 5), "어린이날"),
            HolidayDate(LocalDate.of(2026, 5, 24), "부처님오신날"),
            HolidayDate(LocalDate.of(2026, 5, 25), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 6, 3), "전국동시지방선거"),
            HolidayDate(LocalDate.of(2026, 6, 6), "현충일"),
            HolidayDate(LocalDate.of(2026, 8, 15), "광복절"),
            HolidayDate(LocalDate.of(2026, 8, 17), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 9, 24), "추석 연휴"),
            HolidayDate(LocalDate.of(2026, 9, 25), "추석"),
            HolidayDate(LocalDate.of(2026, 9, 26), "추석 연휴"),
            HolidayDate(LocalDate.of(2026, 10, 3), "개천절"),
            HolidayDate(LocalDate.of(2026, 10, 5), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 10, 9), "한글날"),
            HolidayDate(LocalDate.of(2026, 12, 25), "기독탄신일"),
        ),
    )
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
    val voiceRandomPrompt: Boolean = false,
    val voiceRandomContext: String? = null,
    val voiceWeatherCountry: String? = null,
    val voiceWeatherCity: String? = null,
    val voiceFortuneGender: String? = null,
    val voiceFortuneBirthDate: String? = null,
    val voiceFortuneBirthTime: String? = null,
    val dynamicVoicePreparedForFireAtMillis: Long? = null,
    val voiceRepeat: Boolean = true,
    val ttsMessageId: String? = null,
    val alarmVolumePercent: Int = 100,
    val alarmSoundUri: String? = null,
    val alarmSoundLabel: String? = null,
)
