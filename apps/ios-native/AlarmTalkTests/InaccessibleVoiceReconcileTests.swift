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
    /// ⚠ **두 겹으로 공허했다**(2026-08-19 감사 P3). (a) 권위를 세우지 않아 첫 가드에서
    /// 되돌아갔고, (b) 픽스처 알람의 소유자가 `"owner-1"` 이라 설령 권위를 세워도
    /// nil-owner 갈래가 아무것도 결정하지 않았다. 둘 다 고쳐 **소유자 미기록 행이
    /// 로그아웃 상태에서 강등되지 않는지**를 실제로 잰다.
    func test_소유자를_모르면_아무것도_하지_않는다() {
        let store = makeStore()
        var record = alarm(id: "a", voiceProfileId: "clone-1")
        record.ownerUserId = nil       // 옛 행 — 로그인 상태였다면 '현재 계정 것' 으로 봤을 값
        store.upsert(record)
        let voice = VoiceStudioViewModel()
        // 권위를 세우지 않으면 첫 가드에서 되돌아가 아래 단언이 아무것도 지키지 못한다.
        voice.__setAccessibleVoicesForTests(profileIDs: [])

        XCTAssertEqual(
            voice.reconcileInaccessibleVoiceAlarms(alarmStore: store, audioCache: nil, ownerUserId: nil),
            0,
            "로그아웃 상태에서는 강등 대상을 가릴 기준이 없다 — 옛 행까지 건드리면 남의 알람을 깎는다"
        )
        XCTAssertEqual(store.record(id: "a")?.voiceProfileId, "clone-1", "행이 강등됐다")
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

/// **계정을 떠났는데 알람이 울리면 안 된다.** 예약을 끊고 **행도 끈다**(2026-08-19 지시).
///
/// ⚠ 이 주석은 한때 정확히 **반대**를 적고 있었다 — "`enabled` 는 사용자 의도라 건드리지
/// 않는다" 는 이 브랜치 첫 커밋의 서술이고, **같은 날 지시로 뒤집혔다**(커밋 18cc45a3).
/// 스펙이 규칙 1-1 의 회귀 테스트로 이 클래스를 지목하는데 그 문서가 옛 정책을 말하고
/// 있었으니, 여기를 근거로 삼은 사람은 반대로 고쳤을 것이다.
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

    /// ⚠ **시각을 고정한다.** 호출마다 `Date()` 를 읽으면 두 레코드의 `fireAtMillis` 가
    /// 밀리초 단위로 갈려, "같은 행이면 스냅샷도 같다" 가 **간헐적으로** 깨진다
    /// (2026-08-19 실제로 한 번 붉게 났다).
    private func record(enabled: Bool) -> LocalAlarmRecord {
        let now: Int64 = 1_700_000_000_000
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

/// **못 끊은 예약은 행 상태와 무관하게 기억한다** (Codex #699 P1).
///
/// 처음에는 "꺼졌는데 손잡이가 남은 행" 으로 회수 대상을 골랐는데, 그 판정은 두 군데서
/// 무너진다 — 그 예약이 **울리면** `markRinging` 이 행을 도로 켜 대상에서 빠지고,
/// 남의 계정 알람은 애초에 끄지 않으므로 켜진 채라 대상이 아니다.
/// 그래서 행이 아니라 **UUID** 를 따로 적는다.
@MainActor
final class PendingCancellationTests: XCTestCase {

    override func setUp() { PendingAlarmCancellationStore.removeAll() }
    override func tearDown() { PendingAlarmCancellationStore.removeAll() }

    func test_적어_두면_남는다() {
        PendingAlarmCancellationStore.add("KIT-1", origin: .accountLeave)
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-1"])
    }

    func test_같은_것을_두_번_적지_않는다() {
        PendingAlarmCancellationStore.add("KIT-1", origin: .accountLeave)
        PendingAlarmCancellationStore.add("KIT-1", origin: .accountLeave)
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-1"], "회차마다 목록이 불어난다")
    }

    func test_끊으면_지운다() {
        PendingAlarmCancellationStore.add("KIT-1", origin: .accountLeave)
        PendingAlarmCancellationStore.add("KIT-2", origin: .accountLeave)
        PendingAlarmCancellationStore.remove("KIT-1")
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-2"])
    }

    func test_빈_값은_적지_않는다() {
        PendingAlarmCancellationStore.add(nil, origin: .accountLeave)
        PendingAlarmCancellationStore.add("   ", origin: .accountLeave)
        XCTAssertTrue(PendingAlarmCancellationStore.all.isEmpty)
    }

    /// ⚠ **행이 다시 켜져도 목록은 그대로다.** 이게 행 상태로 기억하지 않는 이유다 —
    /// 고아 예약이 울려 `markRinging` 이 행을 켜도 회수 대상에서 빠지지 않아야 한다.
    /// ⚠ **출처를 구분한다**(Codex #699 P1). 회수는 끊은 뒤 행도 끄는데, 그 처리가 맞는 것은
    /// **떠나는 계정의 종료**에서 온 UUID 뿐이다 — 로그인 때 정리한 남의 계정 예약은 행을
    /// 일부러 켜 둔 것이라(자동 401) 끄면 그 사람이 돌아왔을 때 알람이 사라진다.
    func test_출처를_함께_기억한다() {
        PendingAlarmCancellationStore.add("KIT-LEAVE", origin: .accountLeave)
        PendingAlarmCancellationStore.add("KIT-FOREIGN", origin: .foreignCleanup)

        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: "KIT-LEAVE"), .accountLeave)
        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: "KIT-FOREIGN"), .foreignCleanup)
    }

    /// ⚠ **더 강한 출처로 올라간다.** 남의 계정 정리에서 먼저 실패한 UUID 를, 그 주인이
    /// 명시적으로 로그아웃하며 다시 실패하면 **그때는 행도 꺼야 한다.**
    func test_출처는_계정이탈로_승격된다() {
        PendingAlarmCancellationStore.add("KIT-X", origin: .foreignCleanup)
        PendingAlarmCancellationStore.add("KIT-X", origin: .accountLeave)

        XCTAssertEqual(
            PendingAlarmCancellationStore.origin(of: "KIT-X"), .accountLeave,
            "낡은 출처가 남으면 명시적으로 로그아웃한 알람이 다음 로그인에 되살아난다"
        )
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-X"], "목록이 불어났다")
    }

    /// 반대 방향으로는 내려가지 않는다 — 계정 이탈이 더 강한 뜻이다.
    func test_출처는_약한_쪽으로_내려가지_않는다() {
        PendingAlarmCancellationStore.add("KIT-Y", origin: .accountLeave)
        PendingAlarmCancellationStore.add("KIT-Y", origin: .foreignCleanup)

        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: "KIT-Y"), .accountLeave)
    }

    /// 기록이 없으면(이 빌드 이전에 적힌 값) **행을 건드리지 않는 쪽**으로 본다 —
    /// 못 가릴 때는 남의 알람을 끄는 것보다 켜 둔 채 두는 편이 되돌릴 수 있다.
    func test_출처_기록이_없으면_남의_것으로_본다() {
        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: "KIT-UNKNOWN"), .foreignCleanup)
    }

    func test_행_상태와_무관하다() {
        PendingAlarmCancellationStore.add("KIT-1", origin: .accountLeave)
        // (행을 어떻게 만지든 이 목록은 영향을 받지 않는다 — 저장소가 분리돼 있다.)
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-1"])
    }

    /// ⚠ **밀어낸 알람도 행을 다시 꺼야 한다**(Codex #703 P1).
    /// 받은 가족 알람이 같은 시각에서 밀어낸 알람은 취소가 실패한 채 울면 `markRinging` 이
    /// 행을 도로 켠다. 그때 회수가 손잡이만 지우고 끝내면 그 행은
    /// `enabled = true, alarmKitID = nil` — 정확히 복구 후보라 곧바로 다시 예약되어
    /// **받은 알람과 나란히 운다.**
    func test_밀어낸_예약은_행도_다시_끈다() {
        XCTAssertTrue(PendingAlarmCancellationStore.Origin.conflictDisplacement.restoresDisabledRow)
        XCTAssertTrue(PendingAlarmCancellationStore.Origin.accountLeave.restoresDisabledRow)
        XCTAssertFalse(
            PendingAlarmCancellationStore.Origin.foreignCleanup.restoresDisabledRow,
            "남의 계정 예약은 행을 일부러 켜 둔 것이다 — 끄면 그 사람이 돌아왔을 때 알람이 사라진다"
        )
    }

    /// ⚠ **못 끊은 예약은 '주인 행' 으로 되짚는다**(Codex #703 P1).
    /// 행의 `alarmKitID` 한 칸은 **지금 예약**을 가리키므로, 그 행이 한 번 더 재예약되면
    /// 못 끊은 옛 손잡이는 어느 행도 가리키지 않는다 — 손잡이로만 찾으면 그때부터 영영
    /// 못 찾고, 전달 정리는 "끊을 게 없다" 고 답해 ACK 가 서버 행을 지운다.
    func test_못_끊은_예약을_주인_행으로_되짚는다() {
        PendingAlarmCancellationStore.add("KIT-OLD", origin: .foreignCleanup, alarmID: "alarm-1")
        PendingAlarmCancellationStore.add("KIT-OTHER", origin: .foreignCleanup, alarmID: "alarm-2")

        XCTAssertEqual(PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-1"), ["KIT-OLD"])
        XCTAssertEqual(PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-2"), ["KIT-OTHER"])
        XCTAssertTrue(PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-3").isEmpty)
    }

    /// 같은 행이 여러 번 실패하면 전부 들고 있는다 — 한 회차에 하나씩만 갚으면
    /// 나머지가 조용히 남는다.
    func test_한_행의_고아를_모두_들고_있는다() {
        PendingAlarmCancellationStore.add("KIT-A", origin: .conflictDisplacement, alarmID: "alarm-1")
        PendingAlarmCancellationStore.add("KIT-B", origin: .conflictDisplacement, alarmID: "alarm-1")

        XCTAssertEqual(
            PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-1").sorted(),
            ["KIT-A", "KIT-B"]
        )
        PendingAlarmCancellationStore.remove("KIT-A")
        XCTAssertEqual(PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-1"), ["KIT-B"])
    }

    /// 주인을 안 적은 옛 기록은 되짚히지 않는다 — 그건 전경 sweep 의 몫이다.
    func test_주인_없는_기록은_행으로_되짚히지_않는다() {
        PendingAlarmCancellationStore.add("KIT-LEGACY", origin: .accountLeave)

        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-LEGACY"])
        XCTAssertTrue(PendingAlarmCancellationStore.owedHandles(forAlarmID: "alarm-1").isEmpty)
    }

    /// 승격 규칙은 '계정 이탈' 이라는 특정 값이 아니라 **행을 꺼야 하는가**로 판정한다.
    /// 값 목록을 조건문에 베끼면 출처가 늘 때마다 같이 고쳐야 하고, 언젠가 빠뜨린다.
    func test_출처는_밀어내기로도_승격된다() {
        PendingAlarmCancellationStore.add("KIT-Z", origin: .foreignCleanup)
        PendingAlarmCancellationStore.add("KIT-Z", origin: .conflictDisplacement)

        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: "KIT-Z"), .conflictDisplacement)
        XCTAssertEqual(PendingAlarmCancellationStore.all, ["KIT-Z"], "목록이 불어났다")
    }
}

/// **예약이 await 하는 동안 계정이 바뀌면 그 예약은 되돌려져야 한다** (Codex #699 P1).
///
/// `SchedulingSnapshot` 은 **행**이 바뀌었는지만 본다 — 활성 계정도 `ownerUserId` 도 담고
/// 있지 않아 이 경합을 못 잡는다. 그래서 세대 값 하나로 잰다.
@MainActor
final class AccountEpochTests: XCTestCase {

    func test_첫_관찰은_세대를_올리지_않는다() {
        let kit = AlarmKitViewModel()
        let before = kit.accountEpoch
        kit.noteActiveAccount("A")
        XCTAssertEqual(kit.accountEpoch, before, "앱을 켤 때마다 진행 중인 예약이 취소된다")
    }

    func test_같은_계정을_다시_봐도_그대로다() {
        let kit = AlarmKitViewModel()
        kit.noteActiveAccount("A")
        let before = kit.accountEpoch
        kit.noteActiveAccount("A")
        XCTAssertEqual(kit.accountEpoch, before)
    }

    func test_계정이_바뀌면_올라간다() {
        let kit = AlarmKitViewModel()
        kit.noteActiveAccount("A")
        let before = kit.accountEpoch
        kit.noteActiveAccount("B")
        XCTAssertEqual(kit.accountEpoch, before + 1, "A 의 진행 중 예약이 B 의 앱에 남는다")
    }

    /// 로그아웃(계정 없음)도 바뀐 것이다 — 그 사이 끝난 예약이 남으면 끌 수가 없다.
    func test_로그아웃도_세대를_올린다() {
        let kit = AlarmKitViewModel()
        kit.noteActiveAccount("A")
        let before = kit.accountEpoch
        kit.noteActiveAccount(nil)
        XCTAssertEqual(kit.accountEpoch, before + 1)
    }
}

/// **세션이 끝나기 전에 소유자를 새긴다** (Codex #699 P1).
///
/// 실제로 쓰이던 알람들은 소유자 없이 저장돼 있었다. 그 상태로 A 의 세션이 자동 401 로
/// 끊기면 행은 계속 `nil` 이고, 뒤이어 B 가 로그인했다 **명시적으로 로그아웃**하면
/// `nil` 을 '떠나는 계정 것' 으로 보는 규칙이 **A 의 알람을 영구히 끈다.**
@MainActor
final class ClaimUnownedAlarmsTests: XCTestCase {

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("claim-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func alarm(id: String, owner: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: id, label: "아침", hour: 7, minute: 0, fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = true
        r.ownerUserId = owner
        return r
    }

    func test_소유자_미기록_행에만_새긴다() {
        let store = makeStore()
        [alarm(id: "옛행", owner: nil), alarm(id: "남의것", owner: "B")].forEach { store.upsert($0) }

        let claimed = store.claimUnownedAlarms(for: "A")

        XCTAssertEqual(claimed, 1)
        XCTAssertEqual(store.record(id: "옛행")?.ownerUserId, "A")
        XCTAssertEqual(store.record(id: "남의것")?.ownerUserId, "B", "남의 행에 덮어썼다")
    }

    /// 새겨 두면 그 뒤에 들어온 계정이 로그아웃해도 앞 계정 알람이 살아남는다.
    func test_새긴_뒤에는_다음_계정_로그아웃이_건드리지_못한다() async {
        let store = makeStore()
        store.upsert(alarm(id: "A의것", owner: nil))
        store.claimUnownedAlarms(for: "A")   // A 의 세션이 끝나는 순간

        _ = await AlarmKitViewModel().stopAllScheduledAlarms(store: store, ownerUserId: "B")

        XCTAssertEqual(
            store.record(id: "A의것")?.enabled, true,
            "새기지 않았다면 B 의 로그아웃이 A 의 알람을 영구히 껐을 것이다"
        )
    }

    func test_계정이_없으면_아무것도_새기지_않는다() {
        let store = makeStore()
        store.upsert(alarm(id: "옛행", owner: nil))
        XCTAssertEqual(store.claimUnownedAlarms(for: nil), 0)
        XCTAssertNil(store.record(id: "옛행")?.ownerUserId)
    }
}

/// **끝내지 못한 로그아웃은 표시를 남겨 다음 실행이 마저 한다** (Codex #699 P1).
///
/// 뒷정리는 저장소가 로드된 뒤에만 할 수 있는데, 그 기다림에는 상한이 있다(3초).
/// 콜드 스타트 직후 로그아웃하면 그 창에 걸려 아무것도 못 끄고 끝난다 — 그 계정의
/// OS 예약은 살아 있는데 로그인 화면 뒤라 끌 수도 없다.
@MainActor
final class PendingSignOutStoreTests: XCTestCase {

    override func setUp() { PendingSignOutStore.removeAll() }
    override func tearDown() { PendingSignOutStore.removeAll() }

    func test_표시가_없으면_할_일이_없다() {
        XCTAssertTrue(PendingSignOutStore.pendingUserIds.isEmpty)
    }

    func test_계정을_적으면_그대로_남는다() {
        PendingSignOutStore.mark("A")
        XCTAssertEqual(PendingSignOutStore.pendingUserIds, ["A"])
    }

    /// ⚠ **한 칸이면 앞 계정이 덮인다**(Codex #699 P2). A 의 뒷정리가 오프라인으로 남아
    /// 있는데 B 가 로그인했다 로그아웃하면, A 의 푸시 바인딩과 토큰이 **영영** 정리되지 않는다.
    func test_여러_계정이_쌓인다() {
        PendingSignOutStore.mark("A")
        PendingSignOutStore.mark("B")
        XCTAssertEqual(PendingSignOutStore.pendingUserIds, ["A", "B"], "앞 계정이 덮였다")
    }

    func test_같은_계정을_두_번_적지_않는다() {
        PendingSignOutStore.mark("A")
        PendingSignOutStore.mark("A")
        XCTAssertEqual(PendingSignOutStore.pendingUserIds, ["A"])
    }

    /// 계정을 몰라도 표시 자체는 남아야 뒷정리가 돈다 — 그때는 '누구인지 모름' 으로 처리된다.
    func test_계정을_몰라도_표시는_남는다() {
        PendingSignOutStore.mark(nil)
        XCTAssertEqual(PendingSignOutStore.pendingUserIds.count, 1)
    }

    func test_끝난_계정만_지운다() {
        PendingSignOutStore.mark("A")
        PendingSignOutStore.mark("B")
        PendingSignOutStore.clear("B")
        XCTAssertEqual(PendingSignOutStore.pendingUserIds, ["A"], "남의 뒷정리까지 지웠다")
    }

    /// 토큰도 계정별이다 — 한 칸이면 B 의 로그아웃이 A 의 재시도 수단을 덮어쓴다.
    func test_토큰도_계정별로_보관한다() {
        PendingSignOutStore.markServerCleanup(token: "TOKEN-A", for: "A")
        PendingSignOutStore.markServerCleanup(token: "TOKEN-B", for: "B")

        XCTAssertEqual(PendingSignOutStore.serverCleanupToken(for: "A"), "TOKEN-A")
        XCTAssertEqual(PendingSignOutStore.serverCleanupToken(for: "B"), "TOKEN-B")

        PendingSignOutStore.clear("B")
        XCTAssertEqual(PendingSignOutStore.serverCleanupToken(for: "A"), "TOKEN-A", "남의 토큰까지 지웠다")
        XCTAssertNil(PendingSignOutStore.serverCleanupToken(for: "B"))
    }

}

/// **서버 뒷정리는 실패를 성공으로 보고하면 안 된다** (Codex #699 P2).
///
/// 이 값으로 로그아웃 복구 표시를 내릴지 정한다 — 오프라인이나 5xx 에서 표시를 지우면
/// 다음 실행이 재시도할 근거를 잃고, 기기는 떠난 계정에 묶인 채 알림을 계속 받는다.
@MainActor
final class ServerSignOutCleanupTests: XCTestCase {

    private final class StubAPI: AuthAPIProviding, @unchecked Sendable {
        var logoutError: Error?
        var logoutCalls = 0
        func me(token: String) async throws -> (token: String?, user: AuthUser) { throw APIError.invalidResponse }
        func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse { throw APIError.invalidResponse }
        func deleteAccount(token: String) async throws -> DeleteAccountResponse { throw APIError.invalidResponse }
        func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse { throw APIError.invalidResponse }
        func cancelAccountDeletion(token: String) async throws -> CancelDeletionResponse { throw APIError.invalidResponse }
        func consentStatus(token: String) async throws -> ConsentStatusResponse { throw APIError.invalidResponse }
        func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse { throw APIError.invalidResponse }
        func logout(token: String) async throws {
            logoutCalls += 1
            if let logoutError { throw logoutError }
        }
    }

    /// ⚠ **해제는 그 계정 몫일 때만 한다**(Codex #699 P2). 서버는 토큰만 보고 지우므로,
    /// 떠난 계정의 뒷정리가 **지금 로그인한 사람의 바인딩**을 지워 버릴 수 있다.
    func test_해제_대상_계정을_함께_넘긴다() async {
        let api = StubAPI()
        var seenOwner: String??
        _ = await AuthViewModel.runServerSignOutCleanup(
            token: "T",
            ownerUserId: "A",
            unregister: { _, owner, _ in seenOwner = .some(owner); return true },
            api: api
        )
        XCTAssertEqual(seenOwner ?? nil, "A", "누구 몫인지 모르면 남의 푸시를 끊는다")
    }

    /// ⚠ **철회되면 서버 호출 자체를 멈춘다**(Codex #699 P1). 로컬 `signOut` 만 막는 것으로는
    /// 늦다 — `/auth/logout` 이 이미 `token_epoch` 를 올려 **방금 되살린 세션을 죽인 뒤**다.
    func test_더_이상_필요없으면_서버를_부르지_않는다() async {
        let api = StubAPI()
        var unregisterCalls = 0
        let done = await AuthViewModel.runServerSignOutCleanup(
            token: "T",
            ownerUserId: "A",
            unregister: { _, _, _ in unregisterCalls += 1; return true },
            api: api,
            stillNeeded: { false }
        )
        XCTAssertFalse(done)
        XCTAssertEqual(unregisterCalls, 0)
        XCTAssertEqual(api.logoutCalls, 0, "철회됐는데 폐기하면 되살린 세션이 죽는다")
    }

    /// 해제가 도는 사이에 철회되면 **폐기는 하지 않는다** — 폐기는 되돌릴 수 없다.
    func test_해제_뒤에_철회되면_폐기하지_않는다() async {
        let api = StubAPI()
        // `stillNeeded` 는 여러 실행 맥락에서 불리므로 참조 타입에 담는다.
        final class Flag: @unchecked Sendable { var value = true }
        let needed = Flag()
        let done = await AuthViewModel.runServerSignOutCleanup(
            token: "T",
            ownerUserId: "A",
            unregister: { _, _, _ in needed.value = false; return true },   // 해제 도중 철회된 상황
            api: api,
            stillNeeded: { needed.value }
        )
        XCTAssertFalse(done)
        XCTAssertEqual(api.logoutCalls, 0)
    }

    func test_토큰이_없으면_할_일이_없다() async {
        let api = StubAPI()
        let done = await AuthViewModel.runServerSignOutCleanup(token: nil, ownerUserId: nil, unregister: { _, _, _ in true }, api: api)
        XCTAssertTrue(done)
        XCTAssertEqual(api.logoutCalls, 0)
    }

    func test_둘_다_성공해야_끝난_것이다() async {
        let api = StubAPI()
        let done = await AuthViewModel.runServerSignOutCleanup(token: "T", ownerUserId: "A", unregister: { _, _, _ in true }, api: api)
        XCTAssertTrue(done)
    }

    func test_푸시_해제가_실패하면_안_끝난_것이다() async {
        let api = StubAPI()
        let done = await AuthViewModel.runServerSignOutCleanup(token: "T", ownerUserId: "A", unregister: { _, _, _ in false }, api: api)
        XCTAssertFalse(done, "표시를 지우면 기기가 떠난 계정에 묶인 채 남는다")
        XCTAssertEqual(api.logoutCalls, 0, "해제가 실패했는데 폐기하면 재시도할 토큰이 죽는다")
    }

    func test_폐기가_5xx_면_안_끝난_것이다() async {
        let api = StubAPI()
        api.logoutError = APIError.server(status: 500, message: "boom", errorCode: nil)
        let done = await AuthViewModel.runServerSignOutCleanup(token: "T", ownerUserId: "A", unregister: { _, _, _ in true }, api: api)
        XCTAssertFalse(done)
    }

    /// 유예 탈퇴 계정은 백엔드가 폐기를 **허용하지 않는다**(403 `ACCOUNT_PENDING_DELETION`) —
    /// 실패로 치면 뒷정리 재시도가 영원히 돈다. 그 토큰이 살아 있는 건 의도된 것이다
    /// (탈퇴를 철회할 때 필요하다).
    func test_유예탈퇴_403_은_끝난_것으로_본다() async {
        let api = StubAPI()
        api.logoutError = APIError.server(
            status: 403, message: "Account is scheduled for deletion", errorCode: "ACCOUNT_PENDING_DELETION"
        )
        let done = await AuthViewModel.runServerSignOutCleanup(token: "T", ownerUserId: "A", unregister: { _, _, _ in true }, api: api)
        XCTAssertTrue(done, "폐기가 불가능한 상태를 실패로 치면 표시가 영원히 남는다")
    }

    /// 401 은 **이미 폐기됐다**는 뜻이라 성공으로 본다 — 실패로 치면 지울 수도 없는 것을
    /// 영원히 재시도하게 된다.
    func test_폐기가_401_이면_끝난_것으로_본다() async {
        let api = StubAPI()
        api.logoutError = APIError.server(status: 401, message: "unauthorized", errorCode: nil)
        let done = await AuthViewModel.runServerSignOutCleanup(token: "T", ownerUserId: "A", unregister: { _, _, _ in true }, api: api)
        XCTAssertTrue(done, "이미 폐기된 토큰을 영원히 재시도하게 된다")
    }
}
