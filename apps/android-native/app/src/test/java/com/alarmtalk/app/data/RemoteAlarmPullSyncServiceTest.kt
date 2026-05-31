package com.alarmtalk.app.data

import com.alarmtalk.app.network.RemoteAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteAlarmPullSyncServiceTest {
    @Test
    fun newReceivedRemoteAlarmUsesRemoteActiveState() {
        assertTrue(resolveReceivedRemoteEnabled(existing = null, remoteIsActive = true))
        assertTrue(resolveReceivedRemoteEnabled(existing = null, remoteIsActive = null))
        assertFalse(resolveReceivedRemoteEnabled(existing = null, remoteIsActive = false))
    }

    @Test
    fun locallyDisabledReceivedRemoteAlarmStaysDisabledWhenPulledAgain() {
        val existing = alarm(enabled = false, origin = AlarmOrigins.RECEIVED_REMOTE)

        assertFalse(resolveReceivedRemoteEnabled(existing, remoteIsActive = true))
    }

    @Test
    fun remotelyDisabledReceivedRemoteAlarmDisablesLocalCopy() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)

        assertFalse(resolveReceivedRemoteEnabled(existing, remoteIsActive = false))
    }

    @Test
    fun locallyEnabledReceivedRemoteAlarmStaysEnabledWhenRemoteIsActive() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)

        assertTrue(resolveReceivedRemoteEnabled(existing, remoteIsActive = true))
    }

    @Test
    fun remoteAlarmDoesNotDownloadMessageAudioWhenAudioUrlWasCleared() {
        val remote = RemoteAlarm(id = "remote-id", mode = "sound-only", messageId = "message-id")

        assertFalse(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun remoteAlarmWithVoiceMessageAudioDownloadsAudio() {
        val remote = RemoteAlarm(
            id = "remote-id",
            mode = "sound-only",
            messageId = "message-id",
            messageAudioUrl = "r2://message-audio.mp3",
        )

        assertTrue(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun remoteAlarmWithoutMessageIdDoesNotDownloadAudio() {
        val remote = RemoteAlarm(id = "remote-id", mode = "tts", messageId = " ")

        assertFalse(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun receivedRemoteAlarmLabelUsesSenderNameAsSentAlarmCopy() {
        assertEquals("김규원님이 보낸 알람", receivedRemoteAlarmLabel("김규원"))
    }

    @Test
    fun receivedRemoteAlarmLabelDoesNotDuplicateHonorific() {
        assertEquals("김규원님이 보낸 알람", receivedRemoteAlarmLabel("김규원님"))
    }

    @Test
    fun receivedRemoteAlarmLabelFallsBackWhenSenderIsMissing() {
        assertEquals("상대가 보낸 알람", receivedRemoteAlarmLabel(" "))
    }

    @Test
    fun receivedRemoteAlarmLabelUsesFallbackSenderWhenPrimaryIsBlank() {
        assertEquals("sender@example.com님이 보낸 알람", receivedRemoteAlarmLabel(" ", "sender@example.com"))
    }

    private fun alarm(
        enabled: Boolean,
        origin: String,
    ): AlarmEntity =
        AlarmEntity(
            id = "alarm-id",
            label = "remote alarm",
            hour = 7,
            minute = 30,
            fireAtMillis = 1_000L,
            repeatDaysMask = 0,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
            snoozeCount = 0,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.ALARM_ONLY,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            voiceSource = VoiceSources.LOCAL_AUDIO,
            voiceProfileId = null,
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
            ttsMessageId = null,
            remoteAlarmId = "remote-id",
            lastSyncedAtMillis = 1_000L,
            syncState = AlarmSyncStates.SYNCED,
            origin = origin,
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            enabled = enabled,
            state = if (enabled) AlarmStates.SCHEDULED else AlarmStates.DISABLED,
            createdAtMillis = 1_000L,
            updatedAtMillis = 1_000L,
        )
}
