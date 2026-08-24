package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.RemoteAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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

        val state = resolveReceivedLockState(AlarmPlayModes.VOICE_ONLY, existing)

        assertEquals(AlarmPlayModes.VOICE_ONLY, state.playMode)
        assertEquals(null, state.preLockPlayMode)
    }

    @Test
    fun lockedReceivedAlarmStaysLockedAfterPullAndSnapshotsRebuiltVoiceMode() {
        // 무료로 잠긴 받은 알람: pull 이 원격 목소리 모드(VOICE_ONLY)를 재구성해도 잠금을 유지하고,
        // 그 최신 모드를 복원용으로 스냅샷한다(재유료 시 unlockPaidAlarmTalks 가 이 값으로 복원).
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY)

        val state = resolveReceivedLockState(AlarmPlayModes.VOICE_ONLY, existing)

        assertEquals(AlarmPlayModes.ALARM_ONLY, state.playMode)
        assertEquals(AlarmPlayModes.VOICE_ONLY, state.preLockPlayMode)
    }

    @Test
    fun lockedReceivedAlarmPreservesLockMarkerWhenAudioMissingThisPull() {
        // 이번 pull 에서 오디오를 못 받아 사운드온리(computed==ALARM_ONLY)가 돼도 기존 잠금 마커를
        // 잃지 않는다 — 잃으면 다음 성공 pull 이 무료인데도 목소리로 되살린다.
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY)

        val state = resolveReceivedLockState(AlarmPlayModes.ALARM_ONLY, existing)

        assertEquals(AlarmPlayModes.ALARM_ONLY, state.playMode)
        assertEquals(AlarmPlayModes.VOICE_ONLY, state.preLockPlayMode)
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
    fun receivedAlarmAcksOnlyAfterEnabledAlarmIsScheduledAndVersioned() {
        assertFalse(receivedAlarmDeliveryComplete(true, true, false, "version-1"))
        assertFalse(receivedAlarmDeliveryComplete(true, true, true, null))
        assertTrue(receivedAlarmDeliveryComplete(true, true, true, "version-1"))
        assertTrue(receivedAlarmDeliveryComplete(true, false, false, "version-1"))
    }

    @Test
    fun editedReceivedAlarmRetriesAckOnlyForAppliedDeliveryVersion() {
        val existing = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(remoteDeliveryVersion = "version-1")

        assertTrue(receivedAlarmDeliveryVersionAlreadyApplied(existing, "version-1"))
        assertFalse(receivedAlarmDeliveryVersionAlreadyApplied(existing, "version-2"))
        assertFalse(receivedAlarmDeliveryVersionAlreadyApplied(existing, null))

        val legacy = existing.copy(remoteDeliveryVersion = null)
        assertFalse(receivedAlarmDeliveryVersionAlreadyApplied(legacy, "0123456789abcdef0123456789abcdef"))
        assertTrue(isLegacyBackfilledDelivery(legacy, "0123456789abcdef0123456789abcdef"))
        assertFalse(isLegacyBackfilledDelivery(existing, "0123456789abcdef0123456789abcdef"))
        assertFalse(receivedAlarmDeliveryVersionAlreadyApplied(legacy, "11111111-1111-4111-8111-111111111111"))
        assertFalse(isLegacyBackfilledDelivery(legacy, "11111111-1111-4111-8111-111111111111"))
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

    @Test
    fun receivedAlarmKeepsSnoozeAndHolidayToggles() {
        // 값(분)만 지키고 토글을 놓치면 다음 pull 이 스누즈를 다시 켜고 공휴일에도 울린다.
        val edited = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(snoozeEnabled = false, holidayOff = true)
        val resolved = resolveReceivedSchedule(edited, 6, 0, 0, 5)
        assertFalse("수신자가 끈 스누즈는 켜지지 않는다", resolved.snoozeEnabled)
        assertTrue("수신자가 켠 공휴일 건너뛰기는 유지된다", resolved.holidayOff)
    }

    @Test
    fun pullKeepsEverythingTheRecipientCanEdit() {
        // pull 이 음성을 받는 사이 수신자가 알람을 고칠 수 있다. 그래서 행은 **반영 직전에
        // 다시 읽은 값**으로 만든다 — 예전에는 다운로드 전 스냅샷으로 미리 만들고 달라진
        // 필드만 골라 덮었는데, 그 목록에서 빠진 값이 네 번 나왔다(시각 → 끄기 → 스누즈 →
        // 볼륨·알람음). 여기서 한 번에 못 박는다(Codex #675 P1).
        val edited = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            hour = 5,
            minute = 45,
            repeatDaysMask = 0b0111110,
            snoozeEnabled = false,
            snoozeMinutes = 9,
            snoozeRepeatLimit = SnoozeRepeatLimits.FIVE,
            holidayOff = true,
            alarmVolumePercent = 30,
            alarmSoundEnabled = false,
            voiceVolumePercent = 40,
            voiceRepeat = false,
        )
        val rebuilt = requireNotNull(
            buildReceivedAlarmRow(
                context = context,
                remote = remote(),
                existing = edited,
                cachedAudio = null,
                currentUserId = "user-1",
            ),
        )
        assertEquals("고친 시각", 5, rebuilt.hour)
        assertEquals(45, rebuilt.minute)
        assertEquals(0b0111110, rebuilt.repeatDaysMask)
        assertFalse("끈 스누즈", rebuilt.snoozeEnabled)
        assertEquals(9, rebuilt.snoozeMinutes)
        assertEquals(SnoozeRepeatLimits.FIVE, rebuilt.snoozeRepeatLimit)
        assertTrue("공휴일 건너뛰기", rebuilt.holidayOff)
        assertEquals("낮춘 알람음 볼륨", 30, rebuilt.alarmVolumePercent)
        assertFalse("끈 알람음", rebuilt.alarmSoundEnabled)
        assertEquals(40, rebuilt.voiceVolumePercent)
        assertFalse(rebuilt.voiceRepeat)
        assertEquals("같은 행을 갱신한다", edited.id, rebuilt.id)
    }

    @Test
    fun pullKeepsTheWholeSnoozeEpisode() {
        // 마감·상태·누른 횟수는 한 묶음이다. 상태만 SCHEDULED 로 되돌리면 정합성 복원이
        // 다음 정규 발생으로 밀어 스누즈가 사라지고, 횟수만 0 으로 되돌리면 같은 회차에서
        // 스누즈 제한이 초기화된다(Codex #675 P1·P2).
        val snoozed = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(state = AlarmStates.SNOOZED, snoozeCount = 2, fireAtMillis = 9_999L)
        val rebuilt = requireNotNull(
            buildReceivedAlarmRow(
                context = context,
                remote = remote(),
                existing = snoozed,
                cachedAudio = null,
                currentUserId = "user-1",
            ),
        )
        assertEquals(AlarmStates.SNOOZED, rebuilt.state)
        assertEquals("이미 누른 횟수", 2, rebuilt.snoozeCount)
        assertEquals("스누즈 마감", 9_999L, rebuilt.fireAtMillis)
    }

    @Test
    fun revokedVoiceLeavesTheAlarmRingingWithoutTheVoice() {
        // 발신자가 탈퇴하면 그 사람의 복제 목소리는 파기 대상이다. 하지만 시각은 수신자가
        // 기대고 자는 자기 정보라, 알람까지 지우면 그날 못 일어난다(Codex #676 P1).
        val received = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            label = "김규원 님이 보낸 알람",
            playMode = AlarmPlayModes.VOICE_ONLY,
            preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///cache/remote-message-m1.m4a",
            audioCacheKey = "remote-message-m1",
            voiceProfileId = "vp-A",
            voiceText = "일어나",
            ttsMessageId = "m1",
        )
        assertTrue("철회 대상 판정", hasSenderVoice(received))

        val stripped = withVoiceRevoked(received, context)

        assertEquals("시각은 그대로", received.hour, stripped.hour)
        assertEquals(received.repeatDaysMask, stripped.repeatDaysMask)
        assertTrue("알람은 계속 울린다", stripped.enabled)
        assertEquals(AlarmPlayModes.ALARM_ONLY, stripped.playMode)
        assertNull("잠금 복원 스냅샷도 비운다", stripped.preLockPlayMode)
        assertNull(stripped.localAudioUri)
        assertNull(stripped.audioCacheKey)
        assertNull(stripped.voiceProfileId)
        assertNull(stripped.voiceText)
        assertNull(stripped.ttsMessageId)
        assertFalse("보낸 사람 이름도 지운다", stripped.label.contains("김규원"))
        assertFalse("한 번 걷어낸 뒤에는 다시 걷어내지 않는다", hasSenderVoice(stripped))
    }

    @Test
    fun revocationDoesNotTouchAVoiceTheRecipientChoseThemselves() {
        // 서버는 철회 기록을 영구히 들고 있다. '목소리가 있으면 걷어낸다' 로 잡으면, 알람을
        // 물려받은 수신자가 나중에 넣은 자기 목소리까지 pull 마다 걷어내 **다시는 목소리를
        // 쓸 수 없는 알람**이 된다(Codex #677 P2). 걷어낼 것은 탈퇴한 사람이 보낸 음성뿐이다.
        val mine = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            label = "출근",
            playMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///cache/tts-abc.m4a",
            audioCacheKey = "tts-abc",
            voiceProfileId = "vp-mine",
            ttsMessageId = "my-message",
        )
        assertFalse("내가 고른 목소리는 철회 대상이 아니다", hasSenderVoice(mine))

        // 직접 녹음·기본 목소리(스톡)·무료 버킷도 마찬가지다.
        assertFalse(hasSenderVoice(mine.copy(audioCacheKey = "stock_wake_01")))
        assertFalse(
            hasSenderVoice(
                mine.copy(audioCacheKey = null, localAudioUri = null, bucketId = "wake"),
            ),
        )
    }

    @Test
    fun revocationStillCatchesAKeylessLegacyRow() {
        // 지금 코드는 캐시 키 없는 받은-알람 행을 만들지 않는다(buildReceivedAlarmRow 가 두
        // 값을 같은 CachedAlarmAudio 에서 채운다). 그래도 실기기의 옛 DB 까지 없다고 단정하고
        // 발신자의 녹음을 남겨 둘 수는 없다 — 키가 없으면 URI 로 잡는다(Codex #677 P1).
        val legacy = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            playMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///data/audio/legacy_recording.m4a",
            audioCacheKey = null,
        )
        assertTrue(hasSenderVoice(legacy))

        // 반대로 파일도 키도 없으면 걷어낼 목소리가 없다 — 라벨만 날리면 안 된다.
        assertFalse(hasSenderVoice(legacy.copy(localAudioUri = null)))
    }

    @Test
    fun revocationTargetsAFreeLockedRowToo() {
        // 무료로 잠긴 받은 알람은 재생만 막혔지(playMode=ALARM_ONLY) 발신자의 녹음 파일은
        // 디스크에 그대로 있다. 재생 모드로 판정하면 이 행을 놓쳐 생체정보가 남는다.
        val locked = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            playMode = AlarmPlayModes.ALARM_ONLY,
            preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///cache/remote-message-m1.m4a",
            audioCacheKey = "remote-message-m1",
        )
        assertTrue(hasSenderVoice(locked))
        assertNull(withVoiceRevoked(locked, context).audioCacheKey)
    }

    // ── 받은 뒤에는 받은 사람이 관리한다 (docs/spec/family-alarm.md 1절) ──────────────
    // 예전에는 '지켜야 할 필드' 목록을 늘려 가며 막았고, 목록에 없는 값은 매 pull 마다
    // 되돌아왔다. 이제는 **고쳐진 행 자체에 손대지 않는다** — 그 판정을 고정한다.

    @Test
    fun pullWrittenRowIsNotTreatedAsRecipientEdit() {
        // pull 이 만든 행은 두 시각이 같다. 이걸 '편집됨' 으로 읽으면 갓 받은 알람이
        // 곧바로 잠겨, 음성 다운로드가 실패했던 행의 **재시도**까지 죽는다.
        val fresh = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
        assertFalse(locallyEditedByRecipient(fresh))
    }

    @Test
    fun recipientEditMakesRowStickAgainstRemote() {
        // 수신자가 저장하면 updateAlarm 이 lastSyncedAtMillis 를 보존한 채
        // updatedAtMillis 만 올린다(upsertPreservingServerSyncFields).
        val edited = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(updatedAtMillis = 2_000L)
        assertTrue(locallyEditedByRecipient(edited))
    }

    @Test
    fun legacyRowWithoutSyncStampIsTreatedAsEdited() {
        // pull 이 만든 게 아닌 행은 근거가 없으니 보수적으로 지킨다.
        val legacy = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE)
            .copy(lastSyncedAtMillis = null)
        assertTrue(locallyEditedByRecipient(legacy))
    }

    @Test
    fun rebuiltReceivedRowKeepsTheUneditedInvariant() {
        // ⚠ 이 불변식이 깨지면 위 판정이 통째로 뒤집힌다 — buildReceivedAlarmRow 가
        // 두 시각을 **같은 now** 로 넣어야 '아직 안 고침' 이 표현된다.
        val row = buildReceivedAlarmRow(
            context = context,
            remote = remote(),
            existing = null,
            cachedAudio = null,
            currentUserId = "recipient",
            now = 5_000L,
        )
        assertNotNull(row)
        assertEquals(row!!.updatedAtMillis, row.lastSyncedAtMillis)
        assertFalse(locallyEditedByRecipient(row))
    }

    @Test
    fun recipientPlayModeChoiceSurvivesAPullThatCarriesNoVoice() {
        // 실제 증상(2026-08-17): 가족 알람은 message_id 가 없어 remote 에 음성이 없다.
        // 수신자가 자기 목소리로 바꿔 저장해도, 재구성이 돌면 ALARM_ONLY 로 되돌아갔다.
        // 이제는 재구성 자체가 돌지 않아야 한다.
        val edited = alarm(enabled = true, origin = AlarmOrigins.RECEIVED_REMOTE).copy(
            playMode = AlarmPlayModes.VOICE_ONLY,
            audioCacheKey = "my-own-voice",
            updatedAtMillis = 2_000L,
        )
        assertTrue(locallyEditedByRecipient(edited))
        // 대조군 — 손대지 않은 행이라면 서버본으로 재구성된다(첫 수신·음성 재시도 경로).
        val untouched = edited.copy(updatedAtMillis = edited.lastSyncedAtMillis!!)
        assertFalse(locallyEditedByRecipient(untouched))
        val rebuilt = buildReceivedAlarmRow(
            context = context,
            remote = remote(),
            existing = untouched,
            cachedAudio = null,
            currentUserId = "recipient",
        )
        assertEquals(AlarmPlayModes.ALARM_ONLY, rebuilt!!.playMode)
    }

    private fun remote(): RemoteAlarm = RemoteAlarm(
        id = "remote-id",
        time = "07:30",
        repeatDays = emptyList(),
        isActive = true,
        snoozeMinutes = 5,
        senderName = "보낸 사람",
        isReceived = true,
    )

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
