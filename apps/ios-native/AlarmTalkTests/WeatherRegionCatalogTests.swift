import XCTest
@testable import AlarmTalk

/// 날씨 지역 목록(생성 `WeatherRegions`)과 앱 쪽 규칙(`WeatherRegionSupport.swift`)의 회귀.
///
/// ⚠ **아래 되짚기 표는 `packages/shared/test/weather-regions.test.ts` 의 표를 그대로 옮긴
/// 것이다.** 서버·안드로이드·iOS·생성 스크립트 네 구현이 글자 하나까지 같은 답을 내야 한다
/// (`docs/spec/voice-and-message.md` 「날씨 지역은 목록에서만 고른다」). 한쪽 표만 고치지 말 것.
@MainActor
final class WeatherRegionCatalogTests: XCTestCase {

    // MARK: - 목록

    func test_나라별_개수와_순서() {
        XCTAssertEqual(WeatherRegions.byCountry(.kr).count, 17)
        XCTAssertEqual(WeatherRegions.byCountry(.jp).count, 47)
        XCTAssertGreaterThanOrEqual(WeatherRegions.byCountry(.us).count, 51)
        for country in WeatherCountry.allCases {
            XCTAssertEqual(WeatherRegions.byCountry(country).map(\.order), Array(1...WeatherRegions.byCountry(country).count))
        }
        XCTAssertEqual(Set(WeatherRegions.all.map(\.key)).count, WeatherRegions.all.count, "키가 겹친다")
    }

    /// 목록에서 고른 값은 옛 앱용 표준 글자로 저장되고, 그 글자는 **언제나 자기 지역으로** 되짚힌다.
    /// 알람 행에 키 칸을 따로 두지 않는 근거가 이것이다(`WeatherRegionSupport.swift` 주석).
    func test_표준_글자는_언제나_자기_지역으로_되짚힌다() {
        for region in WeatherRegions.all {
            let labels = WeatherRegions.canonicalLabels(key: region.key)
            XCTAssertEqual(labels?.country, region.country.legacyLabel)
            XCTAssertEqual(
                WeatherRegions.resolveAlias(country: labels?.country, city: labels?.city)?.key,
                region.key,
                region.key
            )
            let stored = WeatherRegions.storageLabels(country: labels?.country, city: labels?.city)
            XCTAssertEqual(stored.country, labels?.country)
            XCTAssertEqual(stored.city, labels?.city)
        }
    }

    func test_보이는_이름은_앱_언어로_나라는_붙이지_않는다() {
        XCTAssertEqual(WeatherRegions.displayName(country: "일본", city: "아이치", language: "ko"), "아이치")
        XCTAssertEqual(WeatherRegions.displayName(country: "일본", city: "아이치", language: "en"), "Aichi")
        XCTAssertEqual(WeatherRegions.displayName(country: "일본", city: "아이치", language: "ja"), "愛知県")
        // 옛 한국어 프리셋 '수원' 은 경기로 되짚혀 '경기' 로 보인다.
        XCTAssertEqual(WeatherRegions.displayName(country: "대한민국", city: "수원", language: "ko"), "경기")
        // 되짚지 못한 옛 글자는 적힌 그대로 — 안내가 붙는다.
        XCTAssertEqual(WeatherRegions.displayName(country: "대한민국", city: " 속초 ", language: "en"), "속초")
        XCTAssertTrue(WeatherRegions.isUnresolvedLegacy(country: "대한민국", city: "속초"))
        XCTAssertFalse(WeatherRegions.isUnresolvedLegacy(country: "대한민국", city: "서울"))
        XCTAssertFalse(WeatherRegions.isUnresolvedLegacy(country: "", city: " "), "빈 값은 옛 값이 아니다")
        XCTAssertNil(WeatherRegions.displayName(country: nil, city: nil))
        // 나라 칸이 모르는 글자면 옛 입력칸이 첫 낱말을 떼어 간 것이다 — 이어 붙여 보인다
        // (안드로이드 `weatherRegionDisplay` 와 같다).
        XCTAssertEqual(WeatherRegions.displayName(country: "Birmingham", city: "England"), "Birmingham England")
        XCTAssertEqual(WeatherRegions.displayName(country: "South Korea", city: "Sokcho"), "Sokcho")
        // 지역 시트의 부제는 옛 값일 때만.
        XCTAssertEqual(WeatherRegions.unresolvedLegacyLabel(country: "대한민국", city: "속초"), "속초")
        XCTAssertNil(WeatherRegions.unresolvedLegacyLabel(country: "대한민국", city: "서울"))
        XCTAssertNil(WeatherRegions.unresolvedLegacyLabel(country: nil, city: nil))
    }

