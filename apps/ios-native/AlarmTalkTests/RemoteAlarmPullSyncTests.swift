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

    private func makeLocalOwned(remoteID: String) -> LocalAlarmRecord {
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
            speakerId: nil,
            messageId: "m1",
            messageText: "msg",
            category: nil,
            rawAudioUrl: nil,
            messageAudioUrl: "https://example.com/audio.m4a",
            rawAudioDurationMs: nil,
            targetUserId: targetUserID,
            senderUserId: senderUserID,
            senderName: "Other",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: false
        )
    }
}
