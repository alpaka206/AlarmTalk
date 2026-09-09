import XCTest
@testable import AlarmTalk

@MainActor
final class AlarmAppContextTests: XCTestCase {

    private var store: LocalAlarmStore!
    private var ctx: AlarmAppContext!
    private var fixedNow: Date!

    override func setUp() async throws {
        // 디스크 storage 정리: LocalAlarmStore 가 documentDirectory 에 쓰므로
        // 새 store 를 만들기 전에 파일을 미리 지운다.
        //
        // ⚠ **경로를 손으로 조립하지 말 것.** 2026-08-19 까지 여기서 파일명을 직접 적었고,
        // 그래서 기기에서 테스트를 돌릴 때마다 **사용자의 진짜 알람 파일이 지워졌다.**
        // `TestIsolation` 이 갈라 준 경로를 반드시 저장소에게 물어서 쓴다.
        try? FileManager.default.removeItem(at: LocalAlarmStore.defaultStorageURL())

        store = LocalAlarmStore()
        // init 이 띄운 비동기 load Task 가 완료될 시간을 보장. 디스크 read 1회.
        try? await Task.sleep(nanoseconds: 50_000_000)
        // 안전망: load 가 남긴 게 있으면 비운다.
        for r in store.alarms { store.delete(r) }

        ctx = AlarmAppContext(store: store)
        fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
        ctx.nowProvider = { [fixedNow] in fixedNow! }
    }

    override func tearDown() async throws {
        AlarmAppContext.shared = nil
        ctx = nil
        store = nil
    }

    // MARK: - Stop

    func test_handleAlarmStopped_marksStore() async throws {
        let kitID = UUID().uuidString
        let record = makeArmedRecord(alarmKitID: kitID)
        store.upsert(record)

        await ctx.handleAlarmStopped(alarmKitIDString: kitID)

        // store: dismissed 로 전이.
        let stored = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(stored.state, AlarmRuntimeState.dismissed.rawValue)
        XCTAssertFalse(stored.enabled)
    }

    func test_handleAlarmStopped_unknownKitID_noMutation() async {
        let unknown = UUID().uuidString
        await ctx.handleAlarmStopped(alarmKitIDString: unknown)
        // 매칭되는 기록이 없으면 no-op — store 는 비어 있어야 한다.
        XCTAssertTrue(store.alarms.isEmpty)
    }

    func test_handleAlarmStopped_repeatingAlarmRemainsArmed() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.repeatDaysMask = RepeatDay.monday.mask
        store.upsert(record)

        await ctx.handleAlarmStopped(alarmKitIDString: kitID)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.state, AlarmRuntimeState.armed.rawValue)
        XCTAssertTrue(updated.enabled)
        XCTAssertEqual(updated.snoozeCount, 0)
    }

    // MARK: - Snooze

    func test_handleAlarmSnoozed_advancesFireAndIncrementsCount() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeMinutes = 7
        record.snoozeCount = 1
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.state, AlarmRuntimeState.snoozed.rawValue)
        XCTAssertEqual(updated.snoozeCount, 2)
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 7 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)
    }

    /// 미루는 시간은 **언제나 행의 값**이다 — 예약 때 `countdownDuration` 에 구워진 값이
    /// 그것이고 `countdown(id:)` 은 그걸 바꾸지 못한다. 예전에는 인텐트가 넘긴 값으로
    /// 행만 전진시켜, 홈 화면이 "30분 남음" 을 띄우고 5분 뒤에 울렸다(리뷰 39차).
    func test_handleAlarmSnoozed_usesRecordSnoozeMinutes() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeMinutes = 12
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID)

        let updated = try XCTUnwrap(store.record(id: record.id))
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 12 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)
    }

    func test_handleAlarmSnoozed_unknownKitID_noMutation() async {
        let unknown = UUID().uuidString
        await ctx.handleAlarmSnoozed(alarmKitIDString: unknown)
        XCTAssertTrue(store.alarms.isEmpty)
    }

    func test_handleAlarmSnoozed_disabledNoOps() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeEnabled = false
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.snoozeCount, record.snoozeCount)
        XCTAssertEqual(updated.state, record.state)
    }

    /// ⚠ **횟수 한도는 더 이상 다시 울림을 막지 않는다**(2026-09-09 지시로 설정을 없앴다).
    /// 예전에는 한도에 닿으면 무시했는데, 자동 재울림이 없으므로 그 숫자는 '사람이 누를 수
    /// 있는 횟수' 였고 그렇게 읽히지 않았다 — 한도에 닿으면 **'다시 울리기' 를 눌렀는데
    /// 알람이 꺼졌다.** 저장된 값은 행에 남지만 아무도 읽지 않는다.
    func test_handleAlarmSnoozed_한도를_넘겨도_미뤄진다() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeRepeatLimit = SnoozeRepeatLimit.three.rawValue
        record.snoozeCount = 3
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.snoozeCount, 4, "한도를 이유로 거절하면 안 된다")
        XCTAssertEqual(updated.state, AlarmRuntimeState.snoozed.rawValue)
    }

    // MARK: - Helpers

    private func makeArmedRecord(alarmKitID: String) -> LocalAlarmRecord {
        let now = Int64(fixedNow.timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            label: "test",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceProfileId: "profile-1",
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now,
            alarmKitID: alarmKitID
        )
    }
}
