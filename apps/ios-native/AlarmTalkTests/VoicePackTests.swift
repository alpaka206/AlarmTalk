import XCTest
@testable import AlarmTalk

/// 추가 음성팩(`docs/spec/voice-packs.md`) — iOS 쪽 판정.
///  - 팩 목소리 대역·캐시 키 `pack_`(기본 목소리 `stock_` 와 따로)
///  - 해시·크기가 상세와 다르면 캐시에 넣지 않는다
///  - 받은 팩 목록은 계정마다 따로다
///  - 게시 끝: 기한 전에는 유지, 기한 뒤에는 대체 대상 · 목록에 아예 없는 팩은 건드리지 않는다
///  - 서버 알람 사본에 팩 목소리·클립 id 를 싣지 않는다
///  - 접근권 대조(`GET /voice` 에 없음)가 팩 알람을 강등하지 않는다
///  - 편집기 목록: 게시 끝난 팩은 빠지고, 지금 여는 알람이 쓰는 팩은 남는다
///  - 지우기·기한 뒤 대체: 그 팩 알람은 미나로 바뀌고 목록에서 빠진다
@MainActor
final class VoicePackTests: XCTestCase {

    private let packVoiceID = voicePackVoiceIDPrefix + "0000000000aa"

    private func clip(_ id: String, category: String = "cheer", variant: Int = 0, data: Data = Data("audio".utf8)) -> VoicePackClip {
        VoicePackClip(
            clipId: id,
            category: category,
            language: "ko",
            variant: variant,
            text: "\(category) \(variant)",
            sha256: VoicePacks.sha256Hex(data),
            sizeBytes: data.count,
            audioFormat: "mp3"
        )
    }

    private func held(
        packID: String = "first-pack",
        state: HeldVoicePack.State = .ready,
        withdrawnUntil: Date? = nil,
        clips: [VoicePackClip]? = nil
    ) -> HeldVoicePack {
        HeldVoicePack(
            packId: packID,
            voiceId: packVoiceID,
            speakerName: "화자",
            language: "ko",
            description: "",
            usageNote: "",
            contentRevision: 3,
            latestRevision: 3,
            clips: clips ?? [clip(UUID().uuidString)],
            state: state,
            previewClipId: nil,
            withdrawnPlaybackUntil: withdrawnUntil
        )
    }

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("voicepack-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(id: String, voiceProfileId: String?, owner: String? = "owner-1") -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: id,
            label: "아침",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceSource = VoiceSource.ttsProfile.rawValue
        record.voiceProfileId = voiceProfileId
        record.ownerUserId = owner
        return record
    }

    private func isolatedDefaults() -> UserDefaults {
        UserDefaults(suiteName: "voicepack-tests-\(UUID().uuidString)")!
    }

    // MARK: - 대역·캐시 키

    func test_팩_목소리_대역은_기본_목소리와_겹치지_않는다() {
        XCTAssertTrue(isVoicePackVoiceID(packVoiceID))
        XCTAssertFalse(isSystemVoiceId(packVoiceID))
        XCTAssertFalse(isVoicePackVoiceID(systemVoiceIDPrefix + "000000000102"))
        XCTAssertTrue(isFreeFixedVoiceID(packVoiceID))
        XCTAssertTrue(isFreeFixedVoiceID(systemVoiceIDPrefix + "000000000102"))
        XCTAssertFalse(isFreeFixedVoiceID("clone-1"))
    }

    func test_팩_클립_캐시_키는_pack_이다() {
        let pack = held(clips: [clip("c-1")])
        XCTAssertEqual(pack.stockClips.first?.cacheKey, "pack_c-1")
        XCTAssertTrue(AudioCacheStore.isFixedClipCacheKey("pack_c-1"))
        XCTAssertTrue(AudioCacheStore.isFixedClipCacheKey("stock_m-1"))
        XCTAssertFalse(AudioCacheStore.isFixedClipCacheKey("abc123"))
        let system = StockClip(messageId: "m-1", voiceProfileId: systemVoiceIDPrefix + "000000000101", text: "")
        XCTAssertEqual(system.cacheKey, "stock_m-1")
        XCTAssertEqual(VoicePacks.packID(fromIdentity: pack.stockClips.first?.audioUrl), "first-pack")
    }

    // MARK: - 해시·크기

