import Foundation

/// Android `AlarmTimeCalculator.kt:8-69` 의 nextFireAtMillis 를 1:1 이식.
/// - 21일 lookahead 윈도우
/// - holidayOff: 해당 날짜가 휴일이면 skip
/// - repeatDaysMask == 0: 한 번만 알람 (오늘 candidate 가 미래면 오늘, 아니면 내일)
/// - repeatDaysMask 비트 규약: bit 0=Sun .. bit 6=Sat (Calendar.weekday - 1)
enum AlarmTimeCalculator {

    enum CalculatorError: LocalizedError {
        case invalidHour
        case invalidMinute
        case invalidMask

        var errorDescription: String? {
            switch self {
            case .invalidHour: return "Hour must be between 0 and 23."
            case .invalidMinute: return "Minute must be between 0 and 59."
            case .invalidMask: return "Repeat days mask must only use Sunday through Saturday bits."
            }
        }
    }

    /// 다음 발화 시각 (epoch ms).
    /// - Parameter isHoliday: 휴일 판정 클로저. 기본은 `LocalHolidayCalendar` 의 KR 고정 공휴일.
    static func nextFireAtMillis(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        holidayOff: Bool = false,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        timeZone: TimeZone = .current,
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) throws -> Int64 {
        guard (0...23).contains(hour) else { throw CalculatorError.invalidHour }
        guard (0...59).contains(minute) else { throw CalculatorError.invalidMinute }
        guard (0...0x7f).contains(repeatDaysMask) else { throw CalculatorError.invalidMask }

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone

        let now = Date(timeIntervalSince1970: TimeInterval(nowMillis) / 1000.0)

        // repeatDaysMask == 0 : 한 번만 알람.
        if repeatDaysMask == 0 {
            let todayCandidate = candidate(at: now, hour: hour, minute: minute, calendar: cal)
            if todayCandidate.timeIntervalSince(now) > 0 {
                return Self.epochMillis(of: todayCandidate)
            } else {
                let tomorrow = cal.date(byAdding: .day, value: 1, to: todayCandidate) ?? todayCandidate
                return Self.epochMillis(of: tomorrow)
            }
        }

        // 0..7 : 후보 일자에 시간을 박아 future 인 첫 결과
        for offset in 0...7 {
            guard let date = cal.date(byAdding: .day, value: offset, to: now) else { continue }
            guard isSelected(date: date, repeatDaysMask: repeatDaysMask, calendar: cal) else { continue }
            if holidayOff && isHoliday(date) { continue }

            let candidate = Self.candidate(at: date, hour: hour, minute: minute, calendar: cal)
            if candidate.timeIntervalSince(now) > 0 {
                return Self.epochMillis(of: candidate)
            }
        }

        // 8..21 : 미래임이 자명. 첫 매칭 날짜를 그대로 사용.
        for offset in 8...21 {
            guard let date = cal.date(byAdding: .day, value: offset, to: now) else { continue }
            guard isSelected(date: date, repeatDaysMask: repeatDaysMask, calendar: cal) else { continue }
            if holidayOff && isHoliday(date) { continue }
            let candidate = Self.candidate(at: date, hour: hour, minute: minute, calendar: cal)
            return Self.epochMillis(of: candidate)
        }

        // 폴백: 21일 안에도 매칭이 없는 비정상 케이스. 내일 시각으로 강제 폴백.
        let tomorrow = cal.date(byAdding: .day, value: 1, to: now) ?? now
        let candidate = Self.candidate(at: tomorrow, hour: hour, minute: minute, calendar: cal)
        return Self.epochMillis(of: candidate)
    }

    /// Android `AlarmTimeCalculator.isSelected` 동등.
    /// Calendar.weekday: 1=Sun..7=Sat 이므로 -1 변환 후 bit 검사.
    static func isSelected(date: Date, repeatDaysMask: Int, calendar: Calendar = .current) -> Bool {
        let weekday = calendar.component(.weekday, from: date)
        let dayIndex = (weekday - 1) % 7   // 0..6, 0=Sun
        return (repeatDaysMask & (1 << dayIndex)) != 0
    }

    // MARK: Helpers

    /// 주어진 day 의 hour:minute:00 으로 정규화된 Date.
    private static func candidate(at date: Date, hour: Int, minute: Int, calendar: Calendar) -> Date {
        var comps = calendar.dateComponents([.year, .month, .day], from: date)
        comps.hour = hour
        comps.minute = minute
        comps.second = 0
        return calendar.date(from: comps) ?? date
    }

    private static func epochMillis(of date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }
}
