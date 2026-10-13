import XCTest

/// **코드 입력칸에 키보드가 올라와도 입력칸과 등록 버튼이 가려지지 않는다.**
///
/// 대상은 코드를 넣는 **유일한 자리**인 더보기 → 초대 코드 등록(`CodeRegisterRow`)이다.
/// 예전에는 유료 게이트의 코드 입력 시트(`RedeemCodeSheet`)를 봤다 — 화면 아래에서 올라오는 시트라
/// 키보드와 겹치기 쉬웠다. 그 시트는 게이트의 코드 입력 액션과 함께 2026-10-14 에 없앴다.
///
/// ⚠ **유료 게이트에 코드 입력을 되살리지 말 것**(2026-10-14, App Store 지침 3.1.1 두 번째 반려 —
/// 선물 코드 폐지). 남은 코드는 커플·가족 이용권의 초대 코드뿐이고, 넣는 자리는 더보기 하나다.
/// 할인·무료 이용은 스토어 오퍼 코드로 준다. 게이트에 코드 액션이 없는지는 `FreeManualGateUITests` 가 본다.
final class RedeemCodeKeyboardUITests: XCTestCase {

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func test_키보드가_올라와도_초대_코드_입력칸과_등록_버튼이_보인다() {
        let app = XCUIApplication()
        // 공유 이용권이 없는 시드라 더보기에 '초대 코드 등록' 행이 있다(`CodeInputUITests` 와 같은 진입).
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "초대 코드 등록"))
            .element(boundBy: 0)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "더보기에 '초대 코드 등록' 행이 없다")
        row.tap()

        let field = app.textFields["초대 코드"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "초대 코드 입력칸이 없다")
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

        // 등록도 닿아야 한다. 가려지면 코드를 치고도 제출할 수 없다.
        // 이 행은 등록 버튼을 입력칸 바로 옆에 둔다(`CodeRegisterRow`).
        let submit = app.buttons["등록"].firstMatch
        XCTAssertTrue(submit.exists, "등록 버튼이 없다")
        XCTAssertTrue(submit.isHittable, "키보드가 등록 버튼을 가렸다")
    }
}
