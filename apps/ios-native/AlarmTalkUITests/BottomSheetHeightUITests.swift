import XCTest

/// **바텀시트가 내용만큼만 올라오는지 실측한다.**
///
/// 2026-08-13 지적: "공휴일 달력 보면 3개 들어있는데 화면 꽉 차 있잖아. 위아래 여백이
/// 거의 대부분이야." 원인은 시트 안 목록이 `LazyVStack` 이었던 것 — 게으른 스택은
/// 스크롤뷰가 제안한 높이를 그대로 먹어서, 높이를 재는 `measuredSheetContent()` 가
/// **내용 높이 대신 제안 높이**를 보고했다. 그러면 `sheetScrollFit()` 이 묶을 값이 상한과
/// 같아져 아무것도 안 묶인다.
///
/// 눈으로만 보면 "좀 큰가?" 로 넘어가므로 **숫자로 고정한다.**
final class BottomSheetHeightUITests: XCTestCase {

    private func launch(tab: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", tab]
        app.launch()
        return app
    }

    /// 행이 셋뿐인 시트는 화면의 **절반도** 쓰지 않아야 한다.
    ///
    /// 상한은 0.9 지만 그건 긴 목록용이다 — 짧은 시트가 거기에 닿으면 자연 높이 계산이
    /// 깨진 것이다.
    func test_화면테마_시트는_내용만큼만_올라온다() throws {
        let app = launch(tab: "menu")

        // 행 라벨에 값("시스템 설정과 같이")이 붙어 오므로 CONTAINS 로 찾는다.
        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "화면 테마"))
            .element(boundBy: 0)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "더보기 탭에 '화면 테마' 행이 없다")
        row.tap()

        // 시트 안 첫 항목이 뜰 때까지 기다린다.
        let option = app.staticTexts["시스템 설정과 같이"].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5), "시트가 열리지 않았다")

        let screenHeight = app.windows.firstMatch.frame.height
        // 시트 맨 위 = 시트 안 제목의 위쪽. 그 아래로 화면 바닥까지가 시트가 차지한 높이다.
        let sheetTitle = app.staticTexts.matching(NSPredicate(format: "label == %@", "화면 테마"))
            .allElementsBoundByIndex
            .max(by: { $0.frame.minY < $1.frame.minY })
        let sheetTop = try XCTUnwrap(sheetTitle).frame.minY
        let sheetHeight = screenHeight - sheetTop

        XCTAssertLessThan(
            sheetHeight, screenHeight * 0.5,
            """
            행이 셋인 시트가 화면의 \(Int(sheetHeight / screenHeight * 100))% 를 차지한다 — \
            자연 높이 계산이 깨졌다(`LazyVStack` 회귀 의심).
            """
        )
    }

    /// 공휴일 달력도 항목이 셋(KR/JP/US)이다 — 같은 기준.
    func test_공휴일달력_시트는_내용만큼만_올라온다() throws {
        let app = launch(tab: "menu")

        let account = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "내 정보"))
            .element(boundBy: 0)
        XCTAssertTrue(account.waitForExistence(timeout: 10), "설정으로 들어갈 행이 없다")
        account.tap()

        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "공휴일 달력"))
            .element(boundBy: 0)
        guard row.waitForExistence(timeout: 5) else {
            throw XCTSkip("설정 화면에 '공휴일 달력' 행이 보이지 않는다(레이아웃 변경)")
        }
        row.tap()

        let sheetTitle = app.staticTexts.matching(NSPredicate(format: "label == %@", "공휴일 달력"))
        XCTAssertTrue(sheetTitle.firstMatch.waitForExistence(timeout: 5), "시트가 열리지 않았다")

        let screenHeight = app.windows.firstMatch.frame.height
        let top = try XCTUnwrap(
            sheetTitle.allElementsBoundByIndex.max(by: { $0.frame.minY < $1.frame.minY })
        ).frame.minY
        let sheetHeight = screenHeight - top

        XCTAssertLessThan(
            sheetHeight, screenHeight * 0.5,
            "행이 셋인 시트가 화면의 \(Int(sheetHeight / screenHeight * 100))% 를 차지한다"
        )
    }

    /// **입력칸은 키보드 위에 있어야 한다.**
    ///
    /// 2026-08-13 지적: "날씨 지역 직접 입력할 때 입력창은 키보드 위로 올려줘야 하지 않나."
    /// 원인은 `BottomSheetHost` 의 인자 없는 `.ignoresSafeArea()` — 인자를 안 주면
    /// `.keyboard` 영역까지 무시해 **키보드 자동 회피가 통째로 꺼진다.** 무엇을 치고 있는지
    /// 안 보이는 채로 입력하게 된다.
    func test_지역_직접입력칸은_키보드에_가리지_않는다() throws {
        let app = launch(tab: "menu")

        let account = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "내 정보")).element(boundBy: 0)
        XCTAssertTrue(account.waitForExistence(timeout: 10), "설정으로 들어갈 행이 없다")
        account.tap()

        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "날씨 지역")).element(boundBy: 0)
        guard row.waitForExistence(timeout: 5) else {
            throw XCTSkip("설정 화면에 '날씨 지역' 행이 보이지 않는다(레이아웃 변경)")
        }
        row.tap()

        let custom = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "직접 입력")).element(boundBy: 0)
        XCTAssertTrue(custom.waitForExistence(timeout: 5), "'직접 입력' 행이 없다")
        custom.tap()

        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "입력칸이 열리지 않았다")
        field.tap()

        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "키보드가 올라오지 않았다")

        XCTAssertLessThan(
            field.frame.maxY, keyboard.frame.minY,
            """
            입력칸 아래쪽(\(Int(field.frame.maxY)))이 키보드 위쪽(\(Int(keyboard.frame.minY)))보다             아래다 — 치는 글자가 안 보인다.
            """
        )
    }
}
