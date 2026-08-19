import XCTest

/// 비밀번호 재설정 **실기기 E2E**.
///
/// 실기기에는 `simctl` 같은 입력 주입이 없어서, 이 테스트가 손 역할을 한다.
/// 코드는 서버가 메일로만 보내므로 호출부가 `E2E_RESET_CODE` 로 넣어 준다
/// (dev DB 에 아는 코드를 심어 두고 그 값을 넘긴다).
///
/// 검증하는 것 둘:
///   1. 코드 요청 → 코드·새 비밀번호 단계가 열리는가
///   2. 나갔다 다시 들어오면 **발송 상태가 남지 않는가**(2026-08-10 수정)
final class PasswordResetE2EUITests: XCTestCase {
    private var app: XCUIApplication!

    private func env(_ key: String) -> String? {
        let value = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespaces)
        return (value?.isEmpty ?? true) ? nil : value
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    func test_passwordReset_thenStateClearedOnReentry() throws {
        guard let email = env("E2E_EMAIL"),
              let code = env("E2E_RESET_CODE"),
              let newPassword = env("E2E_NEW_PASSWORD") else {
            let visible = ProcessInfo.processInfo.environment.keys
                .filter { $0.contains("E2E") || $0.contains("TEST_RUNNER") }
                .sorted()
            throw XCTSkip("E2E 값을 못 받았다. 보이는 키: \(visible)")
        }

        app = XCUIApplication()
        // ⚠ **먼저 로그아웃해야 한다.** `-UIPreviewAuthScreen` 은 `LandingView` 에서만
        // 읽히는데, 세션이 있으면 그 화면 자체가 뜨지 않아 인자가 조용히 무시된다.
        app.launchArguments = []
        addUIInterruptionMonitor(withDescription: "시스템 권한") { alert in
            for label in ["허용", "Allow", "확인", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()

        // 세션이 있으면 로그아웃한다(없으면 그대로 지나간다).
        let more = app.buttons["더보기"].firstMatch
        if more.waitForExistence(timeout: 20) {
            more.tap()
            let settings = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] '내 정보'")
            ).firstMatch
            if settings.waitForExistence(timeout: 10) {
                settings.tap()
                let logout = app.buttons["로그아웃"].firstMatch
                if logout.waitForExistence(timeout: 10) {
                    logout.tap()
                    // 확인 알럿의 '로그아웃'(두 번째)을 누른다.
                    let confirmLogout = app.alerts.buttons["로그아웃"].firstMatch
                    if confirmLogout.waitForExistence(timeout: 10) { confirmLogout.tap() }
                }
            }
            shot("00-로그아웃후")
        }

        // 이제 랜딩이 뜨므로 재설정 화면으로 바로 진입할 수 있다.
        app.terminate()
        app.launchArguments = ["-UIPreviewAuthScreen", "reset"]
        app.launch()

        XCTAssertTrue(app.buttons["인증 코드 받기"].firstMatch.waitForExistence(timeout: 20),
                      "재설정 화면에 도달하지 못했다")
        shot("01-재설정화면")

        // 이메일 입력 → 인증 코드 받기
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 10), "이메일 칸이 없다")
        emailField.tap()
        emailField.typeText(email)

        let sendButton = app.buttons["인증 코드 받기"].firstMatch
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5), "'인증 코드 받기' 가 없다")
        sendButton.tap()

        // 코드 단계가 열려야 한다
        let codeField = app.textFields.element(boundBy: 1)
        XCTAssertTrue(codeField.waitForExistence(timeout: 25), "코드 입력 단계가 열리지 않았다")
        shot("02-코드단계")

        codeField.tap()
        codeField.typeText(code)

        let pwField = app.secureTextFields.firstMatch
        XCTAssertTrue(pwField.waitForExistence(timeout: 10), "새 비밀번호 칸이 없다")
        pwField.tap()
        pwField.typeText(newPassword)
        shot("03-입력완료")

        let confirm = app.buttons["비밀번호 변경"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "'비밀번호 변경' 이 없다")
        confirm.tap()

        // 성공하면 재설정 화면을 벗어난다(변경 버튼이 사라진다).
        // ⚠ `expectation(for:evaluatedWith:)` 를 쓰지 말 것 — Swift 6 에서 테스트
        // 인스턴스를 non-Sendable 로 보내 컴파일이 막힌다. 단순 폴링으로 기다린다.
        var vanished = false
        for _ in 0..<60 where !vanished {
            if !confirm.exists { vanished = true; break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(vanished, "변경 후에도 '비밀번호 변경' 이 남아 있다")
        shot("04-변경후")

        // ⚠ 다시 띄웠을 때 **발송 상태가 남아 있으면 안 된다**(2026-08-10 수정).
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["인증 코드 받기"].firstMatch.waitForExistence(timeout: 20),
                      "재진입 화면이 초기 상태가 아니다")
        XCTAssertFalse(app.staticTexts["코드를 보냈어요"].exists, "재진입인데 '코드를 보냈어요' 가 남아 있다")
        shot("05-재진입")
    }
}
