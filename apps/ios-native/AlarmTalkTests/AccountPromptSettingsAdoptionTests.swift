import XCTest
@testable import AlarmTalk

/// 서버의 계정 설정(지역·사주)을 **이 기기에 받아 적는가**, 그리고 **이 기기의 새 변경을 덮지 않는가**
/// (`DynamicPromptPreferences.adoptAccount`). 안드로이드 `AccountPromptSettingsAdoptionTest` 와 같은 표다 —
/// 한쪽만 고치지 말 것.
///
/// 예전 iOS 는 "서버 값이 있으면 서버, 없으면 기기" 였다. 그래서 오프라인에서 고른 지역이 다음 실행에 서버의
/// 옛 지역으로 되돌아갔고, 서버에 사주만 있으면 기기에만 있던 지역까지 '미설정' 으로 보였다.
///
/// ⚠ 기기 값은 키체인이다 — 테스트마다 새 계정 id 를 쓰고 끝나면 지운다. '안 올라간 변경' 표시는 따로 만든
/// UserDefaults 에 둔다(`.standard` 는 사용자의 진짜 값이다).
final class AccountPromptSettingsAdoptionTests: XCTestCase {

    private var userID = ""
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        userID = "adoption-test-\(UUID().uuidString)"
        suiteName = "AccountPromptSettingsAdoptionTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    }

    override func tearDown() {
        DynamicPromptPreferences.clear(userID: userID)
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func regionSettings(_ key: String) throws -> DynamicPromptSettings {
        let labels = try XCTUnwrap(WeatherRegions.canonicalLabels(key: key))
        return DynamicPromptSettings(
            weather: DynamicPromptWeatherSettings(country: labels.country, city: labels.city, region: key)
        )
    }

    private func preferences(region key: String) throws -> DynamicPromptPreferences {
        let region = try XCTUnwrap(WeatherRegions.byKey(key))
        return DynamicPromptPreferences(weatherCountry: region.legacyCountry, weatherCity: region.legacyCity)
    }

    /// 이 기기에서 고르고 서버 저장까지 성공한 상태(= 안 올라간 변경 없음).
    private func savedAndPushed(_ key: String) throws {
        let prefs = try preferences(region: key)
        prefs.saveLocalEdit(userID: userID, defaults: defaults)
        DynamicPromptPreferences.markPushed(userID: userID, pushed: prefs.toSettings(), defaults: defaults)
    }

    private var local: DynamicPromptPreferences { .load(userID: userID) }

    private func hasUnsynced() -> Bool {
        DynamicPromptPreferences.hasUnsyncedChange(userID: userID, defaults: defaults)
    }

    // MARK: - 0. 적기에 실패하면 표시를 남기지 않는다

    /// **키체인에 못 적었으면 '안 올라간 변경' 표시를 남기지 않는다**(Codex #837). 키체인에는 옛 값(서울)이
    /// 그대로라, 표시만 남으면 서버 저장(도쿄)이 성공해도 표시가 안 내려가고 다음 받아 적기가 옛 서울을
    /// `.localPending` 으로 다시 올려 새 값을 덮는다. 표시가 없으면 서버의 도쿄를 받아 적는다.
    func test_키체인에_못_적으면_표시를_남기지_않고_서버_값을_받아_적는다() throws {
        try savedAndPushed("kr-seoul")
        let tokyo = try preferences(region: "jp-tokyo")

        let wrote = tokyo.saveLocalEdit(userID: userID, defaults: defaults, write: { _, _ in false })

        XCTAssertFalse(wrote)
        XCTAssertFalse(hasUnsynced(), "적지 못한 변경에 표시를 남기면 옛 값이 새 값을 덮는다")
        XCTAssertEqual(local.weatherRegion?.key, "kr-seoul")
        // 서버 저장은 성공했다(도쿄) — 다음 받아 적기는 서버를 따른다.
        DynamicPromptPreferences.markPushed(userID: userID, pushed: tokyo.toSettings(), defaults: defaults)
        XCTAssertEqual(
            DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("jp-tokyo"), defaults: defaults),
            .accepted
        )
        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
    }

