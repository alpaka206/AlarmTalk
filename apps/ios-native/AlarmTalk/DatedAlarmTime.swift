import Foundation

/// **날짜 지정 알람(한 번)** 의 시각 계산 — 스펙 `docs/spec/alarm-lifecycle.md` §4.
///
/// 날짜 알람은 `targetDate`(YYYY-MM-DD) 의 시:분을 `targetTimezone`(IANA) 으로 읽은 **절대 시각**에
/// 한 번 운다. 기기 시간대가 바뀌어도 벽시계 시각을 따라가지 않는다 — 반복 알람과 정반대라 계산을
/// 이 한 곳에 모은다. 호출부에서 `Calendar` 를 따로 조립하지 말 것.
enum DatedAlarmTime {

    /// 저장된 시간대 이름으로 시간대를 고른다. 없거나 모르는 이름이면 지금 기기 시간대다.
    static func timeZone(_ identifier: String?) -> TimeZone {
        identifier.nilIfBlank.flatMap(TimeZone.init(identifier:)) ?? .current
    }

    private static func calendar(_ timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// 저장 형식 `YYYY-MM-DD`(서버 `alarms.target_date` 와 같다)를 날짜 성분으로 읽는다.
    /// 실제로 없는 날(2월 30일)은 nil 이다.
    static func components(of targetDate: String) -> DateComponents? {
        let parts = targetDate.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        let utc = calendar(TimeZone(identifier: "UTC") ?? .current)
        guard let date = utc.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let back = utc.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return DateComponents(year: year, month: month, day: day)
    }

    static func isValidTargetDate(_ targetDate: String?) -> Bool {
        guard let targetDate else { return false }
        return components(of: targetDate) != nil
    }

    /// 발사 시각(epoch ms). 서머타임으로 없는 시각은 Foundation 달력이 앞으로 민 시각이다(스펙 §4-2).
    static func fireAtMillis(targetDate: String, hour: Int, minute: Int, timeZoneID: String?) -> Int64? {
        guard (0...23).contains(hour), (0...59).contains(minute),
              var parts = components(of: targetDate) else { return nil }
        parts.hour = hour
        parts.minute = minute
        parts.second = 0
        guard let date = calendar(timeZone(timeZoneID)).date(from: parts) else { return nil }
        return Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    /// 그 시간대에서 본 날짜 문자열.
    static func dateString(for date: Date, in timeZone: TimeZone) -> String {
        let parts = calendar(timeZone).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }

    /// 그 날짜 문자열을 날짜 고르기에 넘길 값(그 시간대의 정오 — 자정은 시간대가 달라지면 하루가 밀린다).
    static func pickerDate(for targetDate: String, in timeZone: TimeZone) -> Date? {
        guard var parts = components(of: targetDate) else { return nil }
        parts.hour = 12
        return calendar(timeZone).date(from: parts)
    }

    /// 스위치를 켤 때의 첫 날짜 — 지금 고른 시각이 아직 오지 않았으면 오늘, 지났으면 내일(스펙 alarm-editor.md §2-1).
    static func defaultTargetDate(
        hour: Int,
        minute: Int,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        timeZone: TimeZone = .current
    ) -> String {
        let now = Date(timeIntervalSince1970: TimeInterval(nowMillis) / 1000)
        let cal = calendar(timeZone)
        let today = dateString(for: now, in: timeZone)
        if let fire = fireAtMillis(targetDate: today, hour: hour, minute: minute, timeZoneID: timeZone.identifier),
           fire > nowMillis {
            return today
        }
        let tomorrow = cal.date(byAdding: .day, value: 1, to: now) ?? now
        return dateString(for: tomorrow, in: timeZone)
    }

    /// 이미 지난 시각인가 — 저장·켜기를 막는 판정(스펙 §4-3·§4-4). 계산이 안 되는 날짜도 지난 것으로 본다.
    static func hasPassed(targetDate: String, hour: Int, minute: Int, timeZoneID: String?, nowMillis: Int64) -> Bool {
        guard let fire = fireAtMillis(targetDate: targetDate, hour: hour, minute: minute, timeZoneID: timeZoneID) else {
            return true
        }
        return fire <= nowMillis
    }

    /// 기기 시간대가 알람의 시간대와 다를 때 붙이는 한 줄 — "<시간대> 기준 · 이 기기 시각 <날짜 시각>"(스펙 §4-2).
    /// 같으면 nil 이다(같은 오프셋이라도 이름이 다르면 붙인다 — 서머타임이 갈리는 날이 있다).
    static func timezoneNote(
        targetDate: String,
        hour: Int,
        minute: Int,
        timeZoneID: String?,
        deviceTimeZone: TimeZone = .current
    ) -> String? {
        guard let identifier = timeZoneID.nilIfBlank,
              identifier != deviceTimeZone.identifier,
              let fire = fireAtMillis(targetDate: targetDate, hour: hour, minute: minute, timeZoneID: identifier)
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.timeZone = deviceTimeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd EEE jmm")
        let local = formatter.string(from: Date(timeIntervalSince1970: TimeInterval(fire) / 1000))
        return String(localized: "\(String(identifier)) 기준 · 이 기기 시각 \(String(local))")
    }
}

extension LocalAlarmRecord {
    /// 날짜 지정 알람인가 — `targetDate` 가 있으면 그렇다(스펙 alarm-lifecycle.md §4-1).
    var isDated: Bool { targetDate.nilIfBlank != nil }

    /// 다음 회차를 **계산해 다시 거는** 반복 알람인가. 날짜 알람은 요일 값이 남아 있어도 반복이 아니다 —
    /// 정지·복구 갈래가 이 이름 하나로 가른다(`markStopped`·`prepareForScheduleRecovery`).
    var isRecurring: Bool { repeatDaysMask != 0 && !isDated }

    /// 날짜 알람의 발사 시각(`targetDate`·`targetTimezone` 기준). 날짜 알람이 아니거나 계산이 안 되면 nil.
    var datedFireAtMillis: Int64? {
        guard let targetDate = targetDate.nilIfBlank else { return nil }
        return DatedAlarmTime.fireAtMillis(targetDate: targetDate, hour: hour, minute: minute, timeZoneID: targetTimezone)
    }

    /// 날짜 알람인데 그 시각이 이미 지났는가. 날짜 알람이 아니면 false.
    func datedTimeHasPassed(nowMillis: Int64) -> Bool {
        guard let targetDate = targetDate.nilIfBlank else { return false }
        return DatedAlarmTime.hasPassed(
            targetDate: targetDate, hour: hour, minute: minute, timeZoneID: targetTimezone, nowMillis: nowMillis
        )
    }

    /// 알람 행·편집기의 시간대 안내 한 줄. 날짜 알람이 아니거나 기기 시간대와 같으면 nil.
    func datedTimezoneNote(deviceTimeZone: TimeZone = .current) -> String? {
        guard let targetDate = targetDate.nilIfBlank else { return nil }
        return DatedAlarmTime.timezoneNote(
            targetDate: targetDate, hour: hour, minute: minute, timeZoneID: targetTimezone, deviceTimeZone: deviceTimeZone
        )
    }
}
