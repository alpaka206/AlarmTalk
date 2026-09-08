import XCTest

/// 코드 입력칸의 **입력 즉시** 정리 규칙.
///
/// 2026-08-13 지적: "소문자 쳐도 대문자로 안 변하고 있고(등록 보내야 바뀜), 한글은 아직 쳐진다."
/// 원인은 커스텀 `Binding` 의 setter 에서 정리한 것 — 거기서 값을 바꿔도 `TextField` 가
/// 제 내부 상태를 그대로 들고 있어 **화면에는 친 그대로 남는다.**
/// 눈에 보이는 값을 검사해야 잡히므로 UI 테스트로 고정한다.
final class CodeInputUITests: XCTestCase {

    private func openCodeScreen() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()
        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "코드 등록"))
            .element(boundBy: 0)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "'코드 등록' 행이 없다")
        row.tap()
        return app
    }

    func test_소문자는_치는_즉시_대문자가_된다() throws {
        let app = openCodeScreen()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "입력칸이 없다")
        field.tap()
        field.typeText("ab12cd")

        XCTAssertEqual(
            field.value as? String, "AB12CD",
            "제출 전에 이미 대문자여야 한다 — 지금 보이는 값이 그대로 저장된다고 믿게 된다"
        )
    }

    /// ⚠ 한글은 **키보드 단계에서** 막는다(`.keyboardType(.asciiCapable)`).
    /// 걸러 내기만 하면 조합 중인 글자가 잠깐 보였다 사라져 고장처럼 보인다.
    func test_한글은_입력칸에_남지_않는다() throws {
        let app = openCodeScreen()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "입력칸이 없다")
        field.tap()
        field.typeText("AB가나CD")

        let shown = (field.value as? String) ?? ""
        XCTAssertFalse(
            shown.contains(where: { $0.unicodeScalars.contains { $0.value > 127 } }),
            "코드 입력칸에 비-ASCII 가 남았다: \(shown)"
        )
    }

    /// **틀린 코드를 보내면 입력창 밑에 빨간 문구가 남아야 한다.**
    ///
    /// 2026-08-13 지적: "잘못된 거 보내면 경고는 안 뜨고 갑자기 아래로 내려갔다가 올라가."
    /// 원인은 실패 뒤 입력값을 **되돌려 넣은 것** — 그 대입이 `onChange(of: codeDraft)` 를
    /// 깨워 방금 세운 오류 문구를 지웠다. 화면이 튄 것은 상단 배너가 생겼다 사라진 탓이다.
    ///
    /// 프리뷰 시드는 서버가 없어 등록이 반드시 실패하므로, 실패 경로를 그대로 탄다.
    func test_틀린_코드는_입력창_밑에_남는다() throws {
        let app = openCodeScreen()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "입력칸이 없다")
        field.tap()
        field.typeText("BADCODE1")

        app.buttons["등록"].firstMatch.tap()
        // 확인 알럿의 '등록'.
        let confirm = app.alerts.buttons["등록"].firstMatch
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }

        // ⚠ **`"코드"` 로 찾지 말 것 — 안내 문구("초대 코드, 이용권 선물 코드…")에도 있어
        // 버그가 있어도 늘 통과한다.** 실제 오류 문구만 본다.
        //
        // 서버가 CODE_NOT_FOUND 를 주면 "잘못된 코드입니다.", 프리뷰처럼 서버가 없으면
        // 폴백("…실패했어요.")이 온다 — 어느 쪽이든 **오류가 화면에 남는가**가 요점이다.
        let error = app.staticTexts.matching(
            NSPredicate(
                format: "label CONTAINS %@ OR label CONTAINS %@",
                "잘못된 코드", "실패했어요"
            )
        )
        XCTAssertTrue(
            error.firstMatch.waitForExistence(timeout: 8),
            "실패했는데 오류 문구가 남지 않았다"
        )

        // ⚠ 친 값이 그대로 있어야 고칠 수 있다.
        XCTAssertEqual(
            field.value as? String, "BADCODE1",
            "실패했는데 입력이 비었다 — 처음부터 다시 쳐야 한다"
        )
    }
}
