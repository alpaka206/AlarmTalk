import XCTest

/// 이용권 화면을 열어 **안드로이드와 나란히 대조**하기 위한 진입점.
/// (시뮬레이터를 스크립트로 탭할 방법이 없어 만든 것 — `-UIPreview*` 와 같은 이유다.)
final class BillingScreenshotUITests: XCTestCase {

    func test_이용권_화면을_연다() throws {
        // UI 미리보기 촬영이다. 가격 조회·실제 결제 성공을 검증하는 테스트는 아니다.
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewPlan", "free", "-UIPreviewTab", "menu"]
        app.launch()

        let billing = app.buttons.containing(.staticText, identifier: "이용권").firstMatch
        guard billing.waitForExistence(timeout: 20) else {
            throw XCTSkip("더보기에서 '이용권' 을 찾지 못했다")
        }
        billing.tap()

        // 화면이 그려질 때까지 기다린다(플랜 카드 중 하나라도 뜨면 된 것).
        _ = app.staticTexts["개인"].waitForExistence(timeout: 10)

        var report = ["", "===== 이용권 화면에 보이는 글자 ====="]
        for t in app.staticTexts.allElementsBoundByIndex.prefix(40) where !t.label.isEmpty {
            report.append("  \(t.label)")
        }
        report.append("----- 버튼 -----")
        for b in app.buttons.allElementsBoundByIndex.prefix(20) where !b.label.isEmpty {
            report.append("  [\(b.label)]")
        }
        print(report.joined(separator: "\n"))

        let top = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        top.name = "billing-top"
        top.lifetime = .keepAlways
        add(top)

        app.swipeUp()
        app.swipeUp()
        let bottom = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        bottom.name = "billing-bottom"
        bottom.lifetime = .keepAlways
        add(bottom)

        app.swipeDown()
        app.swipeDown()
        let gift = app.buttons["선물하기"].firstMatch
        XCTAssertTrue(gift.waitForExistence(timeout: 5))
        gift.tap()
        XCTAssertTrue(app.staticTexts["개인 이용권 선물하기"].waitForExistence(timeout: 5))
        let giftScreen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        giftScreen.name = "billing-gift"
        giftScreen.lifetime = .keepAlways
        add(giftScreen)
    }
}
