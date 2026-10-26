package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SYSTEM_VOICE_ID_PREFIX
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import org.junit.Assert.assertEquals
import org.junit.Test

/** 다음 알람 상태 카드의 우선순위(`NextAlarmStatus.kt`, v1.3 W06). */
class NextAlarmStatusTest {
    private val now = 1_800_000_000_000L
    private val hour = 60L * 60 * 1000
    private val mina = SYSTEM_VOICE_ID_PREFIX + "000000000102"

    private fun alarm(
        voiceProfileId: String? = mina,
        bucketId: String? = "cheer",
        playMode: String = AlarmPlayModes.VOICE_ONLY,
        voiceSource: String = VoiceSources.TTS_PROFILE,
        contextResolvedAtMillis: Long? = null,
    ) = AlarmEntity(
        id = "a", label = "", hour = 7, minute = 0, fireAtMillis = 0L, repeatDaysMask = 0, holidayOff = false,
        snoozeEnabled = true, snoozeMinutes = 5, snoozeRepeatLimit = SnoozeRepeatLimits.THREE, snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT, playMode = playMode, defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://a.mp3", audioCacheKey = "stock_a", rawAudioUri = null, voiceSource = voiceSource,
        voiceProfileId = voiceProfileId, voiceListenerTitle = null, voiceText = "t", voiceCategory = "custom", voiceLanguage = "ko",
        voiceRandomPrompt = false, voiceRandomContext = null, voiceWeatherCountry = null, voiceWeatherCity = null,
        voiceFortuneGender = null, voiceFortuneBirthDate = null, voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null, voiceRepeat = true, voiceVolumePercent = 100, ttsMessageId = "m",
        bucketId = bucketId, contextResolvedAtMillis = contextResolvedAtMillis, remoteAlarmId = null, lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY, origin = AlarmOrigins.LOCAL_OWNED, alarmVolumePercent = 100,
        alarmSoundUri = null, alarmSoundLabel = null, enabled = true, state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L, updatedAtMillis = 0L,
    )

    private fun status(
        a: AlarmEntity,
        fireAt: Long = now + 8 * hour,
        missing: PermissionTarget? = null,
        downloading: Boolean = false,
        endsAt: Long? = null,
    ) = nextAlarmStatus(a, fireAt, missing, downloading, endsAt, now)

    @Test
    fun permissionComesFirst() {
        assertEquals(
            NextAlarmStatus.PermissionMissing(PermissionTarget.ExactAlarms),
            status(alarm(), missing = PermissionTarget.ExactAlarms, downloading = true),
        )
    }

    @Test
    fun defaultVoiceDownloadOnlyMattersForDefaultVoiceAlarms() {
        assertEquals(NextAlarmStatus.VoicePreparing, status(alarm(), downloading = true))
        assertEquals(NextAlarmStatus.Ready, status(alarm(voiceProfileId = "clone"), downloading = true))
        assertEquals(NextAlarmStatus.Ready, status(alarm(playMode = AlarmPlayModes.ALARM_ONLY), downloading = true))
    }

    @Test
    fun weatherIsStaleOnlyInsideTheDayBeforeTheAlarm() {
        val weather = alarm(bucketId = "weather", contextResolvedAtMillis = now - 40 * hour)
        assertEquals(NextAlarmStatus.WeatherStale, status(weather))
        assertEquals(NextAlarmStatus.Ready, status(weather, fireAt = now + 48 * hour))
        assertEquals(NextAlarmStatus.Ready, status(alarm(bucketId = "weather", contextResolvedAtMillis = now - hour)))
        // 지금 기준으로 잰다 — 8시간 전에 받은 답은 23시간 뒤 알람이라도 새 답이다(울릴 시각 기준이면 31시간으로 읽힌다).
        val fetched8hAgo = alarm(bucketId = "weather", contextResolvedAtMillis = now - 8 * hour)
        assertEquals(NextAlarmStatus.Ready, status(fetched8hAgo, fireAt = now + 23 * hour))
    }

    @Test
    fun registeredVoiceEndingBeforeTheAlarmIsSaid() {
        val clone = alarm(voiceProfileId = "clone", bucketId = null)
        assertEquals(NextAlarmStatus.VoiceEnding(now + hour), status(clone, endsAt = now + hour))
        assertEquals(NextAlarmStatus.Ready, status(clone, endsAt = now + 100 * hour))
        // 기본 목소리는 이용 종료와 무관하다.
        assertEquals(NextAlarmStatus.Ready, status(alarm(), endsAt = now + hour))
    }
}
