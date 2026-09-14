import XCTest

/// **화면을 눈으로 확인하기 위한 진입점.**
///
/// 실기기 iPhone 은 `devicectl` 로 설치·실행·파일복사만 되고 **탭도 스크린샷도 안 된다**
/// (`adb shell input tap` / `screencap` 같은 것이 없다). 대신 XCUITest 안에서는 둘 다
/// 되므로, 확인하고 싶은 화면을 여기로 열고 캡처를 첨부한다.
///
/// 열 화면은 환경변수로 준다 — 테스트 코드를 매번 고치지 않고 인자만 바꿔 돌릴 수 있다:
///
///     PROBE_ARGS="-UIPreviewSeed -UIPreviewAuthScreen login" \
///       xcodebuild test -only-testing:AlarmTalkUITests/ScreenProbeUITests ...
///
/// 캡처는 `.xcresult` 에 첨부로 남고, `xcrun xcresulttool export attachments` 로 꺼낸다.
@MainActor
final class ScreenProbeUITests: XCTestCase {

    func test_화면을_열고_캡처한다() {
        let app = XCUIApplication()
        let raw = ProcessInfo.processInfo.environment["PROBE_ARGS"] ?? "-UIPreviewSeed"
        app.launchArguments = raw.split(separator: " ").map(String.init)
        app.launch()

        // 첫 화면이 그려질 때까지. 무엇이 뜨는지는 화면마다 다르므로 존재 단언 대신
        // 앱이 살아 있는지만 본다 — 이 테스트의 목적은 판정이 아니라 **눈으로 보기**다.
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "앱이 전경으로 안 왔다")

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "screen"
        shot.lifetime = .keepAlways
        add(shot)

        // 요소 트리도 함께 남긴다 — 캡처만으로는 무엇이 눌리는지(히트영역) 알 수 없다.
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "tree"
        tree.lifetime = .keepAlways
        add(tree)
    }

    /// **여러 단계를 눌러 가며 확인할 수 있다는 증거.**
    ///
    /// 모달을 닫고 → 탭을 옮기고 → 그 결과를 캡처한다. 한 번에 한 화면씩 눌러 보는 일이
    /// 실기기에서도 되는지 보여 주는 것이 목적이다.
    ///
    /// ⚠ **실제 계정 상태를 건드리는 조작(로그아웃·탈퇴·결제)은 여기에 넣지 말 것.**
    /// 화면 확인은 `-UIPreviewSeed` 의 가짜 세션 위에서만 한다 — 2026-08-19 에 테스트가
    /// 진짜 세션을 지워 사용자를 로그아웃시킨 적이 있다(`TestIsolation`).
    func test_눌러가며_화면을_옮긴다() {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewTab", "alarms"]
        app.launch()

        // 시드 계정에는 1회성 안내가 떠 있을 수 있다 — 있으면 닫고 진행한다.
        let confirm = app.buttons["확인"].firstMatch
        if confirm.waitForExistence(timeout: 8) { confirm.tap() }

        let more = app.buttons["더보기"]
        XCTAssertTrue(more.waitForExistence(timeout: 20), "'더보기' 탭이 없다")
        more.tap()

        let landed = app.staticTexts["이용권"].waitForExistence(timeout: 10)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "after-tap"
        shot.lifetime = .keepAlways
        add(shot)

        XCTAssertTrue(landed, "탭을 눌렀는데 화면이 안 바뀌었다")
    }
}
