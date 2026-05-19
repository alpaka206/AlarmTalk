import XCTest
@testable import VoiceAlarm

final class AlarmTimeCalculatorTests: XCTestCase {

    private let utc = TimeZone(secondsFromGMT: 0)!

    /// helper: yyyy/MM/dd HH:mm:ss (UTC) → millis
    private func millis(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        var comps = DateComponents()
        comps.year = y; comps.month = mo; comps.day = d
        comps.hour = h; comps.minute = mi; comps.second = 0
        let date = cal.date(from: comps)!
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    func test_oneShotAlarm_returnsTodayIfFuture() throws {
        // 2026-05-19 (Tue) 06:00 UTC. 알람은 같은 날 09:00.
        let now = millis(2026, 5, 19, 6, 0)
        let expected = millis(2026, 5, 19, 9, 0)
        let next = try AlarmTimeCalculator.nextFireAtMillis(
            hour: 9, minute: 0,
            repeatDaysMask: 0,
            holidayOff: false,
            nowMillis: now,
            timeZone: utc,
            isHoliday: { _ in false }
        )
        XCTAssertEqual(next, expected)
    }

    func test_oneShotAlarm_returnsTomorrowIfPast() throws {
        // 2026-05-19 (Tue) 09:30 UTC. 알람은 09:00 → 다음날.
        let now = millis(2026, 5, 19, 9, 30)
        let expected = millis(2026, 5, 20, 9, 0)
        let next = try AlarmTimeCalculator.nextFireAtMillis(
            hour: 9, minute: 0,
            repeatDaysMask: 0,
            holidayOff: false,
            nowMillis: now,
            timeZone: utc,
            isHoliday: { _ in false }
        )
        XCTAssertEqual(next, expected)
    }

    func test_weeklyAlarm_skipsHolidayWhenHolidayOffEnabled() throws {
        // 2026-05-19 (Tue) 06:00 UTC. 매주 화/수 07:00 알람.
        // 화요일(5/19) 이 휴일이라 가정하고 holidayOff=true 면 → 수요일(5/20) 07:00.
        let now = millis(2026, 5, 19, 6, 0)
        let tueIsHoliday: (Date) -> Bool = { date in
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = self.utc
            let comps = cal.dateComponents([.year, .month, .day], from: date)
            return comps.year == 2026 && comps.month == 5 && comps.day == 19
        }
        let mask = RepeatDay.tuesday.mask | RepeatDay.wednesday.mask
        let nextSkipped = try AlarmTimeCalculator.nextFireAtMillis(
            hour: 7, minute: 0,
            repeatDaysMask: mask,
            holidayOff: true,
            nowMillis: now,
            timeZone: utc,
            isHoliday: tueIsHoliday
        )
        let wedExpected = millis(2026, 5, 20, 7, 0)
        XCTAssertEqual(nextSkipped, wedExpected)

        // 동일 조건에서 holidayOff=false 면 화요일(5/19) 07:00.
        let nextKept = try AlarmTimeCalculator.nextFireAtMillis(
            hour: 7, minute: 0,
            repeatDaysMask: mask,
            holidayOff: false,
            nowMillis: now,
            timeZone: utc,
            isHoliday: tueIsHoliday
        )
        XCTAssertEqual(nextKept, millis(2026, 5, 19, 7, 0))
    }

    func test_weeklyAlarm_lookahead21DaysIfNoMatchInWeek() throws {
        // 매주 일요일 09:00. now 가 월요일 → 다음 일요일은 6일 후.
        // 2026-05-18 (Mon) 12:00 UTC.
        let now = millis(2026, 5, 18, 12, 0)
        let mask = RepeatDay.sunday.mask
        let next = try AlarmTimeCalculator.nextFireAtMillis(
            hour: 9, minute: 0,
            repeatDaysMask: mask,
            holidayOff: false,
            nowMillis: now,
            timeZone: utc,
            isHoliday: { _ in false }
        )
        let expected = millis(2026, 5, 24, 9, 0)
        XCTAssertEqual(next, expected)
    }

    func test_isSelected_calendarWeekdayMapping() {
        // 2026-05-19 = Tuesday. Calendar.weekday == 3.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        let date = cal.date(from: DateComponents(year: 2026, month: 5, day: 19))!

        XCTAssertTrue(AlarmTimeCalculator.isSelected(date: date, repeatDaysMask: RepeatDay.tuesday.mask, calendar: cal))
        XCTAssertFalse(AlarmTimeCalculator.isSelected(date: date, repeatDaysMask: RepeatDay.monday.mask, calendar: cal))
    }

    func test_invalidInputsThrow() {
        XCTAssertThrowsError(try AlarmTimeCalculator.nextFireAtMillis(
            hour: 24, minute: 0, repeatDaysMask: 0
        ))
        XCTAssertThrowsError(try AlarmTimeCalculator.nextFireAtMillis(
            hour: 0, minute: 60, repeatDaysMask: 0
        ))
        XCTAssertThrowsError(try AlarmTimeCalculator.nextFireAtMillis(
            hour: 0, minute: 0, repeatDaysMask: 0x80
        ))
    }
}
