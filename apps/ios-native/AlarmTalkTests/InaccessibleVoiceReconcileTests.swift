import XCTest
@testable import AlarmTalk

/// **접근권을 잃은 목소리를 쓰는 알람은 알람음으로 내려야 한다** — 그런데 그 판단이
/// 실패한 조회로 돌면 멀쩡한 알람을 되돌릴 수 없게 부순다.
///
/// 안드로이드는 처음부터 `familyVoicesLoadedFresh`·`voiceProfilesLoadedFresh` 를 보고
/// 물러섰다. iOS 에는 이 경로 자체가 없었다(2026-08-18 Codex #697 P1).
@MainActor
final class InaccessibleVoiceReconcileTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("reconcile-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(
        id: String,
        voiceProfileId: String?,
        origin: AlarmOrigin = .localOwned,
        owner: String? = "owner-1"
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
        return record
    }

    /// ⚠ 조회가 권위 없는 회차에는 **아무것도 하지 않는다.** 이게 이 테스트의 핵심이다 —
    /// 목록이 비었다고 강등하면 네트워크가 한 번 끊긴 것만으로 알람이 부서진다.
    func test_목록이_권위없으면_강등하지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "a", voiceProfileId: "clone-1"))
        let voice = VoiceStudioViewModel()   // 새로고침 전 = 권위 없음

        let degraded = voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1")

        XCTAssertEqual(degraded, 0)
        XCTAssertEqual(store.record(id: "a")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 받은 알람은 **보낸 사람의** 접근권으로 성립한다 — 내 목록으로 판단하지 않는다.
    func test_받은_알람은_대상이_아니다() {
        let store = makeStore()
        store.upsert(alarm(id: "recv", voiceProfileId: "clone-1", origin: .receivedRemote))
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"), 0)
    }

    /// 시스템(기본) 목소리는 목록에 없어도 언제나 쓸 수 있다.
    func test_기본_목소리는_강등_대상이_아니다() {
        let store = makeStore()
        store.upsert(alarm(id: "sys", voiceProfileId: systemVoiceIDPrefix + "000000000101"))
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"), 0)
    }

    /// ⚠ **다른 계정 알람은 건드리지 않는다.** 한 기기에서 계정을 바꾸면 B 의 목록에는
    /// A 의 목소리 id 가 당연히 없다 — 소유자를 안 보면 A 의 알람을 부순다.
    func test_다른_계정의_알람은_건드리지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "a-of-other", voiceProfileId: "clone-1", owner: "owner-2"))
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            0
        )
    }

    /// 소유 계정을 모르면(로그아웃 직후 등) 아무것도 하지 않는다.
    func test_소유자를_모르면_아무것도_하지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "a", voiceProfileId: "clone-1"))
        let voice = VoiceStudioViewModel()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: nil),
            0
        )
    }
}