    func test_해시나_크기가_다르면_캐시에_넣지_않는다() throws {
        let data = Data("real-audio".utf8)
        let expected = clip("c-\(UUID().uuidString)", data: data)
        let tampered = VoicePackAudioResponse(
            clipId: expected.clipId,
            packId: "first-pack",
            audioBase64: Data("other-audio".utf8).base64EncodedString(),
            audioFormat: "mp3",
            sha256: expected.sha256,
            sizeBytes: expected.sizeBytes
        )
        XCTAssertThrowsError(try AudioCacheStore.cacheVoicePackClip(audio: tampered, expected: expected, packID: "first-pack")) { error in
            guard case AudioCacheError.integrityMismatch = error else { return XCTFail("\(error)") }
        }
        XCTAssertNil(AudioCacheStore.shared.cachedURL(for: VoicePacks.cacheKey(clipID: expected.clipId)))
        XCTAssertTrue(VoicePacks.bytesMatch(data, sha256: expected.sha256, sizeBytes: data.count))
        XCTAssertFalse(VoicePacks.bytesMatch(data, sha256: expected.sha256, sizeBytes: data.count + 1))
    }

    // MARK: - 계정별 목록

    func test_받은_팩_목록은_계정마다_따로다() throws {
        let defaults = isolatedDefaults()
        let store = VoicePackStore(defaults: defaults)
        store.activate(userID: "user-a")
        XCTAssertTrue(store.held.isEmpty)
        let data = try JSONEncoder().encode([held()])
        defaults.set(data, forKey: VoicePackStore.storageKey(userID: "user-a"))
        store.activate(userID: nil)
        XCTAssertTrue(store.held.isEmpty)
        store.activate(userID: "user-a")
        XCTAssertEqual(store.held.map(\.packId), ["first-pack"])
        store.activate(userID: "user-b")
        XCTAssertTrue(store.held.isEmpty, "다른 계정의 팩이 보이면 안 된다")
    }

    // MARK: - 게시 끝

    func test_카탈로그의_withdrawn_은_기한을_적고_목록에_없는_팩은_건드리지_않는다() {
        let until = Date(timeIntervalSinceNow: 3 * 86_400)
        let iso = ISO8601DateFormatter().string(from: until)
        let other = held(packID: "hidden-pack")
        let response = VoicePackListResponse(
            packs: [],
            withdrawn: [VoicePackWithdrawal(packId: "first-pack", voiceId: packVoiceID, playbackUntil: iso)]
        )
        let next = VoicePacks.applyCatalog(response, to: [held(), other])
        XCTAssertEqual(next[0].withdrawnPlaybackUntil.map { Int($0.timeIntervalSince1970) }, Int(until.timeIntervalSince1970))
        XCTAssertNil(next[1].withdrawnPlaybackUntil, "목록에 아예 없는 팩(빌드·지역)은 그대로 둔다")
        // 기한 전에는 유지, 뒤에는 대체 대상.
        XCTAssertFalse(next[0].isExpired(now: Date()))
        XCTAssertTrue(next[0].isExpired(now: until.addingTimeInterval(1)))
        // 다시 게시되면 기한을 지우고 최신 개정을 적는다.
        let republished = VoicePackListResponse(
            packs: [VoicePackSummary(
                packId: "first-pack", voiceId: packVoiceID, contentRevision: 5, speakerName: "화자", description: "",
                usageNote: "", language: "ko", categories: [], clipCount: 1, totalBytes: 1, preview: nil, clips: nil
            )],
            withdrawn: []
        )
        let again = VoicePacks.applyCatalog(republished, to: next)
        XCTAssertNil(again[0].withdrawnPlaybackUntil)
        XCTAssertEqual(again[0].latestRevision, 5)
    }

    func test_기한이_지나면_팩_알람은_미나로_바뀌고_목록에서_빠진다() throws {
        let defaults = isolatedDefaults()
        let packs = VoicePackStore(defaults: defaults)
        defaults.set(
            try JSONEncoder().encode([held(withdrawnUntil: Date(timeIntervalSinceNow: -60))]),
            forKey: VoicePackStore.storageKey(userID: "owner-1")
        )
        packs.activate(userID: "owner-1")
        let alarms = makeStore()
        alarms.upsert(alarm(id: "p", voiceProfileId: packVoiceID))
        alarms.upsert(alarm(id: "other", voiceProfileId: packVoiceID, owner: "owner-2"))
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(packs.retireExpired(alarmStore: alarms, voiceStudio: voice), 1)
        XCTAssertEqual(alarms.record(id: "p")?.voiceProfileId, substituteSystemVoiceID)
        XCTAssertNotEqual(alarms.record(id: "p")?.playMode, AlarmPlayMode.alarmOnly.rawValue, "곧바로 무음·알람음으로 내리지 않는다")
        XCTAssertEqual(alarms.record(id: "other")?.voiceProfileId, packVoiceID, "다른 계정의 알람은 그 계정이 대체한다")
        XCTAssertTrue(packs.held.isEmpty)
    }

