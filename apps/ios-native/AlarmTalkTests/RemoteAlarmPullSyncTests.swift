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
