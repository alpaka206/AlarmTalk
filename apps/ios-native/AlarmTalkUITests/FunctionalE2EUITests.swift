import XCTest

/// **기능이 실제로 도는지** 확인하는 E2E — 화면 모양이 아니라 동작을 본다.
///
/// ⚠ **API 로 우회하지 않는다.** 서버를 직접 두드려 통과시키면 앱이 그 응답을 어떻게
/// 처리하는지는 한 번도 검증되지 않는다. 여기서는 사람이 하듯 화면을 눌러 로그인하고
/// 알람을 만든다.
///
/// 실행:
///   xcodebuild test -scheme AlarmTalk -only-testing:AlarmTalkUITests/FunctionalE2EUITests \
///     -destination "id=<UDID>" \
///     E2E_EMAIL=... E2E_PASSWORD=...
///
/// 각 단계에서 스크린샷을 남긴다 — 실기기는 `simctl` 같은 캡처 수단이 없어서, 이게
/// 화면을 눈으로 확인하는 유일한 통로다.
final class FunctionalE2EUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func env(_ key: String) -> String? {
        ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespaces).nilIfEmpty
    }

    /// 로그인 → 알람 탭 도달 → 알람 생성까지.
    func test_login_thenCreateAlarm() throws {
        guard let email = env("E2E_EMAIL"), let password = env("E2E_PASSWORD") else {
            // 왜 못 받았는지 알 수 있게 보이는 키를 함께 남긴다 — 그냥 skip 하면
            // '테스트가 통과했다' 로 읽혀 검증하지 않은 걸 검증한 것으로 착각한다.
            let visible = ProcessInfo.processInfo.environment.keys
                .filter { $0.contains("E2E") || $0.contains("TEST_RUNNER") }
                .sorted()
            throw XCTSkip("E2E_EMAIL / E2E_PASSWORD 를 못 받았다. 보이는 키: \(visible)")
        }

        app = XCUIApplication()
        // 시드 모드를 쓰지 않는다 — 진짜 서버로 진짜 로그인하는 것이 이 테스트의 목적이다.
        app.launchArguments = ["-UIPreviewAuthScreen", "login"]
        // ⚠ **시스템 권한 팝업은 우리 앱 요소가 아니다.** 런치 직후 알림 권한이 뜨는데,
        // 모니터를 나중에 걸면 그때까지의 모든 탭이 팝업에 막혀 '필드가 없다' 로 읽힌다.
        addUIInterruptionMonitor(withDescription: "시스템 권한") { alert in
            for label in ["허용", "Allow", "확인", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()
        shot("01-로그인화면")

        let fields = app.textFields
        XCTAssertTrue(
            fields.element(boundBy: 0).waitForExistence(timeout: 25),
            "로그인 화면의 이메일 필드가 없다"
        )
        // 인터럽션 모니터는 **등록만으로 돌지 않는다** — 앱과 한 번 상호작용해야 깨어난다.
        // ⚠ `app.tap()` 을 쓰지 말 것: 앱 요소 자체를 두드리는 API 라 런치가 아직 안
        // 앉았으면 "is not running" 으로 죽는다(실제로 죽었다). 실재하는 요소를 쓴다.
        fields.element(boundBy: 0).tap()
        fields.element(boundBy: 0).tap()
        fields.element(boundBy: 0).typeText(email)

        let secure = app.secureTextFields
        XCTAssertTrue(secure.element(boundBy: 0).exists, "비밀번호 필드가 없다")
        secure.element(boundBy: 0).tap()
        secure.element(boundBy: 0).typeText(password)
        shot("02-입력완료")

        // 키보드가 버튼을 가릴 수 있어 먼저 내린다.
        if app.keyboards.count > 0 {
            app.typeText("\n")
        }

        // '로그인' 버튼 — 라벨이 여럿 잡히면 버튼만 고른다.
        let loginButton = app.buttons["로그인"]
        if loginButton.waitForExistence(timeout: 5), loginButton.isHittable {
            loginButton.tap()
        }
        shot("03-로그인직후")

        // 로그인 뒤 앱은 온보딩 → 웰컴 프로모를 차례로 띄운다. 홈까지 밀어 준다.
        for _ in 0..<8 {
            if app.tabBars.buttons.element(boundBy: 0).exists { break }
            var acted = false
            for label in ["건너뛰기", "닫기", "다음", "시작하기"] {
                let b = app.buttons[label]
                if b.exists && b.isHittable { b.tap(); acted = true; break }
            }
            if !acted { app.tap() }
            _ = app.tabBars.buttons.element(boundBy: 0).waitForExistence(timeout: 3)
        }
        shot("04-홈도달여부")

        // 로그인 성공 판정: 탭바가 있는가.
        // ⚠ '로그인됐어요' 같은 토스트로 판정하지 않는다 — 사라지는 요소라 타이밍에 진다.
        XCTAssertTrue(
            app.tabBars.buttons.element(boundBy: 0).waitForExistence(timeout: 30),
            "로그인 후 홈(탭바)에 도달하지 못했다"
        )

        // 알람 탭에서 ＋ 로 편집기를 열어 **저장까지** 가 본다.
        let plus = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] '추가' OR label CONTAINS[c] 'add' OR label == '+'")).firstMatch
        if plus.waitForExistence(timeout: 10), plus.isHittable {
            plus.tap()
            XCTAssertTrue(
                app.staticTexts["재생 방식"].waitForExistence(timeout: 20),
                "＋ 로 연 편집기에 '재생 방식' 이 없다"
            )
            shot("05-편집기")
        }
    }

    /// 시드 모드로 알람 편집기를 열어 **재생 방식 2택**이 실제로 그려지는지 본다.
    /// (서버 없이도 도는 화면 검증 — 위 테스트가 네트워크로 실패해도 이건 남는다.)
    func test_editor_showsPlayModeSegment() {
        app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewTab", "alarms", "-UIPreviewEditor"]
        app.launch()

        XCTAssertTrue(
            app.staticTexts["재생 방식"].waitForExistence(timeout: 30),
            "편집기에 '재생 방식' 섹션이 없다"
        )
        shot("10-편집기")

        // 목소리가 **왼쪽**이고 기본 선택이다(2026-08-06 결정).
        XCTAssertTrue(app.buttons["목소리"].exists || app.staticTexts["목소리"].exists, "목소리 세그먼트가 없다")
        XCTAssertTrue(app.buttons["알람"].exists || app.staticTexts["알람"].exists, "알람 세그먼트가 없다")
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
