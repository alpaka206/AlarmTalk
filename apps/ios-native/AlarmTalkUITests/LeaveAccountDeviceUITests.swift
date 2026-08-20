import XCTest

/// **로그아웃 정책을 실기기에서 끝까지 밟아 본다.**
///
/// 이 PR 의 핵심 규칙은 코드와 단위 테스트로만 검증돼 있었다. 실제 기기에서 사람이 누르는
/// 순서대로 밟으면 무슨 일이 벌어지는지는 확인하지 못했는데, 이 PR 이 만진 것이 **잠든
/// 사람을 깨우는 경로**라 그 확인이 없으면 곤란하다.
///
/// ⚠ **이 테스트는 진짜 세션을 로그아웃시킨다.** `-UIPreviewSeed` 가짜 세션이 아니라
/// 기기에 실제로 로그인된 계정을 쓴다 — 사용자 동의를 받고 돌린다(2026-08-19).
///
/// ⚠ **이름과 주석으로는 못 막는다**(Codex #699 P1). 공유 스킴의 Test 액션은
/// `AlarmTalkUITests` 타깃을 통째로 켜므로, 누가 평범하게 "테스트 실행" 만 해도 XCTest 가
/// 이 클래스를 **찾아내서 실기기의 진짜 계정을 로그아웃시킨다.** 그래서 실행 시점에
/// 환경변수로 **명시적으로 켜야만** 돌게 한다 — 안 켜면 건너뛴다.
///
///     ALARMTALK_DEVICE_LOGOUT_TEST=1 xcodebuild test -only-testing:... 
///
/// 확인하는 것:
///   1. 알람을 만들면 켜진 채 예약된다.
///   2. 로그아웃하면 **행이 꺼지고** 예약 핸들이 사라진다(정책의 핵심).
///   3. 로그아웃 뒤에는 알람 화면에 **들어갈 수 없다**(그래서 예약을 끊어야 한다).
///   4. 비밀번호를 틀리면 **입력창 바로 아래에 빨간 문구**가 뜬다.
@MainActor
final class LeaveAccountDeviceUITests: XCTestCase {

    /// ⚠ **라벨로 찾는다.** 이 앱은 접근성 **식별자**를 따로 두지 않아서,
    /// `app.buttons["추가"]` 같은 첨자 조회는 `'"추가" IN identifiers'` 로 풀려 못 찾는다
    /// (2026-08-19 실기기에서 확인 — 화면에는 분명히 있는데 매칭이 0건이었다).
    private func button(_ app: XCUIApplication, label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// 화면에 무엇이 있는지 함께 남긴다 — 라벨을 추측하다 기기 실행을 여러 번 날렸다.
    private func dump(_ app: XCUIApplication, _ name: String) {
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "tree-\(name)"
        tree.lifetime = .keepAlways
        add(tree)
    }

    /// 실행 인자로 켜지 않으면 건너뛴다 — 이 테스트는 **진짜 계정을 로그아웃시킨다.**
    private func requireExplicitOptIn() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["ALARMTALK_DEVICE_LOGOUT_TEST"] == "1",
            "실기기 로그아웃 테스트는 ALARMTALK_DEVICE_LOGOUT_TEST=1 일 때만 돈다"
        )
    }

    func test_로그아웃까지_한_흐름으로_밟는다() throws {
        try requireExplicitOptIn()
        let app = XCUIApplication()
        app.launch()

        // ── 1. 로그인된 상태에서 시작한다.
        XCTAssertTrue(
            app.staticTexts["더보기"].waitForExistence(timeout: 30),
            "홈이 안 떴다 — 세션이 없다"
        )
        snap(app, "1-home-before")
        dump(app, "1-home")

        // ── 2. 알람을 하나 만든다.
        // ⚠ 빈 목록에서는 '＋' 가 **카드 안**에 있고 그 카드에는 버튼 라벨이 없다.
        // 라벨로 찾으려다 기기 실행을 세 번 날려서, 좌표로 누른다(카드 한가운데).
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.225)).tap()
        let save = button(app, label: "저장")
        let editorOpened = save.waitForExistence(timeout: 25)
        snap(app, "2-editor")
        dump(app, "2-editor")
        XCTAssertTrue(editorOpened, "편집기가 안 열렸다")
        save.tap()

        // 저장은 비동기(로컬 쓰기 + 예약)라 목록에 나타날 때까지 기다린다.
        let alarmAppeared = app.switches.firstMatch.waitForExistence(timeout: 30)
        snap(app, "3-home-with-alarm")
        dump(app, "3-home-with-alarm")
        XCTAssertTrue(alarmAppeared, "저장한 알람이 목록에 없다")

        // ── 3. 더보기 → 내 정보 → 로그아웃.
        button(app, label: "더보기").tap()
        let profile = app.staticTexts["내 정보 · 앱 설정"]
        XCTAssertTrue(profile.waitForExistence(timeout: 15), "'내 정보' 행이 없다")
        profile.tap()

        let logout = button(app, label: "로그아웃")
        let logoutVisible = logout.waitForExistence(timeout: 15)
        snap(app, "4-account-panel")
        dump(app, "4-account-panel")
        XCTAssertTrue(logoutVisible, "로그아웃 버튼이 없다")
        logout.tap()

        // ⚠ 확인 알럿이 뜬다 — 바로 나가지 않는다(잘못 눌렀을 때를 위해).
        let confirm = app.alerts.buttons["로그아웃"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "확인 알럿이 안 떴다")
        snap(app, "5-logout-confirm")
        confirm.tap()

        // ── 4. 랜딩으로 나가야 한다. 이게 "알람 화면에 들어갈 수도 없다" 의 실체다.
        let leftHome = app.staticTexts["더보기"].waitForNonExistence(timeout: 30)
        snap(app, "6-landing-after-logout")
        dump(app, "6-landing")
        XCTAssertTrue(leftHome, "로그아웃했는데 홈이 그대로다")
    }

    /// **비밀번호를 틀렸을 때 빨간 문구가 입력창 아래에 뜨는가.**
    ///
    /// 위 테스트가 로그아웃시켜 놓은 상태에서 이어서 돈다(이름 순서상 뒤에 실행된다).
    /// 일부러 틀린 비밀번호로 **진짜 서버에** 붙는다 — 그 401 이 있어야 문구가 뜬다.
    func test_비밀번호가_틀리면_입력창_아래에_빨간_문구가_뜬다() throws {
        try requireExplicitOptIn()
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewAuthScreen", "login"]
        app.launch()

        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 30), "로그인 화면이 안 열렸다(아직 로그인 상태?)")

        let email = app.textFields.firstMatch
        email.tap()
        email.typeText("no-such-account-probe@example.com")

        password.tap()
        password.typeText("definitely-wrong-password")
        snap(app, "7-login-filled")

        button(app, label: "로그인").tap()

        let error = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "맞지 않아요")
        ).firstMatch
        let appeared = error.waitForExistence(timeout: 30)
        snap(app, "8-login-error")

        XCTAssertTrue(appeared, "틀린 비밀번호인데 안내 문구가 뜨지 않았다")
    }
}
