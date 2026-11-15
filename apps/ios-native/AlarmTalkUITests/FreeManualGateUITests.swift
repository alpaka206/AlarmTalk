import XCTest

/// **무료 사용자도 문구 화면에서 '직접 입력' 을 누르면 입력 알럿이 뜬다** — 이용권 게이트가 아니다.
///
/// 2026-10-26(v1.3): 무료도 기본 목소리로 직접 입력을 월 3회 만든다 — 입력·편집은 막지 않고, 새로 만들어야
/// 할 때 서버가 429 로 막으면 저장 흐름이 그때 말한다(`docs/spec/voice-and-message.md` §8,
/// `AlarmEditorSheet` 의 `manualLocked: false`). 그 전(2026-08-17 지시)에는 행은 눌리되 이용권 모달이
/// 떴다 — 그 규칙으로 되돌리지 말 것. 잠긴 **목소리**를 눌렀을 때의 게이트는 아래 두 번째 테스트가 지킨다.
final class FreeManualGateUITests: XCTestCase {

    func test_무료에서_직접_입력을_누르면_입력_알럿이_뜬다() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPlan", "free", "-UIPreviewEditor"]
        app.launch()
        XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        // 편집기 본문의 '문구' 행 → 문구 화면.
        let messageRow = app.buttons.containing(.staticText, identifier: "문구").firstMatch
        XCTAssertTrue(messageRow.waitForExistence(timeout: 10), "'문구' 행이 없다")
        messageRow.tap()

        let manual = app.staticTexts["직접 입력"].firstMatch
        XCTAssertTrue(manual.waitForExistence(timeout: 10), "문구 화면에 '직접 입력' 행이 없다")
        manual.tap()

        // 「직접 입력」 알럿 — 문구 칸과 횟수 안내(`MessageSettingsPane` 의 `manualDialogOpen`).
        let dialog = app.alerts["직접 입력"].firstMatch
        XCTAssertTrue(
            dialog.waitForExistence(timeout: 5),
            "직접 입력을 눌렀는데 입력 알럿이 뜨지 않는다"
        )
        XCTAssertTrue(dialog.textFields.firstMatch.exists, "알럿에 문구 칸이 없다")
        XCTAssertFalse(
            app.staticTexts["유료 이용권이 필요해요"].exists,
            "무료라고 직접 입력을 이용권 게이트로 막는다 — 2026-10-26 규칙(무료도 월 3회) 전으로 되돌아갔다"
        )
    }

    /// 목소리 고르기 **시트** 안에서 잠긴 목소리를 눌러도 같은 게이트가 떠야 한다.
    /// (알럿이 편집기에만 붙어 있으면 시트 위에서도 안 뜬다 — 같은 종류의 결함이다.)
    func test_무료에서_잠긴_목소리를_누르면_이용권_모달이_뜬다() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPlan", "free", "-UIPreviewEditor"]
        app.launch()
        XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 20), "편집기가 뜨지 않았다")

        let voiceRow = app.buttons.containing(.staticText, identifier: "목소리").firstMatch
        XCTAssertTrue(voiceRow.waitForExistence(timeout: 10), "'목소리' 행이 없다")
        voiceRow.tap()

        // 무료에서 잠기는 것은 **내 클론 목소리**다(시드의 "엄마 목소리").
        let locked = app.staticTexts["엄마 목소리"].firstMatch
        guard locked.waitForExistence(timeout: 8) else {
            throw XCTSkip("시드에 잠긴 목소리가 없다 — 이 경로는 확인하지 않는다")
        }
        locked.tap()

        XCTAssertTrue(
            app.staticTexts["유료 이용권이 필요해요"].firstMatch.waitForExistence(timeout: 5),
            "잠긴 목소리를 눌렀는데 이용권 모달이 뜨지 않는다"
        )
        XCTAssertTrue(app.buttons["이용권 보기"].exists, "게이트에 '이용권 보기' 액션이 없다")
        // ⚠ 게이트에는 **코드 입력 액션이 없다**(2026-10-14, App Store 지침 3.1.1 두 번째 반려 — 선물 코드
        // 폐지). 되살리지 말 것 — 코드를 넣는 화면은 앱 어디에도 없고, 할인·무료 이용은 스토어 오퍼 코드로
        // 준다(`docs/spec/plan-gates.md` §2).
        XCTAssertFalse(
            app.alerts.buttons.matching(NSPredicate(format: "label CONTAINS %@", "코드")).firstMatch.exists,
            "유료 게이트에 코드 입력 액션이 남아 있다"
        )
    }
}
