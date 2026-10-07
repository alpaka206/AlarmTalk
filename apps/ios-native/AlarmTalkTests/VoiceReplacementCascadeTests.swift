import XCTest
@testable import AlarmTalk

/// **제자리 목소리 교체 — 직접 입력 알람만 내린다** (Codex #703 P1 회귀 방지).
///
/// 교체는 옛 프로필 **행을 재사용**한다(id 가 그대로다). 그래서 접근권 대조
/// (`reconcileInaccessibleVoiceAlarms`)로는 영원히 안 걸리고, 본인 소유 알람은 pull 대상도
/// 아니라 서버가 행을 내려도 이 기기에 닿지 않는다 — 놔두면 **지운 사람의 목소리로 계속 운다.**
///
/// 반대로 넓히면 안 된다: 프리셋(버킷) 알람은 서버가 같은 message id 로 새 목소리를 다시 만들어
/// 게시하므로, 여기서 벗기면 되돌릴 수 없이 잃는다.
///
/// 안드로이드 짝은 `VoiceReplacementCascadeTest.kt` — 판정식이 갈리면 둘 중 하나가 틀린 것이다.
@MainActor
final class VoiceReplacementCascadeTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("replace-cascade-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(
        id: String,
        voiceProfileId: String?,
        origin: AlarmOrigin = .localOwned,
        owner: String? = "owner-1",
        bucketId: String? = nil,
        randomPrompt: Bool = false,
        cacheKey: String? = nil
    ) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: id,
            label: "아침",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            origin: origin.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = voiceProfileId
        record.ownerUserId = owner
        record.bucketId = bucketId
        record.voiceRandomPrompt = randomPrompt
        record.voiceCategory = "custom"
        record.audioCacheKey = cacheKey
        record.ttsMessageId = "m-\(id)"
        return record
    }

    func test_직접_입력_알람만_내린다() {
        let store = makeStore()
        store.upsert(alarm(id: "custom", voiceProfileId: "clone-1"))
        store.upsert(alarm(id: "bucket", voiceProfileId: "clone-1", bucketId: "medication"))
        store.upsert(alarm(id: "random", voiceProfileId: "clone-1", randomPrompt: true))
        store.upsert(alarm(id: "other", voiceProfileId: "clone-2"))
        // 버킷 없이 프리셋 클립 하나만 물린 **옛 행** — 세 값이 직접 입력과 똑같아 보인다.
        store.upsert(alarm(id: "legacy", voiceProfileId: "clone-1", cacheKey: "stock_m-legacy"))
        let voice = VoiceStudioViewModel()

        let degraded = voice.degradeCustomMessageAlarms(
            forProfileID: "clone-1",
            alarmStore: store,
            audioCache: nil,
            ownerUserId: "owner-1"
        )

        XCTAssertEqual(degraded, ["custom"], "내린 행 id 를 돌려줘야 호출자가 예약까지 확인한다")
        // 알람음이 아니라 **기본 목소리(미나)** 로 바뀐다 — 낡은 오디오·문구 참조는 버린다(2026-09-29).
        let custom = store.record(id: "custom")
        XCTAssertEqual(custom?.voiceProfileId, substituteSystemVoiceID)
        XCTAssertEqual(custom?.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(custom?.ttsMessageId)
        XCTAssertNil(custom?.audioCacheKey)
        XCTAssertNil(custom?.preLockPlayMode, "되돌릴 목소리가 없으니 표시도 남기지 않는다")
        XCTAssertEqual(
            store.record(id: "bucket")?.voiceProfileId, "clone-1",
            "프리셋 알람은 새 목소리로 다시 만들어진다 — 벗기면 되돌릴 수 없다"
        )
        XCTAssertEqual(store.record(id: "random")?.voiceProfileId, "clone-1")
        XCTAssertEqual(store.record(id: "other")?.voiceProfileId, "clone-2")
        XCTAssertEqual(
            store.record(id: "legacy")?.voiceProfileId, "clone-1",
            "프리셋 클립 옛 행은 캐시 키(stock_)로 갈린다 — 벗기면 되돌릴 수 없다"
        )
        XCTAssertTrue(voice.needsScheduleReconcile, "예약을 다시 맞추지 않으면 구워 둔 사운드가 그대로 운다")
    }

    /// 받은 알람은 **보낸 사람의** 목소리로 성립한다 — 내 교체로 판단하지 않는다.
    /// ⚠ **정리가 끝나지 않은 교체 목소리는 아직 고를 수 없다.** 고를 수 있게 두면 그 사이
    /// 만든 새 알람을 다음 회차가 함께 지운다(강등 대상은 프로필 id 로만 고른다).
    ///
    /// ⚠ **숨기지는 않는다**(2026-08-25 지시. 그전에는 목록에서 뺐다). 감추면 사용자에게는
    /// 목소리가 **사라진 것으로 보여 고장으로 읽힌다.** 자리에 두고 흐리게 그린 뒤
    /// 이유를 말한다 — 곧 돌아온다는 것을 알 수 있어야 한다.
    func test_정리가_끝나지_않으면_목록에_두되_고를_수_없다() {
        let voice = VoiceStudioViewModel()
        voice.profiles = [
            VoiceProfile(id: "clone-1", name: "엄마"),
            VoiceProfile(id: "clone-2", name: "아빠"),
        ]

        voice.suppressReplacedProfile("clone-1")
        XCTAssertEqual(
            voice.profiles.map(\.id), ["clone-1", "clone-2"],
            "목록에서 빼면 사라진 것으로 보여 고장으로 읽힌다"
        )
        XCTAssertTrue(voice.isReplacementSettling("clone-1"), "고를 수는 없어야 한다")
        XCTAssertFalse(voice.isReplacementSettling("clone-2"))

        voice.releaseReplacedProfile("clone-1")
        XCTAssertFalse(
            voice.isReplacementSettling("clone-1"),
            "정리가 확정되면 곧바로 다시 고를 수 있어야 한다"
        )
    }

    func test_받은_알람은_대상이_아니다() {
        let store = makeStore()
        store.upsert(alarm(id: "recv", voiceProfileId: "clone-1", origin: .receivedRemote))
        let voice = VoiceStudioViewModel()

        XCTAssertTrue(
            voice.degradeCustomMessageAlarms(
                forProfileID: "clone-1", alarmStore: store, audioCache: nil, ownerUserId: "owner-1"
            ).isEmpty
        )
        XCTAssertEqual(store.record(id: "recv")?.voiceProfileId, "clone-1")
    }

    /// 한 기기에서 계정을 바꾸면 앞 계정 알람이 그대로 남는다 — 되돌릴 수 없는 강등은 소유자를 본다.
    func test_다른_계정의_알람은_건드리지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "theirs", voiceProfileId: "clone-1", owner: "owner-2"))
        let voice = VoiceStudioViewModel()

        XCTAssertTrue(
            voice.degradeCustomMessageAlarms(
                forProfileID: "clone-1", alarmStore: store, audioCache: nil, ownerUserId: "owner-1"
            ).isEmpty
        )
        XCTAssertEqual(store.record(id: "theirs")?.voiceProfileId, "clone-1")
    }

    /// 무료 잠금이 테마 없이 기본 목소리로 바꾼 행은 그 목소리가 **대체 목소리**라 자기 오디오가 없다.
    /// 직접 입력 판정에 걸리고 오디오 시각이 0 이라, 그 기본 목소리의 교체 표식에 잡혀 알람음으로
    /// 내려가고 "직접 입력 알람이 바뀌었어요" 가 떴다 — 낡은 오디오가 하나도 없는데.
    /// (`docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」, 안드로이드
    /// `DefaultVoiceLockRepositoryTest.theSubstituteVoicesInPlaceReplacementLeavesAnUnboundLockAlone` 짝)
    func test_잠금이_넣은_기본_목소리가_교체돼도_잠긴_알람은_그대로다() {
        let store = makeStore()
        let systemID = systemVoiceIDPrefix + "000000000101"
        let locked = DefaultVoiceSubstitute.locked(
            alarm(id: "locked", voiceProfileId: "clone-1", cacheKey: "tts-custom-1"),
            voiceID: systemID, binding: nil, nowMillis: 1
        )
        XCTAssertTrue(locked.usesCustomMessageVoice, "전제 — 직접 입력 판정에 걸리는 모양이다")
        store.upsert(locked)
        let voice = VoiceStudioViewModel()

        let degraded = voice.degradeCustomMessageAlarms(
            forProfileID: systemID, alarmStore: store, audioCache: nil, ownerUserId: "owner-1",
            allowSystemVoice: true, invalidatedBefore: Date().addingTimeInterval(60)
        )

        XCTAssertTrue(degraded.isEmpty, "강등 안내에 세지 않는다")
        XCTAssertEqual(store.record(id: "locked")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(store.record(id: "locked")?.voiceProfileId, systemID, "그대로 기본 목소리로 운다")
        XCTAssertEqual(store.record(id: "locked")?.preLockVoice?.voiceProfileId, "clone-1", "복원할 원래 목소리도 그대로")
    }

    /// 기본 목소리로 친 직접 입력(생성 오디오 — 유료)을 잠근 뒤 그 목소리가 교체되면 보관본의 오디오가
    /// 낡았다 — 잠금을 **확정**한다. 같은 회차에 방금 풀린 그 행을 강등 후보로 다시 읽으면 알람음으로
    /// 내려가 버린다(확정은 "기본 목소리로 남긴다" 가 규칙이다).
    func test_교체된_기본_목소리로_친_직접_입력의_잠금은_확정만_한다() {
        let store = makeStore()
        let systemID = systemVoiceIDPrefix + "000000000101"
        store.upsert(DefaultVoiceSubstitute.locked(
            alarm(id: "manual", voiceProfileId: systemID, cacheKey: "tts-manual-1"),
            voiceID: systemID, binding: nil, nowMillis: 1
        ))
        let voice = VoiceStudioViewModel()

        let degraded = voice.degradeCustomMessageAlarms(
            forProfileID: systemID, alarmStore: store, audioCache: nil, ownerUserId: "owner-1",
            allowSystemVoice: true, invalidatedBefore: Date().addingTimeInterval(60)
        )

        XCTAssertTrue(degraded.isEmpty)
        let after = store.record(id: "manual")
        XCTAssertEqual(after?.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(after?.voiceProfileId, systemID)
        XCTAssertNil(after?.preLockVoice, "낡은 원래 오디오는 되살리지 않는다")
        XCTAssertNil(after?.preLockPlayMode)
    }

    /// 확정은 보관본이 붙든 오디오를 **전부** 놓는다(Codex #820) — 테마 알람의 보관본은 클립 세트
    /// 전체를 가리키는데, 대표 키만 지우면 지워진 목소리의 나머지 생성 음성이 캐시 정리 때까지 남는다.
    /// 목소리로 우는 다른 알람이 세트 안의 키를 쓰고 있으면 그것만 남긴다. 안드로이드
    /// `DefaultVoiceLockRepositoryTest.finalizingReleasesEveryClipTheSnapshotHeld` 짝.
    func test_잠금_확정은_보관본의_클립을_전부_놓는다() throws {
        let store = makeStore()
        let cache = AudioCacheStore()
        let tag = UUID().uuidString.prefix(8)
        let cloneKeys = (0..<3).map { "stock_clone-\(tag)-\($0)" }
        for key in cloneKeys {
            _ = try cache.cacheBytes(
                Data("clip-\(key)".utf8), cacheKey: key, mimeType: "audio/mpeg", source: "tts",
                durationOverrideMs: 1_000, enforceMaxDuration: false
            )
        }
        defer { cloneKeys.forEach { try? cache.deleteCachedAudio(cacheKey: $0) } }
        var original = alarm(id: "locked", voiceProfileId: "clone-1", bucketId: "weather", cacheKey: cloneKeys[0])
        original.bucketClipKeys = cloneKeys
        store.upsert(DefaultVoiceSubstitute.locked(
            original, voiceID: systemVoiceIDPrefix + "000000000101", binding: nil, nowMillis: 1
        ))
        // 다른(남아 있는) 목소리의 알람이 세트의 마지막 키를 회전에 쓴다.
        var other = alarm(id: "other", voiceProfileId: "clone-2", bucketId: "weather", cacheKey: "stock_other-\(tag)")
        other.bucketClipKeys = ["stock_other-\(tag)", cloneKeys[2]]
        store.upsert(other)
        let tuningStore = VoiceTuningStore()
        let tuningUser = "lock-\(tag)"
        tuningStore.save(VoiceTuning(pitchSt: -2, source: .user), userID: tuningUser, voiceProfileID: "clone-1")
        defer { tuningStore.save(.neutral, userID: tuningUser, voiceProfileID: "clone-1") }

        VoiceStudioViewModel().degradeAlarms(usingVoiceProfileIDs: ["clone-1"], alarmStore: store, audioCache: cache)
        XCTAssertNil(
            tuningStore.tuning(userID: tuningUser, voiceProfileID: "clone-1"),
            "사라진 원래 목소리의 높이 값도 지운다(Codex #870)"
        )

        XCTAssertNil(store.record(id: "locked")?.preLockVoice)
        XCTAssertNil(cache.cachedURL(for: cloneKeys[0]), "대표 클립")
        XCTAssertNil(cache.cachedURL(for: cloneKeys[1]), "대표가 아닌 세트 클립도 지운다")
        XCTAssertNotNil(cache.cachedURL(for: cloneKeys[2]), "목소리로 우는 다른 알람이 쓰는 클립은 남긴다")
    }

    /// 교체된 것이 **기본 목소리**면 그 목소리는 그대로 쓸 수 있다 — 미나로 바꾸지 않고 낡은 오디오만 버린다.
    /// 안드로이드 `VoiceReplacementCascadeTest` 의 기본 목소리 직접 입력 갈래 짝.
    func test_교체된_기본_목소리의_직접_입력은_그_목소리로_남고_오디오만_버린다() {
        let store = makeStore()
        let systemID = systemVoiceIDPrefix + "000000000101"
        store.upsert(alarm(id: "manual", voiceProfileId: systemID, cacheKey: "tts-manual-1"))
        let voice = VoiceStudioViewModel()

        let degraded = voice.degradeCustomMessageAlarms(
            forProfileID: systemID, alarmStore: store, audioCache: nil, ownerUserId: "owner-1",
            allowSystemVoice: true
        )

        XCTAssertEqual(degraded, ["manual"])
        let after = store.record(id: "manual")
        XCTAssertEqual(after?.voiceProfileId, systemID)
        XCTAssertEqual(after?.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(after?.ttsMessageId)
        XCTAssertNil(after?.audioCacheKey)
    }

    /// 이미 기본 목소리로 바꿔 둔 직접 입력 알람에는 **낡을 오디오가 없다** — 그 기본 목소리의 교체
    /// 표식이 올 때마다 같은 행을 다시 '강등' 으로 세면 없는 변화를 안내한다. 안드로이드
    /// `VoiceReplacementCascadeTest.anAlarmWithoutAnyAudioIsNotDegradedAgainByAReplacementMarker` 짝.
    func test_오디오가_없는_행은_교체_표식에_다시_세지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "custom", voiceProfileId: "clone-1"))
        let voice = VoiceStudioViewModel()
        XCTAssertEqual(
            voice.degradeCustomMessageAlarms(
                forProfileID: "clone-1", alarmStore: store, audioCache: nil, ownerUserId: "owner-1"
            ),
            ["custom"]
        )
        XCTAssertEqual(store.record(id: "custom")?.voiceProfileId, substituteSystemVoiceID)

        XCTAssertTrue(
            voice.degradeCustomMessageAlarms(
                forProfileID: substituteSystemVoiceID, alarmStore: store, audioCache: nil,
                ownerUserId: "owner-1", allowSystemVoice: true
            ).isEmpty,
            "강등 안내에 다시 세지 않는다"
        )
    }

    func test_기본_목소리는_대상이_아니다() {
        let store = makeStore()
        let systemID = systemVoiceIDPrefix + "000000000101"
        store.upsert(alarm(id: "sys", voiceProfileId: systemID))
        let voice = VoiceStudioViewModel()

        XCTAssertTrue(
            voice.degradeCustomMessageAlarms(
                forProfileID: systemID, alarmStore: store, audioCache: nil, ownerUserId: "owner-1"
            ).isEmpty
        )
    }
}
