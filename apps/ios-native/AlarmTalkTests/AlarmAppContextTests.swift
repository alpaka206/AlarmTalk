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

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: nil)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.state, AlarmRuntimeState.snoozed.rawValue)
        XCTAssertEqual(updated.snoozeCount, 2)
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 7 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)
    }

    func test_handleAlarmSnoozed_overridesSnoozeMinutes() async throws {
        let kitID = UUID().uuidString
        let record = makeArmedRecord(alarmKitID: kitID)
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: 12)

        let updated = try XCTUnwrap(store.record(id: record.id))
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 12 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)
    }

    func test_handleAlarmSnoozed_unknownKitID_noMutation() async {
        let unknown = UUID().uuidString
        await ctx.handleAlarmSnoozed(alarmKitIDString: unknown, snoozeMinutesOverride: 5)
        XCTAssertTrue(store.alarms.isEmpty)
    }

    func test_handleAlarmSnoozed_disabledNoOps() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeEnabled = false
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: nil)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.snoozeCount, record.snoozeCount)
        XCTAssertEqual(updated.state, record.state)
    }

    func test_handleAlarmSnoozed_limitReachedNoOps() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeRepeatLimit = SnoozeRepeatLimit.three.rawValue
        record.snoozeCount = 3
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: nil)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.snoozeCount, 3)
        XCTAssertEqual(updated.state, record.state)
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
