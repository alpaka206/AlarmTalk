import Foundation

// MARK: - HolidayEntity
// Android `HolidayEntity.kt:9-21` 의 데이터 구조를 1:1 이식.
struct HolidayEntity: Codable, Hashable, Equatable {
    let countryCode: String     // ex: "KR"
    let regionCode: String      // 빈 문자열이면 전국 공휴일
    let epochDay: Int           // LocalDate.toEpochDay 동일 (1970-01-01 = 0)
    let localDate: String       // "yyyy-MM-dd"
    let name: String
    let source: String          // "bundled_seed" / "server_sync" / ...
    let updatedAtMillis: Int64
}

/// HolidayDate (이름 + Date) — 시드 입력용 보조 구조.
struct HolidayDate: Hashable, Equatable {
    let date: Date
    let name: String
}

// MARK: - HolidaySeedData
// Android `AlarmEntity.kt:117-148` 의 한국 2026 공휴일 시드를 그대로 이식.
enum HolidaySeedData {
    static func holidays(countryCode: String, year: Int) -> [HolidayDate] {
        switch countryCode.uppercased() {
        case "KR":
            return koreanHolidaysByYear[year] ?? []
        default:
            return []
        }
    }

    private static let koreanHolidaysByYear: [Int: [HolidayDate]] = [
        2026: [
            HolidayDate(date: ymd(2026, 1, 1), name: "신정"),
            HolidayDate(date: ymd(2026, 2, 16), name: "설날 연휴"),
            HolidayDate(date: ymd(2026, 2, 17), name: "설날"),
            HolidayDate(date: ymd(2026, 2, 18), name: "설날 연휴"),
            HolidayDate(date: ymd(2026, 3, 1), name: "삼일절"),
            HolidayDate(date: ymd(2026, 3, 2), name: "대체공휴일"),
            HolidayDate(date: ymd(2026, 5, 5), name: "어린이날"),
            HolidayDate(date: ymd(2026, 5, 24), name: "부처님오신날"),
            HolidayDate(date: ymd(2026, 5, 25), name: "대체공휴일"),
            HolidayDate(date: ymd(2026, 6, 3), name: "전국동시지방선거"),
            HolidayDate(date: ymd(2026, 6, 6), name: "현충일"),
            HolidayDate(date: ymd(2026, 8, 15), name: "광복절"),
            HolidayDate(date: ymd(2026, 8, 17), name: "대체공휴일"),
            HolidayDate(date: ymd(2026, 9, 24), name: "추석 연휴"),
            HolidayDate(date: ymd(2026, 9, 25), name: "추석"),
            HolidayDate(date: ymd(2026, 9, 26), name: "추석 연휴"),
            HolidayDate(date: ymd(2026, 10, 3), name: "개천절"),
            HolidayDate(date: ymd(2026, 10, 5), name: "대체공휴일"),
            HolidayDate(date: ymd(2026, 10, 9), name: "한글날"),
            HolidayDate(date: ymd(2026, 12, 25), name: "기독탄신일"),
        ]
    ]

    private static func ymd(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        return cal.date(from: comps) ?? Date(timeIntervalSince1970: 0)
    }
}

// MARK: - LocalHolidayCalendar
// Android `LocalHolidayCalendar.kt` 의 고정 + 대체공휴일 규칙을 fallback 으로 보유.
// 시드 미커버 연도/지역에서도 최소한 양력 고정 공휴일은 잡아주기 위함.
enum LocalHolidayCalendar {
    static func isHoliday(_ date: Date,
                          countryCode: String = HolidayStore.defaultCountryCode) -> Bool {
        switch countryCode.uppercased() {
        case "KR":
            return isKoreanFixedHoliday(date) || isKoreanObservedFixedHoliday(date)
        default:
            return false
        }
    }

    private static func isKoreanFixedHoliday(_ date: Date) -> Bool {
        let comps = Calendar.current.dateComponents([.month, .day], from: date)
        guard let m = comps.month, let d = comps.day else { return false }
        switch (m, d) {
        case (1, 1), (3, 1), (5, 5), (6, 6), (8, 15), (10, 3), (10, 9), (12, 25):
            return true
        default:
            return false
        }
    }

    private static func isKoreanObservedFixedHoliday(_ date: Date) -> Bool {
        let cal = Calendar.current
        // Calendar.weekday: 1=Sun..7=Sat. Monday == 2 일 때 대체 후보 검사.
        guard cal.component(.weekday, from: date) == 2 else { return false }
        guard let minus1 = cal.date(byAdding: .day, value: -1, to: date),
              let minus2 = cal.date(byAdding: .day, value: -2, to: date) else { return false }
        return isSubstituteEligible(minus1) || isSubstituteEligible(minus2)
    }

    private static func isSubstituteEligible(_ date: Date) -> Bool {
        let comps = Calendar.current.dateComponents([.month, .day], from: date)
        guard let m = comps.month, let d = comps.day else { return false }
        switch (m, d) {
        case (3, 1), (5, 5), (8, 15), (10, 3), (10, 9), (12, 25):
            return true
        default:
            return false
        }
    }
}

