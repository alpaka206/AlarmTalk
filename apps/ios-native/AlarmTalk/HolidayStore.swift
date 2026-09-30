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
    /// ⚠ **베트남·중국은 뺐다(2026-08-10).** 목록에서만 감추는 것이라, 이미 그 값을 고른
    /// 계정은 저장된 코드를 그대로 들고 있을 수 있다 — `localizedCountryName` 은 계속
    /// 그 코드를 이름으로 풀 수 있어야 하고, 선택 UI 에만 안 나온다.
    nonisolated static let supportedCountryCodes = ["KR", "JP", "US"]

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

    /// 이 날씨 지역이 정하는 공휴일 국가. 지역이 없거나 모르는 키면 nil — **건드리지 않는다**는 뜻이다.
    nonisolated static func countryCode(forWeatherRegion key: String?) -> String? {
        guard let code = WeatherRegions.byKey(key)?.country.code,
              supportedCountryCodes.contains(code) else { return nil }
        return code
    }

    /// **공휴일 국가 = 날씨 지역의 나라**(2026-09-30, `docs/spec/alarm-lifecycle.md`
    /// 「공휴일 국가는 지역의 나라다」). 설정 화면의 '공휴일 달력' 행은 없다 — 이 값을 쓰는
    /// 자리는 여기 하나다. 안드로이드는 `HolidayCountryPreferenceStore.setCountry` 로 같은 일을 한다.
    ///
    /// 서버에서 계정 설정을 받아 **이 기기가 받아들였을 때**(`AlarmTalkApp` — 새 기기 로그인·다른 기기에서 고침,
    /// `DynamicPromptPreferences.adoptAccount` 가 `.accepted`)는 `adoptCountry(ofAccountWeatherRegion:userID:)` 가
    /// 판정(`countryForAccountRegion`)을 거쳐 같은 일을 한다. 계정 설정은 계정에, 공휴일 국가는 기기에 있으므로
    /// 받아 올 때 맞추지 않으면 두 번째 기기는 옛 나라에 남는다.
    ///
    /// 부르는 곳(고를 때): 설정 '지역' 행(`SettingsView` — 고를 때마다), 편집기 문구 화면
    /// (`AlarmEditorSheet.applyMessageSettings` — 내 알람에서 **지역이 실제로 바뀔 때만**,
    /// 판정은 `DynamicPromptPreferences.editorUpdate`). 가족 알람에서 고른 지역은 받는 사람의
    /// 것이라 부르지 않는다.
    ///
    /// 같은 값이면 쓰지 않는다 — 써도 공휴일off 알람을 다시 걸지는 않지만(`HolidayOffRescheduler`
    /// 는 달력 표지가 같으면 돌지 않는다), 괜히 동기화(`ensureSynced`)를 깨울 이유가 없다.
    /// 지역이 없거나 되짚지 못한 옛 글자뿐이면 지금 값(기기 로케일 기본값 포함)을 그대로 둔다.
    @discardableResult
    func adoptCountry(ofWeatherRegion key: String?) -> Bool {
        guard let code = Self.countryCode(forWeatherRegion: key) else { return false }
        // 사용자가 지역을 골랐다 — 옛 '공휴일 달력' 행에서 고른 나라는 더 지키지 않는다
        // (`countryForAccountRegion`). 남겨 두면 다음 실행에 서버 지역을 받을 때 그 판정이 이 고름을 가린다.
        UserDefaults.standard.removeObject(forKey: Self.keptCountryAccountWeatherRegionDefaultsKey)
        UserDefaults.standard.removeObject(forKey: Self.keptCountryAccountUserDefaultsKey)
        guard code != selectedCountryCode else { return false }
        selectedCountryCode = code
        return true
    }

    /// 서버에서 마지막으로 받은 계정 지역 키. 없으면 이 업데이트 뒤 아직 한 번도 받지 않았다.
    nonisolated static let lastAccountWeatherRegionDefaultsKey = "holiday.lastAccountWeatherRegion"
    /// 옛 '공휴일 달력' 행에서 **직접 고른** 나라를 지키고 있는 계정 지역 키(아래 판정).
    nonisolated static let keptCountryAccountWeatherRegionDefaultsKey = "holiday.keptCountryForAccountWeatherRegion"
    /// 그 나라를 지키고 있는 **계정**. ⚠ 지역 키만으로 가르지 말 것 — 이 값은 기기 전역이라, 같은 지역의
    /// **다른 계정**이 이 기기에 들어와도 앞 계정 때 지켜 둔 나라를 물려받는다(Codex #837).
    /// 안드로이드 `HolidayCountryPreferenceStore.keptCountryAccountUserId`.
    nonisolated static let keptCountryAccountUserDefaultsKey = "holiday.keptCountryForAccountUser"

    /// 이 기기에 적힌 공휴일 국가 — 없으면 기기 로케일 기본값. 안드로이드
    /// `HolidayCountryPreferenceStore.read()` 와 같은 값이다(지역 시트가 처음 보일 나라의 폴백).
    nonisolated static func persistedCountryCode(defaults: UserDefaults = .standard) -> String {
        let persisted = defaults.string(forKey: countryDefaultsKey)?.uppercased() ?? ""
        return supportedCountryCodes.contains(persisted) ? persisted : defaultCountryFromLocale()
    }

    /// **서버에서 계정 지역을 받았을 때** 공휴일 국가를 무엇으로 할지. nil 이면 건드리지 않는다.
    ///
    /// 안드로이드 `WeatherRegionHolidaySync.onAccountRegionReceived` 와 같은 판정이다 —
    /// **업데이트 직후 처음 받는 계정 지역**인데, 이 기기에 옛 '공휴일 달력' 행에서 **직접 고른**
    /// 나라가 있고 그게 지역의 나라와 다르면, **그 계정 지역이 바뀌기 전까지** 그 나라를 둔다. 지역을
    /// 다시 고르면(설정 '지역' 행) 곧바로 지역의 나라가 된다. 행이 사라졌다고 사용자가 고른 달력을
    /// 말없이 바꾸면 공휴일에 꺼지는 날이 조용히 달라진다.
    /// ⚠ 지키는 것은 **그 계정**(`userID`)에 대해서뿐이다 — 다른 계정이 들어오면(지역이 같아도) 그 계정의
    /// 지역의 나라를 따른다. 지역 키로만 가르면 다음 계정이 앞 계정 때 지켜 둔 나라를 물려받는데, 그 계정에게는
    /// 그 나라를 바꿀 행이 없다(Codex #837).
    ///
    /// 그 밖에는 **받아들일 때마다** 지역의 나라로 맞춘다("지난번과 같은 지역이면 건너뛴다" 를 두지 않는다).
    /// 이 기기에서 고른 지역의 저장이 실패한 경우는 여기까지 오지 않는다 — 받아 적기가 `.localPending` 이라
    /// 호출부가 부르지 않는다. 건너뛰기를 두면 오히려 로그아웃(값·표시를 지운다) 뒤 같은 계정으로 다시
    /// 들어왔을 때 화면의 지역과 달력의 나라가 갈라진 채 남는다. 안드로이드
    /// `WeatherRegionHolidaySync.onAccountRegionReceived` 도 같은 판정이다.
    nonisolated static func countryForAccountRegion(
        _ key: String?,
        userID: String?,
        currentCountry: String,
        defaults: UserDefaults = .standard
    ) -> String? {
        guard let region = WeatherRegions.byKey(key),
              let code = countryCode(forWeatherRegion: region.key) else { return nil }
        let firstReceipt = defaults.string(forKey: lastAccountWeatherRegionDefaultsKey) == nil
        defaults.set(region.key, forKey: lastAccountWeatherRegionDefaultsKey)
        if firstReceipt,
           defaults.string(forKey: countryDefaultsKey) != nil,
           currentCountry != code {
            defaults.set(region.key, forKey: keptCountryAccountWeatherRegionDefaultsKey)
            defaults.set(userID, forKey: keptCountryAccountUserDefaultsKey)
            return nil
        }
        if defaults.string(forKey: keptCountryAccountWeatherRegionDefaultsKey) == region.key,
           defaults.string(forKey: keptCountryAccountUserDefaultsKey) == userID {
            return nil
        }
        defaults.removeObject(forKey: keptCountryAccountWeatherRegionDefaultsKey)
        defaults.removeObject(forKey: keptCountryAccountUserDefaultsKey)
        return code
    }

    /// 서버에서 받은 계정 지역으로 공휴일 국가를 맞춘다(`AlarmTalkApp` 의 계정 설정 관찰).
    /// 판정은 `countryForAccountRegion` 한 곳이다.
    @discardableResult
    func adoptCountry(ofAccountWeatherRegion key: String?, userID: String?) -> Bool {
        guard let code = Self.countryForAccountRegion(key, userID: userID, currentCountry: selectedCountryCode),
              code != selectedCountryCode else { return false }
        // 같은 값이면 쓰지 않는다 — `adoptCountry(ofWeatherRegion:)` 주석과 같은 이유.
        selectedCountryCode = code
        return true
    }

    @Published private(set) var holidays: [HolidayEntity] = []

    /// 디스크의 공휴일 캐시를 읽었는가. 읽기 전의 빈 `holidays` 는 '공휴일이 없다' 가 아니다 —
    /// 그 사이에 달력 표지(`holidayCalendarMarker`)를 내면 JP·US 달력이 비어 보인다.
    @Published private(set) var hasLoadedHolidays = false

    /// 앱 전역 단일 국가 설정 (per-alarm 아님). 변경 시 UserDefaults 영속 + 선택 국가 sync.
    ///
    /// 공휴일off 알람을 다시 거는 일은 여기서 하지 않는다 — `AlarmTalkApp` 이 달력 표지
    /// (`holidayCalendarMarker`)를 보고 `HolidayOffRescheduler` 로 **멱등하게** 한다. 예전에는 이 `didSet`
    /// 이 콜백(`onCountryChanged`)을 불렀는데, 세 군데서 조용히 빠졌다: 콜백을 꽂기 전(콜드 스타트에서
    /// 계정 지역을 받는 순간)·알람 저장소를 읽기 전(`hasLoadedFromDisk` 가드에서 그냥 버렸다)·JP·US 공휴일을
    /// 서버에서 받아 온 뒤(나라는 그대로라 다시 불리지 않았다). 빠지면 **다음 한 번은 옛 달력으로** 울린다.
    @Published var selectedCountryCode: String {
        didSet {
            guard didFinishInit else { return }
            UserDefaults.standard.set(selectedCountryCode, forKey: Self.countryDefaultsKey)
            let cc = selectedCountryCode
            Task { await self.ensureSynced(countryCode: cc) }
        }
    }

    /// 공휴일off 예약이 기대는 **달력의 표지** — 나라, 그리고 그 나라 공휴일을 아직 못 받았으면 `:pending`.
    ///
    /// KR 은 기기 안에서 계산하므로(시드 + 음력 엔진, `LocalHolidayCalendar`) 언제나 완성이다. JP·US 는
    /// 서버에서 받아야(`ensureSynced`) 공휴일이 생긴다 — 받기 전에 다시 건 예약은 공휴일이 하나도 없는
    /// 달력으로 계산된 것이라, 받은 뒤 **한 번 더** 걸어야 한다. 표지가 달라지는 것이 그 신호다.
    ///
    /// ⚠ **"그 나라 행이 있다" 로 가르지 말 것**(Codex #837). 받은 창(~395일)이 지나면 파일에는 그 나라의 **지난**
    /// 공휴일만 남는데, 행이 있다고 완성으로 보면 다시 받지도(`ensureSynced`) 다시 걸지도 않아 공휴일off 알람이
    /// 사실상 빈 달력으로 계속 돈다. 그래서 **아직 오지 않은 공휴일까지 덮는가**로 가르고, 덮는 끝(`@마지막 날`)을
    /// 표지에 싣는다 — 새 창을 받으면 끝이 늘어 표지가 바뀌고 다시 건다.
    nonisolated static func calendarMarker(
        country: String,
        holidays: [HolidayEntity],
        todayEpochDay: Int = KoreanLunarHolidayEngine.epochDay(of: Date())
    ) -> String {
        let cc = country.uppercased()
        if cc == defaultCountryCode { return cc }
        guard let coveredThrough = coveredThroughEpochDay(country: cc, holidays: holidays),
              coveredThrough >= todayEpochDay else {
            return "\(cc):pending"
        }
        return "\(cc)@\(coveredThrough)"
    }

    /// 받아 둔 그 나라 공휴일의 마지막 날(epochDay). 하나도 없으면 nil.
    nonisolated static func coveredThroughEpochDay(country: String, holidays: [HolidayEntity]) -> Int? {
        let cc = country.uppercased()
        return holidays.lazy.filter { $0.countryCode.uppercased() == cc }.map(\.epochDay).max()
    }

    /// 지금 달력의 표지. 디스크 캐시를 읽기 전이면 nil — 아직 판단하지 않는다.
    var holidayCalendarMarker: String? {
        guard hasLoadedHolidays else { return nil }
        return Self.calendarMarker(country: selectedCountryCode, holidays: holidays)
    }

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
        // 지금 걸려 있는 공휴일off 예약은 이 나라 달력으로 계산됐다 — 처음 한 번만 적는다.
        // **나라가 바뀌기 전에** 적어야 한다: 콜드 스타트에서 계정 지역을 받아 곧바로 나라가
        // 바뀌어도(`adoptCountry(ofAccountWeatherRegion:userID:)`) 그 변화를 놓치지 않는다.
        HolidayOffRescheduler.recordInitialCalendarIfAbsent(selectedCountryCode)

        Task { [persistence] in
            let loaded = await persistence.load()
            await MainActor.run {
                self.holidays = loaded
                self.hasLoadedHolidays = true
            }
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

    /// Android `holidayPredicate` 와 동일 의미. AlarmTimeCalculator 에 주입.
    /// countryCode == nil 이면 평가 시점에 selectedCountryCode 로 resolve 해
    /// 설정 변경에 반응적이다 (weak-self 폴백 분기는 defaultCountryCode 로 resolve).
    func holidayPredicate(countryCode: String? = nil) -> (Date) -> Bool {
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
        // ⚠ **아직 오지 않은 공휴일이 있을 때만** 건너뛴다 — 지난 행만 남은 옛 창이면 새 창을 받는다(`calendarMarker`).
        if let coveredThrough = Self.coveredThroughEpochDay(country: cc, holidays: holidays),
           coveredThrough >= KoreanLunarHolidayEngine.epochDay(of: Date()) { return }
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
