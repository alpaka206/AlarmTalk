import XCTest
@testable import AlarmTalk

/// 받은 알람을 내 알람으로 바꾸는 두 단계 — 1단계 즉시 변환(`ReceivedAlarmConversion`)과 2단계 내 목소리로
/// 승격(`ReceivedAlarmPromotion`). 규칙은 `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」,
/// `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」. 안드로이드 짝은 Room 27→28 마이그레이션 테스트와
/// `data/FormerReceivedAlarms.kt` 의 판정 테스트다.
@MainActor
final class ReceivedAlarmConversionTests: XCTestCase {

    private let owner = "me"
    private let now: Int64 = 1_760_000_000_000

    // MARK: - 1단계: 즉시 변환

    /// 옛 앱이 남긴 JSON — 전달 세대 두 칸과 `received_remote` 가 그대로 있다.
    private let legacyJSON = """
    [
      {
        "id": "recv-1", "label": "민수님이 보낸 알람", "hour": 6, "minute": 40, "fireAtMillis": 1760000000000,
        "repeatDaysMask": 62, "holidayOff": true, "snoozeEnabled": true, "snoozeMinutes": 7,
        "playMode": "alarm_only", "preLockPlayMode": "voice_only",
        "voiceSource": "server_tts", "voiceProfileId": "sender-clone", "voiceListenerTitle": "우리 딸",
        "voiceText": "일어나", "voiceCategory": "custom", "voiceLanguage": "ko",
        "localAudioUri": "remote-message-m1.mp3", "audioCacheKey": "remote-message-m1",
        "rawAudioUri": "https://cdn.example/m1.mp3", "ttsMessageId": "m1", "bucketId": "weather",
        "bucketClipKeys": ["remote-message-m1"], "voiceRepeat": true, "voiceVolumePercent": 80,
        "remoteAlarmId": "srv-1", "lastSyncedAtMillis": 1759999000000,
        "remoteDeliveryVersion": "v2", "observedDeliveryVersion": "v2",
        "syncState": "synced", "origin": "received_remote", "alarmVolumePercent": 40,
        "enabled": true, "state": "armed", "createdAtMillis": 1759990000000, "updatedAtMillis": 1759999000000,
        "alarmKitID": "11111111-1111-1111-1111-111111111111",
        "scheduledSoundFingerprint": "voice:remote-message-m1", "ownerUserId": "me"
      },
      {
        "id": "own-1", "label": "알람", "hour": 7, "minute": 0, "fireAtMillis": 1760000000000,
        "playMode": "voice_only", "voiceSource": "tts_profile", "voiceProfileId": "my-clone",
        "syncState": "synced", "remoteAlarmId": "srv-own", "origin": "local_owned", "ownerUserId": "me"
      }
    ]
    """

    private func decodeLegacy() throws -> [LocalAlarmRecord] {
        try JSONDecoder().decode([LocalAlarmRecord].self, from: Data(legacyJSON.utf8))
    }

