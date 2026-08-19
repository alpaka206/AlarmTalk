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

    // MARK: - 권위가 선 상태에서의 **범위** 검증
    //
    // ⚠ 아래 테스트들이 `__setAccessibleVoicesForTests` 로 권위를 먼저 세우는 이유:
    // 그러지 않으면 전부 첫 가드에서 통과해 **필터를 통째로 지워도 초록**이다
    // (2026-08-18 Codex #697 P2 — 실제로 그런 테스트였다).

    /// 기준선 — 접근권을 잃은 내 알람은 실제로 내려간다. 이게 참이어야 아래 '안 내린다'
    /// 들이 의미를 갖는다.
    func test_접근권을_잃은_내_알람은_내려간다() {
        let store = makeStore()
        store.upsert(alarm(id: "mine", voiceProfileId: "clone-1"))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests()   // 접근 가능한 목소리가 하나도 없다(확정)

        let degraded = voice.reconcileInaccessibleVoiceAlarms(
            alarmStore: store, audioCache: nil, ownerUserId: "owner-1"
        )

        XCTAssertEqual(degraded, 1)
        XCTAssertEqual(store.record(id: "mine")?.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertNil(store.record(id: "mine")?.voiceProfileId)
    }

    /// 아직 접근 가능한 목소리는 건드리지 않는다.
    func test_접근_가능한_목소리는_그대로다() {
        let store = makeStore()
        store.upsert(alarm(id: "keep", voiceProfileId: "clone-1"))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests(profileIDs: ["clone-1"])

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            0
        )
        XCTAssertEqual(store.record(id: "keep")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 받은 알람은 **보낸 사람의** 접근권으로 성립한다 — 같은 목소리를 내 알람도 쓰고
    /// 있을 때 함께 벗겨지면 안 된다(그게 실제로 났던 사고다).
    func test_같은_목소리를_쓰는_받은_알람은_남는다() {
        let store = makeStore()
        store.upsert(alarm(id: "mine", voiceProfileId: "shared-1"))
        store.upsert(alarm(id: "recv", voiceProfileId: "shared-1", origin: .receivedRemote, owner: nil))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            1
        )
        XCTAssertEqual(store.record(id: "mine")?.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertEqual(store.record(id: "recv")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(store.record(id: "recv")?.voiceProfileId, "shared-1")
    }

    /// 기본(시스템) 목소리는 목록에 없어도 언제나 쓸 수 있다.
    func test_기본_목소리는_권위가_있어도_안_내린다() {
        let store = makeStore()
        store.upsert(alarm(id: "sys", voiceProfileId: systemVoiceIDPrefix + "000000000101"))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            0
        )
        XCTAssertEqual(store.record(id: "sys")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 다른 계정 알람은 권위가 있어도 건드리지 않는다.
    func test_다른_계정의_알람은_권위가_있어도_안_내린다() {
        let store = makeStore()
        store.upsert(alarm(id: "other", voiceProfileId: "clone-1", owner: "owner-2"))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            0
        )
        XCTAssertEqual(store.record(id: "other")?.playMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 소유자 미기록(옛 행)은 이 계정 것으로 본다 — 잠금 경로와 같은 관용.
    func test_소유자_미기록_옛_행은_이_계정_것으로_본다() {
        let store = makeStore()
        store.upsert(alarm(id: "legacy", voiceProfileId: "clone-1", owner: nil))
        let voice = VoiceStudioViewModel()
        voice.__setAccessibleVoicesForTests()

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: "owner-1"),
            1
        )
    }
}

/// **디스크 로드를 기다리지 않으면 강등 판정이 빈 목록을 본다.**
///
/// 화면이 있는 경로는 `.task(id: hasLoadedFromDisk)` 로 다시 돌지만, 백그라운드로
/// 깨어난 주기 사이클에는 그런 재시도가 없다 — 그 회차가 조용히 지나간다
/// (2026-08-18 Codex #697 P1).
@MainActor
final class LocalAlarmStoreLoadWaitTests: XCTestCase {

    func test_로드를_기다리면_알람이_올라와_있다() async throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("load-wait-\(UUID().uuidString).json")
        // ⚠ 저장소를 거쳐 쓰지 않는다 — `persist()` 가 비동기라 파일이 언제 내려갔는지
        // 알 수 없어 테스트가 경주한다(처음에 그렇게 썼다가 실제로 깨졌다).
        // 여기서 검증하려는 건 **읽는 쪽의 대기**이므로 파일은 직접 만든다.
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: "persisted",
            label: "아침",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.voiceProfileId = "clone-1"
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try Data(encoder.encode([record])).write(to: url, options: [.atomic])

        // 새 저장소는 디스크에서 비동기로 읽는다.
        let reader = LocalAlarmStore(storageURL: url, loadFromDisk: true)
        await reader.waitUntilLoadedFromDisk()

        XCTAssertTrue(reader.hasLoadedFromDisk)
        XCTAssertEqual(reader.record(id: "persisted")?.voiceProfileId, "clone-1")
    }

    /// 이미 로드된 저장소에서는 곧바로 돌아온다(주기 예산을 낭비하지 않는다).
    func test_이미_로드됐으면_즉시_돌아온다() async {
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("load-wait-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
        let started = Date()
        await store.waitUntilLoadedFromDisk(timeout: 3)
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.5)
    }
}

/// **계정을 떠났는데 알람이 울리면 안 된다.** 다만 `enabled` 는 사용자 의도라
/// 건드리지 않는다 — 끄면 재로그인 때 알람이 전부 꺼진 채로 보인다(2026-08-19 지시).
@MainActor
final class LeaveAccountAlarmTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("leave-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(id: String, enabled: Bool, kitID: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: id, label: "아침", hour: 7, minute: 0,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = enabled
        r.alarmKitID = kitID
        return r
    }

    /// 예약 핸들만 지우고 `enabled` 는 남는다 — 그래야 복구 후보(`enabled && kitID == nil`)가 된다.
    func test_예약_핸들만_지우고_켜짐은_유지한다() {
        let store = makeStore()
        store.upsert(alarm(id: "a", enabled: true, kitID: "KIT-1"))

        store.clearScheduleHandle(id: "a")

        let r = store.record(id: "a")
        XCTAssertNil(r?.alarmKitID, "예약 핸들이 남으면 재로그인해도 다시 안 걸린다")
        XCTAssertEqual(r?.enabled, true, "사용자 의도(켜짐)를 끄면 재로그인 때 전부 꺼져 보인다")
    }

    /// ⚠ **켜기 실패 경로가 실제로 이 순서다** — 되돌려 끈 뒤 실패를 새긴다.
    /// 그 결과가 `enabled=false, state=failed` 이고, 복구 sweep 는 켜진 알람만 보므로
    /// **아무도 치워 주지 않아** 빨간 경고가 영원히 남는다(실기기에서 그 상태를 확인했다).
    func test_꺼진_알람에는_실패를_새기지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "b", enabled: true, kitID: nil))

        // AlarmsListView 의 켜기 실패 경로와 같은 순서
        store.setEnabled(id: "b", enabled: false)
        store.markFailed(id: "b")

        XCTAssertNotEqual(
            store.record(id: "b")?.runtimeStateEnum, .failed,
            "꺼진 알람에 '다시 예약하지 못했어요' 가 영원히 붙는다"
        )
    }

    /// 끄기 전에 이미 `.failed` 였어도 끄는 순간 풀린다(반대 방향의 같은 불변식).
    func test_알람을_끄면_기존_실패도_풀린다() {
        let store = makeStore()
        store.upsert(alarm(id: "b2", enabled: true, kitID: nil))
        store.markFailed(id: "b2")
        XCTAssertEqual(store.record(id: "b2")?.runtimeStateEnum, .failed)

        store.setEnabled(id: "b2", enabled: false)

        XCTAssertNotEqual(store.record(id: "b2")?.runtimeStateEnum, .failed)
    }

    /// 켜진 알람의 `.failed` 는 그대로 둔다 — 그건 진짜로 안 울린다는 뜻이라 알려야 한다.
    func test_켜진_알람의_실패는_유지된다() {
        let store = makeStore()
        store.upsert(alarm(id: "c", enabled: false, kitID: nil))
        store.markFailed(id: "c")

        store.setEnabled(id: "c", enabled: true)
        store.markFailed(id: "c")

        XCTAssertEqual(store.record(id: "c")?.runtimeStateEnum, .failed)
    }
}
