import XCTest

/// 운세 정보 다이얼로그를 열어 눈으로 확인하기 위한 진입점.
/// (시뮬레이터를 스크립트로 탭할 방법이 없어 만든 것 — `-UIPreview*` 와 같은 이유다.)
final class FortuneDialogScreenshotUITests: XCTestCase {

    func test_운세_정보_다이얼로그를_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        let settings = app.buttons.containing(.staticText, identifier: "내 정보 · 앱 설정").firstMatch
        guard settings.waitForExistence(timeout: 20) else {
            throw XCTSkip("설정 입구를 찾지 못했다")
        }
        settings.tap()

        let fortune = app.buttons.containing(.staticText, identifier: "운세 정보").firstMatch
        guard fortune.waitForExistence(timeout: 10) else {
            throw XCTSkip("설정에서 '운세 정보' 행을 찾지 못했다")
        }
        fortune.tap()

        XCTAssertTrue(
            app.staticTexts["연도"].waitForExistence(timeout: 10),
            "생년월일 드롭다운(연도)이 없다 — 달력 시트로 되돌아갔을 수 있다"
        )
        XCTAssertTrue(app.staticTexts["월"].exists && app.staticTexts["일"].exists,
                      "생년월일은 연·월·일 드롭다운 3개여야 한다")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "fortune-dialog"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