    func test_옛_받은_알람은_던지지_않고_읽혀_미나의_내_알람이_된다() throws {
        let loaded = try decodeLegacy()
        XCTAssertEqual(loaded.count, 2, "한 행 때문에 목록 전체를 버리면 안 된다")
        let own = try XCTUnwrap(loaded.first { $0.id == "own-1" })

        let outcome = ReceivedAlarmConversion.convert(loaded, nowMillis: now)
        XCTAssertEqual(outcome.converted.map(\.id), ["recv-1"])
        let converted = try XCTUnwrap(outcome.alarms.first { $0.id == "recv-1" })

        // 받은 사람이 기대는 값은 남는다.
        XCTAssertEqual(converted.hour, 6)
        XCTAssertEqual(converted.minute, 40)
        XCTAssertEqual(converted.repeatDaysMask, 62)
        XCTAssertTrue(converted.holidayOff)
        XCTAssertTrue(converted.enabled)
        XCTAssertEqual(converted.snoozeMinutes, 7)
        XCTAssertEqual(converted.alarmVolumePercent, 40)
        XCTAssertEqual(converted.voiceVolumePercent, 80)
        XCTAssertEqual(converted.ownerUserId, owner)
        // 재생 방식은 옛 잠금 표시의 원래 값이다.
        XCTAssertEqual(converted.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(converted.preLockPlayMode)
        // 목소리는 미나, 보낸 사람 흔적은 모두 비운다.
        XCTAssertEqual(converted.voiceSource, VoiceSource.ttsProfile.rawValue)
        XCTAssertEqual(converted.voiceProfileId, substituteSystemVoiceID)
        XCTAssertEqual(converted.label, LocalAlarmRecord.storedDefaultLabel)
        XCTAssertNil(converted.voiceListenerTitle)
        XCTAssertNil(converted.voiceText)
        XCTAssertNil(converted.voiceCategory)
        XCTAssertNil(converted.localAudioUri)
        XCTAssertNil(converted.audioCacheKey)
        XCTAssertNil(converted.rawAudioUri)
        XCTAssertNil(converted.ttsMessageId)
        XCTAssertNil(converted.bucketId)
        XCTAssertNil(converted.bucketClipKeys)
        // 서버의 받은 알람 행과 끊고, 아직 서버에 없는 새 내 알람으로 둔다.
        XCTAssertEqual(converted.origin, AlarmOrigin.localOwned.rawValue)
        XCTAssertNil(converted.remoteAlarmId)
        XCTAssertNil(converted.lastSyncedAtMillis)
        XCTAssertEqual(converted.syncState, AlarmSyncState.localOnly.rawValue)
        // 예약을 다시 걸게 한다(보낸 사람 목소리·이름이 든 옛 예약을 남기지 않는다).
        XCTAssertEqual(converted.scheduledSoundFingerprint, ReceivedAlarmConversion.staleScheduleFingerprint)
        XCTAssertTrue(ReceivedAlarmPromotion.isStillConverted(converted))
        // 내 알람은 그대로다.
        XCTAssertEqual(outcome.alarms.first { $0.id == "own-1" }, own)
        // 보낸 사람 오디오는 아무도 안 가리키게 됐으니 지운다.
        XCTAssertEqual(outcome.releasedSenderAudioKeys, ["remote-message-m1"])
    }

    func test_다른_알람이_같은_보낸_사람_오디오를_쓰면_파일을_남긴다() throws {
        var loaded = try decodeLegacy()
        loaded[1].audioCacheKey = "remote-message-m1"
        let outcome = ReceivedAlarmConversion.convert(loaded, nowMillis: now)
        XCTAssertEqual(outcome.converted.count, 1)
        XCTAssertTrue(outcome.releasedSenderAudioKeys.isEmpty)
    }

    func test_받은_알람이_없으면_목록을_그대로_돌려준다() throws {
        let own = try decodeLegacy().filter { $0.id == "own-1" }
        let outcome = ReceivedAlarmConversion.convert(own, nowMillis: now)
        XCTAssertEqual(outcome.alarms, own)
        XCTAssertTrue(outcome.converted.isEmpty)
        XCTAssertTrue(outcome.releasedSenderAudioKeys.isEmpty)
    }

    func test_저장소는_읽자마자_바꾸고_곧바로_디스크에_앉힌다() async throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("received-conversion-\(UUID().uuidString).json")
        try Data(legacyJSON.utf8).write(to: url)
        ReceivedAlarmPromotionStore().clear(userID: owner)
        defer {
            try? FileManager.default.removeItem(at: url)
            ReceivedAlarmPromotionStore().clear(userID: owner)
        }

        let store = LocalAlarmStore(storageURL: url)
        await store.waitUntilLoadedFromDisk(timeout: 5)
        XCTAssertTrue(store.hasLoadedFromDisk)
        XCTAssertEqual(store.record(id: "recv-1")?.origin, AlarmOrigin.localOwned.rawValue)
        XCTAssertFalse(store.alarms.contains { $0.origin == ReceivedAlarmConversion.legacyReceivedOrigin })

        let onDisk = try JSONDecoder().decode([LocalAlarmRecord].self, from: Data(contentsOf: url))
        XCTAssertEqual(onDisk.first { $0.id == "recv-1" }?.origin, AlarmOrigin.localOwned.rawValue)
        XCTAssertEqual(onDisk.first { $0.id == "recv-1" }?.voiceProfileId, substituteSystemVoiceID)
        // 2단계가 볼 행으로 계정별로 적었다.
        XCTAssertEqual(ReceivedAlarmPromotionStore().pendingIDs(for: owner), ["recv-1"])
    }

