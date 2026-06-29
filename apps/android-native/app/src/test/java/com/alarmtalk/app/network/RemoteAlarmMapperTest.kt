package com.alarmtalk.app.network

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
        assertNull(request.rawAudioUrl)
    }

    @Test
    fun remoteAudioUrlCanBeReferencedWhenAlreadyNetworkBacked() {
        val alarm = alarm(
            playMode = AlarmPlayModes.ALARM_VOICE,
            rawAudioUri = "https://cdn.example.com/alarm.m4a",
        )

        val request = RemoteAlarmMapper.toWriteRequest(alarm)

        assertEquals("tts", request.mode)
        assertEquals("sound_then_voice", request.wakeMode)
        assertEquals("https://cdn.example.com/alarm.m4a", request.rawAudioUrl)
    }

    @Test
    fun cleartextRemoteAudioUrlIsNotReferenced() {
        val alarm = alarm(
            playMode = AlarmPlayModes.ALARM_VOICE,
            rawAudioUri = "http://cdn.example.com/alarm.m4a",
        )

        val request = RemoteAlarmMapper.toWriteRequest(alarm)

        assertEquals("sound-only", request.mode)
        assertNull(request.rawAudioUrl)
    }

    @Test
    fun generatedTtsUsesMessageIdInsteadOfRawR2Url() {
        val alarm = alarm(
            playMode = AlarmPlayModes.ALARM_VOICE,
            rawAudioUri = "r2://voices/user/audio",
            voiceSource = VoiceSources.TTS_PROFILE,
            ttsMessageId = "message-id",
            voiceProfileId = "profile-id",
        )

        val request = RemoteAlarmMapper.toWriteRequest(alarm)

        assertEquals("tts", request.mode)
        assertEquals("message-id", request.messageId)
        assertEquals("profile-id", request.voiceProfileId)
        assertNull(request.rawAudioUrl)
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
