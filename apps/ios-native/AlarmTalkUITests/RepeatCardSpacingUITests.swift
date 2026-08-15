import XCTest

/// **요일을 고르면 나타나는 '공휴일에는 끄기' 행이 카드 바닥에 붙지 않아야 한다.**
///
/// 2026-08-15 지적: "요일 골랐을 때 공휴일에 끄기 토글이 너무 아래 여백이 작게 나와서
/// 조금 어려워." `EditorCard` 의 세로 패딩이 4 뿐이라, 이 행만 아래 여백 없이 놓여
/// 스위치가 카드 모서리에 4pt 로 붙어 있었다(위쪽은 14pt).
///
/// 눈으로는 "좀 좁나?" 로 넘어가므로 좌표로 고정한다.
final class RepeatCardSpacingUITests: XCTestCase {

    func test_공휴일_끄기_행이_카드_바닥에_붙지_않는다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()

        // 요일을 하나 골라야 이 행이 나타난다. 칩의 접근성 라벨은 "월요일 반복"
        // (`RepeatWeekdayChips.accessibilityLabel`) — 짧은 글자 "월" 로는 못 찾는다.
        let monday = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "월요일")).firstMatch
        XCTAssertTrue(monday.waitForExistence(timeout: 15), "편집기에 요일 칩이 없다")
        if (monday.value as? String) != "선택됨" { monday.tap() }

        let toggle = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "공휴일")).element(boundBy: 0)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "요일을 골랐는데 공휴일 행이 없다")

        // 바로 아래 섹션('재생 방식')까지의 거리 = 카드 아래 여백 + 카드 사이 간격(16).
        let nextSection = app.staticTexts["재생 방식"].firstMatch
        XCTAssertTrue(nextSection.waitForExistence(timeout: 5), "'재생 방식' 섹션이 없다")

        let gap = nextSection.frame.minY - toggle.frame.maxY
        XCTAssertGreaterThanOrEqual(
            gap, 24,
            """
            공휴일 행 아래가 \(Int(gap))pt 밖에 없다 — 카드 세로 패딩(4)만 남아 스위치가 \
            모서리에 붙었다. 아래 여백 10 을 지웠는지 확인할 것.
            """
        )
    }
}