    // MARK: - 2단계 기록

    func test_기록은_계정별이고_소유자_미기록_행은_어느_계정에서나_본다() throws {
        let suite = "received-promotion-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ReceivedAlarmPromotionStore(defaults: defaults)

        store.add(["a", "b"], ownerUserID: "me")
        store.add(["c"], ownerUserID: nil)
        store.add(["z"], ownerUserID: "other")
        XCTAssertEqual(store.pendingIDs(for: "me"), ["a", "b", "c"])
        XCTAssertEqual(store.pendingIDs(for: "other"), ["z", "c"])

        store.remove(["a", "c"], ownerUserID: "me")
        XCTAssertEqual(store.pendingIDs(for: "me"), ["b"])
        XCTAssertEqual(store.pendingIDs(for: "other"), ["z"])

        store.clear(userID: "me")
        XCTAssertTrue(store.pendingIDs(for: "me").isEmpty)
        XCTAssertEqual(store.pendingIDs(for: "other"), ["z"])
    }

    // MARK: - 2단계 판정

    private func convertedRow(playMode: AlarmPlayMode = .voiceOnly) throws -> LocalAlarmRecord {
        var row = try XCTUnwrap(
            ReceivedAlarmConversion.convert(try decodeLegacy(), nowMillis: now).converted.first
        )
        row.playMode = playMode.rawValue
        return row
    }

    private func clone(_ id: String, createdAt: String, status: String? = "ready", isDraft: Bool? = nil) -> VoiceProfile {
        VoiceProfile(id: id, name: id, status: status, createdAt: createdAt, isDraft: isDraft)
    }

    private let expected = ExpectedVariantCounts(system: ["greeting": 2], clone: ["greeting": 3])

    private func greetingClips(_ voiceID: String, language: String = "ko") -> [StockClip] {
        // 일부러 거꾸로 둔다 — 묶을 때는 자리 번호(variant) 순이어야 한다.
        (0..<3).reversed().map { (variant: Int) -> StockClip in
            StockClip(
                messageId: "\(voiceID)-greeting-\(language)-\(variant)",
                voiceProfileId: voiceID,
                voiceName: nil,
                category: "greeting",
                language: language,
                text: "인사 \(variant)",
                audioUrl: "https://cdn.example/\(voiceID)/greeting/\(variant).mp3",
                variant: variant
            )
        }
    }

    private func allCached(_ key: String) -> URL? { URL(fileURLWithPath: "/tmp/\(key).mp3") }

    private func decide(
        _ record: LocalAlarmRecord?,
        access: PaidVoiceAccess = .entitled,
        confirmed: Bool = true,
        profiles: [VoiceProfile]? = nil,
        settling: Set<String> = [],
        lastUsed: String? = nil,
        manifest: [StockClip]? = nil,
        expectedVariants: ExpectedVariantCounts?? = nil,
        cachedURL: ((String) -> URL?)? = nil
    ) -> ReceivedAlarmPromotion.Decision {
        ReceivedAlarmPromotion.decide(
            record: record,
            access: access,
            entitlementConfirmed: confirmed,
            profiles: profiles ?? [clone("clone-a", createdAt: "2026-10-01T00:00:00Z")] + bundledSystemVoiceProfiles(),
            settlingProfileIDs: settling,
            lastUsedVoiceID: lastUsed,
            manifest: manifest ?? greetingClips("clone-a"),
            expectedVariants: expectedVariants ?? expected,
            deviceLanguage: "ko",
            cachedURL: cachedURL ?? allCached
        )
    }