    /// **받아 적지 못했으면 받아들였다고 말하지 않는다**(Codex #837). 기기 값은 옛것(서울)인데 `.accepted` 면
    /// 호출부가 공휴일 국가를 서버 지역(도쿄)의 나라로 옮겨, 화면·알람이 읽는 기기 값과 달력의 나라가 갈라진다.
    func test_서버_값을_기기에_못_적으면_받아들였다고_하지_않는다() throws {
        try savedAndPushed("kr-seoul")

        let adoption = DynamicPromptPreferences.adoptAccount(
            userID: userID,
            server: try regionSettings("jp-tokyo"),
            defaults: defaults,
            write: { _, _ in false }
        )

        XCTAssertEqual(adoption, .localWriteFailed)
        XCTAssertEqual(local.weatherRegion?.key, "kr-seoul")
        // 같은 값이면 적을 것이 없다 — 받아들인다.
        XCTAssertEqual(
            DynamicPromptPreferences.adoptAccount(
                userID: userID, server: try regionSettings("kr-seoul"), defaults: defaults, write: { _, _ in false }
            ),
            .accepted
        )
    }

    /// **기기에 적었을 때만 뒤따르는 일(공휴일 국가·서버 올리기)을 한다**(Codex #837). 못 적었는데 하면 화면·서버·
    /// 달력은 새 지역인데 기기 값(알람·편집기가 읽는 것)은 옛 지역으로 갈라지고, 받아 적기가 실패를 알려도 옮긴
    /// 달력은 못 되돌린다.
    func test_기기에_못_적으면_뒤따르는_일을_하지_않는다() throws {
        let tokyo = try preferences(region: "jp-tokyo")
        var applied = 0

        XCTAssertFalse(tokyo.commitLocalEdit(userID: userID, defaults: defaults, write: { _, _ in false }) { applied += 1 })
        XCTAssertFalse(
            tokyo.commitLocalEdit(userID: userID, markUnsynced: false, defaults: defaults, write: { _, _ in false }) { applied += 1 }
        )
        XCTAssertEqual(applied, 0)
        XCTAssertFalse(hasUnsynced())

        XCTAssertTrue(tokyo.commitLocalEdit(userID: userID, defaults: defaults) { applied += 1 })
        XCTAssertEqual(applied, 1)
        XCTAssertTrue(hasUnsynced())
        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
    }

    /// **밀린 표시는 묶음(날씨·사주)마다다**(Codex #837). 지역만 밀려 있는 사이 다른 기기가 사주를 고쳤으면, 다시
    /// 올릴 값은 **밀린 지역 + 서버의 새 사주**다 — 이 기기의 옛 사주까지 올리면 다른 기기의 변경이 지워진다.
    /// 안드로이드 `AccountPromptSettingsAdoptionTest.밀린_지역을_다시_올릴_때_다른_기기가_고친_사주는_받아_적고_함께_올린다`.
    func test_밀린_지역을_다시_올릴_때_다른_기기가_고친_사주는_받아_적고_함께_올린다() throws {
        var seoul = try preferences(region: "kr-seoul")
        seoul.fortuneGender = "여성"
        seoul.fortuneBirthDate = "1990-01-01"
        seoul.fortuneBirthTime = "07:31~09:30"
        seoul.saveLocalEdit(userID: userID, defaults: defaults)
        DynamicPromptPreferences.markPushed(userID: userID, pushed: seoul.toSettings(), defaults: defaults)
        XCTAssertFalse(hasUnsynced())
        // 이 기기에서 도쿄로 바꿨는데 올리지 못했다 — 지역만 밀려 있다.
        var tokyo = seoul
        let tokyoRegion = try XCTUnwrap(WeatherRegions.byKey("jp-tokyo"))
        tokyo.weatherCountry = tokyoRegion.legacyCountry
        tokyo.weatherCity = tokyoRegion.legacyCity
        tokyo.saveLocalEdit(userID: userID, defaults: defaults)
        // 그 사이 다른 기기가 사주를 고쳤다 — 서버는 서울 + 새 사주.
        var server = try regionSettings("kr-seoul")
        server.fortune = DynamicPromptFortuneSettings(gender: "남성", birthDate: "1988-05-05", birthTime: "05:31~07:30")

        let adoption = DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)

