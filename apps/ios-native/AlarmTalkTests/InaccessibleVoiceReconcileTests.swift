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

    /// `clearScheduleHandle` 은 **핸들만** 지운다 — 끄는 것은 호출부(`stopAllScheduledAlarms`)
    /// 의 책임이다. 둘을 한 함수에 묶으면 재예약 경로가 핸들만 비우고 싶을 때 쓸 수 없다.
    func test_핸들_지우기는_켜짐을_건드리지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "a", enabled: true, kitID: "KIT-1"))

        store.clearScheduleHandle(id: "a")

        let r = store.record(id: "a")
        XCTAssertNil(r?.alarmKitID, "예약 핸들이 남으면 다음에 켤 때 어긋난다")
        XCTAssertEqual(r?.enabled, true)
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

extension LeaveAccountAlarmTests {
    /// ⚠ 로그아웃 뒤 **다른 계정**으로 들어오면 앞 계정 알람이 보이면 안 된다.
    /// 안드로이드 `AlarmDao` 는 처음부터 `(ownerUserId IS NULL OR = :caller)` 로 걸렀는데
    /// iOS 는 `store.alarms` 를 통째로 그렸다(2026-08-19).
    func test_다른_계정_알람은_목록에_안_보인다() {
        let store = makeStore()
        var mine = alarm(id: "mine", enabled: true, kitID: nil); mine.ownerUserId = "A"
        var theirs = alarm(id: "theirs", enabled: true, kitID: nil); theirs.ownerUserId = "B"
        var legacy = alarm(id: "legacy", enabled: true, kitID: nil); legacy.ownerUserId = nil
        [mine, theirs, legacy].forEach { store.upsert($0) }

        let visible = store.alarms(visibleTo: "A").map(\.id).sorted()

        XCTAssertEqual(visible, ["legacy", "mine"], "남의 알람이 보이거나 옛 행이 사라졌다")
    }

    /// 로그아웃 상태에서는 아무것도 보이지 않는다.
    func test_로그아웃_상태에서는_목록이_빈다() {
        let store = makeStore()
        var mine = alarm(id: "mine", enabled: true, kitID: nil); mine.ownerUserId = "A"
        store.upsert(mine)

        XCTAssertTrue(store.alarms(visibleTo: nil).isEmpty)
    }
}

/// **로그아웃이 끄는 범위 — 떠나는 계정 것만이다** (Codex #699 P1).
///
/// 예약 취소는 전부에 걸어도 되지만(되돌릴 수 있다) `enabled = false` 는 되돌릴 수 없다.
/// 남의 계정 행까지 끄면 자동 401 로 세션만 잃은 사람의 알람이 **영영 꺼진다.**
@MainActor
final class LeaveAccountScopeTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("scope-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(id: String, owner: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: id, label: "아침", hour: 7, minute: 0,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = true
        r.alarmKitID = nil          // AlarmKit 왕복 없이 끄는 범위만 본다
        r.ownerUserId = owner
        return r
    }

    /// A 가 자동 401 로 세션만 잃은 상태에서 B 가 로그인했다 로그아웃하는 경우.
    func test_남의_계정_알람은_로그아웃해도_켜진_채로_남는다() async {
        let store = makeStore()
        [alarm(id: "A-것", owner: "A"),
         alarm(id: "B-것", owner: "B"),
         alarm(id: "옛행", owner: nil)].forEach { store.upsert($0) }

        _ = await AlarmKitViewModel().stopAllScheduledAlarms(store: store, ownerUserId: "B")

        XCTAssertEqual(store.record(id: "A-것")?.enabled, true,
                       "자동 401 로 세션만 잃은 A 의 알람이 B 의 로그아웃에 꺼졌다 — A 는 영영 되찾지 못한다")
        XCTAssertEqual(store.record(id: "B-것")?.enabled, false, "떠나는 계정 알람은 꺼져야 한다")
        // 소유자 미기록(옛 행)은 현재 계정 것으로 본다 — 저장소의 다른 경로와 같은 관용.
        XCTAssertEqual(store.record(id: "옛행")?.enabled, false)
    }

    /// 누가 떠나는지 모를 때는 켜진 것을 전부 끈다 — 근거가 없으면 안 울리는 쪽이 안전하다.
    func test_떠나는_계정을_모르면_전부_끈다() async {
        let store = makeStore()
        [alarm(id: "A-것", owner: "A"), alarm(id: "B-것", owner: "B")].forEach { store.upsert($0) }

        _ = await AlarmKitViewModel().stopAllScheduledAlarms(store: store, ownerUserId: nil)

        XCTAssertEqual(store.record(id: "A-것")?.enabled, false)
        XCTAssertEqual(store.record(id: "B-것")?.enabled, false)
    }
}

