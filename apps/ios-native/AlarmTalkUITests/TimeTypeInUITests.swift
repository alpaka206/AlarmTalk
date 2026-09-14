import XCTest

/// 숫자 직접 입력 — **시에서 분으로 곧장 옮겨갈 수 있어야** 한다.
///
/// ⚠ **여기서 값까지 단언하지 않는다.** 휠 숫자는 화면에 `:` 만 노출되고 접근성 `value`
/// 도 비어 있어, XCUITest 로는 "시에 9 가 들어갔는가" 를 읽을 방법이 없다(2026-08-11 시도).
/// 값 보존은 실기기에서 눈으로 본다 — 여기서는 **옮겨갈 수 있는가**만 못 박는다.
final class TimeTypeInUITests: XCTestCase {

    func test_시를_치다가_분을_누르면_분으로_옮겨간다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()

        let hourWheel = app.otherElements["timeWheel.시"].firstMatch
        let minuteWheel = app.otherElements["timeWheel.분"].firstMatch
        guard hourWheel.waitForExistence(timeout: 30), minuteWheel.exists else {
            throw XCTSkip("타임휠을 못 찾았다")
        }

        hourWheel.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "숫자 키패드가 안 떴다")
        app.typeText("9")

        // ⚠ 툴바 '완료' 를 거치지 않고 **분을 곧장 누른다.**
        minuteWheel.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 5),
            "분으로 옮겨가지 못했다 — 입력이 닫혀 버렸나?"
        )
        app.typeText("45")

        // ⚠ **휠이 아닌 곳**을 누른다. 휠을 누르면 그 칼럼의 입력이 다시 시작되므로
        // (`beginTypeIn`) 키패드가 남는 게 정상이다 — 처음엔 그걸 버그로 오독했다.
        app.staticTexts["재생 방식"].firstMatch.tap()
        XCTAssertFalse(
            app.keyboards.firstMatch.waitForExistence(timeout: 3),
            "휠 밖을 눌렀는데 키패드가 남아 있다 — '완료' 없이는 못 닫는 상태다"
        )
    }
}
