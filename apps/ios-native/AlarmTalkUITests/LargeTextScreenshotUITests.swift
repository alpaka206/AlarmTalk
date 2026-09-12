import XCTest

/// **큰 글씨 설정에서 화면이 견디는지** 눈으로 보기 위한 스크린샷 도구.
///
/// 2026-08-17 에 iOS 도 사용자의 텍스트 크기 설정을 따르게 바꿨다(`Font.pretendard` 의
/// `relativeTo:`). 그 전까지는 설정을 무시했으므로 **큰 글씨에서 어떻게 보이는지 아무도
/// 본 적이 없다.** 기기 설정을 바꾸지 않고 `-UIPreferredContentSizeCategoryName` 실행
/// 인자로 그 상태를 만들어 찍는다.
///
/// 손으로 돌린다: `ALARMTALK_LARGE_TEXT_SHOTS=1`.
final class LargeTextScreenshotUITests: XCTestCase {

    private func shoot(_ category: String, tab: String, editor: Bool, name: String) {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewTab", tab]
        if editor { app.launchArguments += ["-UIPreviewEditor"] }
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", category]
        app.launch()
        _ = app.wait(for: .runningForeground, timeout: 20)
        Thread.sleep(forTimeInterval: 2.5)

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
        app.terminate()
    }

    func test_큰_글씨에서_화면을_찍는다() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["ALARMTALK_LARGE_TEXT_SHOTS"] == "1",
            "손으로 돌리는 도구다"
        )
        // 기본(L)과 상한(accessibility1 = AccessibilityMedium) 두 상태를 같은 화면으로 찍어
        // 나란히 본다. 상한은 `AlarmTalkApp` 의 `.dynamicTypeSize(...accessibility1)` 이다.
        for (category, suffix) in [("UICTContentSizeCategoryL", "기본"),
                                   ("UICTContentSizeCategoryAccessibilityM", "최대")] {
            shoot(category, tab: "alarms", editor: false, name: "알람목록-\(suffix)")
            shoot(category, tab: "alarms", editor: true, name: "편집기-\(suffix)")
            shoot(category, tab: "menu", editor: false, name: "더보기-\(suffix)")
        }
    }
}
