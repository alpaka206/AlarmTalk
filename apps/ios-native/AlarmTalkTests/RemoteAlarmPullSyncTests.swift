import XCTest
@testable import AlarmTalk

/// `RemoteAlarmPullSync` 의 충돌 정책 / 머지 / cascade 정책을 단위 검증.
///
/// 네트워크 layer 는 `AlarmTalkAPI` final class 의 직접 mock 이 까다로워
/// 본 테스트는 store 기반 정책 메서드에 집중한다. 통합 흐름은 simulator 의
/// end-to-end 빌드로 별도 검증한다.
@MainActor
final class RemoteAlarmPullSyncTests: XCTestCase {

    // MARK: - shouldApplyRemote

    func test_shouldApplyRemote_localDirty_returnsFalse() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.dirty.rawValue
        existing.lastSyncedAtMillis = 100

        var mapped = existing
        mapped.lastSyncedAtMillis = 200  // 서버가 더 최신이라도

        XCTAssertFalse(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_shouldApplyRemote_serverFresher_returnsTrue() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.synced.rawValue
        existing.lastSyncedAtMillis = 100

        var mapped = existing
        mapped.lastSyncedAtMillis = 200

        XCTAssertTrue(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_shouldApplyRemote_localFresher_returnsFalse() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.synced.rawValue
        existing.lastSyncedAtMillis = 500

        var mapped = existing
        mapped.lastSyncedAtMillis = 100

        XCTAssertFalse(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    // MARK: - received remote filter

    func test_isReceivedRemoteCandidate_targetMeSenderOther_returnsTrue() {
        let remote = makeRemote(targetUserID: "me", senderUserID: "other")

        XCTAssertTrue(RemoteAlarmPullSync.isReceivedRemoteCandidate(remote, currentUserID: "me"))
    }

    func test_isReceivedRemoteCandidate_senderIsMe_returnsFalse() {
        let remote = makeRemote(targetUserID: "me", senderUserID: "me")

        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(remote, currentUserID: "me"))
    }

    func test_isReceivedRemoteCandidate_missingTargetOrSender_returnsFalse() {
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: nil, senderUserID: "other"),
            currentUserID: "me"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: "me", senderUserID: nil),
            currentUserID: "me"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: "someone-else", senderUserID: "other"),
            currentUserID: "me"
        ))
    }

    // MARK: - merge

    func test_merge_preservesLocalIdentityAndCounters() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.id = "local-id"
        existing.alarmKitID = "kit-id"
        existing.snoozeCount = 3
        existing.snoozeRepeatLimit = SnoozeRepeatLimit.five.rawValue
        existing.voiceVolumePercent = 64
        existing.holidayOff = true
        existing.alarmVolumePercent = 70
        existing.alarmSoundUri = "file:///x.wav"
        existing.alarmSoundLabel = "custom"
        existing.createdAtMillis = 12345

        var mapped = makeLocalOwned(remoteID: "r1")
        mapped.id = "another-id"
        mapped.alarmKitID = nil
        mapped.snoozeCount = 0
        mapped.snoozeRepeatLimit = SnoozeRepeatLimit.three.rawValue
        mapped.voiceVolumePercent = 100
        mapped.holidayOff = false
        mapped.alarmVolumePercent = 100
        mapped.alarmSoundUri = nil
        mapped.alarmSoundLabel = nil
        mapped.createdAtMillis = 99999
        mapped.label = "remote-label"

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.id, "local-id")
        XCTAssertEqual(merged.alarmKitID, "kit-id")
        XCTAssertEqual(merged.snoozeCount, 3)
        XCTAssertEqual(merged.snoozeRepeatLimit, SnoozeRepeatLimit.five.rawValue)
        XCTAssertEqual(merged.voiceVolumePercent, 64)
        XCTAssertTrue(merged.holidayOff)
        XCTAssertEqual(merged.alarmVolumePercent, 70)
        XCTAssertEqual(merged.alarmSoundUri, "file:///x.wav")
        XCTAssertEqual(merged.alarmSoundLabel, "custom")
        XCTAssertEqual(merged.createdAtMillis, 12345)
        // 서버 권위 필드는 mapped 가 이긴다.
        XCTAssertEqual(merged.label, "remote-label")
    }

    func test_merge_receivedRemote_respectsLocalDisabledIntent() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.enabled = false  // 사용자가 끔

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.enabled = true     // 서버는 active

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertFalse(merged.enabled)
        XCTAssertEqual(merged.runtimeStateEnum, .disabled)
    }

    func test_merge_localOwned_doesNotForceDisabled() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.enabled = false

        var mapped = makeLocalOwned(remoteID: "r1")
        mapped.enabled = true

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        // localOwned 는 사용자 disable 의도 보존 규칙이 적용되지 않으므로 서버 응답을 그대로.
        XCTAssertTrue(merged.enabled)
    }

    // MARK: - remote audio fallback

    func test_withoutUnavailableRemoteAudio_downgradesToAlarmOnly() {
        var record = makeReceivedRemote(remoteID: "r1")
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.localAudioUri = "remote-message-m1.m4a"
        record.audioCacheKey = "remote-message-m1"
        record.rawAudioUri = "r2://tts/m1.m4a"
        record.voiceSource = VoiceSource.serverTts.rawValue
        record.voiceProfileId = "voice-1"
        record.voiceText = "wake up"
        record.voiceCategory = "custom"
        record.voiceLanguage = "ko"
        record.voiceRandomPrompt = true
        record.voiceRandomContext = "weather"
        record.voiceWeatherCountry = "KR"
        record.voiceWeatherCity = "Seoul"
        record.voiceFortuneGender = "female"
        record.voiceFortuneBirthDate = "2000-01-01"
        record.voiceFortuneBirthTime = "07:30"
        record.ttsMessageId = "m1"

        let sanitized = RemoteAlarmPullSync.withoutUnavailableRemoteAudio(record)

        XCTAssertEqual(sanitized.playModeEnum, .alarmOnly)
        XCTAssertNil(sanitized.localAudioUri)
        XCTAssertNil(sanitized.audioCacheKey)
        XCTAssertNil(sanitized.rawAudioUri)
        XCTAssertEqual(sanitized.voiceSourceEnum, .localAudio)
        XCTAssertNil(sanitized.voiceProfileId)
        XCTAssertNil(sanitized.voiceText)
        XCTAssertNil(sanitized.voiceCategory)
        XCTAssertNil(sanitized.voiceLanguage)
        XCTAssertFalse(sanitized.voiceRandomPrompt)
        XCTAssertNil(sanitized.voiceRandomContext)
        XCTAssertNil(sanitized.voiceWeatherCountry)
        XCTAssertNil(sanitized.voiceWeatherCity)
        XCTAssertNil(sanitized.voiceFortuneGender)
        XCTAssertNil(sanitized.voiceFortuneBirthDate)
        XCTAssertNil(sanitized.voiceFortuneBirthTime)
        XCTAssertNil(sanitized.ttsMessageId)
    }

    // MARK: - Helpers

    // MARK: - 편집 커밋이 sync 필드를 되돌리지 않는다

    /// 편집기는 화면 진입 시점의 스냅샷으로 전체 행을 덮는다. 그 사이에 push 가
    /// `remoteAlarmId` 를 새겼다면 편집 커밋이 그걸 **nil 로 되돌리면 안 된다** —
    /// 되돌리면 다음 push 가 같은 알람을 또 create 해 서버에 두 행이 생긴다.
    @MainActor
    func test_upsertPreservingServerSyncFields_keepsRemoteIdSetDuringEdit() {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("upsert-preserve-\(UUID().uuidString).json")
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        defer { try? FileManager.default.removeItem(at: url) }
        var record = makeLocalOwned(remoteID: nil)
        record.syncState = AlarmSyncState.localOnly.rawValue
        store.upsert(record)

        // 편집 중 push 가 끼어들어 remoteAlarmId 를 새긴다.
        store.markRemote(
            localID: record.id,
            remoteID: "remote-new",
            lastSyncedAtMillis: 777,
            syncState: .synced
        )

        // 편집기가 들고 있던 **옛 스냅샷**으로 커밋한다.
        var stale = record
        stale.label = "사용자가 고친 라벨"
        let committed = store.upsertPreservingServerSyncFields(stale)

        XCTAssertEqual(committed.label, "사용자가 고친 라벨", "사용자 편집은 반영된다")
        XCTAssertEqual(committed.remoteAlarmId, "remote-new", "push 가 새긴 값이 살아남아야 한다")
        XCTAssertEqual(committed.lastSyncedAtMillis, 777)
        // remoteAlarmId 가 있으므로 편집분은 dirty 여야 다음 push 가 update 로 간다.
        XCTAssertEqual(committed.syncState, AlarmSyncState.dirty.rawValue)
    }

    // MARK: - 받은 알람 소유권 (받은 뒤부터는 받는 사람 것)

    /// **수신자가 고친 값은 다음 pull 이 되돌리면 안 된다.**
    ///
    /// 예전 구현은 '무엇을 보존할지 세는' 방식이라 시각·요일·스누즈 간격·스누즈 토글·
    /// 발화시각을 빠뜨렸다. 수신자가 07:00 → 06:30 으로 고쳐도 다음 pull 에 되돌아갔다 —
    /// 고쳐 뒀다고 믿고 그 시각에 못 일어난다. 안드로이드도 같은 버그를 네 번 겪고
    /// 세는 방식을 폐기했다.
    ///
    /// ⚠ 이 테스트에 필드를 계속 더해라. 편집 가능한 필드가 늘 때 같이 늘어야 한다.
    func test_merge_receivedRemote_recipientOwnsSchedule() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.hour = 6
        existing.minute = 30
        existing.repeatDaysMask = 0b0000_0010
        existing.fireAtMillis = 111_111
        existing.snoozeEnabled = false
        existing.snoozeMinutes = 12
        existing.holidayOff = true

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.hour = 7          // 서버가 보낸 원래 시각
        mapped.minute = 0
        mapped.repeatDaysMask = 0b0111_1110
        mapped.fireAtMillis = 999_999
        mapped.snoozeEnabled = true
        mapped.snoozeMinutes = 5
        mapped.holidayOff = false

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.hour, 6, "수신자가 고친 시각이 이긴다")
        XCTAssertEqual(merged.minute, 30)
        XCTAssertEqual(merged.repeatDaysMask, 0b0000_0010)
        XCTAssertEqual(merged.fireAtMillis, 111_111)
        XCTAssertFalse(merged.snoozeEnabled, "스누즈 토글도 수신자 것이다")
        XCTAssertEqual(merged.snoozeMinutes, 12)
        XCTAssertTrue(merged.holidayOff, "놓치면 공휴일에 울린다")
    }

    /// 스누즈 회차는 **한 묶음으로** 지킨다. 상태만 지키고 마감을 갈아 끼우면
    /// '5분 뒤 다시 울림' 이 사라져 다음 정규 회차로 밀린다.
    func test_merge_keepsSnoozeEpisodeIntact() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.state = AlarmRuntimeState.snoozed.rawValue
        existing.fireAtMillis = 555_555
        existing.snoozeCount = 2
        existing.enabled = true

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.fireAtMillis = 999_999
        mapped.snoozeCount = 0
        mapped.enabled = true

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.state, AlarmRuntimeState.snoozed.rawValue)
        XCTAssertEqual(merged.fireAtMillis, 555_555, "스누즈 마감이 유지돼야 한다")
        XCTAssertEqual(merged.snoozeCount, 2)
    }

    /// 지금 울리는(또는 스누즈 중인) 행은 pull 이 아예 건드리지 않는다.
    /// 건드리면 `rescheduleReceivedRemote` 가 **울리는 중인 AlarmKit 알람을 취소**해
    /// 알람이 울리다 말고 조용해진다.
    func test_isInFlight_coversRingingAndSnoozed() {
        var ringing = makeReceivedRemote(remoteID: "r1")
        ringing.state = AlarmRuntimeState.ringing.rawValue
        XCTAssertTrue(RemoteAlarmPullSync.isInFlight(ringing))

        var snoozed = makeReceivedRemote(remoteID: "r2")
        snoozed.state = AlarmRuntimeState.snoozed.rawValue
        XCTAssertTrue(RemoteAlarmPullSync.isInFlight(snoozed))

        var armed = makeReceivedRemote(remoteID: "r3")
        armed.state = AlarmRuntimeState.armed.rawValue
        XCTAssertFalse(RemoteAlarmPullSync.isInFlight(armed))
    }

    // MARK: - 목소리 철회 (발신자 탈퇴)

    /// 대상은 '목소리가 있는 행' 이 아니라 **'발신자 음성을 든 행'** 이다.
    /// 서버는 철회 기록을 영구히 들고 있어서, 넓게 잡으면 수신자가 나중에 넣은 자기
    /// 목소리까지 매번 걷어낸다.
    func test_hasSenderVoice_onlyRemoteMessageCacheKey() {
        var senderVoice = makeReceivedRemote(remoteID: "r1")
        senderVoice.audioCacheKey = "remote-message-msg-1"
        XCTAssertTrue(RemoteAlarmPullSync.hasSenderVoice(senderVoice))

        // 수신자가 나중에 넣은 자기 목소리 — 키가 다르다. 걷어내면 안 된다.
        var ownVoice = makeReceivedRemote(remoteID: "r2")
        ownVoice.audioCacheKey = "a1b2c3d4e5"
        XCTAssertFalse(RemoteAlarmPullSync.hasSenderVoice(ownVoice))

        // 목소리가 아예 없는 행.
        var noVoice = makeReceivedRemote(remoteID: "r3")
        noVoice.audioCacheKey = nil
        noVoice.localAudioUri = nil
        XCTAssertFalse(RemoteAlarmPullSync.hasSenderVoice(noVoice))
    }

    /// 키 없이 파일 경로만 든 옛 행도 포함한다 — 지금 코드로는 안 만들어지지만,
    /// 그렇다고 단정하고 생체정보를 남겨 둘 수는 없다.
    func test_hasSenderVoice_legacyRowWithoutCacheKey() {
        var legacy = makeReceivedRemote(remoteID: "r4")
        legacy.audioCacheKey = nil
        legacy.localAudioUri = "file:///tmp/voice.m4a"
        XCTAssertTrue(RemoteAlarmPullSync.hasSenderVoice(legacy))
    }

    /// **목소리만 걷어내고 알람은 남긴다.** 복제 목소리는 발신자의 생체정보라 파기
    /// 대상이지만, 시각·요일은 수신자가 기대고 자는 자기 정보다 — 통째로 지우면
    /// 그날 못 일어난다.
    func test_withVoiceRevoked_stripsVoiceButKeepsSchedule() {
        var record = makeReceivedRemote(remoteID: "r5")
        record.label = "엄마가 보낸 알람"
        record.hour = 6
        record.minute = 40
        record.repeatDaysMask = 0b0111_1110
        record.enabled = true
        record.playMode = AlarmPlayMode.soundThenVoice.rawValue
        record.audioCacheKey = "remote-message-msg-9"
        record.localAudioUri = "file:///tmp/a.m4a"
        record.rawAudioUri = "https://example.com/a.mp3"
        record.voiceProfileId = "vp-mom"
        record.voiceListenerTitle = "우리 딸"
        record.voiceText = "일어나"
        record.voiceCategory = "morning"
        record.ttsMessageId = "msg-9"

        let revoked = RemoteAlarmPullSync.withVoiceRevoked(record)

        // 시각·요일·켜짐은 그대로 — 그날 못 일어나면 안 된다.
        XCTAssertEqual(revoked.hour, 6)
        XCTAssertEqual(revoked.minute, 40)
        XCTAssertEqual(revoked.repeatDaysMask, 0b0111_1110)
        XCTAssertTrue(revoked.enabled)
        XCTAssertEqual(revoked.id, record.id)
        XCTAssertEqual(revoked.remoteAlarmId, record.remoteAlarmId)

        // 목소리와 발신자 흔적은 전부 사라진다.
        XCTAssertEqual(revoked.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertNil(revoked.audioCacheKey)
        XCTAssertNil(revoked.localAudioUri)
        XCTAssertNil(revoked.rawAudioUri)
        XCTAssertNil(revoked.voiceProfileId)
        XCTAssertNil(revoked.ttsMessageId)
        XCTAssertNil(revoked.voiceText)
        XCTAssertNil(revoked.voiceCategory)
        // 보낸 사람 이름이 든 라벨·호칭도 파기 대상이다.
        XCTAssertNil(revoked.voiceListenerTitle)
        XCTAssertEqual(revoked.label, "알람")
        XCTAssertEqual(revoked.voiceSource, VoiceSource.localAudio.rawValue)
    }

    private func makeLocalOwned(remoteID: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: UUID().uuidString,
            label: "owned",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            remoteAlarmId: remoteID,
            lastSyncedAtMillis: now,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
    }

    private func makeReceivedRemote(remoteID: String) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: UUID().uuidString,
            label: "received",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            remoteAlarmId: remoteID,
            lastSyncedAtMillis: now,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.receivedRemote.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
    }

    private func makeRemote(targetUserID: String?, senderUserID: String?) -> RemoteAlarm {
        RemoteAlarm(
            id: "remote",
            time: "07:30",
            repeatDays: [1, 2, 3, 4, 5],
            isActive: true,
            snoozeMinutes: 5,
            mode: "tts",
            vibrationPattern: "default",
            wakeMode: "sound_then_voice",
            voiceProfileId: "vp",
            messageId: "m1",
            messageText: "msg",
            category: nil,
            messageAudioUrl: "https://example.com/audio.m4a",
            targetUserId: targetUserID,
            senderUserId: senderUserID,
            senderName: "Other",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: false
        )
    }
}
