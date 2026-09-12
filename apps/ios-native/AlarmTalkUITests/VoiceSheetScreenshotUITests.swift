import XCTest

/// 목소리 고르기 시트를 열어 눈으로 확인하기 위한 진입점.
/// (시뮬레이터를 스크립트로 탭할 방법이 없어 만든 것 — `-UIPreview*` 와 같은 이유다.)
final class VoiceSheetScreenshotUITests: XCTestCase {

    func test_목소리_고르기_시트를_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms", "-UIPreviewEditor"]
        app.launch()

        let voiceRow = app.buttons.containing(.staticText, identifier: "목소리").firstMatch
        guard voiceRow.waitForExistence(timeout: 20) else {
            throw XCTSkip("편집기에서 목소리 행을 찾지 못했다")
        }
        voiceRow.tap()

        XCTAssertTrue(
            app.staticTexts["목소리 고르기"].waitForExistence(timeout: 10),
            "목소리 고르기 시트가 뜨지 않았다"
        )
        // ⚠ **'닫기' 버튼이 없어야 한다.** 고르면 닫히고 스크림·드래그로도 닫히므로,
        // 버튼을 두면 취소와 같은 일을 하는 두 번째 액션이 된다(CLAUDE.md).
        XCTAssertFalse(app.buttons["닫기"].exists, "선택 시트에 '닫기' 버튼을 다시 두지 말 것")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "voice-selection-sheet"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
