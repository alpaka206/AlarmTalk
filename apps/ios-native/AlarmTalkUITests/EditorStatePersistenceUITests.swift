import XCTest

/// **편집기에서 맞춘 값이 스스로 되돌아가면 안 된다.**
///
/// 사용자 보고(2026-08-10): "알람 설정에서 알람 맞춰도 돌아가는 현상이 있다".
/// 두 가지 중 하나다 — (a) 고른 시각이 원래 값으로 되돌아가거나, (b) 화면 자체가 닫힌다.
/// 둘 다 배경 동기화가 부모 화면을 다시 그릴 때 편집기 뷰의 **identity 가 바뀌어
/// `@State` 가 초기화되면** 일어난다(그러면 `didLoadInitial` 이 false 로 돌아가
/// `loadInitialState()` 가 다시 돌면서 draft 를 저장값으로 덮는다).
///
/// 시트였을 때는 표시 계층이 따로라 이 일이 없었는데, push 로 바꾸면서 생길 수 있는
/// 회귀라 못박는다.
final class EditorStatePersistenceUITests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func test_시간을_맞춘_뒤_기다려도_편집기가_닫히거나_되돌아가지_않는다() {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()

        let save = app.buttons["저장"]
        XCTAssertTrue(save.waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        // 시각 휠을 굴려 값을 바꾼다.
        let before = app.staticTexts.allElementsBoundByIndex
            .map { $0.label }
            .filter { $0.contains(":") }
            .first
        XCTAssertNotNil(before, "시각 표시를 찾지 못했다")

        let wheel = app.otherElements.firstMatch
        wheel.swipeUp()

        // 바뀐 값을 읽는다.
        let afterSwipe = app.staticTexts.allElementsBoundByIndex
            .map { $0.label }
            .filter { $0.contains(":") }
            .first

        // 배경 동기화·전경 복귀가 부모를 다시 그릴 시간을 준다.
        // (앱 진입 직후 pull/refresh 가 이 구간에서 돈다.)
        Thread.sleep(forTimeInterval: 12)

        XCTAssertTrue(
            app.buttons["저장"].exists,
            "기다리는 사이 편집기가 스스로 닫혔다 — push 전환에서 뷰 identity 가 깨진 것이다"
        )

        let afterWait = app.staticTexts.allElementsBoundByIndex
            .map { $0.label }
            .filter { $0.contains(":") }
            .first
        XCTAssertEqual(
            afterWait, afterSwipe,
            "맞춰 둔 시각이 저절로 되돌아갔다 — @State 가 초기화되면서 loadInitialState() 가 다시 돈 것이다"
        )
    }
}
