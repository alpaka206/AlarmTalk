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

        print(String(format: "알럿: x=%.1f y=%.1f w=%.1f h=%.1f",
                     alert.frame.minX, alert.frame.minY, alert.frame.width, alert.frame.height))
        var prevBottom = alert.frame.minY
        for text in alert.staticTexts.allElementsBoundByIndex {
            print(String(format: "  텍스트 h=%.1f w=%.1f 위여백=%.1f \"%@\"",
                         text.frame.height, text.frame.width,
                         text.frame.minY - prevBottom, String(text.label.prefix(14))))
            prevBottom = text.frame.maxY
        }
        for b in alert.buttons.allElementsBoundByIndex {
            print(String(format: "  버튼 \"%@\" x=%.1f h=%.1f w=%.1f 위여백=%.1f",
                         b.label, b.frame.minX, b.frame.height, b.frame.width,
                         b.frame.minY - prevBottom))
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
