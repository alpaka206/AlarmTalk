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
// TIMEZONE: 공휴일 KEY(시드/엔진 epochDay·고정 월/일)는 존 독립 civil 값이다. 질의(알람 날짜) 쪽만
// 스케줄링/디바이스 존(.current)으로 민용일을 환산해 평가한다 — Android AlarmTimeCalculator 가
// LocalDate(systemDefault)를 그대로 isHoliday 에 넘기는 것과 동등. (질의를 고정 Asia/Seoul 로 버킷팅하면
// 비-KST 디바이스에서 스케줄링하는 민용일과 하루 어긋나 휴일 skip 이 오작동하던 버그를 수정.)
enum LocalHolidayCalendar {
    /// Date instant 질의. 알람 스케줄링과 동일하게 디바이스(스케줄링) 존으로 민용일을 환산해 평가한다.
    static func isHoliday(_ date: Date,
                          countryCode: String = HolidayStore.defaultCountryCode,
                          timeZone: TimeZone = .current) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        guard let y = comps.year, let m = comps.month, let d = comps.day else { return false }
        return isHoliday(year: y, month: m, day: d, countryCode: countryCode)
    }

    /// 민용일(y/m/d) 직접 질의. 존 독립 civil epochDay/월·일로 평가한다.
    static func isHoliday(year y: Int, month m: Int, day d: Int,
                          countryCode: String = HolidayStore.defaultCountryCode) -> Bool {
        switch countryCode.uppercased() {
        case "KR":
            let epoch = KoreanLunarHolidayEngine.epochDay(year: y, month: m, day: d)
            return isKoreanFixedHoliday(month: m, day: d)
                || KoreanLunarHolidayEngine.isLunarHoliday(epochDay: epoch, year: y)
                || KoreanLunarHolidayEngine.isSubstituteHoliday(epochDay: epoch, year: y)
        default:
            return false
        }
    }

    private static func isKoreanFixedHoliday(month m: Int, day d: Int) -> Bool {
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
    /// Phase 2: 지원 국가는 정확히 이 5개. (EU/GB 없음.)
    nonisolated static let supportedCountryCodes = ["KR", "JP", "US", "VN", "CN"]

    /// UserDefaults 키 — 앱 전역 단일 국가 설정.
    nonisolated static let countryDefaultsKey = "holiday.selectedCountryCode"

    /// region 코드를 현재 로케일 기준 표시명으로. ("KR" → "대한민국" / "South Korea")
    nonisolated static func localizedCountryName(_ code: String) -> String {
        Locale.current.localizedString(forRegionCode: code) ?? code
    }

    /// 디바이스 로케일 지역이 지원 집합에 있으면 그것을, 아니면 "KR".
    nonisolated static func defaultCountryFromLocale() -> String {
        let region = Locale.current.region?.identifier.uppercased() ?? ""
        return supportedCountryCodes.contains(region) ? region : defaultCountryCode
    }

    @Published private(set) var holidays: [HolidayEntity] = []

    /// 앱 전역 단일 국가 설정 (per-alarm 아님). 변경 시 UserDefaults 영속 +
    /// 선택 국가 sync + onCountryChanged 콜백.
    @Published var selectedCountryCode: String {
        didSet {
            guard didFinishInit else { return }
            UserDefaults.standard.set(selectedCountryCode, forKey: Self.countryDefaultsKey)
            let cc = selectedCountryCode
            Task { await self.ensureSynced(countryCode: cc) }
            onCountryChanged?()
        }
    }

    /// 국가 변경 시 재무장/재계산을 트리거하도록 AlarmTalkApp 이 설정한다.
    var onCountryChanged: (() -> Void)?

    /// init 단계에서 didSet 이 UserDefaults 를 다시 쓰지 않도록 가드.
    private var didFinishInit = false

    /// 동일 국가 중복 sync 방지.
    private var inFlightSyncCountries: Set<String> = []

    private let persistence: HolidayPersistence

    init() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let storageURL = directory.appendingPathComponent("voice-alarm-ios-holidays.json")
        self.persistence = HolidayPersistence(storageURL: storageURL)

        // 영속된 국가 설정 로드 — 없거나 지원 외면 디바이스 로케일 기반 기본값.
        let persisted = UserDefaults.standard.string(forKey: Self.countryDefaultsKey)
        if let persisted, Self.supportedCountryCodes.contains(persisted.uppercased()) {
            self.selectedCountryCode = persisted.uppercased()
        } else {
            self.selectedCountryCode = Self.defaultCountryFromLocale()
        }
        // init 이후부터 didSet 영속/sync 동작 허용.
        self.didFinishInit = true

        Task { [persistence] in
            let loaded = await persistence.load()
            await MainActor.run { self.holidays = loaded }
            await self.seedDefaultsIfNeeded()
            await self.ensureSynced(countryCode: self.selectedCountryCode)
        }
    }

    // MARK: Queries

    func isHoliday(_ date: Date,
                   countryCode: String? = nil,
                   timeZone: TimeZone = .current) -> Bool {
        let cc = countryCode ?? selectedCountryCode
        // 질의 날짜를 스케줄링/디바이스 존의 민용일(y/m/d)로 환산한다 (Android 의 LocalDate 동등).
        // 캐시 KEY(epochDay)·고정공휴일 월/일은 존 독립 civil 값이므로 비교가 정확히 정렬된다.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        guard let y = comps.year, let m = comps.month, let d = comps.day else { return false }
        let epochDay = KoreanLunarHolidayEngine.epochDay(year: y, month: m, day: d)
        let inCache = holidays.contains { h in
            h.countryCode.uppercased() == cc.uppercased() &&
                h.epochDay == epochDay
        }
        return inCache || LocalHolidayCalendar.isHoliday(year: y, month: m, day: d, countryCode: cc)
    }

    /// Android `HolidayCalendarStore.upcomingHolidays` / DAO `getUpcoming` 동등.
    /// from(기본 오늘) 이후 가장 가까운 공휴일 count(기본 5)개. 상한 날짜 없음(LIMIT 만) —
    /// 370일 ceiling 으로 자르지 않아 Android 와 개수/윈도 시맨틱이 일치한다.
    func upcomingHolidays(countryCode: String? = nil,
                          from: Date = Date(),
                          count: Int = 5,
                          timeZone: TimeZone = .current) -> [HolidayEntity] {
        let cc = countryCode ?? selectedCountryCode
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: from)
        let startEpoch = KoreanLunarHolidayEngine.epochDay(
            year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1
        )
        return holidays
            .filter { $0.countryCode.uppercased() == cc.uppercased() && $0.epochDay >= startEpoch }
            .sorted { $0.epochDay < $1.epochDay }
            .prefix(count)
            .map { $0 }
    }

    /// Android `holidayPredicate` 와 동일 의미. AlarmTimeCalculator 에 주입.
    /// countryCode == nil 이면 평가 시점에 selectedCountryCode 로 resolve 해
    /// 설정 변경에 반응적이다 (weak-self 폴백 분기는 defaultCountryCode 로 resolve).
    func holidayPredicate(
        countryCode: String? = nil,
        startDate: Date = Date()
    ) -> (Date) -> Bool {
        return { [weak self] date in
            guard let self else {
                let cc = countryCode ?? Self.defaultCountryCode
                return LocalHolidayCalendar.isHoliday(date, countryCode: cc)
            }
            return self.isHoliday(date, countryCode: countryCode)
        }
    }

    // MARK: Seeding / sync

    /// 선택 국가의 공휴일을 백엔드 `/holiday` 에서 가져와 캐시한다.
    /// KR 은 온디바이스(시드 + 음력 엔진)라 네트워크가 필요 없어 즉시 return.
    /// 이미 해당 국가 행이 있으면(=한 번 받음) 재요청하지 않는다. 실패는 삼켜
    /// UI 가 placeholder 를 보이도록 한다.
    func ensureSynced(countryCode: String) async {
        let cc = countryCode.uppercased()
        if cc == "KR" { return }
        if holidays.contains(where: { $0.countryCode.uppercased() == cc }) { return }
        if inFlightSyncCountries.contains(cc) { return }
        inFlightSyncCountries.insert(cc)
        defer { inFlightSyncCountries.remove(cc) }

        // from = today, to = today + ~395일. HolidayStore.formatDate 와 동일한
        // Asia/Seoul gregorian 시계로 문자열화.
        let seoul = KoreanLunarHolidayEngine.seoulGregorian
        let today = Date()
        let toDate = seoul.date(byAdding: .day, value: 395, to: today) ?? today
        let from = Self.formatDate(today)
        let to = Self.formatDate(toDate)

        do {
            let result = try await AlarmTalkAPI.shared.fetchHolidays(
                country: cc,
                from: from,
                to: to,
                lang: Self.uiLanguageCode()
            )
            if !result.isEmpty {
                upsertAll(result)
            }
        } catch {
            // Swallow — UI 가 placeholder 를 표시한다.
        }
    }

    /// 백엔드 `lang` 파라미터에 쓸 UI 언어 코드 (없으면 nil).
    nonisolated private static func uiLanguageCode() -> String? {
        Locale.preferredLanguages.first.flatMap { Locale(identifier: $0).language.languageCode?.identifier }
    }

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
