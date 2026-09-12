import XCTest
@testable import AlarmTalk

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

    /// ⚠ **재생 방식만으로는 잠금 대상이 아니다**(2026-08-18 계약 수정).
    /// 예전에는 `voice-mode`(재생 방식만 목소리, 말할 자원은 전무)를 대상으로 기대했다 —
    /// 이 테스트가 **버그를 고정하고 있었다.** 그 판정 때문에 구독 이력이 0건인 실계정
    /// (`ronald@estsoft.com`)의 07:30 알람이 잠겨 서버에 `mode=sound-only` 로 박혔고,
    /// "무료 이용권으로 바뀌었어요" 모달이 앱을 켤 때마다 떴다. 근거는 안드로이드
    /// `AlarmRepository.lockPaidAlarmTalks` 의 `usesVoice` — **함께 고쳤다.**
    func test_paidAlarmTalksMirrorsAndroidFreePlanLockTargets() {
        let store = makeStore()
        let alarmOnly = makeAlarm(id: "alarm-only", audioCacheKey: nil)
        let voiceMode = makeAlarm(id: "voice-mode", audioCacheKey: nil, playMode: .voiceOnly)
        let localAudio = makeAlarm(id: "local-audio", audioCacheKey: nil, localAudioUri: "local.m4a")
        let rawAudio = makeAlarm(id: "raw-audio", audioCacheKey: nil, rawAudioUri: "r2://raw")
        let profile = makeAlarm(id: "profile", audioCacheKey: nil, voiceProfileId: "voice-1")
        let message = makeAlarm(id: "message", audioCacheKey: nil, ttsMessageId: "msg-1")

        [alarmOnly, voiceMode, localAudio, rawAudio, profile, message].forEach { store.upsert($0) }

        XCTAssertEqual(
            Set(store.paidAlarmTalks().map(\.id)),
            // `voice-mode` 는 빠진다 — 말할 자원이 없는 알람은 유료 기능을 쓰는 게 아니다.
            Set(["local-audio", "raw-audio", "profile", "message"])
        )
    }

    /// Android `AlarmRepository.deletePaidAlarmTalks` 의 `stockVoiceOnly` 보존 규칙 동일:
    /// 로컬/raw 음원이 없고 voiceProfileId 가 시스템 스톡 보이스면 무료 다운그레이드에서 보존한다.
    func test_paidAlarmTalksPreservesSystemStockVoiceOnlyAlarms() {
        let store = makeStore()
        let stockOnly = makeAlarm(
            id: "stock-only",
            audioCacheKey: nil,
            playMode: .voiceOnly,
            voiceProfileId: "\(systemVoiceIDPrefix)000000000001"
        )
        let stockWithLocalAudio = makeAlarm(
            id: "stock-with-local-audio",
            audioCacheKey: nil,
            playMode: .voiceOnly,
            localAudioUri: "local.m4a",
            voiceProfileId: "\(systemVoiceIDPrefix)000000000002"
        )
        let stockWithRawAudio = makeAlarm(
            id: "stock-with-raw-audio",
            audioCacheKey: nil,
            playMode: .voiceOnly,
            rawAudioUri: "r2://raw",
            voiceProfileId: "\(systemVoiceIDPrefix)000000000003"
        )

        [stockOnly, stockWithLocalAudio, stockWithRawAudio].forEach { store.upsert($0) }

        // stockOnly 만 보존(삭제 대상 제외), 음원이 붙은 둘은 여전히 삭제 대상.
        XCTAssertEqual(
            Set(store.paidAlarmTalks().map(\.id)),
            Set(["stock-with-local-audio", "stock-with-raw-audio"])
        )
    }

    /// 스톡 클립 알람은 스테이징된 `stock_<id>` 캐시 파일이 있어 localAudioUri 가
    /// NON-blank 다. 그래도 `audioCacheKey` 의 `stock_` prefix + 시스템 voiceProfileId 면
    /// 무료 다운그레이드에서 보존한다(P1). 비-시스템 server_tts 가 우연히 stock 모양 key 를
    /// 가져도 보존되지 않아야 한다.
    func test_paidAlarmTalksPreservesStockClipAlarmsWithStagedCache() {
        let store = makeStore()
        // 실제 스톡 저장 시그니처: stock_ cacheKey + NON-blank localAudioUri + 시스템 보이스.
        let stockClip = makeAlarm(
            id: "stock-clip",
            audioCacheKey: "stock_msg-1",
            voiceProfileId: "\(systemVoiceIDPrefix)000000000010",
            ttsMessageId: "msg-1"
        )
        // 같은 stock 모양 key 지만 비-시스템 voiceProfileId — 보존되면 안 됨(여전히 삭제 대상).
        let fakeStock = makeAlarm(
            id: "fake-stock",
            audioCacheKey: "stock_msg-2",
            voiceProfileId: "voice-not-system",
            ttsMessageId: "msg-2"
        )

        [stockClip, fakeStock].forEach { store.upsert($0) }

        XCTAssertFalse(store.paidAlarmTalks().contains { $0.id == "stock-clip" })
        XCTAssertTrue(store.paidAlarmTalks().contains { $0.id == "fake-stock" })
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
