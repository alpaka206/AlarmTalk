import XCTest

/// **입력이 있는 바텀시트의 진짜 관건은 키보드다.** 시트는 화면 아래에 있고 키보드도
/// 아래에서 올라오므로, 회피가 없으면 입력창·확정 버튼이 가려진다.
///
/// 알럿은 화면 가운데라 이 문제가 약하다 — 그래서 "코드 입력에 시트가 맞느냐" 는
/// 물음은 정당하고, 답은 이 테스트가 한다.
///
/// 대상은 유료 게이트의 쿠폰 입력 시트(`RedeemCodeSheet`)다. 예전에는 웰컴 코드 안내
/// 시트를 봤는데 그 시트는 2026-09-27 에 없앴다(쿠폰 입력 자체는 남았다) — 같은 껍데기
/// (`FormSheet` + `BottomSheetHost`)라 여기로 옮겼다.
final class RedeemCodeKeyboardUITests: XCTestCase {

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func test_시트에서_키보드가_올라와도_입력창과_버튼이_보인다() {
        let app = XCUIApplication()
        // 무료 계정의 편집기 → 문구 → '직접 입력' 이 유료 게이트를 띄운다(`FreeManualGateUITests`).
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPlan", "free", "-UIPreviewEditor"]
        app.launch()
        XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        let messageRow = app.buttons.containing(.staticText, identifier: "문구").firstMatch
        XCTAssertTrue(messageRow.waitForExistence(timeout: 10), "'문구' 행이 없다")
        messageRow.tap()

        let manual = app.staticTexts["직접 입력"].firstMatch
        XCTAssertTrue(manual.waitForExistence(timeout: 10), "문구 화면에 '직접 입력' 행이 없다")
        manual.tap()

        let redeem = app.buttons["쿠폰이 있어요"].firstMatch
        XCTAssertTrue(redeem.waitForExistence(timeout: 5), "유료 게이트에 '쿠폰이 있어요' 가 없다")
        redeem.tap()

        let field = app.textFields["초대·선물·프로모션 코드"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "시트의 입력창이 없다")
        shot(app, "01-키보드전")

        field.tap()
        // 키보드가 올라올 때까지.
        XCTAssertTrue(
            app.keyboards.element.waitForExistence(timeout: 5),
            "키보드가 안 올라왔다"
        )
        field.typeText("TESTCODE")
        shot(app, "02-키보드후")

        // 입력창이 키보드 위에 남아 있는가 — 가려지면 hittable 이 false 다.
        XCTAssertTrue(field.isHittable, "키보드가 입력창을 가렸다")

        // 확정(등록)도 닿아야 한다. 가려지면 코드를 치고도 제출할 수 없다.
        // 이 시트는 확정을 상단바에 둔다(`FormSheet` 규칙).
        let submit = app.buttons["등록"].firstMatch
        XCTAssertTrue(submit.exists, "등록 버튼이 없다")
        XCTAssertTrue(submit.isHittable, "키보드가 등록 버튼을 가렸다")
    }
}