    func test_쓸_수_있는_클론과_인사말이_다_있으면_그_클론으로_올린다() throws {
        let row = try convertedRow()
        guard case .promote(let greeting) = decide(row) else {
            return XCTFail("올려야 한다")
        }
        XCTAssertEqual(greeting.voiceID, "clone-a")
        XCTAssertEqual(greeting.language, "ko")
        XCTAssertEqual(greeting.keys, (0..<3).map { AudioCacheStore.stockCacheKey(messageId: "clone-a-greeting-ko-\($0)") })

        let promoted = ReceivedAlarmPromotion.promoted(row, greeting: greeting, nowMillis: now)
        XCTAssertEqual(promoted.voiceProfileId, "clone-a")
        XCTAssertEqual(promoted.voiceSource, VoiceSource.ttsProfile.rawValue)
        XCTAssertEqual(promoted.bucketId, "greeting")
        XCTAssertEqual(promoted.voiceRandomContext, RandomPromptContext.preset.rawValue)
        XCTAssertFalse(promoted.voiceRandomPrompt)
        XCTAssertEqual(promoted.bucketClipKeys, greeting.keys)
        XCTAssertEqual(promoted.audioCacheKey, greeting.keys.first)
        XCTAssertEqual(promoted.ttsMessageId, "clone-a-greeting-ko-0")
        XCTAssertEqual(promoted.voiceText, "인사 0")
        XCTAssertEqual(promoted.bucketRotationIndex, 0)
        XCTAssertTrue(promoted.voiceRepeat)
        XCTAssertFalse(ReceivedAlarmPromotion.isStillConverted(promoted), "올린 행은 다시 판정 대상이 아니다")
    }

    func test_클립이_하나라도_없으면_조용히_울리지_않게_미나로_두고_다시_본다() throws {
        let row = try convertedRow()
        let missing = AudioCacheStore.stockCacheKey(messageId: "clone-a-greeting-ko-1")
        XCTAssertEqual(decide(row, cachedURL: { $0 == missing ? nil : self.allCached($0) }), .hold)
        // 세트가 모자라다.
        XCTAssertEqual(decide(row, manifest: Array(greetingClips("clone-a").prefix(2))), .hold)
        // 세트 크기를 모른다 — 편집기 관문과 같다.
        XCTAssertEqual(decide(row, expectedVariants: .some(nil)), .hold)
        // 매니페스트가 없다.
        XCTAssertEqual(
            ReceivedAlarmPromotion.decide(
                record: row, access: .entitled, entitlementConfirmed: true,
                profiles: [clone("clone-a", createdAt: "2026-10-01T00:00:00Z")], settlingProfileIDs: [],
                lastUsedVoiceID: nil, manifest: nil, expectedVariants: expected, deviceLanguage: "ko",
                cachedURL: allCached
            ),
            .hold
        )
    }

    func test_이용권이_정해지지_않았거나_정리_중이면_기다린다() throws {
        let row = try convertedRow()
        XCTAssertEqual(decide(row, access: .unknown), .hold)
        XCTAssertEqual(decide(row, access: .notEntitled, confirmed: false), .hold, "저장된 무료 판정만으로는 확정하지 않는다")
        XCTAssertEqual(decide(row, settling: ["clone-a"]), .hold)
    }

