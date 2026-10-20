import XCTest

/// **화면 순회 캡처** — 안드로이드와 나란히 놓고 보기 위한 스크린샷을 한 번에 만든다.
///
/// 왜 필요한가: `simctl` 에는 탭·스와이프가 없어서 시뮬레이터를 호스트에서 조작할 수단이
/// 없다. `-UIPreview*` 진입점이 '어느 화면을 띄울까' 는 해결했지만, **스크롤해야 보이는
/// 아래쪽**과 **눌러야 열리는 시트**는 여전히 못 본다. 이 테스트가 그 손 역할을 한다.
///
/// 실행:
/// ```
/// xcodebuild test -scheme AlarmTalk \
///   -only-testing:AlarmTalkUITests/ScreenSweepUITests \
///   -destination "id=<UDID>" -resultBundlePath /tmp/sweep.xcresult
/// xcrun xcresulttool export attachments --path /tmp/sweep.xcresult --output-path /tmp/shots
/// ```
///
/// ⚠ **기능 검증이 아니다.** 여기서는 아무것도 단언하지 않는다 — 화면을 남기는 것이
/// 전부다. 동작 검증은 `FunctionalE2EUITests` 가 한다.
final class ScreenSweepUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        // 화면 한 장을 못 찍었다고 나머지를 통째로 버리지 않는다 — 이 테스트의 산출물은
        // 통과/실패가 아니라 스크린샷 묶음이다.
        continueAfterFailure = true
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launch(_ arguments: [String]) {
        app = XCUIApplication()
        app.launchArguments = arguments
        addUIInterruptionMonitor(withDescription: "시스템 권한") { alert in
            for label in ["허용", "Allow", "확인", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()
        // 시스템 알럿은 앱의 요소 트리 밖이므로 springboard 에서 직접 누른다. 앱 중앙을
        // 무조건 탭하면 현재 화면의 버튼(예: 회원 탈퇴)을 의도치 않게 열 수 있다.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["허용", "Allow"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: 2) {
                button.tap()
                break
            }
        }
    }

    /// 스크롤 가능한 화면을 **바닥까지** 훑으며 한 화면씩 남긴다.
    private func sweepScroll(_ prefix: String, maxPages: Int = 5) {
        shot("\(prefix)-1")
        for page in 2...maxPages {
            app.swipeUp(velocity: .slow)
            shot("\(prefix)-\(page)")
        }
    }

    func test_sweep_alarmEditor() {
        launch(["-UIPreviewSeed", "-UIPreviewEditor"])
        sweepScroll("editor")

        // 목소리 고르기 시트 — '직접 녹음' 이 마지막 항목으로 붙었는지 본다.
        //
        // ⚠ `app.buttons["목소리"]` 로 찾지 말 것 — 하단 탭바에도 같은 이름이 있어서
        // 그쪽을 눌러 편집기가 닫힌다(실제로 그랬다). 전용 식별자로 집는다.
        // 위 `sweepScroll` 이 바닥까지 내려놨으니 먼저 되올린다.
        for _ in 0..<5 { app.swipeDown(velocity: .fast) }
        // `AlarmSettingRow` 는 본문과 셰브론이 각각 버튼이라 식별자가 둘에 걸린다.
        let voiceRow = app.buttons["editor.voiceRow"].firstMatch
        if voiceRow.waitForExistence(timeout: 3) {
            voiceRow.tap()
            shot("editor-voiceSheet")
        } else {
            shot("editor-voiceRow-notFound")
        }
    }

    func test_sweep_tabs() {
        for (tab, name) in [("alarms", "알람"), ("voices", "목소리"), ("menu", "더보기")] {
            launch(["-UIPreviewSeed", "-UIPreviewTab", tab])
            sweepScroll("tab-\(name)", maxPages: 4)
        }
    }

    func test_sweep_auth() {
        for screen in ["login", "register"] {
            launch(["-UIPreviewAuthScreen", screen])
            sweepScroll("auth-\(screen)", maxPages: 3)
        }
    }

    /// App Store 목업에는 실제 iOS 화면만 넣는다. 녹음·업로드·구매는 수행하지 않는다.
    func test_capture_storeMockupSources() {
        launch(["-UIPreviewAuthScreen", "landing"])
        XCTAssertTrue(app.buttons["시작하기"].waitForExistence(timeout: 15))
        shot("mockup-welcome")

        launch(["-UIPreviewSeed", "-UIPreviewTab", "voices"])
        let add = app.buttons["추가"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 15))
        add.tap()
        let consent = app.alerts["목소리를 등록하기 전에"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.buttons["동의하기"].tap()
        let file = app.buttons["파일"].firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 15))
        shot("mockup-voice-recording")
        file.tap()
        XCTAssertTrue(app.buttons["파일 또는 영상 업로드"].waitForExistence(timeout: 5))
        shot("mockup-voice-upload")
    }

    /// 더보기 **하위** 화면 — 탭 순회는 최상위만 훑어서 여기까지 오지 않는다. 더보기에서 들어가는 하위
    /// 화면은 이용권 하나다(코드를 넣는 화면은 없다 — `docs/spec/plan-gates.md`).
    func test_sweep_menuSubscreens() {
        launch(["-UIPreviewSeed", "-UIPreviewTab", "menu"])
        // ⚠ `app.buttons` 로만 찾지 말 것 — 설정 행은 접근성 트리에 버튼으로 안 잡힐 수 있다.
        // staticTexts 까지 훑고, 그래도 없으면 좌표로 눌러 본다.
        // ⚠ 술어를 지역 변수로 빼지 말 것 — `NSPredicate` 는 Sendable 이 아니라
        // Swift 6 동시성 검사가 "sending 'rowMatch' risks causing data races" 로 막는다.
        let rowMatch = "label BEGINSWITH '이용권'"
        var target = app.buttons.matching(NSPredicate(format: rowMatch)).firstMatch
        if !target.waitForExistence(timeout: 5) {
            target = app.staticTexts.matching(NSPredicate(format: rowMatch)).firstMatch
        }
        guard target.waitForExistence(timeout: 5) else {
            shot("menu-이용권행-notFound")
            return
        }
        // 텍스트 자체는 hittable 이 아닐 수 있으니 좌표로 누른다.
        target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        sweepScroll("menu-이용권", maxPages: 3)
    }
}
