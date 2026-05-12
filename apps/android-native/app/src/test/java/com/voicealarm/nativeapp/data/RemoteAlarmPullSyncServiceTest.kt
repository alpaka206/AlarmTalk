package com.voicealarm.nativeapp.data

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
            voiceRepeat = true,
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