    func test_되짚지_못한_옛_글자는_적힌_그대로_저장한다() {
        let stored = WeatherRegions.storageLabels(country: " 대한민국 ", city: " 속초 ")
        XCTAssertEqual(stored.country, "대한민국")
        XCTAssertEqual(stored.city, "속초")
        let mapped = WeatherRegions.storageLabels(country: "大韓民国", city: "東京")
        XCTAssertEqual(mapped.country, "일본")
        XCTAssertEqual(mapped.city, "도쿄")
    }

    // MARK: - 옛 값 되짚기(shared 표를 그대로 옮김)

    func test_옛_프리셋은_전부_되짚힌다() {
        let ko: [(String, String)] = [
            ("서울", "kr-seoul"), ("부산", "kr-busan"), ("인천", "kr-incheon"), ("대구", "kr-daegu"),
            ("대전", "kr-daejeon"), ("광주", "kr-gwangju"), ("울산", "kr-ulsan"), ("수원", "kr-gyeonggi"),
            ("제주", "kr-jeju"),
        ]
        for (city, expected) in ko {
            XCTAssertEqual(key("대한민국", city), expected, city)
        }
        let jaMain: [(String, String)] = [
            ("東京", "jp-tokyo"), ("大阪", "jp-osaka"), ("名古屋", "jp-aichi"), ("横浜", "jp-kanagawa"),
            ("札幌", "jp-hokkaido"), ("福岡", "jp-fukuoka"), ("仙台", "jp-miyagi"), ("那覇", "jp-okinawa"),
        ]
        for (city, expected) in jaMain {
            XCTAssertEqual(key("大韓民国", city), expected, city)
            XCTAssertEqual(key("대한민국", city), expected, city)
        }
        let jaDevelop = ["ソウル", "釜山", "仁川", "大邱", "大田", "光州", "蔚山", "水原", "済州"]
        let enDevelop = ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Ulsan", "Suwon", "Jeju"]
        for (index, city) in jaDevelop.enumerated() {
            XCTAssertEqual(key("大韓民国", city), ko[index].1, city)
            XCTAssertEqual(key("South Korea", enDevelop[index]), ko[index].1, enDevelop[index])
        }
    }

    func test_옛_값_되짚기_표() {
        let table: [(String?, String?, String?)] = [
            ("New", "York", "us-new-york"),
            ("Los", "Angeles", "us-los-angeles"),
            ("Salt", "Lake City", "us-salt-lake-city"),
            ("San", "Francisco", "us-san-francisco"),
            ("South Korea", "Tokyo", "jp-tokyo"),
            ("대한민국", "NYC", "us-new-york"),
            ("대한민국", "Portland", "us-portland-or"),
            ("경기도", "수원시", "kr-gyeonggi"),
            ("서울", "강남구", "kr-seoul"),
            ("부산광역시", "해운대구", "kr-busan"),
            ("미국", "뉴욕 맨해튼", "us-new-york"),
            ("대한민국", "서울 강남구", "kr-seoul"),
            ("대한민국", " 서울특별시 ", "kr-seoul"),
            ("대한민국", "제주도", "kr-jeju"),
            ("大韓民国", "津市", "jp-mie"),
            ("일본", "東京都", "jp-tokyo"),
            ("日本", "名古屋市", "jp-aichi"),
            ("Japan", "Osaka-fu", "jp-osaka"),
            ("US", "Washington, D.C.", "us-washington-dc"),
            ("미국", "워싱턴DC", "us-washington-dc"),
            ("미국", "오클라호마 시티", "us-oklahoma-city"),
            ("USA", "St. Louis", "us-st-louis"),
            ("미국", "Portland, ME", "us-portland-me"),
            ("미국", "포틀랜드(메인)", "us-portland-me"),
            ("아메리카", "", nil),
            ("", "ＳＥＯＵＬ", "kr-seoul"),
            ("대한민국", "\u{3000}부산\u{3000}", "kr-busan"),
            ("東京都", "新宿区", "jp-tokyo"),
            ("대한민국", "LA", "us-los-angeles"),
            ("Birmingham", "England", nil),
            ("La", "Paz", nil),
            ("Jackson", "Hole", nil),
            ("미국", "Columbus Georgia", nil),
            ("Tokyo", "Shinjuku", nil),
            ("USA", "Seoul", nil),
            ("미국", "광주", nil),
            ("일본", "뉴욕", nil),
            ("영국", "버밍엄", nil),
            ("영국", "런던", nil),
            ("대한민국", "속초", nil),
            ("대한민국", "", nil),
            ("", "", nil),
            (nil, nil, nil),
        ]
        for (country, city, expected) in table {
            XCTAssertEqual(key(country, city), expected, "(\(country ?? "nil"), \(city ?? "nil"))")
        }
    }

    // MARK: - 계정 설정

