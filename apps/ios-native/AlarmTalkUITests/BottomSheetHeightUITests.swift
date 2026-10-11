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

    /// **지역 시트는 나라를 바꾸면 그 나라의 지역을 보인다**(2026-09-30).
    ///
    /// 예전 자리의 두 검사(공휴일 달력 시트 높이, 날씨 '직접 입력' 칸과 키보드)는 그 화면이 없어져
    /// 지웠다 — 공휴일 국가는 지역의 나라를 따르고, 지역은 목록에서만 고른다(직접 입력 없음).
    /// 짧은 시트의 자연 높이는 위 '화면 테마' 검사가 계속 본다.
    func test_지역_시트는_나라를_바꾸면_그_나라_지역을_보인다() throws {
        let app = launch(tab: "menu")

        let account = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "내 정보"))
            .element(boundBy: 0)
        XCTAssertTrue(account.waitForExistence(timeout: 10), "설정으로 들어갈 행이 없다")
        account.tap()

        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", "공휴일 달력"))
                .element(boundBy: 0).waitForExistence(timeout: 2),
            "설정에 '공휴일 달력' 행이 되살아났다 — 공휴일 국가는 지역의 나라다"
        )

        let row = app.buttons.containing(.staticText, identifier: "지역").firstMatch
        guard row.waitForExistence(timeout: 5) else {
            throw XCTSkip("설정 화면에 '지역' 행이 보이지 않는다(레이아웃 변경)")
        }
        row.tap()

        let japan = app.segmentedControls.buttons["일본"]
        XCTAssertTrue(japan.waitForExistence(timeout: 5), "나라 세그먼트가 없다")
        XCTAssertFalse(app.textFields.firstMatch.exists, "지역 시트에 직접 입력칸이 되살아났다")
        japan.tap()

        // ⚠ 글자 하나짜리 행은 버튼 하나로 합쳐져 노출된다 — `staticTexts` 로 찾으면 없다고 나온다.
        XCTAssertTrue(app.buttons["도쿄"].waitForExistence(timeout: 5), "일본을 골랐는데 도쿄가 없다")
        XCTAssertFalse(app.buttons["부산"].exists, "일본 목록에 한국 지역이 섞였다")

        // 긴 목록이라도 시트 위로 스크림이 남아야 한다 — 없으면 바깥을 눌러 닫을 곳이 없다.
        let title = try XCTUnwrap(
            app.staticTexts.matching(NSPredicate(format: "label == %@", "지역"))
                .allElementsBoundByIndex.max(by: { $0.frame.minY < $1.frame.minY })
        )
        let screenHeight = app.windows.firstMatch.frame.height
        XCTAssertGreaterThan(
            title.frame.minY, screenHeight * 0.08,
            "지역 시트가 화면을 꽉 채웠다(제목 위 \(Int(title.frame.minY))pt) — 세그먼트 높이를 상한에서 빼지 않았다"
        )
    }
}
