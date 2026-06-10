import XCTest
@testable import AlarmTalk

@MainActor
final class LocalAlarmStoreRecoveryTests: XCTestCase {

    func test_prepareForScheduleRecovery_repeatingPastAlarmMovesToNextFire() {
        let store = makeStore()
        let now = millis(2026, 5, 19, 9, 0)
        let oldKitID = "11111111-1111-1111-1111-111111111111"
        let alarm = LocalAlarmRecord(
            id: "repeating",
            label: "Repeating",
            hour: 8,
            minute: 0,
            fireAtMillis: millis(2026, 5, 18, 8, 0),
            repeatDaysMask: RepeatDay.wednesday.mask,
            snoozeCount: 2,
            enabled: true,
            state: AlarmRuntimeState.failed.rawValue,
            alarmKitID: oldKitID
        )
        store.upsert(alarm)

        let prepared = store.prepareForScheduleRecovery(
            id: alarm.id,
            nowMillis: now,
            isHoliday: { _ in false }
        )

        XCTAssertEqual(prepared?.fireAtMillis, millis(2026, 5, 20, 8, 0))
        XCTAssertEqual(prepared?.runtimeStateEnum, .armed)
        XCTAssertEqual(prepared?.snoozeCount, 0)
        XCTAssertTrue(prepared?.enabled == true)
        XCTAssertEqual(prepared?.alarmKitID, oldKitID)
    }

    func test_prepareForScheduleRecovery_expiredOneShotDisablesAndMarksFailed() {
        let store = makeStore()
        let now = millis(2026, 5, 19, 9, 0)
        let alarm = LocalAlarmRecord(
            id: "one-shot",
            label: "One shot",
            hour: 8,
            minute: 0,
            fireAtMillis: millis(2026, 5, 19, 8, 0),
            repeatDaysMask: 0,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            alarmKitID: "22222222-2222-2222-2222-222222222222"
        )
        store.upsert(alarm)

        let prepared = store.prepareForScheduleRecovery(
            id: alarm.id,
            nowMillis: now,
            isHoliday: { _ in false }
        )

        XCTAssertNil(prepared)
        let updated = store.record(id: alarm.id)
        XCTAssertFalse(updated?.enabled == true)
        XCTAssertEqual(updated?.runtimeStateEnum, .failed)
        XCTAssertNil(updated?.alarmKitID)
    }

    func test_prepareForScheduleRecovery_failedFutureAlarmArmsWithoutChangingFireAt() {
        let store = makeStore()
        let now = millis(2026, 5, 19, 9, 0)
        let fireAt = millis(2026, 5, 19, 10, 0)
        let alarm = LocalAlarmRecord(
            id: "future",
            label: "Future",
            hour: 10,
            minute: 0,
            fireAtMillis: fireAt,
            repeatDaysMask: 0,
            enabled: true,
            state: AlarmRuntimeState.failed.rawValue
        )
        store.upsert(alarm)

        let prepared = store.prepareForScheduleRecovery(
            id: alarm.id,
            nowMillis: now,
            isHoliday: { _ in false }
        )

        XCTAssertEqual(prepared?.fireAtMillis, fireAt)
        XCTAssertEqual(prepared?.runtimeStateEnum, .armed)
        XCTAssertTrue(prepared?.enabled == true)
    }

    func test_setEnabled_recomputesNextFireAndClearsSnooze() {
        let store = makeStore()
        let now = millis(2026, 5, 19, 9, 0)
        let alarm = LocalAlarmRecord(
            id: "disabled-past",
            label: "Disabled past",
            hour: 8,
            minute: 0,
            fireAtMillis: millis(2026, 5, 19, 8, 0),
            repeatDaysMask: RepeatDay.wednesday.mask,
            snoozeCount: 2,
            remoteAlarmId: "remote-1",
            syncState: AlarmSyncState.synced.rawValue,
            enabled: false,
            state: AlarmRuntimeState.disabled.rawValue,
            alarmKitID: "33333333-3333-3333-3333-333333333333"
        )
        store.upsert(alarm)

        store.setEnabled(
            id: alarm.id,
            enabled: true,
            nowMillis: now,
            isHoliday: { _ in false }
        )

        let updated = store.record(id: alarm.id)
        XCTAssertEqual(updated?.fireAtMillis, millis(2026, 5, 20, 8, 0))
        XCTAssertEqual(updated?.snoozeCount, 0)
        XCTAssertEqual(updated?.runtimeStateEnum, .armed)
        XCTAssertEqual(updated?.syncStateEnum, .dirty)
        XCTAssertNil(updated?.alarmKitID)
    }

    func test_setEnabled_disableClearsAlarmKitIDAndMarksDirty() {
        let store = makeStore()
        let alarm = LocalAlarmRecord(
            id: "enabled",
            label: "Enabled",
            hour: 8,
            minute: 0,
            fireAtMillis: millis(2026, 5, 20, 8, 0),
            remoteAlarmId: "remote-1",
            syncState: AlarmSyncState.synced.rawValue,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            alarmKitID: "44444444-4444-4444-4444-444444444444"
        )
        store.upsert(alarm)

        store.setEnabled(
            id: alarm.id,
            enabled: false,
            nowMillis: millis(2026, 5, 19, 9, 0)
        )

        let updated = store.record(id: alarm.id)
        XCTAssertFalse(updated?.enabled == true)
        XCTAssertEqual(updated?.runtimeStateEnum, .disabled)
        XCTAssertEqual(updated?.syncStateEnum, .dirty)
        XCTAssertNil(updated?.alarmKitID)
    }

    private func makeStore() -> LocalAlarmStore {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        return LocalAlarmStore(storageURL: url, loadFromDisk: false)
    }

    private func millis(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        var comps = DateComponents()
        comps.year = y
        comps.month = mo
        comps.day = d
        comps.hour = h
        comps.minute = mi
        comps.second = 0
        let date = cal.date(from: comps)!
        return Int64(date.timeIntervalSince1970 * 1000)
    }
}
