package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.RemoteAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// receivedRemoteAlarmLabel 가 Context(앱 리소스)에 의존하므로 Robolectric 으로 실행.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class RemoteAlarmPullSyncServiceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

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
    fun newReceivedAlarmRecordsCurrentRecipientAsOwner() {
        // 새 받은 알람은 현재 수신자를 소유자로 기록한다 — 같은 기기에 다른 계정이 로그인해도
        // 남의 받은 목소리 알람을 복원·스케줄하지 못하게 스코프한다.
        assertEquals("recipient-1", resolveReceivedOwner(existing = null, currentUserId = "recipient-1"))
    }

    @Test
    fun existingReceivedAlarmPreservesRecordedOwner() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(ownerUserId = "owner-a")

        assertEquals("owner-a", resolveReceivedOwner(existing, currentUserId = "recipient-b"))
    }

    @Test
    fun legacyReceivedAlarmWithoutOwnerHealsToCurrentRecipient() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(ownerUserId = null)

        assertEquals("recipient-1", resolveReceivedOwner(existing, currentUserId = "recipient-1"))
    }

    @Test
    fun pullNeverTouchesAnotherAccountsRetainedAlarms() {
        // 로컬 알람은 로그아웃해도 남는다. 서버 알람의 수신자는 한 명이라 앞 계정(A)이 받은/만든
        // 알람이 B 의 스냅샷에 없는 건 당연한데, 그걸 '서버에 없다'로 읽으면 pull 이 A 의 알람을
        // 끄거나(같은 시각 양보) 지운다(stale prune). 끄기는 특히 치명적이다 — 재예약은 enabled=1
        // 만 훑으므로 A 가 다시 로그인해도 알람이 영영 안 울린다.
        val leftBehind = alarm(enabled = true, origin = AlarmOrigins.LOCAL_OWNED)
            .copy(ownerUserId = "account-a")

        assertFalse(isOwnedByRecipient(leftBehind, currentUserId = "account-b"))
        assertFalse("비로그인 세션도 남의 행을 건드리면 안 된다", isOwnedByRecipient(leftBehind, currentUserId = null))
    }

    @Test
    fun pullStillManagesThisRecipientsOwnAndLegacyAlarms() {
        // 회귀 방지: 같은 시각 양보·stale prune 은 내 알람에 대해서는 예전대로 동작해야 한다.
        val mine = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(ownerUserId = "account-b")
        val legacy = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(ownerUserId = null)

        assertTrue(isOwnedByRecipient(mine, currentUserId = "account-b"))
        assertTrue(isOwnedByRecipient(legacy, currentUserId = "account-b"))
        assertTrue("소유자 미기록은 비로그인에서도 현재 계정 것으로 본다", isOwnedByRecipient(legacy, currentUserId = null))
    }

    @Test
    fun unlockedReceivedAlarmKeepsRebuiltRemoteVoiceMode() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)

        val state = resolveReceivedLockState(AlarmPlayModes.ALARM_VOICE, existing)

        assertEquals(AlarmPlayModes.ALARM_VOICE, state.playMode)
        assertEquals(null, state.preLockPlayMode)
    }

    @Test
    fun lockedReceivedAlarmStaysLockedAfterPullAndSnapshotsRebuiltVoiceMode() {
        // 무료로 잠긴 받은 알람: pull 이 원격 목소리 모드(ALARM_VOICE)를 재구성해도 잠금을 유지하고,
        // 그 최신 모드를 복원용으로 스냅샷한다(재유료 시 unlockPaidAlarmTalks 가 이 값으로 복원).
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY)

        val state = resolveReceivedLockState(AlarmPlayModes.ALARM_VOICE, existing)

        assertEquals(AlarmPlayModes.ALARM_ONLY, state.playMode)
        assertEquals(AlarmPlayModes.ALARM_VOICE, state.preLockPlayMode)
    }

    @Test
    fun lockedReceivedAlarmPreservesLockMarkerWhenAudioMissingThisPull() {
        // 이번 pull 에서 오디오를 못 받아 사운드온리(computed==ALARM_ONLY)가 돼도 기존 잠금 마커를
        // 잃지 않는다 — 잃으면 다음 성공 pull 이 무료인데도 목소리로 되살린다.
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.ALARM_VOICE)

        val state = resolveReceivedLockState(AlarmPlayModes.ALARM_ONLY, existing)

        assertEquals(AlarmPlayModes.ALARM_ONLY, state.playMode)
        assertEquals(AlarmPlayModes.ALARM_VOICE, state.preLockPlayMode)
    }

    @Test
    fun remoteAlarmDoesNotDownloadMessageAudioWhenAudioUrlWasCleared() {
        val remote = RemoteAlarm(id = "remote-id", messageId = "message-id")

        assertFalse(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun remoteAlarmWithVoiceMessageAudioDownloadsAudio() {
        val remote = RemoteAlarm(
            id = "remote-id",
            messageId = "message-id",
            messageAudioUrl = "r2://message-audio.mp3",
        )

        assertTrue(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun remoteAlarmWithoutMessageIdDoesNotDownloadAudio() {
        val remote = RemoteAlarm(id = "remote-id", messageId = " ")

        assertFalse(shouldDownloadRemoteMessageAudio(remote))
    }

    @Test
    fun receivedRemoteAlarmLabelUsesSenderNameAsSentAlarmCopy() {
        assertEquals("김규원님이 보낸 알람", receivedRemoteAlarmLabel(context, "김규원"))
    }

    @Test
    fun receivedRemoteAlarmLabelDoesNotDuplicateHonorific() {
        assertEquals("김규원님이 보낸 알람", receivedRemoteAlarmLabel(context, "김규원님"))
    }

    @Test
    fun receivedRemoteAlarmLabelFallsBackWhenSenderIsMissing() {
        assertEquals("상대가 보낸 알람", receivedRemoteAlarmLabel(context, " "))
    }

    @Test
    fun receivedRemoteAlarmLabelUsesFallbackSenderWhenPrimaryIsBlank() {
        assertEquals("sender@example.com님이 보낸 알람", receivedRemoteAlarmLabel(context, " ", "sender@example.com"))
    }

    @Test
    fun receivedAlarmKeepsLocallyEditedSchedule() {
        // 받은 뒤부터는 받는 사람 것이다 — 서버 값(6:00)이 로컬 수정(7:30)을 덮으면 안 된다.
        // 예전엔 로컬에 저장된 뒤 1초 만에 조용히 되돌아갔다(사용자는 못 일어난다).
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
        val resolved = resolveReceivedSchedule(
            existing = existing,
            remoteHour = 6,
            remoteMinute = 0,
            remoteRepeatDaysMask = 0b0111110,
            remoteSnoozeMinutes = 10,
        )
        assertEquals(7, resolved.hour)
        assertEquals(30, resolved.minute)
        assertEquals(existing.repeatDaysMask, resolved.repeatDaysMask)
        assertEquals(existing.snoozeMinutes, resolved.snoozeMinutes)
        // 이미 잡아 둔 발사 시각도 그대로 — 다시 계산하면 로컬 수정이 사라진다.
        assertEquals(existing.fireAtMillis, resolved.keptFireAtMillis)
    }

    @Test
    fun firstTimeReceivedAlarmUsesRemoteSchedule() {
        // 처음 받을 때는 서버 값이 씨앗이다. fireAt 은 계산해야 하므로 null 을 돌려준다.
        val resolved = resolveReceivedSchedule(
            existing = null,
            remoteHour = 6,
            remoteMinute = 15,
            remoteRepeatDaysMask = 0b0111110,
            remoteSnoozeMinutes = 10,
        )
        assertEquals(6, resolved.hour)
        assertEquals(15, resolved.minute)
        assertEquals(0b0111110, resolved.repeatDaysMask)
        assertEquals(10, resolved.snoozeMinutes)
        assertEquals(null, resolved.keptFireAtMillis)
    }

    @Test
    fun myOwnAlarmIsNotTreatedAsReceived() {
        // 내가 만든 알람은 이 규칙 밖이다(애초에 pull 이 건드리지 않는다).
        val mine = alarm(enabled = true, origin = AlarmOrigins.LOCAL_OWNED)
        val resolved = resolveReceivedSchedule(mine, 6, 0, 0, 10)
        assertEquals(6, resolved.hour)
        assertEquals(null, resolved.keptFireAtMillis)
    }

    @Test
    fun ringingReceivedAlarmKeepsPastFireTimeSoPullMustSkipIt() {
        // 울리는 중인 행은 enabled=true 인데 fireAtMillis 가 이미 과거다. 그 값을 살려
        // 다시 SCHEDULED 로 세우고 예약하면 즉시 재발화한다(Codex #675 P1).
        // 그래서 pull 은 이 행을 아예 건너뛴다 — 아래는 '살리면 과거가 그대로 남는다' 는
        // 사실을 고정해, 건너뛰기를 지우면 무엇이 깨지는지 남긴다.
        val ringing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
        val resolved = resolveReceivedSchedule(ringing, 6, 0, 0, 5)
        assertEquals(ringing.fireAtMillis, resolved.keptFireAtMillis)
        assertTrue("울리는 행의 fireAt 은 과거다", ringing.fireAtMillis < 2_000L)
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