    /// 서버가 준 `region` 이 알맞으면 글자보다 먼저다 — 그 키의 표준 글자로 채운다.
    func test_계정_설정의_region_은_글자보다_먼저다() {
        let settings = DynamicPromptSettings(
            weather: DynamicPromptWeatherSettings(country: "x", city: "y", region: "jp-aichi")
        )
        let prefs = DynamicPromptPreferences.from(settings: settings)
        XCTAssertEqual(prefs.weatherCountry, "일본")
        XCTAssertEqual(prefs.weatherCity, "아이치")
        XCTAssertEqual(prefs.weatherRegion?.key, "jp-aichi")
    }

    /// 모르는 키는 그 칸만 버리고 옛 글자로 되짚는다(서버 `normalizeSetting` 과 같은 우선순위).
    func test_모르는_region_은_버리고_글자로_되짚는다() {
        let settings = DynamicPromptSettings(
            weather: DynamicPromptWeatherSettings(country: "대한민국", city: "부산", region: "kr-atlantis")
        )
        let prefs = DynamicPromptPreferences.from(settings: settings)
        XCTAssertEqual(prefs.weatherCity, "부산")
        XCTAssertEqual(prefs.weatherRegion?.key, "kr-busan")
    }

    /// 서버로 보낼 때 지역 키를 **글자와 함께** 싣는다. 되짚지 못하면 키 없이 글자만.
    func test_보낼_때_지역_키를_함께_싣는다() throws {
        var prefs = DynamicPromptPreferences()
        prefs.weatherCountry = "大韓民国"
        prefs.weatherCity = "東京"
        let mapped = prefs.toSettings()
        XCTAssertEqual(mapped.weather.region, "jp-tokyo")
        XCTAssertEqual(mapped.weather.country, "大韓民国", "글자는 그대로 둔다 — 덮는 것은 서버 몫이다")

        prefs.weatherCountry = "대한민국"
        prefs.weatherCity = "속초"
        XCTAssertNil(prefs.toSettings().weather.region)

        // 인코딩: 키가 없으면 칸째 빠진다(옛 서버는 모르는 칸을 무시한다).
        let json = try String(decoding: JSONEncoder().encode(prefs.toSettings().weather), as: UTF8.self)
        XCTAssertFalse(json.contains("region"), json)
    }

    func test_region_칸을_읽는다() throws {
        let json = #"{"weather":{"country":"일본","city":"아이치","region":" jp-aichi "},"fortune":{}}"#
        let settings = try JSONDecoder().decode(DynamicPromptSettings.self, from: Data(json.utf8))
        XCTAssertEqual(settings.weather.region, "jp-aichi")
    }

    // MARK: - 공휴일 국가 = 지역의 나라

    func test_공휴일_국가는_지역의_나라다() {
        XCTAssertEqual(HolidayStore.countryCode(forWeatherRegion: "kr-gyeonggi"), "KR")
        XCTAssertEqual(HolidayStore.countryCode(forWeatherRegion: "jp-tokyo"), "JP")
        XCTAssertEqual(HolidayStore.countryCode(forWeatherRegion: "us-new-york"), "US")
        // 지역이 없거나 모르는 키면 건드리지 않는다.
        XCTAssertNil(HolidayStore.countryCode(forWeatherRegion: nil))
        XCTAssertNil(HolidayStore.countryCode(forWeatherRegion: "kr-atlantis"))
    }

