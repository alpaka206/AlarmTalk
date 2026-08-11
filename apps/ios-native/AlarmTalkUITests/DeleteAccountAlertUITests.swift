import XCTest

/// 회원 탈퇴 확인 알럿을 띄워 **안드로이드 것과 나란히 대조**하기 위한 진입점.
/// (누르지 않는다 — 뜨는 것만 확인하고 캡처한다.)
final class DeleteAccountAlertUITests: XCTestCase {

    func test_탈퇴_확인_알럿을_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        let delete = app.buttons.containing(.staticText, identifier: "회원 탈퇴").firstMatch
        guard delete.waitForExistence(timeout: 20) else {
            throw XCTSkip("더보기에서 '회원 탈퇴' 를 찾지 못했다")
        }
        delete.tap()

        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 10) else {
            throw XCTSkip("탈퇴 확인 알럿이 뜨지 않았다")
        }

        // 제목·본문이 가운데인지 프레임으로 본다(좌우 여백이 같으면 가운데다).
        for text in alert.staticTexts.allElementsBoundByIndex {
            let leftGap = text.frame.minX - alert.frame.minX
            let rightGap = alert.frame.maxX - text.frame.maxX
            print(String(
                format: "텍스트 \"%@\": 좌여백 %.1f / 우여백 %.1f → %@",
                text.label, leftGap, rightGap,
                abs(leftGap - rightGap) < 2 ? "가운데" : "치우침"
            ))
        }

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "delete-account-alert"
        shot.lifetime = .keepAlways
        add(shot)

        XCTAssertGreaterThan(alert.frame.width, 0)
    }
}