    func test_기한_전에는_대체하지_않는다() throws {
        let defaults = isolatedDefaults()
        let packs = VoicePackStore(defaults: defaults)
        defaults.set(
            try JSONEncoder().encode([held(withdrawnUntil: Date(timeIntervalSinceNow: 3600))]),
            forKey: VoicePackStore.storageKey(userID: "owner-1")
        )
        packs.activate(userID: "owner-1")
        let alarms = makeStore()
        alarms.upsert(alarm(id: "p", voiceProfileId: packVoiceID))

        XCTAssertEqual(packs.retireExpired(alarmStore: alarms, voiceStudio: VoiceStudioViewModel()), 0)
        XCTAssertEqual(alarms.record(id: "p")?.voiceProfileId, packVoiceID)
        XCTAssertEqual(packs.held.count, 1)
    }

    // MARK: - 서버 사본 · 접근권 · 무료

    func test_서버_사본에_팩_목소리와_클립_id_를_싣지_않는다() {
        var local = alarm(id: "p", voiceProfileId: packVoiceID)
        local.ttsMessageId = "clip-1"
        local.bucketId = "cheer"
        let req = RemoteAlarmMapper.toRemoteRequest(local)
        XCTAssertNil(req.voiceProfileId)
        XCTAssertNil(req.messageId)
        XCTAssertEqual(req.mode, "sound-only")
        XCTAssertEqual(req.bucketId, "cheer")
        XCTAssertTrue(req.clearsMissingVoiceReferences)
    }

    func test_접근권_대조가_팩_알람을_강등하지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "p", voiceProfileId: packVoiceID))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests(profileIDs: [])
        XCTAssertEqual(voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"), 0)
        XCTAssertEqual(store.record(id: "p")?.voiceProfileId, packVoiceID)
    }

    func test_팩_알람은_무료다() {
        var record = alarm(id: "p", voiceProfileId: packVoiceID)
        record.audioCacheKey = "pack_clip-1"
        record.localAudioUri = "clip-1.mp3"
        XCTAssertTrue(PaidVoiceGate.usesFreeSystemVoice(record))
        XCTAssertFalse(record.isPaidVoiceForDowngrade)
        XCTAssertTrue(record.isStockVoiceClip)
    }

    func test_언어_재바인딩은_팩_알람을_묶지_않는다() {
        var record = alarm(id: "p", voiceProfileId: packVoiceID)
        record.bucketId = "cheer"
        record.voiceLanguage = "ja"
        record.bucketClipKeys = ["pack_clip-1"]
        XCTAssertFalse(StockClipLanguageRebinder.needsRebind(record: record, language: "ko", liveKeys: []))
    }

    // MARK: - 편집기 목록

    func test_편집기_목록은_게시_끝난_팩을_빼고_지금_알람의_팩은_남긴다() {
        let live = held(packID: "live-pack")
        var gone = held(packID: "gone-pack", withdrawnUntil: Date(timeIntervalSinceNow: 3600))
        gone.voiceId = voicePackVoiceIDPrefix + "0000000000bb"
        let downloading = held(packID: "half-pack", state: .downloading)

        let fresh = VoicePacks.editorEntries(held: [live, gone, downloading], keepingVoiceID: nil)
        XCTAssertEqual(fresh.profiles.map(\.id), [live.voiceId])
        XCTAssertEqual(fresh.clips.map(\.voiceProfileId), [live.voiceId])
        XCTAssertEqual(fresh.profiles.first?.isSystem, true, "편집기에서는 기본 목소리처럼 다룬다")

        let editingGone = VoicePacks.editorEntries(held: [live, gone], keepingVoiceID: gone.voiceId)
        XCTAssertEqual(Set(editingGone.profiles.map(\.id)), [live.voiceId, gone.voiceId])
    }
}
