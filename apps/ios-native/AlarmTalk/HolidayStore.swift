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
        ],
        2027: [
            HolidayDate(date: ymd(2027, 1, 1), name: "신정"),
            HolidayDate(date: ymd(2027, 2, 6), name: "설날 연휴"),
            HolidayDate(date: ymd(2027, 2, 7), name: "설날"),
            HolidayDate(date: ymd(2027, 2, 8), name: "설날 연휴"),
            HolidayDate(date: ymd(2027, 2, 9), name: "대체공휴일(설날)"),
            HolidayDate(date: ymd(2027, 3, 1), name: "삼일절"),
            HolidayDate(date: ymd(2027, 5, 5), name: "어린이날"),
            HolidayDate(date: ymd(2027, 5, 13), name: "부처님오신날"),
            HolidayDate(date: ymd(2027, 6, 6), name: "현충일"),
            HolidayDate(date: ymd(2027, 8, 15), name: "광복절"),
            HolidayDate(date: ymd(2027, 8, 16), name: "대체공휴일(광복절)"),
            HolidayDate(date: ymd(2027, 9, 14), name: "추석 연휴"),
            HolidayDate(date: ymd(2027, 9, 15), name: "추석"),
            HolidayDate(date: ymd(2027, 9, 16), name: "추석 연휴"),
            HolidayDate(date: ymd(2027, 10, 3), name: "개천절"),
            HolidayDate(date: ymd(2027, 10, 4), name: "대체공휴일(개천절)"),
            HolidayDate(date: ymd(2027, 10, 9), name: "한글날"),
            HolidayDate(date: ymd(2027, 10, 11), name: "대체공휴일(한글날)"),
            HolidayDate(date: ymd(2027, 12, 25), name: "성탄절"),
            HolidayDate(date: ymd(2027, 12, 27), name: "대체공휴일(성탄절)"),
        ],
        2028: [
            HolidayDate(date: ymd(2028, 1, 1), name: "신정"),
            HolidayDate(date: ymd(2028, 1, 26), name: "설날 연휴"),
            HolidayDate(date: ymd(2028, 1, 27), name: "설날"),
            HolidayDate(date: ymd(2028, 1, 28), name: "설날 연휴"),
            HolidayDate(date: ymd(2028, 3, 1), name: "삼일절"),
            HolidayDate(date: ymd(2028, 5, 2), name: "부처님오신날"),
            HolidayDate(date: ymd(2028, 5, 5), name: "어린이날"),
            HolidayDate(date: ymd(2028, 6, 6), name: "현충일"),
            HolidayDate(date: ymd(2028, 8, 15), name: "광복절"),
            HolidayDate(date: ymd(2028, 10, 2), name: "추석 연휴"),
            HolidayDate(date: ymd(2028, 10, 3), name: "추석/개천절"),
            HolidayDate(date: ymd(2028, 10, 4), name: "추석 연휴"),
            HolidayDate(date: ymd(2028, 10, 5), name: "대체공휴일(개천절)"),
            HolidayDate(date: ymd(2028, 10, 9), name: "한글날"),
            HolidayDate(date: ymd(2028, 12, 25), name: "성탄절"),
        ],
        2029: [
            HolidayDate(date: ymd(2029, 1, 1), name: "신정"),
            HolidayDate(date: ymd(2029, 2, 12), name: "설날 연휴"),
            HolidayDate(date: ymd(2029, 2, 13), name: "설날"),
            HolidayDate(date: ymd(2029, 2, 14), name: "설날 연휴"),
            HolidayDate(date: ymd(2029, 3, 1), name: "삼일절"),
            HolidayDate(date: ymd(2029, 5, 5), name: "어린이날"),
            HolidayDate(date: ymd(2029, 5, 7), name: "대체공휴일(어린이날)"),
            HolidayDate(date: ymd(2029, 5, 20), name: "부처님오신날"),
            HolidayDate(date: ymd(2029, 5, 21), name: "대체공휴일(부처님오신날)"),
            HolidayDate(date: ymd(2029, 6, 6), name: "현충일"),
            HolidayDate(date: ymd(2029, 8, 15), name: "광복절"),
            HolidayDate(date: ymd(2029, 9, 21), name: "추석 연휴"),
            HolidayDate(date: ymd(2029, 9, 22), name: "추석"),
            HolidayDate(date: ymd(2029, 9, 23), name: "추석 연휴"),
            HolidayDate(date: ymd(2029, 9, 24), name: "대체공휴일(추석)"),
            HolidayDate(date: ymd(2029, 10, 3), name: "개천절"),
            HolidayDate(date: ymd(2029, 10, 9), name: "한글날"),
            HolidayDate(date: ymd(2029, 12, 25), name: "성탄절"),
        ],
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
// Android `LocalHolidayCalendar.kt` 의 고정 공휴일에 더해, ON-DEVICE 음력/대체공휴일 계산 엔진을
// fallback 으로 보유한다. 시드 미커버 연도/지역(콜드 캐시·시드 지평선 너머)에서도 설날·추석·
// 부처님오신날 + 대체공휴일이 오프라인으로 정확하도록 보강.
//
// isHoliday(date, "KR") = isKoreanFixedHoliday(date)            // 고정 양력 (기존)
//                       || isKoreanLunarHoliday(date)            // 음력 계산 (신규)
//                       || isKoreanSubstituteHoliday(date)       // 대체공휴일 계산 (신규)
//
// 셋은 OR 결합이며, HolidayStore.isHoliday 가 cache(서버/시드)를 먼저 OR 하므로
// 효과적 우선순위: 서버 캐시 > 번들 시드 > 계산 엔진 > 고정 양력 (boolean SUPERSET, 자세한 의미는
// KoreanLunarHolidayEngine 상단 주석 참고).
//
// TIMEZONE: 모든 양력 판정을 KoreanLunarHolidayEngine 의 고정 Asia/Seoul 캘린더로 통일한다.
// (기존 코드는 Calendar.current 를 써서 UTC-11/UTC+14 디바이스에서 HolidaySeedData.ymd(Asia/Seoul)와
// 민용일이 어긋나는 latent 버그가 있었다 — 함께 수정.)
enum LocalHolidayCalendar {
    static func isHoliday(_ date: Date,
                          countryCode: String = HolidayStore.defaultCountryCode) -> Bool {
        switch countryCode.uppercased() {
        case "KR":
            return isKoreanFixedHoliday(date)
                || KoreanLunarHolidayEngine.isLunarHoliday(date)
                || KoreanLunarHolidayEngine.isSubstituteHoliday(date)
        default:
            return false
        }
    }

    private static func isKoreanFixedHoliday(_ date: Date) -> Bool {
        // Asia/Seoul 고정 캘린더로 월/일 추출 — 시드/엔진과 동일 시계.
        let comps = KoreanLunarHolidayEngine.seoulGregorian.dateComponents([.month, .day], from: date)
        guard let m = comps.month, let d = comps.day else { return false }
        switch (m, d) {
        case (1, 1), (3, 1), (5, 5), (6, 6), (8, 15), (10, 3), (10, 9), (12, 25):
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
        // currentYear..currentYear+2 까지 시드 (캘린더가 연말을 넘겨도 다음다음 해 시드가 닿도록).
        let years = Array(currentYear...(currentYear + 2))
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
    /// Asia/Seoul 고정 캘린더로 계산하여 HolidaySeedData.ymd(Asia/Seoul) 및 계산 엔진과 정확히 일치시킨다.
    /// (기존엔 start 는 gregorian, diff 는 Calendar.current 라서 디바이스 TZ 에 따라 ±1 이 가능했던 버그.)
    static func epochDay(of date: Date) -> Int {
        return KoreanLunarHolidayEngine.epochDay(of: date)
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
