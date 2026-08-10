import XCTest

/// **화면급 이동은 push 다** — 그리고 push 로 바꾸면서 생긴 두 가지 함정을 못박는다.
///
/// 1. 편집기에는 **상단바가 없어야 한다.** push 는 뒤로가기를 자동으로 그리는데, 그건
///    하단 [취소]와 완전히 같은 일이라 취소가 두 개가 된다(CLAUDE.md 「취소와 같은 일을
///    하는 버튼을 두 개 두지 않는다」). 안드로이드 편집기에도 TopAppBar 가 없다.
/// 2. 반대로 편집기가 **여는 하위 화면(목소리·문구·세부 설정)에는 뒤로가기가 있어야 한다.**
///    그쪽은 하단 액션바가 없어서 뒤로가기가 유일한 탈출구다 — 부모가 숨긴 상단바가
///    하위로 번지면 **들어간 뒤 나올 수 없는 화면**이 된다.
final class EditorPushNavigationUITests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launchEditor() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()
        return app
    }

    func test_편집기에는_상단_뒤로가기가_없다() {
        let app = launchEditor()

        // 편집기가 떴는지: 하단 액션바의 [저장]으로 확인한다.
        let save = app.buttons["저장"]
        XCTAssertTrue(save.waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        // 하단 [취소]가 유일한 탈출구여야 한다.
        XCTAssertTrue(app.buttons["취소"].exists, "하단 취소가 없다")

        XCTAssertEqual(
            app.navigationBars.count, 0,
            "편집기에 상단바가 생겼다 — 뒤로가기와 [취소]가 같은 일을 하는 버튼 두 개가 된다"
        )
    }

    func test_편집기가_여는_하위화면에는_뒤로가기가_있다() {
        let app = launchEditor()
        XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        // '목소리' 행을 눌러 하위 화면으로 들어간다.
        let voiceRow = app.buttons.containing(.staticText, identifier: "목소리").firstMatch
        guard voiceRow.waitForExistence(timeout: 5) else {
            XCTFail("편집기에서 '목소리' 행을 찾지 못했다")
            return
        }
        voiceRow.tap()

        // 하위 화면에는 상단바 + 뒤로가기가 반드시 있어야 한다.
        let navBar = app.navigationBars.firstMatch
        XCTAssertTrue(
            navBar.waitForExistence(timeout: 5),
            "하위 화면에 상단바가 없다 — 부모가 숨긴 바가 번졌다면 여기서 나올 길이 없다"
        )
        XCTAssertTrue(
            navBar.buttons.firstMatch.exists,
            "하위 화면에 뒤로가기가 없다 — 들어간 뒤 나올 수 없는 화면이 된다"
        )
    }
}
