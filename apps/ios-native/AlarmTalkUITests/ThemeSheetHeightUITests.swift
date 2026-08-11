import XCTest

/// **시트가 내용만큼 뜨는지** 재는 회귀 테스트.
///
/// 예전에는 `BottomSheetHost` 가 부분 높이를 더해 시트 높이를 계산했는데, 그 식에
/// 제목-목록 사이 간격(14)과 시트 아래 여백(8)이 빠져 있었다. 딱 22pt 가 모자라
/// **항목이 3개뿐인 화면 테마 시트조차 안에서 스크롤**됐다(2026-08-11 지적).
///
/// 그래서 "마지막 항목이 화면 안에 온전히 보인다" 를 못으로 박는다.
final class ThemeSheetHeightUITests: XCTestCase {

    func test_테마_시트는_스크롤_없이_세_항목이_다_보인다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        let theme = app.buttons.containing(.staticText, identifier: "화면 테마").firstMatch
        XCTAssertTrue(theme.waitForExistence(timeout: 30), "더보기에서 '화면 테마' 행을 찾지 못했다")
        theme.tap()

        let last = app.staticTexts["어둡게"]
        XCTAssertTrue(last.waitForExistence(timeout: 10), "테마 시트가 뜨지 않았다")

        let screen = app.windows.firstMatch.frame
        var sheetTop = CGFloat.greatestFiniteMagnitude
        // ⚠ "화면 테마" 는 뒤 화면의 설정 행에도 있어 **둘 이상 잡힌다** — 시트 안에서만
        // 유일한 세 항목으로 잰다.
        for label in ["시스템", "밝게", "어둡게"] {
            let e = app.staticTexts[label].firstMatch
            guard e.exists else { continue }
            sheetTop = min(sheetTop, e.frame.minY)
            print(String(format: "  \"%@\" y=%.1f..%.1f", label, e.frame.minY, e.frame.maxY))
        }
        print(String(format: "화면 %.0f / 시트 내용 위 %.0f → 아래에서 %.0f%% 를 덮는다",
                     screen.height, sheetTop, (screen.maxY - sheetTop) / screen.height * 100))

        // ⚠ 핵심 단언: 마지막 항목이 화면 안에 **온전히** 들어와야 한다.
        // 스크롤에 갇히면 여기가 화면 아래로 넘어간다.
        XCTAssertLessThanOrEqual(
            last.frame.maxY, screen.maxY,
            "'어둡게' 가 화면 밖이다 — 시트가 내용보다 짧아 안에서 스크롤되고 있다"
        )
        // 그리고 항목 3개짜리 시트는 화면 절반을 넘길 이유가 없다.
        XCTAssertGreaterThan(
            sheetTop, screen.midY,
            "항목 3개짜리 시트가 화면 절반 넘게 덮는다"
        )

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "theme-sheet"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
