package com.voicealarm.nativeapp.network

import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.AlarmStates
import com.voicealarm.nativeapp.data.AlarmSyncStates
import com.voicealarm.nativeapp.data.DefaultAlarmSounds
import com.voicealarm.nativeapp.data.VibrationPatterns
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

    private fun alarm(
        playMode: String = AlarmPlayModes.ALARM_ONLY,
        localAudioUri: String? = null,
        rawAudioUri: String? = null,
    ): AlarmEntity =
        AlarmEntity(
            id = "local-id",
            label = "Morning",
            hour = 7,
            minute = 30,
            fireAtMillis = 1_000L,
            repeatDaysMask = 0b1000101,
            snoozeMinutes = 5,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = playMode,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = localAudioUri,
            rawAudioUri = rawAudioUri,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = 1_000L,
            updatedAtMillis = 1_000L,
        )
}
