import XCTest

/// **왼쪽으로 밀어 나온 삭제 버튼이 실제로 알람을 지워야 한다.**
///
/// 2026-08-16 지적 "삭제 버튼 눌러도 삭제 안 됨". 원인은 히트테스트 층이었다 —
/// 본문의 `.contentShape` + `.onTapGesture` 가 `.offset` **뒤**에 붙어 있어 히트 영역이
/// 밀리지 않고 **삭제 버튼 자리까지 덮었고**, 그 핸들러는 `guard !deleteRevealed` 로
/// 아무 일도 하지 않았다. 버튼은 접근성상 존재하고 `isHittable` 도 true 라, 눌러도
/// 조용히 아무 일이 없었다.
///
/// 화면만 봐서는 "안 눌렸나?" 로 넘어가므로 행 개수로 못 박는다.
final class AlarmSwipeDeleteUITests: XCTestCase {
    func test_밀어서_삭제하면_행이_사라진다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed"]
        app.launch()

        let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "오전", "오후"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 20), "알람 행이 없다")
        let before = rows.count
        let target = rows.element(boundBy: 0)
        let label = target.label

        target.swipeLeft()
        Thread.sleep(forTimeInterval: 1)

        let deleteButton = app.buttons.matching(NSPredicate(format: "label == %@", "알람 삭제")).firstMatch
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 3), "밀었는데 삭제 버튼이 안 드러났다")
        deleteButton.tap()
        Thread.sleep(forTimeInterval: 2.5)

        let after = rows.count
        XCTAssertEqual(
            after, before - 1,
            "삭제 버튼을 눌렀는데 행이 그대로다(\(before) → \(after), 대상: \(label)) — 히트테스트 층 회귀"
        )
    }
}
