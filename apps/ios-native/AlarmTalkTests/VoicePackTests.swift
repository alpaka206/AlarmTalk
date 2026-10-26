import AVFoundation
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

    // MARK: - 개정 · 받기 경합 (코덱스 #960)

    private func detail(packID: String = "first-pack", revision: Int, clips: [VoicePackClip]) -> VoicePackSummary {
        VoicePackSummary(
            packId: packID, voiceId: packVoiceID, contentRevision: revision, speakerName: "화자", description: "",
            usageNote: "", language: "ko", categories: [], clipCount: clips.count, totalBytes: 1, preview: nil, clips: clips
        )
    }

    private func storeHolding(_ packs: [HeldVoicePack]) throws -> VoicePackStore {
        let defaults = isolatedDefaults()
        defaults.set(try JSONEncoder().encode(packs), forKey: VoicePackStore.storageKey(userID: "owner-1"))
        let store = VoicePackStore(defaults: defaults)
        store.activate(userID: "owner-1")
        return store
    }

    func test_새_개정이_오면_다_받을_때까지_받는_중이고_실패해도_받음으로_남지_않는다() throws {
        let store = try storeHolding([held()])
        let start = try XCTUnwrap(store.heldPack(packID: "first-pack"))
        XCTAssertEqual(start.state, .ready)

        let revised = try XCTUnwrap(store.adoptRevisedDetail(detail(revision: 4, clips: [clip("new-clip")]), fetchedFor: start, alarmStore: makeStore()))
        XCTAssertEqual(revised.state, .downloading, "클립 목록이 새로 왔으면 다시 받는 중이다")
        XCTAssertEqual(store.heldPack(packID: "first-pack")?.contentRevision, 4)
        XCTAssertTrue(VoicePacks.editorEntries(held: store.held, keepingVoiceID: nil).profiles.isEmpty,
                      "덜 받은 개정을 새로 고르는 목록에 내보이지 않는다")

        store.finishDownload(revised, complete: false)
        XCTAssertEqual(store.heldPack(packID: "first-pack")?.state, .downloading, "새 클립 받기가 실패하면 '받음' 이 아니다")
        XCTAssertTrue(store.failedPackIDs.contains("first-pack"))

        store.finishDownload(revised, complete: true)
        XCTAssertEqual(store.heldPack(packID: "first-pack")?.state, .ready)
        XCTAssertFalse(store.failedPackIDs.contains("first-pack"))
    }

    func test_새_개정에서_빠진_클립은_알람이_쓰지_않으면_지운다() throws {
        // 캐시 정리는 `pack_` 을 건너뛰고 지우기는 지금 목록만 지운다 — 개정 때 놓으면 영영 남는다(코덱스 #960).
        func cached(_ id: String) throws -> VoicePackClip {
            let data = Data("audio-\(id)".utf8)
            let c = clip(id, data: data)
            _ = try AudioCacheStore.cacheVoicePackClip(
                audio: VoicePackAudioResponse(
                    clipId: c.clipId, packId: "first-pack", audioBase64: data.base64EncodedString(),
                    audioFormat: "mp3", sha256: c.sha256, sizeBytes: c.sizeBytes
                ),
                expected: c,
                packID: "first-pack"
            )
            return c
        }
        let suffix = UUID().uuidString
        let released = try cached("gone-\(suffix)")
        let heldByAlarm = try cached("alarm-\(suffix)")
        let kept = try cached("kept-\(suffix)")
        let store = try storeHolding([held(clips: [released, heldByAlarm, kept])])
        let alarms = makeStore()
        var record = alarm(id: "p", voiceProfileId: packVoiceID)
        record.audioCacheKey = VoicePacks.cacheKey(clipID: heldByAlarm.clipId)
        alarms.upsert(record)
        let start = try XCTUnwrap(store.heldPack(packID: "first-pack"))

        XCTAssertNotNil(store.adoptRevisedDetail(detail(revision: 4, clips: [kept, clip("new-\(suffix)")]), fetchedFor: start, alarmStore: alarms))

        let cache = AudioCacheStore.shared
        XCTAssertNil(cache.cachedURL(for: VoicePacks.cacheKey(clipID: released.clipId)), "아무도 안 쓰는 옛 클립은 지운다")
        XCTAssertNotNil(cache.cachedURL(for: VoicePacks.cacheKey(clipID: heldByAlarm.clipId)), "알람이 물고 있으면 남긴다")
        XCTAssertNotNil(cache.cachedURL(for: VoicePacks.cacheKey(clipID: kept.clipId)), "새 개정에도 있는 클립은 그대로다")
        for c in [heldByAlarm, kept] { try? cache.deleteCachedAudio(cacheKey: VoicePacks.cacheKey(clipID: c.clipId)) }
    }

    func test_받는_중인_팩도_그_팩을_쓰는_알람의_편집기에는_남는다() {
        let downloading = held(state: .downloading)
        XCTAssertTrue(VoicePacks.editorEntries(held: [downloading], keepingVoiceID: nil).profiles.isEmpty)
        XCTAssertEqual(
            VoicePacks.editorEntries(held: [downloading], keepingVoiceID: packVoiceID).profiles.map(\.id), [packVoiceID],
            "빼면 편집기가 다른 목소리로 갈아 끼워 시각만 고쳐 저장해도 팩 목소리가 바뀐다"
        )
    }

    func test_개정_확인_중에_지운_팩은_되살리지_않는다() throws {
        let store = try storeHolding([held()])
        let start = try XCTUnwrap(store.heldPack(packID: "first-pack"))
        // 상세 요청이 도는 사이 사용자가 지운다.
        store.remove(packID: "first-pack", alarmStore: makeStore(), voiceStudio: VoiceStudioViewModel())

        XCTAssertNil(store.adoptRevisedDetail(detail(revision: 4, clips: [clip("new-clip")]), fetchedFor: start, alarmStore: makeStore()))
        store.finishDownload(start, complete: true)
        XCTAssertTrue(store.held.isEmpty, "지운 팩이 다시 생기면 또 받는다")
    }

    func test_개정_확인_중에_다른_받기가_개정을_바꿨으면_그쪽을_둔다() throws {
        let store = try storeHolding([held()])
        let start = try XCTUnwrap(store.heldPack(packID: "first-pack"))
        XCTAssertNotNil(store.adoptRevisedDetail(detail(revision: 5, clips: [clip("newest")]), fetchedFor: start, alarmStore: makeStore()))

        XCTAssertNil(store.adoptRevisedDetail(detail(revision: 4, clips: [clip("older")]), fetchedFor: start, alarmStore: makeStore()))
        XCTAssertEqual(store.heldPack(packID: "first-pack")?.contentRevision, 5)
        store.finishDownload(start, complete: true)
        XCTAssertEqual(store.heldPack(packID: "first-pack")?.state, .downloading, "앞 개정의 끝이 새 개정을 '받음' 으로 적지 않는다")
    }

    // MARK: - 목록 새로고침이 팩 선택을 지우지 않는다 (코덱스 #960)

    func test_받은_팩_목소리_선택은_서버_목록에_없어도_남는다() {
        let server = [systemVoiceIDPrefix + "000000000101"]
        XCTAssertTrue(VoiceStudioViewModel.selectionSurvivesRefresh(
            packVoiceID, serverProfileIDs: server, heldPackVoiceIDs: [packVoiceID]
        ))
        XCTAssertFalse(VoiceStudioViewModel.selectionSurvivesRefresh(
            packVoiceID, serverProfileIDs: server, heldPackVoiceIDs: []
        ), "받지 않은(지운) 팩 목소리는 남기지 않는다")
        XCTAssertFalse(VoiceStudioViewModel.selectionSurvivesRefresh(
            "deleted-clone", serverProfileIDs: server, heldPackVoiceIDs: ["deleted-clone"]
        ), "팩 대역이 아닌 id 는 서버 목록으로만 본다")
        XCTAssertTrue(VoiceStudioViewModel.selectionSurvivesRefresh(
            server[0], serverProfileIDs: server, heldPackVoiceIDs: []
        ))
    }

    // MARK: - 미리듣기는 한 번에 하나 (코덱스 #960)

    private func makeToneWAV() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pack-preview-\(UUID().uuidString).wav")
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false)!
        let file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ]
        )
        let frames = AVAudioFrameCount(44_100 * 3)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for i in 0..<Int(frames) { samples[i] = 0.1 * sinf(2 * .pi * 440 * Float(i) / 44_100) }
        try file.write(from: buffer)
        return url
    }

    func test_팩_샘플과_목소리_미리듣기는_서로를_멈춘다() throws {
        let url = try makeToneWAV()
        defer { try? FileManager.default.removeItem(at: url) }
        let packs = VoicePackStore(defaults: isolatedDefaults())
        let voice = VoiceStudioViewModel()
        var voiceFinished = 0
        voice.previewPlayer.onFinish = { voiceFinished += 1 }
        defer {
            packs.previewPlayer.stop()
            voice.previewPlayer.stop()
        }

        try voice.previewPlayer.play(url: url)
        XCTAssertTrue(voice.previewPlayer.isPlaying)
        try packs.previewPlayer.play(url: url)
        XCTAssertTrue(packs.previewPlayer.isPlaying)
        XCTAssertFalse(voice.previewPlayer.isPlaying, "팩 샘플을 틀면 기본·클론 미리듣기가 멈춘다")
        XCTAssertEqual(voiceFinished, 1, "끊긴 쪽의 '듣는 중' 표시가 내려가게 알린다")

        try voice.previewPlayer.play(url: url)
        XCTAssertFalse(packs.previewPlayer.isPlaying, "반대 방향도 멈춘다")
        XCTAssertTrue(voice.previewPlayer.isPlaying)
    }

    // MARK: - 알람 정리가 받은 팩의 클립을 지우지 않는다 (코덱스 #960)

    private func cachedPackClip() throws -> (clip: VoicePackClip, key: String) {
        let data = Data("pack-audio-\(UUID().uuidString)".utf8)
        let packClip = clip("pk-\(UUID().uuidString)", data: data)
        _ = try AudioCacheStore.cacheVoicePackClip(
            audio: VoicePackAudioResponse(
                clipId: packClip.clipId, packId: "first-pack", audioBase64: data.base64EncodedString(),
                audioFormat: "mp3", sha256: packClip.sha256, sizeBytes: packClip.sizeBytes
            ),
            expected: packClip,
            packID: "first-pack"
        )
        return (packClip, VoicePacks.cacheKey(clipID: packClip.clipId))
    }

    func test_팩_알람을_지워도_받은_팩의_클립은_남는다() async throws {
        let (packClip, key) = try cachedPackClip()
        let userID = "pack-delete-\(UUID().uuidString)"
        UserDefaults.standard.set(
            try JSONEncoder().encode([held(clips: [packClip])]),
            forKey: VoicePackStore.storageKey(userID: userID)
        )
        defer {
            UserDefaults.standard.removeObject(forKey: VoicePackStore.storageKey(userID: userID))
            try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: key)
        }
        XCTAssertTrue(VoicePackStore.heldClipCacheKeysOnDevice().contains(key))
        let store = makeStore()
        var record = alarm(id: "p", voiceProfileId: packVoiceID, owner: userID)
        record.audioCacheKey = key
        record.bucketClipKeys = [key]
        store.upsert(record)

        let deleted = await AlarmKitViewModel().cancel(record: record, store: store)
        XCTAssertTrue(deleted)
        XCTAssertNil(store.record(id: "p"))
        XCTAssertNotNil(AudioCacheStore.shared.cachedURL(for: key), "지우면 '받음' 인 팩으로 오프라인 저장이 실패한다")
    }

    func test_팩을_지워도_다른_계정이_받아_둔_클립은_남는다() throws {
        let (packClip, key) = try cachedPackClip()
        defer { try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: key) }
        let defaults = isolatedDefaults()
        let pack = held(clips: [packClip])
        for userID in ["owner-1", "owner-2"] {
            defaults.set(try JSONEncoder().encode([pack]), forKey: VoicePackStore.storageKey(userID: userID))
        }
        let store = VoicePackStore(defaults: defaults)
        let alarms = makeStore()
        store.activate(userID: "owner-1")
        store.remove(packID: "first-pack", alarmStore: alarms, voiceStudio: VoiceStudioViewModel())
        XCTAssertTrue(store.held.isEmpty)
        XCTAssertNotNil(AudioCacheStore.shared.cachedURL(for: key), "다른 계정의 목록이 아직 쥐고 있다")

        store.activate(userID: "owner-2")
        store.remove(packID: "first-pack", alarmStore: alarms, voiceStudio: VoiceStudioViewModel())
        XCTAssertNil(AudioCacheStore.shared.cachedURL(for: key), "아무 계정도 쥐지 않으면 놓는 쪽이 지운다")
    }

    // MARK: - 다 받지 못한 팩은 지우지 않고 다시 받는다 (코덱스 #960)

    func test_못_받은_팩은_지우지_않고_다시_받기로_선다운로드를_깨운다() throws {
        let store = try storeHolding([held(state: .downloading)])
        var woke = 0
        store.wakePrefetch = { woke += 1 }
        let pack = try XCTUnwrap(store.heldPack(packID: "first-pack"))
        store.finishDownload(pack, complete: false)
        XCTAssertTrue(store.canRetryDownload(packID: "first-pack"))
        XCTAssertEqual(
            VoicePackStatusText.text(for: VoicePackRowModel(summary: nil, held: store.heldPack(packID: "first-pack")), store: store),
            String(localized: "받지 못했어요. 다시 시도해 주세요.")
        )

        store.retryDownload(packID: "first-pack")
        XCTAssertEqual(woke, 1, "기존 선다운로드를 깨운다")
        XCTAssertNotNil(store.heldPack(packID: "first-pack"), "팩을 지우지 않는다 — 지우면 그 팩 알람이 미나로 바뀐다")
        XCTAssertFalse(store.failedPackIDs.contains("first-pack"))
        XCTAssertFalse(store.canRetryDownload(packID: "first-pack"), "받는 동안에는 다시 받기를 감춘다")
    }

    func test_다_받은_팩과_게시가_끝난_팩은_다시_받기가_없다() throws {
        let store = try storeHolding([
            held(packID: "ready-pack"),
            held(packID: "gone-pack", state: .downloading, withdrawnUntil: Date(timeIntervalSinceNow: 3600)),
        ])
        XCTAssertFalse(store.canRetryDownload(packID: "ready-pack"))
        XCTAssertFalse(store.canRetryDownload(packID: "gone-pack"))
        XCTAssertFalse(store.canRetryDownload(packID: "missing-pack"))
    }
}
