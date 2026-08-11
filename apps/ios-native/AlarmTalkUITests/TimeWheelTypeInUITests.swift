import XCTest

/// 타임휠 숫자를 누르면 **그 자리에서** 고쳐 쓰는지.
///
/// ⚠ 예전에는 '시 직접 입력' **알럿**이 떴다 — 고치려는 숫자가 알럿에 가리고 확인까지
/// 두 번을 더 눌러야 했다(2026-08-11 변경). 알럿으로 되돌아가면 여기서 잡힌다.
final class TimeWheelTypeInUITests: XCTestCase {

    func test_숫자를_누르면_알럿_없이_그_자리에서_고쳐_쓴다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms", "-UIPreviewEditor"]
        app.launch()

        let minutes = app.otherElements["timeWheel.분"]
        guard minutes.waitForExistence(timeout: 20) else {
            throw XCTSkip("타임휠 분 칼럼을 찾지 못했다")
        }

        minutes.tap()

        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "숫자를 눌렀는데 키보드가 안 떴다 — 그 자리 입력이 열리지 않았다")
        XCTAssertEqual(app.alerts.count, 0,
                       "직접 입력이 **알럿**으로 떴다 — 그 자리에서 고쳐 쓰는 방식으로 되돌릴 것")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "time-wheel-type-in"
        shot.lifetime = .keepAlways
        add(shot)

        app.typeText("45")
        // ⚠ **키보드 툴바 '완료' 는 없앴다**(2026-08-11) — 휠 **밖**을 누르면 끝난다.
        // 휠을 누르면 그 칼럼의 입력이 다시 시작되므로 닫히지 않는 게 정상이다.
        app.staticTexts["재생 방식"].firstMatch.tap()

        XCTAssertEqual(minutes.label, "45", "친 값이 그 칼럼에 들어가지 않았다")
    }

    /// 범위를 넘겨 쳐도 **거절하지 않고 잘라서** 넣는다(스누즈 알럿과 같은 규칙).
    func test_범위를_넘기면_잘라서_넣는다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms", "-UIPreviewEditor"]
        app.launch()

        let minutes = app.otherElements["timeWheel.분"]
        guard minutes.waitForExistence(timeout: 20) else {
            throw XCTSkip("타임휠 분 칼럼을 찾지 못했다")
        }

        minutes.tap()
        guard app.keyboards.firstMatch.waitForExistence(timeout: 5) else {
            throw XCTSkip("키보드가 뜨지 않았다")
        }
        app.typeText("99")
        // ⚠ **키보드 툴바 '완료' 는 없앴다**(2026-08-11) — 휠 **밖**을 누르면 끝난다.
        // 휠을 누르면 그 칼럼의 입력이 다시 시작되므로 닫히지 않는 게 정상이다.
        app.staticTexts["재생 방식"].firstMatch.tap()

        XCTAssertEqual(minutes.label, "59", "59분을 넘겨 쳤으면 59로 잘려야 한다")
    }
}