    func test_쓸_수_있는_클론이_없으면_미나로_확정한다() throws {
        let row = try convertedRow()
        XCTAssertEqual(decide(row, access: .notEntitled, confirmed: true), .keepMina)
        XCTAssertEqual(decide(row, access: .unknown, profiles: bundledSystemVoiceProfiles()), .keepMina)
        XCTAssertEqual(
            decide(row, profiles: [
                clone("draft", createdAt: "2026-10-02T00:00:00Z", isDraft: true),
                clone("processing", createdAt: "2026-10-03T00:00:00Z", status: "processing"),
            ]),
            .keepMina
        )
        // '알람' 모드는 목소리를 쓰지 않는다.
        XCTAssertEqual(decide(try convertedRow(playMode: .alarmOnly)), .keepMina)
    }

    func test_고쳤거나_지운_행은_손대지_않는다() throws {
        XCTAssertEqual(decide(nil), .untouched)
        var edited = try convertedRow()
        edited.voiceRandomContext = RandomPromptContext.wakeWeather.rawValue
        XCTAssertEqual(decide(edited), .untouched)
        var otherVoice = try convertedRow()
        otherVoice.voiceProfileId = bundledSystemVoiceProfiles()[0].id
        XCTAssertEqual(decide(otherVoice), .untouched)
    }

    func test_클론이_여럿이면_마지막에_쓴_것_아니면_가장_최근에_만든_것() throws {
        let older = clone("older", createdAt: "2026-09-01T00:00:00Z")
        let newer = clone("newer", createdAt: "2026-10-01T00:00:00.000Z")
        XCTAssertEqual(ReceivedAlarmPromotion.pickClone([older, newer], lastUsedVoiceID: nil)?.id, "newer")
        XCTAssertEqual(ReceivedAlarmPromotion.pickClone([older, newer], lastUsedVoiceID: "older")?.id, "older")
        XCTAssertEqual(
            ReceivedAlarmPromotion.pickClone([older, newer], lastUsedVoiceID: substituteSystemVoiceID)?.id,
            "newer",
            "마지막에 쓴 것이 클론이 아니면 가장 최근 것"
        )

        let row = try convertedRow()
        let manifest = greetingClips("older") + greetingClips("newer")
        guard case .promote(let greeting) = decide(row, profiles: [older, newer], lastUsed: "older", manifest: manifest) else {
            return XCTFail("마지막에 쓴 클론으로 올려야 한다")
        }
        XCTAssertEqual(greeting.voiceID, "older")
    }

    // MARK: - 1단계로 바꾼 알람이 우는 소리

    /// 1단계로 바꾼 알람은 알람음으로 떨어지지 않는다 — 미나의 오디오 없는 기본 목소리 알람이라 울릴 때 그 목소리의
    /// 내장 인사말이 나간다(`AlarmSoundResolver.plan` 의 1b 갈래).
    func test_바꾼_알람은_미나_목소리로_운다() throws {
        guard case .voiceClip = AlarmSoundResolver.plan(for: try convertedRow(), audioCache: .shared) else {
            return XCTFail("바꾼 알람이 목소리가 아니라 알람음으로 운다")
        }
    }

    // MARK: - 2단계 회차(`VoiceStudioViewModel.promoteConvertedReceivedAlarms`)

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("received-promotion-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func isolatedPromotions() throws -> (store: ReceivedAlarmPromotionStore, cleanup: () -> Void) {
        let suite = "received-promotion-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        return (ReceivedAlarmPromotionStore(defaults: defaults), { defaults.removePersistentDomain(forName: suite) })
    }

