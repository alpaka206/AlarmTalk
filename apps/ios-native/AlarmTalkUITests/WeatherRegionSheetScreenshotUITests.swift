import XCTest

/// 지역 시트·설정 '지역' 행·문구 화면의 '지역' 상세 카드를 열어 **눈으로 확인하기 위한** 진입점
/// (스크린샷은 테스트 첨부로 남는다 — `xcresulttool export attachments` 로 꺼낸다).
///
/// 시뮬레이터를 스크립트로 탭할 방법이 없어서 만든 것이다(같은 이유로 `-UIPreview*` 진입점이 있다).
/// 2026-09-30 전에는 '공휴일 달력' 시트를 열었다 — 그 행은 없어졌다(공휴일 국가 = 지역의 나라).
/// 계정의 지역은 `-UIPreviewWeather "<나라>|<도시>"` 로 심는다(서버·로그인 없음).
@MainActor
final class WeatherRegionSheetScreenshotUITests: XCTestCase {

    func test_지역_시트를_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu", "-UIPreviewWeather", "대한민국|서울"]
        app.launch()

        try openSettings(app)
        XCTAssertFalse(app.staticTexts["공휴일 달력"].exists, "'공휴일 달력' 행은 없다 — 공휴일 국가는 지역의 나라다")
        capture("settings")

        let region = app.buttons.containing(.staticText, identifier: "지역").firstMatch
        guard region.waitForExistence(timeout: 10) else {
            throw XCTSkip("설정에서 '지역' 행을 찾지 못했다")
        }
        region.tap()

        // 행 이름과 시트 제목이 같은 문자열("지역")이라, 시트가 떴는지는 시트에만 있는 세그먼트로 가른다.
        XCTAssertTrue(app.segmentedControls.firstMatch.waitForExistence(timeout: 10), "지역 시트가 뜨지 않았다")
        XCTAssertEqual(app.textFields.count, 0, "지역 시트에 직접 입력칸이 있다 — 목록에서만 고른다")
        capture("region-sheet-kr")

        for country in ["일본", "미국"] {
            let segment = app.segmentedControls.buttons[country]
            if segment.waitForExistence(timeout: 3) {
                segment.tap()
                capture("region-sheet-\(country)")
            }
        }

        // ⚠ **여기서 지역을 고르거나 시트를 닫으려 하지 말 것.** 고르면 화면 확인 모드의 가짜 토큰으로
        // `PATCH /user/me` 가 실제로 나가고 이 시뮬레이터의 공휴일 국가까지 바뀐다. 닫기도 안 된다 —
        // 지역 시트는 목록이 길어 높이 상한까지 올라와 위의 스크림(약 40pt)이 상태 표시줄 밑이라 합성
        // 탭이 닿지 않았고, 합성 끌어내리기는 기존 '화면 테마' 시트에서도 닫히지 않았다(2026-09-30 실측).
        // 운세 폼은 `FortuneDialogScreenshotUITests` 가 따로 담는다.
    }

    /// 목록에 없는 옛 값(직접 입력 시절의 "속초")은 글자 그대로 보이고, 행 아래 **라벨과 같은 시작선**에
    /// 안내가 붙는다(안드로이드 `SettingsRow` 의 `supportingText` — 왼쪽 정렬과 같은 자리).
    func test_목록에_없는_옛_지역은_행_아래에_안내가_붙는다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu", "-UIPreviewWeather", "대한민국|속초"]
        app.launch()

        try openSettings(app)
        let hint = app.staticTexts["목록에서 다시 골라 주세요"].firstMatch
        XCTAssertTrue(hint.waitForExistence(timeout: 10), "옛 값의 안내가 없다")
        let value = app.staticTexts["속초"].firstMatch
        XCTAssertTrue(value.exists, "옛 값이 글자 그대로 보이지 않는다")
        // 안내의 왼쪽 끝이 라벨('지역')의 왼쪽 끝과 같은 자리다(1pt 반올림 여유) — 값 쪽(오른쪽)이 아니다.
        let label = app.staticTexts["지역"].firstMatch
        XCTAssertEqual(hint.frame.minX, label.frame.minX, accuracy: 1.5, "안내가 라벨과 같은 시작선이 아니다")
        XCTAssertGreaterThan(hint.frame.minY, value.frame.maxY - 1, "안내가 행 아래에 있지 않다")
        capture("settings-legacy-hint")
    }

    /// 편집기 → '문구' → '날씨' 를 고르면 아래 상세 카드가 **'지역'** 이름으로 지역을 보인다.
    func test_문구_화면_상세_카드는_지역을_보인다() throws {
        for (weather, name, expected) in [("대한민국|서울", "message-detail-region", "서울"),
                                          ("대한민국|속초", "message-detail-region-legacy", "속초")] {
            let app = XCUIApplication()
            app.launchArguments = ["-UIPreviewSeed", "-UIPreviewEditor", "-UIPreviewWeather", weather]
            app.launch()
            XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

            let messageRow = app.buttons.containing(.staticText, identifier: "문구").firstMatch
            XCTAssertTrue(messageRow.waitForExistence(timeout: 10), "'문구' 행이 없다")
            messageRow.tap()

            let weatherOption = app.staticTexts["날씨"].firstMatch
            XCTAssertTrue(weatherOption.waitForExistence(timeout: 10), "문구 화면에 '날씨' 행이 없다")
            weatherOption.tap()

            // 이미 등록한 지역은 다시 묻지 않는다 — 시트 없이 상세 카드만 뜬다.
            XCTAssertFalse(app.segmentedControls.firstMatch.waitForExistence(timeout: 2), "등록된 지역인데 지역 시트가 떴다")
            XCTAssertTrue(app.staticTexts["지역"].firstMatch.waitForExistence(timeout: 5), "상세 카드 제목이 '지역' 이 아니다")
            XCTAssertTrue(app.staticTexts[expected].firstMatch.exists, "상세 카드에 '\(expected)' 가 없다")
            capture(name)

            // ⚠ 여기서 문구 화면을 나가지 말 것 — 나가는 순간 반영되고(`applyMessageSettings`),
            // 고른 지역이 가짜 토큰으로 계정(`PATCH /user/me`)에 올라가려 한다.
            app.terminate()
        }
    }

    private func openSettings(_ app: XCUIApplication) throws {
        // 더보기 → 설정. 입구는 상단 프로필 카드다("내 정보 · 앱 설정").
        let settings = app.buttons.containing(.staticText, identifier: "내 정보 · 앱 설정").firstMatch
        guard settings.waitForExistence(timeout: 20) else {
            throw XCTSkip("더보기 탭에서 설정 입구(프로필 카드)를 찾지 못했다")
        }
        settings.tap()
        XCTAssertTrue(app.staticTexts["문구 정보"].firstMatch.waitForExistence(timeout: 10), "설정의 '문구 정보' 카드가 없다")
    }

    private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