/// **중복 시각 판정도 소유자로 걸러야 한다** (Codex #699 P1).
///
/// 목록만 거르면 뚫린다 — 교체 모달은 이 결과로 **남의 알람 이름을 띄우고**, '교체' 를
/// 누르면 **그 알람을 지운다.** 감춰 둔 알람이 이름을 드러내고 삭제까지 되는 셈이다.
@MainActor
final class ConflictScopeTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("conflict-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(id: String, owner: String?, hour: Int, minute: Int) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: id, label: "\(id) 라벨", hour: hour, minute: minute,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        r.ownerUserId = owner
        return r
    }

    func test_남의_알람은_충돌로_잡히지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "A-것", owner: "A", hour: 7, minute: 0))

        let conflicts = store.conflictingAlarms(hour: 7, minute: 0, ownerUserId: "B")

        XCTAssertTrue(
            conflicts.isEmpty,
            "감춰 둔 남의 알람이 교체 후보로 잡혔다 — 이름이 노출되고 '교체' 로 삭제된다"
        )
    }

    func test_내_알람과_옛_행은_충돌로_잡힌다() {
        let store = makeStore()
        store.upsert(alarm(id: "B-것", owner: "B", hour: 7, minute: 0))
        store.upsert(alarm(id: "옛행", owner: nil, hour: 7, minute: 0))

        let ids = store.conflictingAlarms(hour: 7, minute: 0, ownerUserId: "B").map(\.id).sorted()

        XCTAssertEqual(ids, ["B-것", "옛행"], "중복 방지가 헐거워지면 같은 시각 알람이 둘 생긴다")
    }

    /// 저장 경로(`requireUniqueTime`)도 같은 기준이어야 한다 — 한쪽만 고치면
    /// 화면에는 충돌이 없는데 저장이 거부되는(또는 그 반대) 상태가 된다.
    func test_저장_판정도_남의_알람을_보지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "A-것", owner: "A", hour: 7, minute: 0))

        XCTAssertNoThrow(
            try store.requireUniqueTime(hour: 7, minute: 0, repeatDaysMask: 0, ownerUserId: "B"),
            "보이지도 않는 알람 때문에 저장이 막히면 사용자는 이유를 알 길이 없다"
        )
        XCTAssertThrowsError(
            try store.requireUniqueTime(hour: 7, minute: 0, repeatDaysMask: 0, ownerUserId: "A")
        )
    }
}

/// **자동 만료로 끊긴 계정만 되살린다** (Codex #699 P1).
///
/// 자동 401 과 명시적 로그아웃은 둘 다 세션이 비지만 알람에 대한 기대가 정반대다.
/// 그 둘을 가르는 값이 `SessionExpiryStore` 하나뿐이라, 여기가 깨지면 로그아웃한 사람의
/// 알람이 로그인 화면 뒤에서 울리거나(못 끈다) 쓰던 사람의 알람이 조용히 사라진다.
@MainActor
final class SessionExpiryStoreTests: XCTestCase {

    override func setUp() { SessionExpiryStore.clear() }
    override func tearDown() { SessionExpiryStore.clear() }

    func test_표시가_없으면_되살릴_계정이_없다() {
        XCTAssertNil(SessionExpiryStore.expiredOwnerUserId)
    }

    func test_자동만료는_그_계정을_남긴다() {
        SessionExpiryStore.markSessionExpired(userId: "A")
        XCTAssertEqual(SessionExpiryStore.expiredOwnerUserId, "A")
    }

    /// ⚠ **불리언이면 안 되는 이유.** A 가 만료된 뒤 B 가 로그인했다 B 도 만료되면
    /// 되살려야 하는 건 B 것뿐이다 — 불리언이면 A 의 알람까지 함께 살아난다.
    func test_나중에_만료된_계정으로_덮인다() {
        SessionExpiryStore.markSessionExpired(userId: "A")
        SessionExpiryStore.markSessionExpired(userId: "B")
        XCTAssertEqual(SessionExpiryStore.expiredOwnerUserId, "B")
    }

    func test_빈_값은_표시를_지우지도_남기지도_않는다() {
        SessionExpiryStore.markSessionExpired(userId: "A")
        SessionExpiryStore.markSessionExpired(userId: "   ")
        XCTAssertEqual(SessionExpiryStore.expiredOwnerUserId, "A", "공백으로 표시를 덮으면 되살릴 대상을 잃는다")
    }
}

/// **취소에 실패하면 손잡이를 남긴다** (Codex #699 P1).
///
/// `alarmKitID` 는 OS 예약을 취소할 유일한 손잡이다. 취소에 실패했는데 지우면 예약은
/// 남고 취소할 방법만 사라진다 — 고아 예약이 로그인 화면 뒤에서 운다.
@MainActor
final class ScheduleHandleRetentionTests: XCTestCase {