    /// 사용자가 그 알람을 고치거나 지우면 기록을 지운다 — 사용자가 고른 것을 승격이 덮지 않는다.
    func test_고치거나_지운_알람은_승격_기록에서_빠진다() throws {
        let account = "promotion-\(UUID().uuidString)"
        // `LocalAlarmStore` 가 지우는 기록은 기본 저장소다.
        let promotions = ReceivedAlarmPromotionStore()
        defer { promotions.clear(userID: account) }
        let store = makeStore()
        var edited = try convertedRow()
        edited.id = "edited-\(UUID().uuidString)"
        edited.ownerUserId = account
        var deleted = try convertedRow()
        deleted.id = "deleted-\(UUID().uuidString)"
        deleted.ownerUserId = account
        store.upsert(edited)
        store.upsert(deleted)
        promotions.add([edited.id, deleted.id], ownerUserID: account)

        edited.hour = 9
        store.upsertPreservingServerSyncFields(edited)
        XCTAssertFalse(promotions.pendingIDs(for: account).contains(edited.id), "고친 알람은 승격하지 않는다")
        XCTAssertTrue(promotions.pendingIDs(for: account).contains(deleted.id))

        store.delete(try XCTUnwrap(store.record(id: deleted.id)))
        XCTAssertFalse(promotions.pendingIDs(for: account).contains(deleted.id), "지운 알람의 기록이 남았다")
    }

    /// 회차의 범위 — 서버가 확정한 목소리 목록이 없으면 아무것도 하지 않고, 끝낸 행(미나 확정·없어진 행)의 기록만
    /// 지운다. 다른 계정이 새긴 행은 그 계정의 회차가 본다.
    func test_승격_회차는_확정된_목록에서만_돌고_끝낸_기록만_지운다() throws {
        let (promotions, cleanup) = try isolatedPromotions()
        defer { cleanup() }
        let account = "promotion-\(UUID().uuidString)"
        let store = makeStore()
        var mine = try convertedRow()
        mine.id = "mine"
        mine.ownerUserId = account
        var theirs = try convertedRow()
        theirs.id = "theirs"
        theirs.ownerUserId = "someone-else"
        store.upsert(mine)
        store.upsert(theirs)
        let before = store.alarms
        promotions.add(["mine", "theirs", "gone"], ownerUserID: account)
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(voice.promoteConvertedReceivedAlarms(
            alarmStore: store, ownerUserId: account, entitlementConfirmed: true, promotions: promotions
        ), 0)
        XCTAssertEqual(promotions.pendingIDs(for: account), ["mine", "theirs", "gone"], "확정 전의 목록으로는 판단하지 않는다")

        voice.__setAccessibleVoicesForTests()   // 쓸 수 있는 내 클론이 없다(확정)
        XCTAssertEqual(voice.promoteConvertedReceivedAlarms(
            alarmStore: store, ownerUserId: account, entitlementConfirmed: true, promotions: promotions
        ), 0)
        XCTAssertEqual(promotions.pendingIDs(for: account), ["theirs"])
        XCTAssertEqual(store.alarms, before, "미나로 확정하면 행은 그대로다")
        XCTAssertFalse(voice.needsScheduleReconcile)
    }