    /// 서버에서 받은 계정 지역 — 안드로이드 `WeatherRegionHolidaySync.onAccountRegionReceived` 와 같은 판정.
    /// ⚠ 테스트는 `.standard` 를 건드리지 않는다(사용자의 진짜 공휴일 국가다) — 따로 만든 저장소로 본다.
    func test_계정_지역을_받으면_공휴일_국가를_맞추되_업데이트_직후_직접_고른_나라는_둔다() throws {
        let suite = "WeatherRegionCatalogTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        // 새 기기(직접 고른 나라 없음) — 계정 지역의 나라.
        XCTAssertEqual(HolidayStore.countryForAccountRegion("jp-tokyo", userID: "user-a", currentCountry: "KR", defaults: defaults), "JP")
        // 지역이 없거나 모르는 키면 건드리지 않는다.
        XCTAssertNil(HolidayStore.countryForAccountRegion(nil, userID: "user-a", currentCountry: "KR", defaults: defaults))
        XCTAssertNil(HolidayStore.countryForAccountRegion("kr-atlantis", userID: "user-a", currentCountry: "KR", defaults: defaults))

        // 업데이트 직후: 옛 '공휴일 달력' 행에서 JP 를 직접 골라 둔 기기 + 계정 지역은 서울.
        let upgraded = try XCTUnwrap(UserDefaults(suiteName: suite + ".upgraded"))
        defer { upgraded.removePersistentDomain(forName: suite + ".upgraded") }
        upgraded.set("JP", forKey: HolidayStore.countryDefaultsKey)
        XCTAssertNil(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "JP", defaults: upgraded),
                     "처음 받는 지역은 직접 고른 나라를 덮지 않는다")
        XCTAssertNil(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "JP", defaults: upgraded),
                     "같은 지역을 다시 받아도(콜드 스타트) 그대로 둔다")
        XCTAssertEqual(HolidayStore.countryForAccountRegion("kr-busan", userID: "user-a", currentCountry: "JP", defaults: upgraded), "KR",
                       "계정 지역이 바뀌면 그 나라가 된다")
        XCTAssertEqual(HolidayStore.countryForAccountRegion("kr-busan", userID: "user-a", currentCountry: "JP", defaults: upgraded), "KR",
                       "그 뒤로는 받아들일 때마다 지역의 나라로 맞춘다(안드로이드 `onAccountRegionReceived` 와 같다)")
    }

    /// "지난번과 같은 지역이면 건너뛴다" 를 두지 않는 이유 — 이 기기에서 고른 지역(달력 JP)의 저장이 실패한 채
    /// 로그아웃하면 값·'안 올라간 변경' 표시는 지워지고 공휴일 국가만 남는다. 같은 계정으로 다시 들어와 계정
    /// 지역(서울)을 받아들이면 화면이 서울이니 달력도 한국이어야 한다. 안드로이드
    /// `WeatherRegionPickerTest.받아들일_때마다_지역의_나라로_맞춘다_로그아웃_뒤_같은_계정도` 와 같다.
    func test_같은_계정_지역을_다시_받아도_지역의_나라로_맞춘다() throws {
        let suite = "WeatherRegionCatalogTests.relogin.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertEqual(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "KR", defaults: defaults), "KR")
        // 이 기기에서 도쿄를 골랐다(`adoptCountry(ofWeatherRegion:)` — 달력 JP).
        defaults.set("JP", forKey: HolidayStore.countryDefaultsKey)
        XCTAssertEqual(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "JP", defaults: defaults), "KR")
    }

    /// **지켜 둔 나라는 그 계정의 것이다**(Codex #837). 표시는 기기 전역이라 지역 키로만 가르면, 같은 지역의
    /// 다른 계정이 들어왔을 때 앞 계정 때 지켜 둔 나라를 물려받는다 — 그 계정에게는 바꿀 행이 없다.
    /// 안드로이드 `WeatherRegionPickerTest.지켜_둔_나라는_다른_계정에_물려주지_않는다` 와 같다.
    func test_지켜_둔_나라는_다른_계정에_물려주지_않는다() throws {
        let suite = "WeatherRegionCatalogTests.accounts.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        // 옛 '공휴일 달력' 행에서 JP 를 직접 골라 둔 기기.
        defaults.set("JP", forKey: HolidayStore.countryDefaultsKey)

        XCTAssertNil(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "JP", defaults: defaults),
                     "처음 받는 지역은 직접 고른 나라를 덮지 않는다")
        XCTAssertNil(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-a", currentCountry: "JP", defaults: defaults),
                     "같은 계정이 다시 들어와도 그대로 지킨다")
        XCTAssertEqual(HolidayStore.countryForAccountRegion("kr-seoul", userID: "user-b", currentCountry: "JP", defaults: defaults), "KR",
                       "다른 계정은 지역이 같아도 그 계정 지역의 나라를 따른다")
        XCTAssertNil(defaults.string(forKey: HolidayStore.keptCountryAccountWeatherRegionDefaultsKey))
        XCTAssertNil(defaults.string(forKey: HolidayStore.keptCountryAccountUserDefaultsKey))
    }

    // MARK: - 시트의 첫 나라

    func test_시트는_고른_지역의_나라로_열린다() {
        XCTAssertEqual(WeatherRegions.initialPickerCountry(for: WeatherRegions.byKey("us-miami"), fallbackCountryCode: "JP"), .us)
        XCTAssertEqual(WeatherRegions.initialPickerCountry(for: WeatherRegions.byKey("jp-osaka"), fallbackCountryCode: "US"), .jp)
        // 고른 게 없으면 이 기기의 공휴일 국가(안드로이드 `initialWeatherPickerCountry` 와 같다).
        XCTAssertEqual(WeatherRegions.initialPickerCountry(for: nil, fallbackCountryCode: "US"), .us)
        XCTAssertEqual(WeatherRegions.initialPickerCountry(for: nil, fallbackCountryCode: "VN"), .kr)
        XCTAssertEqual(WeatherRegions.initialPickerCountry(for: nil, fallbackCountryCode: nil), .kr)
    }

    private func key(_ country: String?, _ city: String?) -> String? {
        WeatherRegions.resolveAlias(country: country, city: city)?.key
    }
}
