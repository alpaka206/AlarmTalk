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
        XCTAssertNil(store.record(id: "custom")?.voiceProfileId)
        XCTAssertEqual(store.record(id: "custom")?.playMode, AlarmPlayMode.alarmOnly.rawValue)
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
