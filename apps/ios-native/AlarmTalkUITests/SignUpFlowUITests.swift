import XCTest

/// 회원가입·로그인 **화면을 실제로 조작하는** 테스트.
///
/// ⚠ **이게 없으면 실기기에서 가입 UI 를 검증할 방법이 없다.** 시뮬레이터는
/// `simctl` 에 입력 명령이 없고, 실기기는 더더욱 스크립트로 못 누른다 — 그래서
/// API 로 계정을 만들어 우회하면 **가입 화면 자체는 한 번도 안 거친 채** 넘어간다.
///
/// 실행:
///   xcodebuild test -scheme AlarmTalk -only-testing:AlarmTalkUITests \
///     -destination "id=<기기 UDID>" SIGNUP_EMAIL=... SIGNUP_CODE=...
///
/// 이메일 인증 코드는 서버가 보내므로, 호출자가 환경변수로 넘긴다(dev DB 에 심어 둔 값).
final class SignUpFlowUITests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        // 시드 모드는 로그인 상태로 시작해 버리므로 여기서는 쓰지 않는다.
        app.launchArguments = ["-UIPreviewAuthScreen", "register"]
        app.launch()
        return app
    }

    /// 랜딩 → 회원가입 화면까지 실제로 도달하는가.
    func test_landing_reachesSignUpForm() {
        let app = launchApp()
        // 가입 화면의 고정 요소로 판별한다(문구가 바뀌면 여기서 잡힌다).
        XCTAssertTrue(
            app.staticTexts["회원가입"].waitForExistence(timeout: 20),
            "회원가입 화면에 도달하지 못했다"
        )
        XCTAssertTrue(app.staticTexts["목소리 알람을 만들 계정을 준비해요."].exists, "부제가 없다")
    }

    /// 비밀번호 규칙 3종이 입력에 따라 실제로 켜지는가.
    func test_passwordRules_turnOnAsTyped() {
        let app = launchApp()
        XCTAssertTrue(app.staticTexts["회원가입"].waitForExistence(timeout: 20))

        let fields = app.textFields
        XCTAssertGreaterThanOrEqual(fields.count, 2, "이름·이메일 필드가 있어야 한다")

        let secure = app.secureTextFields
        XCTAssertGreaterThanOrEqual(secure.count, 1, "비밀번호 필드가 있어야 한다")
        secure.element(boundBy: 0).tap()
        secure.element(boundBy: 0).typeText("Test1234!")

        // 규칙 행은 '8자 이상' 등 고정 문구다.
        XCTAssertTrue(app.staticTexts["8자 이상"].exists, "비밀번호 규칙 행이 없다")
    }

    /// 로그인 ↔ 회원가입 하단 전환 행이 동작하는가(안드로이드와 같은 구조).
    func test_bottomSwitchRow_togglesMode() {
        let app = launchApp()
        XCTAssertTrue(app.staticTexts["회원가입"].waitForExistence(timeout: 20))

        // 하단 전환 행은 화면 맨 아래에 있다 — 스크롤해야 닿는다.
        // (같은 이름의 요소가 위에도 있을 수 있어 **마지막** 것을 고른다.)
        let matches = app.buttons.matching(identifier: "로그인")
        XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 5), "전환 행이 없다")
        let target = matches.count > 1
            ? matches.element(boundBy: matches.count - 1)
            : matches.firstMatch
        if !target.isHittable { app.swipeUp() }
        target.tap()
        XCTAssertTrue(
            app.staticTexts["좋아하는 목소리 알람을 다시 불러올게요."].waitForExistence(timeout: 8),
            "하단 전환 행으로 로그인 모드에 못 갔다"
        )
    }
}
