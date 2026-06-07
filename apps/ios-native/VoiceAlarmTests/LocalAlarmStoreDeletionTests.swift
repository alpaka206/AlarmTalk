import XCTest
@testable import VoiceAlarm

@MainActor
final class LocalAlarmStoreDeletionTests: XCTestCase {

    func test_deleteReturnsAudioCacheKeyOnlyAfterLastReferenceIsRemoved() {
        let store = makeStore()
        let first = makeAlarm(id: "first", audioCacheKey: "shared-key")
        let second = makeAlarm(id: "second", audioCacheKey: "shared-key")
        store.upsert(first)
        store.upsert(second)

        XCTAssertNil(store.delete(first))
        XCTAssertEqual(store.countByAudioCacheKey("shared-key"), 1)

        XCTAssertEqual(store.delete(second), "shared-key")
        XCTAssertEqual(store.countByAudioCacheKey("shared-key"), 0)
    }

    func test_deleteReturnsNilForMissingOrEmptyAudioCacheKey() {
        let store = makeStore()
        let alarm = makeAlarm(id: "empty-key", audioCacheKey: " ")
        store.upsert(alarm)

        XCTAssertNil(store.delete(alarm))
        XCTAssertNil(store.delete(makeAlarm(id: "missing", audioCacheKey: "unused")))
    }

    func test_deleteByIDReturnsReleasedAudioCacheKey() {
        let store = makeStore()
        let alarm = makeAlarm(id: "delete-by-id", audioCacheKey: "unique-key")
        store.upsert(alarm)

        XCTAssertEqual(store.deleteByID(alarm.id), "unique-key")
        XCTAssertNil(store.record(id: alarm.id))
    }

    func test_paidVoiceAlarmsMirrorsAndroidFreePlanLockTargets() {
        let store = makeStore()
        let alarmOnly = makeAlarm(id: "alarm-only", audioCacheKey: nil)
        let voiceMode = makeAlarm(id: "voice-mode", audioCacheKey: nil, playMode: .voiceOnly)
        let localAudio = makeAlarm(id: "local-audio", audioCacheKey: nil, localAudioUri: "local.m4a")
        let rawAudio = makeAlarm(id: "raw-audio", audioCacheKey: nil, rawAudioUri: "r2://raw")
        let profile = makeAlarm(id: "profile", audioCacheKey: nil, voiceProfileId: "voice-1")
        let message = makeAlarm(id: "message", audioCacheKey: nil, ttsMessageId: "msg-1")

        [alarmOnly, voiceMode, localAudio, rawAudio, profile, message].forEach { store.upsert($0) }

        XCTAssertEqual(
            Set(store.paidVoiceAlarms().map(\.id)),
            Set(["voice-mode", "local-audio", "raw-audio", "profile", "message"])
        )
    }

    private func makeStore() -> LocalAlarmStore {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        return LocalAlarmStore(storageURL: url, loadFromDisk: false)
    }

    private func makeAlarm(
        id: String,
        audioCacheKey: String?,
        playMode: AlarmPlayMode = .alarmOnly,
        localAudioUri: String? = nil,
        rawAudioUri: String? = nil,
        voiceProfileId: String? = nil,
        ttsMessageId: String? = nil
    ) -> LocalAlarmRecord {
        let resolvedPlayMode = audioCacheKey == nil ? playMode : .voiceOnly
        return LocalAlarmRecord(
            id: id,
            label: id,
            hour: 7,
            minute: 0,
            fireAtMillis: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000),
            playMode: resolvedPlayMode.rawValue,
            localAudioUri: localAudioUri ?? (audioCacheKey == nil ? nil : "\(id).m4a"),
            audioCacheKey: audioCacheKey,
            rawAudioUri: rawAudioUri,
            voiceProfileId: voiceProfileId,
            ttsMessageId: ttsMessageId
        )
    }
}
