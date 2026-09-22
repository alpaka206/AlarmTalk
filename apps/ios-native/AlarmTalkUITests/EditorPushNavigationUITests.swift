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

        // ⚠ **'목소리' 행으로 검사하지 말 것 — 그건 push 가 아니라 시트다**(2026-08-10).
        // 목소리 고르기는 다른 선택 목록과 같은 바텀시트로 열린다(`VoiceSelectionSheet`).
        // push 되는 하위 화면은 '세부 설정' 의 pane 들이다(`AlarmSettingsPane`).
        // ('음성 출력' 행은 여기 없다 — 음량·반복은 목소리 카드가 여는 상세가 소유한다.)
        // ⚠ **행 이름을 고를 때는 그 행이 지금 있는지 먼저 확인할 것.** 여기서 두 번 낡았다 —
        // '진동'(2026-08-17 삭제, AlarmKit 이 알람 진동을 소유한다), '다시 울림'(편집기에서
        // 설정 자체를 없앴다 — `LocalAlarmRecord` 의 스누즈 주석, `docs/qa/dev-test-handoff.md`
        // 의 "편집기에는 '다시 울림' 항목이 **없다**"). UI 테스트는 CI 에서 돌지 않아
        // (`ios-build.yml` 은 유닛 테스트 + Release 빌드다) 낡아도 아무도 모른다.
        // 지금 push 되는 pane 은 `AlarmSettingsPane` 의 둘('알람음' · '목소리 크기')뿐이다.
        // ⚠ '알람음' 으로 검사하지 말 것 — 그 행이 있는 '세부 설정' 카드는
        // `showsAlarmSoundControls`(= `playMode != .voiceOnly`)일 때만 그려지고,
        // 편집기 기본값은 목소리라 **카드 자체가 없다**. 목소리 카드의 '목소리 크기' 행은
        // 그 기본 상태에서 늘 보인다.
        let detailRow = app.buttons.containing(.staticText, identifier: "목소리 크기").firstMatch
        guard detailRow.waitForExistence(timeout: 5) else {
            XCTFail("편집기 목소리 카드에서 '목소리 크기' 행을 찾지 못했다")
            return
        }
        detailRow.tap()

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