// MARK: - HolidayStore
/// Android `HolidayCalendarStore` 의 메모리 캐시 + DB 영속 동작을 JSON 파일로 이식.
/// 메인 스레드에서 호출하므로 디스크 I/O 는 actor 로 격리.
@MainActor
final class HolidayStore: ObservableObject {
    nonisolated static let defaultCountryCode = "KR"
    nonisolated static let defaultLookaheadDays = 370

    @Published private(set) var holidays: [HolidayEntity] = []

    private let persistence: HolidayPersistence

    init() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let storageURL = directory.appendingPathComponent("voice-alarm-ios-holidays.json")
        self.persistence = HolidayPersistence(storageURL: storageURL)
        Task { [persistence] in
            let loaded = await persistence.load()
            await MainActor.run { self.holidays = loaded }
            await self.seedDefaultsIfNeeded()
        }
    }

    // MARK: Queries

    func isHoliday(_ date: Date,
                   countryCode: String = HolidayStore.defaultCountryCode) -> Bool {
        let epochDay = Self.epochDay(of: date)
        let inCache = holidays.contains { h in
            h.countryCode.uppercased() == countryCode.uppercased() &&
                h.epochDay == epochDay
        }
        return inCache || LocalHolidayCalendar.isHoliday(date, countryCode: countryCode)
    }

    func holidaysIn(range: ClosedRange<Date>,
                    countryCode: String = HolidayStore.defaultCountryCode) -> [HolidayEntity] {
        let startEpoch = Self.epochDay(of: range.lowerBound)
        let endEpoch = Self.epochDay(of: range.upperBound)
        return holidays.filter { h in
            h.countryCode.uppercased() == countryCode.uppercased() &&
                h.epochDay >= startEpoch &&
                h.epochDay <= endEpoch
        }
    }

    /// Android `holidayPredicate` 와 동일 의미. AlarmTimeCalculator 에 주입.
    func holidayPredicate(
        countryCode: String = HolidayStore.defaultCountryCode,
        startDate: Date = Date()
    ) -> (Date) -> Bool {
        return { [weak self] date in
            guard let self else {
                return LocalHolidayCalendar.isHoliday(date, countryCode: countryCode)
            }
            return self.isHoliday(date, countryCode: countryCode)
        }
    }

    // MARK: Seeding / sync

    /// 시드 데이터를 영속 캐시에 upsert. 본 phase 는 KR 2026 한 해 분만 채워둠.
    func seedDefaultsIfNeeded() async {
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let calendar = Calendar.current
        let currentYear = calendar.component(.year, from: Date())
        let years = [currentYear, currentYear + 1]
        var collected: [HolidayEntity] = []
        for year in years {
            let seeded = HolidaySeedData.holidays(countryCode: Self.defaultCountryCode, year: year)
            for date in seeded {
                collected.append(
                    HolidayEntity(
                        countryCode: Self.defaultCountryCode,
                        regionCode: "",
                        epochDay: Self.epochDay(of: date.date),
                        localDate: Self.formatDate(date.date),
                        name: date.name,
                        source: "bundled_seed",
                        updatedAtMillis: nowMillis
                    )
                )
            }
        }
        guard !collected.isEmpty else { return }
        upsertAll(collected)
    }

    /// 서버 sync 진입점 placeholder. Phase 2-B3 또는 별도 작업에서 호출자가 구현.
    /// 시그니처만 정의해두고 구현은 미룬다.
    func syncFromRemote(_ remoteHolidays: [HolidayEntity]) {
        upsertAll(remoteHolidays)
    }

    func upsertAll(_ items: [HolidayEntity]) {
        var bucket = holidays
        for item in items {
            if let idx = bucket.firstIndex(where: {
                $0.countryCode == item.countryCode &&
                    $0.regionCode == item.regionCode &&
                    $0.epochDay == item.epochDay
            }) {
                bucket[idx] = item
            } else {
                bucket.append(item)
            }
        }
        holidays = bucket
        let snapshot = holidays
        Task { [persistence] in await persistence.save(snapshot) }
    }

    // MARK: Helpers

    /// LocalDate.toEpochDay 동등: 1970-01-01 을 0 으로 하는 정수 day.
    static func epochDay(of date: Date) -> Int {
        let cal = Calendar(identifier: .gregorian)
        let start = cal.date(from: DateComponents(year: 1970, month: 1, day: 1))
            ?? Date(timeIntervalSince1970: 0)
        let days = Calendar.current.dateComponents([.day], from: start, to: date).day ?? 0
        return days
    }

    static func formatDate(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: date)
    }
}

// MARK: - HolidayPersistence (actor)
actor HolidayPersistence {
    private let storageURL: URL

    init(storageURL: URL) {
        self.storageURL = storageURL
    }

    func load() -> [HolidayEntity] {
        guard let data = try? Data(contentsOf: storageURL) else { return [] }
        return (try? JSONDecoder().decode([HolidayEntity].self, from: data)) ?? []
    }

    func save(_ items: [HolidayEntity]) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(items) else { return }
        try? data.write(to: storageURL, options: [.atomic])
    }
}