    /// 끝까지 간 회차 — 서버가 확정한 목록의 내 클론과, 기기에 다 받아 둔 그 클론의 기본 인사말로 올린다. 올린 행은
    /// 그 클립으로 울고, 예약을 다시 맞추게 하며(AlarmKit 은 예약할 때 소리를 고정한다), 기록을 지운다.
    func test_승격_회차는_내_클론과_받아_둔_인사말로_올린다() async throws {
        let account = "promotion-\(UUID().uuidString)"
        let session = AuthSession(token: "promotion-token", user: AuthUser(id: account, email: "promotion@example.test"))
        let (promotions, cleanup) = try isolatedPromotions()
        let clips = greetingClips("clone-a")
        let keys = (0..<3).map { AudioCacheStore.stockCacheKey(messageId: "clone-a-greeting-ko-\($0)") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PromotionVoiceListURLProtocol.self]
        let urlSession = URLSession(configuration: configuration)
        defer {
            cleanup()
            urlSession.invalidateAndCancel()
            AccessSnapshotStore().clear(userID: account)
            StockClipManifestStore.clear()
            keys.forEach { try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: $0) }
        }
        // 이용권 — 스토어가 확인해 준 개인 이용권.
        AccessSnapshotStore().patchWithoutOwnershipCheck(account) {
            $0.storePlanKey = PlanTier.personal.rawValue
            $0.storeEntitlementUntilMillis = Int64.max
        }
        // 그 클론의 기본 인사말 한 벌 — 세트 크기와 함께 매니페스트에 있고 기기에 다 받아 뒀다.
        XCTAssertEqual(StockClipManifestStore.save(
            StockClipListResponse(clips: clips, expectedVariants: expected, legacyBucketHints: nil),
            ticket: StockClipManifestStore.beginFetch(session: session)
        ), .published)
        for key in keys {
            _ = try AudioCacheStore.shared.cacheBytes(
                Data("clip-\(key)".utf8), cacheKey: key, mimeType: "audio/mpeg", source: "tts",
                durationOverrideMs: 1_500, enforceMaxDuration: false
            )
        }
        let voice = VoiceStudioViewModel(api: AlarmTalkAPI(
            baseURL: URL(string: "https://\(PromotionVoiceListURLProtocol.host)/api/")!, session: urlSession
        ))
        await voice.refresh(session: session, force: true)
        XCTAssertTrue(voice.accessibleVoicesAreAuthoritative)

        let store = makeStore()
        var row = try convertedRow()
        row.ownerUserId = account
        store.upsert(row)
        promotions.add([row.id], ownerUserID: account)

        let promoted = voice.promoteConvertedReceivedAlarms(
            alarmStore: store, ownerUserId: account, entitlementConfirmed: true, promotions: promotions
        )

        XCTAssertEqual(promoted, 1)
        let after = try XCTUnwrap(store.record(id: row.id))
        XCTAssertEqual(after.voiceProfileId, "clone-a")
        XCTAssertEqual(after.bucketId, "greeting")
        XCTAssertEqual(after.bucketClipKeys, keys, "자리 번호 순으로 한 벌을 다 묶는다")
        XCTAssertEqual(after.audioCacheKey, keys.first)
        XCTAssertEqual(after.localAudioUri, AudioCacheStore.shared.cachedURL(for: keys[0])?.lastPathComponent)
        XCTAssertEqual(after.voiceRandomContext, RandomPromptContext.preset.rawValue)
        XCTAssertEqual(after.syncStateEnum, .localOnly, "아직 서버에 없는 내 알람이다")
        XCTAssertEqual(after.hour, row.hour)
        XCTAssertEqual(after.minute, row.minute)
        XCTAssertTrue(voice.needsScheduleReconcile, "예약을 다시 걸어야 새 목소리로 운다")
        XCTAssertTrue(promotions.pendingIDs(for: account).isEmpty)
        guard case .voiceClip(let ringing, _, _, _, _) = AlarmSoundResolver.plan(for: after, audioCache: .shared) else {
            return XCTFail("올린 알람이 그 클론의 클립으로 울지 않는다")
        }
        XCTAssertTrue(keys.contains(ringing))
    }
}

/// 내 클론 하나가 있는 목소리 목록과 등록 한도만 답한다(외부 통신 없음).
private final class PromotionVoiceListURLProtocol: URLProtocol, @unchecked Sendable {
    static let host = "promotion-voices.example.test"

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == host }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let path = url.path.components(separatedBy: "/api/").last ?? url.path
        let (status, body): (Int, String) = switch path {
        case "voice":
            (200, #"{"profiles":[{"id":"clone-a","name":"엄마","status":"ready","created_at":"2026-10-01T00:00:00Z","is_draft":false}]}"#)
        case "voice/draft-quota":
            (200, #"{"limit":1,"used":0,"remaining":1,"registration_limit":1,"registration_used":0,"registration_remaining":1}"#)
        default:
            (404, #"{"error":"unexpected path"}"#)
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
