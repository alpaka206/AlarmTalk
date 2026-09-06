import XCTest

/// 공휴일 달력 시트를 열어 **위 여백**을 눈으로 확인하기 위한 진입점.
///
/// 시뮬레이터를 스크립트로 탭할 방법이 없어서 만든 것이다(같은 이유로 `-UIPreview*` 진입점이 있다).
/// 스크린샷은 테스트 첨부로 남는다.
final class HolidaySheetScreenshotUITests: XCTestCase {

    func test_공휴일_달력_시트를_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        // 더보기 → 설정. 입구는 상단 프로필 카드다("내 정보 · 앱 설정").
        let settings = app.buttons.containing(.staticText, identifier: "내 정보 · 앱 설정").firstMatch
        guard settings.waitForExistence(timeout: 20) else {
            throw XCTSkip("더보기 탭에서 설정 입구(프로필 카드)를 찾지 못했다")
        }
        settings.tap()

        let holiday = app.buttons.containing(.staticText, identifier: "공휴일 달력").firstMatch
        guard holiday.waitForExistence(timeout: 10) else {
            throw XCTSkip("설정에서 '공휴일 달력' 행을 찾지 못했다")
        }
        holiday.tap()

        XCTAssertTrue(
            app.staticTexts["대한민국"].waitForExistence(timeout: 10)
                || app.staticTexts["공휴일 달력"].waitForExistence(timeout: 2),
            "공휴일 시트가 뜨지 않았다"
        )

        capture("holiday-sheet")

        // 시트를 닫고 날씨·운세도 이어서 담는다.
        dismissSheet(app)
        if app.buttons.containing(.staticText, identifier: "날씨 지역").firstMatch.waitForExistence(timeout: 5) {
            app.buttons.containing(.staticText, identifier: "날씨 지역").firstMatch.tap()
            // 행 이름과 시트 제목이 같은 문자열("날씨 지역")이 됐으므로,
            // 시트가 떴는지는 시트에만 있는 행으로 가른다.
            _ = app.staticTexts["직접 입력"].waitForExistence(timeout: 5)
            capture("weather-sheet")
            dismissSheet(app)
        }
        if app.buttons.containing(.staticText, identifier: "운세 정보").firstMatch.waitForExistence(timeout: 5) {
            app.buttons.containing(.staticText, identifier: "운세 정보").firstMatch.tap()
            _ = app.staticTexts["운세 정보"].waitForExistence(timeout: 5)
            capture("fortune-dialog")
        }
    }

    /// 바텀시트를 스크림 탭으로 닫는다.
    ///
    /// ⚠ **`app.tap()` 을 쓰지 말 것 — 화면 정중앙을 누른다.** 시트가 화면의 50% 를
    /// 차지하므로 그 지점은 스크림과 시트의 **경계**라, 시트가 안 닫힌 채 다음 행을 누르러
    /// 가서 "not hittable" 로 실패했다(2026-08-10). 위쪽 15% 지점은 언제나 스크림이다.
    private func dismissSheet(_ app: XCUIApplication) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
    }

    private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