    func test_끄면서_핸들을_남길_수_있다() {
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("handle-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: "a", label: "아침", hour: 7, minute: 0, fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = true
        r.alarmKitID = "KIT-1"
        store.upsert(r)

        store.setEnabled(id: "a", enabled: false, keepScheduleHandle: true)

        XCTAssertEqual(store.record(id: "a")?.enabled, false)
        XCTAssertEqual(
            store.record(id: "a")?.alarmKitID, "KIT-1",
            "취소에 실패했는데 손잡이까지 버리면 그 예약은 영영 못 끈다"
        )
    }

    /// 평소에는 지운다 — 남겨 두면 다음에 켤 때 옛 핸들과 어긋난다.
    func test_기본값은_핸들을_비운다() {
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("handle2-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: "b", label: "아침", hour: 7, minute: 0, fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = true
        r.alarmKitID = "KIT-2"
        store.upsert(r)

        store.setEnabled(id: "b", enabled: false)

        XCTAssertNil(store.record(id: "b")?.alarmKitID)
    }
}

/// **예약 중에 로그아웃이 끼어들면 그 예약은 되돌려져야 한다** (Codex #699 P1 검토).
///
/// `schedule` 은 `AlarmManager.shared.schedule` 을 `await` 하는 동안 다른 경로가 행을 바꿀 수
/// 있다. 로그아웃(`stopAllScheduledAlarms`)이 그 사이에 행을 끄면, 돌아온 예약 코드가
/// `markScheduled` 로 나아가면 안 된다 — 그 함수는 `enabled = true` 를 **무조건** 쓰므로
/// **로그아웃한 계정의 알람이 새 예약과 함께 되살아난다.**
///
/// 그 판정은 `SchedulingSnapshot` 비교 하나에 걸려 있고, **`enabled` 가 그 스냅샷에 들어
/// 있다는 사실**이 전부다. 여기가 빠지면 위 시나리오가 조용히 통과한다.
@MainActor
final class SchedulingSnapshotTests: XCTestCase {

    private func record(enabled: Bool) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: "a", label: "아침", hour: 7, minute: 0, fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = enabled
        return r
    }

    func test_켜짐이_바뀌면_예약_스냅샷이_달라진다() {
        XCTAssertNotEqual(
            AlarmKitViewModel.SchedulingSnapshot(record(enabled: true)),
            AlarmKitViewModel.SchedulingSnapshot(record(enabled: false)),
            "await 중 꺼진 것을 못 알아채면 로그아웃한 계정의 알람이 새 예약과 함께 되살아난다"
        )
    }

    func test_같은_행이면_스냅샷도_같다() {
        XCTAssertEqual(
            AlarmKitViewModel.SchedulingSnapshot(record(enabled: true)),
            AlarmKitViewModel.SchedulingSnapshot(record(enabled: true))
        )
    }
}

/// **취소에 실패해 남겨 둔 손잡이는 반드시 회수돼야 한다** (Codex #699 P1).
///
/// 남기기만 하고 쓰는 데가 없으면 남긴 의미가 없다 — 그 행은 꺼져 있어 복구가 건너뛰고,
/// 같은 계정으로 다시 로그인해도 '남의 것 취소' 가 건너뛴다. 그동안 OS 예약은 살아 있어
/// **꺼 놓은 알람이 울리고**, 울리면 `markRinging` 이 그 행을 도로 켠다.
@MainActor
final class PendingCancellationTests: XCTestCase {

    private func alarm(id: String, enabled: Bool, kitID: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: id, label: "아침", hour: 7, minute: 0, fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = enabled
        r.alarmKitID = kitID
        return r
    }

    func test_꺼졌는데_손잡이가_남은_행만_회수한다() {
        let candidates = AlarmKitViewModel.pendingCancellationCandidates([
            alarm(id: "못끔", enabled: false, kitID: "KIT-1"),   // 취소 실패로 남긴 것
            alarm(id: "정상끔", enabled: false, kitID: nil),      // 평범하게 꺼진 행
            alarm(id: "켜짐", enabled: true, kitID: "KIT-2"),     // 멀쩡히 예약된 알람
        ])

        XCTAssertEqual(candidates.map(\.id), ["못끔"], "켜진 알람을 끊으면 멀쩡한 알람이 죽는다")
    }

    func test_회수할_것이_없으면_빈_목록() {
        let candidates = AlarmKitViewModel.pendingCancellationCandidates([
            alarm(id: "켜짐", enabled: true, kitID: "KIT-1")
        ])
        XCTAssertTrue(candidates.isEmpty)
    }
}
