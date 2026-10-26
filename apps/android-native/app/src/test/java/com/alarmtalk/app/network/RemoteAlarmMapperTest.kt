package com.alarmtalk.app.network

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SUBSTITUTE_SYSTEM_VOICE_ID
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    /** 응원 테마의 다양하게/고정은 서버 사본과 왕복한다 — 이력·선택은 기기 로컬이라 싣지 않는다(스펙 voice-and-message §5-4). */
    @Test
    fun cheerAlarmCarriesItsModeAndPinnedLine() {
        val pinned = alarm(voiceSource = VoiceSources.TTS_PROFILE, voiceProfileId = "profile-id").copy(
            bucketId = "cheer",
            cheerMode = "pinned",
            cheerPinnedContentId = "cheer_v2_05",
            cheerHistoryJson = "[\"cheer_v2_01\"]",
            cheerSelectionJson = "{\"o\":1,\"id\":\"cheer_v2_05\",\"key\":\"stock_x\",\"text\":\"t\",\"lang\":\"ko\"}",
        )
        val body = sentBody(pinned)
        assertEquals("pinned", body["cheer_mode"].asString)
        assertEquals("cheer_v2_05", body["cheer_pinned_content_id"].asString)
        assertFalse(body.has("cheer_history_json"))
        assertFalse(body.keySet().any { it.contains("history") || it.contains("selection") })

        // 다양하게면 고정 문구를 보내지 않고, 옛 행(값 없음)은 다양하게로 읽는다.
        val legacy = sentBody(pinned.copy(cheerMode = null))
        assertEquals("vary", legacy["cheer_mode"].asString)
        assertFalse(legacy.has("cheer_pinned_content_id"))

        // 응원이 아닌 알람은 둘 다 싣지 않는다.
        val weather = sentBody(pinned.copy(bucketId = "weather"))
        assertFalse(weather.has("cheer_mode"))
        assertFalse(weather.has("cheer_pinned_content_id"))
    }

    @Test
    fun responseReadsCheerFields() {
        val response = Gson().fromJson(
            "{\"alarm\":{\"id\":\"a\",\"bucket_id\":\"cheer\",\"cheer_mode\":\"pinned\",\"cheer_pinned_content_id\":\"cheer_v2_02\"}}",
            RemoteAlarmResponse::class.java,
        )
        assertEquals("pinned", response.alarm.cheerMode)
        assertEquals("cheer_v2_02", response.alarm.cheerPinnedContentId)
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
        // 나머지 빈 값은 예전처럼 빠진다 — null 로 싣는 것은 이 두 키뿐이다.
        assertEquals(setOf("message_id", "bucket_id"), body.entrySet().filter { it.value.isJsonNull }.map { it.key }.toSet())
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

    /**
     * 잠금이 **확정**됐거나 목소리를 잃어 **미나**로 바꾼 알람에는 보관본이 없다 — 보관본으로만 가리면
     * 그 알람의 켜기·끄기가 기본 목소리 id 만 올려 클론의 `greeting` 테마 옆에 앉히고, 서버는 토글마다
     * `INVALID_BUCKET_ID` 로 거절한다. 기본 목소리 알람이면 빈 문구·테마를 지운다.
     */
    @Test
    fun aDefaultVoiceAlarmWithoutASnapshotStillClearsTheServersMessageAndTheme() {
        val converted = alarm(
            playMode = AlarmPlayModes.VOICE_ONLY,
            voiceSource = VoiceSources.TTS_PROFILE,
            voiceProfileId = SUBSTITUTE_SYSTEM_VOICE_ID,
        )

        val body = sentBody(converted)

        assertTrue(body.has("message_id") && body.get("message_id").isJsonNull)
        assertTrue(body.has("bucket_id") && body.get("bucket_id").isJsonNull)
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, body.get("voice_profile_id").asString)
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
