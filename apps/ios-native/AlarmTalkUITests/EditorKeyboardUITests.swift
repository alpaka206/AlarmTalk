import XCTest

/// **시각을 눌러 고쳐 쓸 때 [취소][저장] 바가 따라 올라오지 않아야 한다.**
///
/// 2026-08-11 에 한 번 고쳤는데 2026-08-15 에 같은 지적이 다시 나왔다 — 고친 자리가
/// 틀렸기 때문이다. `.ignoresSafeArea(.keyboard)` 를 **바 자신**에 걸어 뒀는데, 키보드
/// 안전영역은 바깥에서 화면을 줄이므로 이미 줄어든 높이 안에 놓인 자식이 "난 무시한다" 고
/// 해 봐야 올라갈 자리가 달라지지 않는다. 줄어드는 **컨테이너**가 무시해야 한다.
///
/// 눈으로는 "좀 올라왔나?" 로 넘어가므로 좌표로 고정한다.
final class EditorKeyboardUITests: XCTestCase {

    func test_시각_입력중에도_저장바는_제자리다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()

        let save = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "저장"))
            .firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 10), "편집기 하단 저장 버튼이 없다")
        let before = save.frame

        // 가운데 시(hour) 숫자를 눌러 그 자리 입력을 연다(`TimeTypeInUITests` 와 같은 식별자).
        let hour = app.otherElements["timeWheel.시"].firstMatch
        XCTAssertTrue(hour.waitForExistence(timeout: 5), "타임휠 시 칼럼이 없다")
        hour.tap()

        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "숫자 키패드가 올라오지 않았다")

        let after = save.frame
        XCTAssertEqual(
            after.minY, before.minY, accuracy: 1,
            """
            키보드가 올라오자 저장 바가 \(Int(before.minY)) → \(Int(after.minY)) 로 움직였다 — \
            `.ignoresSafeArea(.keyboard)` 가 줄어드는 컨테이너가 아니라 바에 걸려 있다.
            """
        )
    }
}