        guard case .localPending(let resend) = adoption else { return XCTFail("밀린 지역을 다시 올려야 한다: \(adoption)") }
        XCTAssertEqual(resend.weather.region, "jp-tokyo")
        XCTAssertEqual(resend.fortune.birthDate, "1988-05-05", "다른 기기가 고친 사주를 옛 값으로 덮으면 안 된다")
        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
        XCTAssertEqual(local.fortuneBirthDate, "1988-05-05")
        DynamicPromptPreferences.markPushed(userID: userID, pushed: resend, defaults: defaults)
        XCTAssertFalse(hasUnsynced())
    }

    func test_키체인에_적으면_표시를_남긴다() throws {
        let tokyo = try preferences(region: "jp-tokyo")
        XCTAssertTrue(tokyo.saveLocalEdit(userID: userID, defaults: defaults))
        XCTAssertTrue(hasUnsynced())
        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
    }

    // MARK: - 1. 두 번째 기기

    func test_새_기기는_계정의_지역과_사주를_받아_적는다() throws {
        var server = try regionSettings("jp-osaka")
        server.fortune = DynamicPromptFortuneSettings(gender: "여성", birthDate: "1990-01-01", birthTime: "07:31~09:30")

        let adoption = DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)

        XCTAssertEqual(adoption, .accepted)
        XCTAssertEqual(local.weatherRegion?.key, "jp-osaka")
        XCTAssertEqual(local.weatherCountry, "일본")
        XCTAssertEqual(local.fortuneBirthDate, "1990-01-01")
        XCTAssertFalse(hasUnsynced(), "받아 적은 값은 '이 기기의 변경' 이 아니다 — 다시 올릴 것이 없다")
    }

    func test_옛_서버처럼_키_없이_글자만_와도_그_글자를_적는다() {
        let server = DynamicPromptSettings(weather: DynamicPromptWeatherSettings(country: "대한민국", city: "부산"))

        DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)

        XCTAssertEqual(local.weatherRegion?.key, "kr-busan")
    }

    func test_다른_기기에서_바꾼_지역을_따라간다() throws {
        try savedAndPushed("kr-seoul")

        DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("us-chicago"), defaults: defaults)

        XCTAssertEqual(local.weatherRegion?.key, "us-chicago")
    }

    func test_같은_값을_몇_번_받아도_결과가_같다() throws {
        let server = try regionSettings("jp-tokyo")
        DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)
        let first = local

        XCTAssertEqual(DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults), .accepted)
        XCTAssertEqual(local, first)
    }

    // MARK: - 2. 이 기기의 새 변경은 덮지 않는다

    func test_올리지_못한_이_기기의_지역은_서버의_옛_지역으로_덮지_않고_다시_올릴_값을_돌려준다() throws {
        try savedAndPushed("kr-seoul")
        // 오프라인에서 도쿄를 골랐다 — 저장(PATCH)은 실패해 서버는 여전히 서울이다.
        try preferences(region: "jp-tokyo").saveLocalEdit(userID: userID, defaults: defaults)

        let adoption = DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("kr-seoul"), defaults: defaults)

        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
        guard case .localPending(let resend) = adoption else {
            return XCTFail("다시 올릴 값을 돌려줘야 한다: \(adoption)")
        }
        XCTAssertEqual(resend.weather.region, "jp-tokyo")
        XCTAssertTrue(hasUnsynced())
    }

    func test_올린_값이_받아들여지면_표시가_내려가고_다시_다른_기기를_따른다() throws {
        try savedAndPushed("jp-tokyo")
        XCTAssertFalse(hasUnsynced())

        DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("kr-busan"), defaults: defaults)

        XCTAssertEqual(local.weatherRegion?.key, "kr-busan")
    }

    func test_올리는_사이에_또_고쳤으면_표시를_내리지_않는다() throws {
        let tokyo = try preferences(region: "jp-tokyo")
        tokyo.saveLocalEdit(userID: userID, defaults: defaults)
        // 응답이 오기 전에 오사카로 다시 골랐다.
        try preferences(region: "jp-osaka").saveLocalEdit(userID: userID, defaults: defaults)

        DynamicPromptPreferences.markPushed(userID: userID, pushed: tokyo.toSettings(), defaults: defaults)

        XCTAssertTrue(hasUnsynced())
        // 서버가 도쿄를 돌려줘도 오사카가 남는다.
        DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("jp-tokyo"), defaults: defaults)
        XCTAssertEqual(local.weatherRegion?.key, "jp-osaka")
    }

    func test_올리기는_됐는데_응답을_못_받았으면_서버가_같은_값을_줄_때_표시만_내린다() throws {
        try preferences(region: "jp-tokyo").saveLocalEdit(userID: userID, defaults: defaults)

        let adoption = DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("jp-tokyo"), defaults: defaults)

        XCTAssertEqual(adoption, .accepted)
        XCTAssertFalse(hasUnsynced())
    }

    func test_서버에_빈_묶음은_로컬을_지우지_않는다() throws {
        try savedAndPushed("kr-daegu")
        // 서버에는 사주만 있다(날씨는 아직 안 올라갔다) — 비어 있는 것은 '지웠다' 가 아니다.
        let server = DynamicPromptSettings(
            fortune: DynamicPromptFortuneSettings(gender: "남성", birthDate: "1980-05-05", birthTime: "09:31~11:30")
        )

        DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)

        XCTAssertEqual(local.weatherRegion?.key, "kr-daegu")
        XCTAssertEqual(local.fortuneGender, "남성")
    }

    func test_로그아웃하면_안_올라간_변경_표시도_지운다() throws {
        // `clear(userID:)` 는 `.standard` 의 표시를 지운다 — 이 테스트만의 계정 id 라 사용자 값과 겹치지 않는다.
        try preferences(region: "jp-tokyo").saveLocalEdit(userID: userID)
        XCTAssertTrue(DynamicPromptPreferences.hasUnsyncedChange(userID: userID))

        DynamicPromptPreferences.clear(userID: userID)

        XCTAssertFalse(DynamicPromptPreferences.hasUnsyncedChange(userID: userID))
        // 다시 로그인하면 빈 기기 값이 서버를 이기지 않고 계정 값을 받아 온다.
        DynamicPromptPreferences.adoptAccount(userID: userID, server: try regionSettings("kr-seoul"))
        XCTAssertEqual(local.weatherRegion?.key, "kr-seoul")
    }

    func test_서버_설정이_없으면_아무것도_하지_않는다() throws {
        try preferences(region: "jp-tokyo").saveLocalEdit(userID: userID, defaults: defaults)

        XCTAssertEqual(DynamicPromptPreferences.adoptAccount(userID: userID, server: nil, defaults: defaults), .accepted)
        XCTAssertEqual(local.weatherRegion?.key, "jp-tokyo")
        XCTAssertTrue(hasUnsynced(), "받은 것이 없으니 표시도 그대로다")
    }

    func test_로그인_전에는_아무것도_적지_않는다() throws {
        XCTAssertEqual(
            DynamicPromptPreferences.adoptAccount(userID: nil, server: try regionSettings("jp-tokyo"), defaults: defaults),
            .accepted
        )
        XCTAssertEqual(DynamicPromptPreferences.load(userID: nil), DynamicPromptPreferences())
    }
}
