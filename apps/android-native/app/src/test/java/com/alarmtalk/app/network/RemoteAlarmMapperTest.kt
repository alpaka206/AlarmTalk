package com.alarmtalk.app.network

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteAlarmMapperTest {
    @Test
    fun repeatMaskToDaysUsesSundayThroughSaturdayBits() {
        assertEquals(listOf(0, 2, 6), RemoteAlarmMapper.repeatMaskToDays(0b1000101))
    }

    @Test
    fun localVoiceAudioDoesNotUploadOrReferenceDeviceUri() {
        val alarm = alarm(
            playMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///data/user/0/app/voice.m4a",
            rawAudioUri = "content://media/audio/1",
        )

        val request = RemoteAlarmMapper.toWriteRequest(alarm)

        assertEquals("sound-only", request.mode)
        assertEquals("voice_only", request.wakeMode)
    }

    @Test
    fun generatedTtsUsesMessageIdInsteadOfRawR2Url() {
        val alarm = alarm(
            playMode = AlarmPlayModes.VOICE_ONLY,
            rawAudioUri = "r2://voices/user/audio",
            voiceSource = VoiceSources.TTS_PROFILE,
            ttsMessageId = "message-id",
            voiceProfileId = "profile-id",
        )

        val request = RemoteAlarmMapper.toWriteRequest(alarm)

        assertEquals("tts", request.mode)
        assertEquals("message-id", request.messageId)
        assertEquals("profile-id", request.voiceProfileId)
    }

    /** Retrofit 의 `GsonConverterFactory.create()` 와 같은 기본 Gson(serializeNulls 꺼짐)으로 보낸 본문. */
    private fun sentBody(alarm: AlarmEntity): JsonObject =
        JsonParser.parseString(Gson().toJson(RemoteAlarmMapper.toWriteRequest(alarm))).asJsonObject

    /**
     * 무료 잠금이 오디오 없이 기본 목소리로 바꾼 알람(Codex #820). 서버 `PATCH /alarm` 은 빠진 필드를
     * 그대로 두므로, 비어 있는 문구·테마를 **null 로 실어야** 클론의 `message_id`·`bucket_id` 가
     * 기본 목소리 옆에 남지 않는다 — 기본 인사말 알람은 그게 `INVALID_BUCKET_ID` 였다.
     */
    @Test
    fun anAudiolessDefaultVoiceLockClearsTheServersMessageAndTheme() {
        val locked = alarm(
            playMode = AlarmPlayModes.VOICE_ONLY,
            voiceSource = VoiceSources.TTS_PROFILE,
            voiceProfileId = "system-voice",
        ).copy(preLockVoiceJson = """{"voiceProfileId":"clone-a","ttsMessageId":"clone-greeting"}""")

        val body = sentBody(locked)

        assertTrue(body.has("message_id") && body.get("message_id").isJsonNull)
        assertTrue(body.has("bucket_id") && body.get("bucket_id").isJsonNull)
        assertEquals("system-voice", body.get("voice_profile_id").asString)
        // 나머지 빈 값은 예전처럼 빠진다 — 지우는 것은 이 두 키뿐이다.
        assertFalse(body.has("target_user_id"))
        assertFalse("본문에 실리지 않는 표시", body.has("clearsMissingVoiceReferences"))
    }

    @Test
    fun aLockWithBoundClipsSendsThemAsIs() {
        val locked = alarm(
            playMode = AlarmPlayModes.VOICE_ONLY,
            voiceSource = VoiceSources.TTS_PROFILE,
            voiceProfileId = "system-voice",
            ttsMessageId = "system-weather-0",
        ).copy(bucketId = "weather", preLockVoiceJson = """{"voiceProfileId":"clone-a"}""")

        val body = sentBody(locked)

        assertEquals("system-weather-0", body.get("message_id").asString)
        assertEquals("weather", body.get("bucket_id").asString)
    }

    @Test
    fun otherAlarmsStillLeaveMissingFieldsToTheServer() {
        val body = sentBody(alarm(playMode = AlarmPlayModes.VOICE_ONLY, voiceSource = VoiceSources.TTS_PROFILE, voiceProfileId = "p"))

        assertFalse(body.has("message_id"))
        assertFalse(body.has("bucket_id"))
        assertEquals("sound-only", body.get("mode").asString)
        assertEquals(listOf(0, 2, 6), body.getAsJsonArray("repeat_days").map { it.asInt })
    }

    private fun alarm(
        playMode: String = AlarmPlayModes.ALARM_ONLY,
        localAudioUri: String? = null,
        rawAudioUri: String? = null,
        voiceSource: String = VoiceSources.LOCAL_AUDIO,
        ttsMessageId: String? = null,
        voiceProfileId: String? = null,
    ): AlarmEntity =
        AlarmEntity(
            id = "local-id",
            label = "Morning",
            hour = 7,
            minute = 30,
            fireAtMillis = 1_000L,
            repeatDaysMask = 0b1000101,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = 3,
            snoozeCount = 0,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = playMode,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = localAudioUri,
            audioCacheKey = null,
            rawAudioUri = rawAudioUri,
            voiceSource = voiceSource,
            voiceProfileId = voiceProfileId,
            voiceListenerTitle = null,
            voiceText = null,
            voiceCategory = null,
            voiceLanguage = null,
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceWeatherCountry = null,
            voiceWeatherCity = null,
            voiceFortuneGender = null,
            voiceFortuneBirthDate = null,
            voiceFortuneBirthTime = null,
            dynamicVoicePreparedForFireAtMillis = null,
            voiceRepeat = true,
            voiceVolumePercent = 100,
            ttsMessageId = ttsMessageId,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = 1_000L,
            updatedAtMillis = 1_000L,
        )
}
