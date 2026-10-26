import XCTest
@testable import AlarmTalk

/// **날짜 지정 알람(한 번)** — 스펙 `docs/spec/alarm-lifecycle.md` §4, `docs/spec/alarm-editor.md` §2-1.
@MainActor
final class DatedAlarmTests: XCTestCase {

    private let seoul = TimeZone(identifier: "Asia/Seoul")!
    private let london = TimeZone(identifier: "Europe/London")!

    private func millis(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int, in zone: TimeZone) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let date = cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("dated-alarm-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func dated(
        _ targetDate: String,
        hour: Int = 7,
        minute: Int = 0,
        zone: String = "Asia/Seoul",
        enabled: Bool = true,
        state: AlarmRuntimeState = .armed
    ) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "내일 한 줄",
            hour: hour,
            minute: minute,
            fireAtMillis: 0,
            enabled: enabled,
            state: state.rawValue
        )
        record.targetDate = targetDate
        record.targetTimezone = zone
        record.fireAtMillis = record.datedFireAtMillis ?? 0
        return record
    }

    // MARK: - 시각 계산

    func testFireTimeIsFixedInTheConfirmedTimeZone() {
        let fire = DatedAlarmTime.fireAtMillis(targetDate: "2026-10-27", hour: 7, minute: 0, timeZoneID: "Asia/Seoul")
        XCTAssertEqual(fire, millis(2026, 10, 27, 7, 0, in: seoul))
        // 기기 시간대가 어디든 같은 절대 시각이다 — 계산은 저장된 시간대만 본다.
        let sameFromRecord = dated("2026-10-27").datedFireAtMillis
        XCTAssertEqual(sameFromRecord, fire)
        // 런던 기준이면 다른 절대 시각이다.
        XCTAssertEqual(
            DatedAlarmTime.fireAtMillis(targetDate: "2026-10-27", hour: 7, minute: 0, timeZoneID: "Europe/London"),
            millis(2026, 10, 27, 7, 0, in: london)
        )
    }

    func testInvalidDatesAreRejected() {
        XCTAssertNil(DatedAlarmTime.components(of: "2026-02-30"))
        XCTAssertNil(DatedAlarmTime.components(of: "2026-1-05"))
        XCTAssertNil(DatedAlarmTime.components(of: "20261005"))
        XCTAssertNil(DatedAlarmTime.components(of: "２０２６-10-05"))
        XCTAssertNotNil(DatedAlarmTime.components(of: "2028-02-29"))
        XCTAssertNil(DatedAlarmTime.fireAtMillis(targetDate: "2026-13-01", hour: 7, minute: 0, timeZoneID: nil))
    }

    func testRecordNextFireDoesNotRollToTomorrow() throws {
        // 지난 날짜 알람도 다음 날로 넘기지 않는다 — 반복 계산을 타지 않는다.
        let record = dated("2026-10-27")
        let after = millis(2026, 10, 28, 9, 0, in: seoul)
        XCTAssertEqual(try record.nextFireAtMillis(nowMillis: after, isHoliday: { _ in false }), record.datedFireAtMillis)
        XCTAssertTrue(record.datedTimeHasPassed(nowMillis: after))
        XCTAssertFalse(record.datedTimeHasPassed(nowMillis: millis(2026, 10, 27, 6, 59, in: seoul)))
    }

    func testDefaultTargetDateIsTodayIfTimeAheadElseTomorrow() {
        let morning = millis(2026, 10, 26, 6, 0, in: seoul)
        XCTAssertEqual(DatedAlarmTime.defaultTargetDate(hour: 7, minute: 0, nowMillis: morning, timeZone: seoul), "2026-10-26")
        let late = millis(2026, 10, 26, 7, 0, in: seoul)
        XCTAssertEqual(DatedAlarmTime.defaultTargetDate(hour: 7, minute: 0, nowMillis: late, timeZone: seoul), "2026-10-27")
    }

    func testTimezoneNoteOnlyWhenDeviceZoneDiffers() {
        XCTAssertNil(dated("2026-10-27").datedTimezoneNote(deviceTimeZone: seoul))
        XCTAssertNotNil(dated("2026-10-27").datedTimezoneNote(deviceTimeZone: london))
        var plain = dated("2026-10-27")
        plain.targetDate = nil
        XCTAssertNil(plain.datedTimezoneNote(deviceTimeZone: london))
    }

    // MARK: - 편집기 초안

    func testEnteringDatedModeClearsWeekdaysAndUsesDeviceZone() {
        var draft = AlarmEditDraft.newDefault()
        XCTAssertFalse(draft.isDated, "새 알람은 언제나 날짜 지정이 꺼진 채 열린다")
        draft.hour = 7
        draft.repeatDaysMask = RepeatDay.monday.mask
        draft.holidayOff = true
        draft.enterDatedMode(nowMillis: millis(2026, 10, 26, 8, 0, in: seoul), timeZone: seoul)
        XCTAssertEqual(draft.repeatDaysMask, 0)
        XCTAssertFalse(draft.holidayOff)
        XCTAssertEqual(draft.targetDate, "2026-10-27")
        XCTAssertEqual(draft.targetTimezone, "Asia/Seoul")
        draft.leaveDatedMode()
        XCTAssertNil(draft.targetDate)
        XCTAssertNil(draft.targetTimezone)
    }

    func testDraftRoundTripKeepsDateAndForcesExclusivity() {
        var draft = AlarmEditDraft.newDefault()
        draft.targetDate = "2026-10-27"
        draft.targetTimezone = "Asia/Seoul"
        draft.repeatDaysMask = RepeatDay.friday.mask
        draft.holidayOff = true
        let record = draft.toRecord(existing: nil, fireAtMillis: 1, nowMillis: 1)
        XCTAssertEqual(record.targetDate, "2026-10-27")
        XCTAssertEqual(record.targetTimezone, "Asia/Seoul")
        XCTAssertEqual(record.repeatDaysMask, 0)
        XCTAssertFalse(record.holidayOff)
        // 저장된 날짜 알람을 열면 그 날짜·시간대를 그대로 쓴다.
        let reopened = AlarmEditDraft(from: record)
        XCTAssertEqual(reopened.targetDate, "2026-10-27")
        XCTAssertEqual(reopened.targetTimezone, "Asia/Seoul")
        // 날짜 없는 알람은 시간대도 싣지 않는다.
        var plain = AlarmEditDraft.newDefault()
        plain.repeatDaysMask = RepeatDay.friday.mask
        let plainRecord = plain.toRecord(existing: record, fireAtMillis: 1, nowMillis: 1)
        XCTAssertNil(plainRecord.targetDate)
        XCTAssertNil(plainRecord.targetTimezone)
        XCTAssertEqual(plainRecord.repeatDaysMask, RepeatDay.friday.mask)
    }

    func testValidateDraftRejectsDateWithWeekdays() {
        var record = dated("2026-10-27")
        record.repeatDaysMask = RepeatDay.monday.mask
        XCTAssertThrowsError(try LocalAlarmStore.validateDraft(record)) { error in
            XCTAssertEqual(error as? LocalAlarmValidationError, .invalidTargetDate)
        }
        var bad = dated("2026-10-27")
        bad.targetDate = "2026-02-30"
        XCTAssertThrowsError(try LocalAlarmStore.validateDraft(bad))
        XCTAssertNoThrow(try LocalAlarmStore.validateDraft(dated("2026-10-27")))
    }

    // MARK: - 저장값 호환

    func testOldJSONWithoutDateFieldsDecodesAsUndated() throws {
        let json = """
        [{"id":"a1","label":"알람","hour":7,"minute":0,"fireAtMillis":1,"repeatDaysMask":0,
          "playMode":"alarm_only","enabled":true,"state":"armed"}]
        """
        let decoded = try JSONDecoder().decode([LocalAlarmRecord].self, from: Data(json.utf8))
        XCTAssertNil(decoded.first?.targetDate)
        XCTAssertNil(decoded.first?.targetTimezone)
        XCTAssertEqual(decoded.first?.isDated, false)
    }

    func testDateFieldsSurviveDiskRoundTrip() throws {
        let original = dated("2026-10-27", zone: "Europe/London")
        let data = try JSONEncoder().encode([original])
        let back = try JSONDecoder().decode([LocalAlarmRecord].self, from: data)
        XCTAssertEqual(back.first?.targetDate, "2026-10-27")
        XCTAssertEqual(back.first?.targetTimezone, "Europe/London")
    }

    // MARK: - 서버 본문

    private func body(_ record: LocalAlarmRecord) throws -> [String: Any] {
        let data = try AlarmTalkAPI.makeJSONEncoder().encode(RemoteAlarmMapper.toRemoteRequest(record))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testMapperSendsTargetDateAndConfirmedTimeZone() throws {
        let sent = try body(dated("2026-10-27", zone: "Europe/London"))
        XCTAssertEqual(sent["target_date"] as? String, "2026-10-27")
        XCTAssertEqual(sent["timezone"] as? String, "Europe/London")
        XCTAssertEqual(sent["repeat_days"] as? [Int], [])
    }

    func testMapperSendsExplicitNullWhenUndated() throws {
        var record = dated("2026-10-27")
        record.targetDate = nil
        record.targetTimezone = nil
        let sent = try body(record)
        XCTAssertTrue(sent.keys.contains("target_date"), "PATCH 가 지우게 null 로 싣는다")
        XCTAssertTrue(sent["target_date"] is NSNull)
        XCTAssertEqual(sent["timezone"] as? String, TimeZone.current.identifier)
    }

    // MARK: - 예약 모양

    func testDatedAlarmIsScheduledFixedNotRelative() {
        XCTAssertEqual(AlarmKitViewModel.scheduleKind(for: dated("2026-10-27")), .fixed)
        var once = dated("2026-10-27")
        once.targetDate = nil
        XCTAssertEqual(AlarmKitViewModel.scheduleKind(for: once), .relativeOnce)
        var weekly = once
        weekly.repeatDaysMask = RepeatDay.monday.mask
        XCTAssertEqual(AlarmKitViewModel.scheduleKind(for: weekly), .weekly)
    }

    func testDatedAlarmIsNotRecurringEvenWithStrayWeekdays() {
        var record = dated("2026-10-27")
        record.repeatDaysMask = RepeatDay.monday.mask
        record.holidayOff = true
        XCTAssertFalse(record.isRecurring)
        XCTAssertFalse(record.isHolidayOffRecurring, "공휴일off 재무장 갈래에 섞이지 않는다")
    }

    // MARK: - 저장소 전이

    func testStoppingADatedAlarmLeavesItDisabledWithoutNextOccurrence() {
        let store = makeStore()
        var record = dated("2026-10-27")
        record.alarmKitID = UUID().uuidString
        store.upsert(record)
        store.markStopped(alarmKitID: record.alarmKitID!, isHoliday: { _ in false })
        let after = store.record(id: record.id)
        XCTAssertEqual(after?.enabled, false)
        XCTAssertEqual(after?.runtimeStateEnum, .dismissed)
        XCTAssertEqual(after?.targetDate, "2026-10-27", "끝난 날짜 알람은 목록에 남는다")
        XCTAssertEqual(after?.fireAtMillis, record.fireAtMillis, "다음 날로 넘기지 않는다")
    }

    func testRecoveryOfAPastUnfiredDatedAlarmMarksFailed() {
        let store = makeStore()
        let record = dated("2026-10-27")
        store.upsert(record)
        let now = millis(2026, 10, 27, 8, 0, in: seoul)
        XCTAssertNil(store.prepareForScheduleRecovery(id: record.id, nowMillis: now, isHoliday: { _ in false }))
        let after = store.record(id: record.id)
        XCTAssertEqual(after?.enabled, false)
        XCTAssertEqual(after?.runtimeStateEnum, .failed)
    }

    func testRecoveryRecomputesFromDateNotWallClock() {
        let store = makeStore()
        var record = dated("2026-10-27")
        // 어긋난 값(예: 옛 빌드가 벽시계로 다시 계산한 값)이 남아 있어도 날짜·시간대로 되돌린다.
        record.fireAtMillis = millis(2026, 10, 27, 7, 0, in: london)
        store.upsert(record)
        let now = millis(2026, 10, 26, 12, 0, in: seoul)
        let prepared = store.prepareForScheduleRecovery(id: record.id, nowMillis: now, isHoliday: { _ in false })
        XCTAssertEqual(prepared?.fireAtMillis, millis(2026, 10, 27, 7, 0, in: seoul))
    }

    func testRecoveryKeepsSnoozeDeadline() {
        let store = makeStore()
        var record = dated("2026-10-27", state: .snoozed)
        let snoozeEnd = millis(2026, 10, 27, 7, 5, in: seoul)
        record.fireAtMillis = snoozeEnd
        store.upsert(record)
        let now = millis(2026, 10, 27, 7, 2, in: seoul)
        let prepared = store.prepareForScheduleRecovery(id: record.id, nowMillis: now, isHoliday: { _ in false })
        XCTAssertEqual(prepared?.fireAtMillis, snoozeEnd, "스누즈는 같은 회차 — 마감을 날짜 시각으로 되돌리지 않는다")
    }

    func testEnablingAPastDatedAlarmIsRefused() {
        let store = makeStore()
        let record = dated("2026-10-27", enabled: false, state: .dismissed)
        store.upsert(record)
        let now = millis(2026, 10, 28, 9, 0, in: seoul)
        XCTAssertFalse(store.setEnabled(id: record.id, enabled: true, nowMillis: now))
        XCTAssertEqual(store.record(id: record.id)?.enabled, false)
        // 아직 오지 않은 날짜면 켠다 — 날짜 시각 그대로.
        let before = millis(2026, 10, 26, 9, 0, in: seoul)
        XCTAssertTrue(store.setEnabled(id: record.id, enabled: true, nowMillis: before))
        XCTAssertEqual(store.record(id: record.id)?.fireAtMillis, record.datedFireAtMillis)
    }
}
