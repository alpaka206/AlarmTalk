import XCTest

/// **무료 사용자가 문구 화면에서 '직접 입력' 을 누르면 이용권 모달이 떠야 한다.**
///
/// 2026-08-17 지시: "무료일 때 직접 입력 눌리게는 해줘야 해 — 대신 문구 페이지에서
/// 이용권 모달을 띄워주는 거지." 행은 이미 눌리게 돼 있었지만, 게이트 알럿이 편집기
/// (스택 루트)에 붙어 있어 **밀어 올린 문구 화면 위에서는 뜨지 않았다.**
final class FreeManualGateUITests: XCTestCase {

    func test_무료에서_직접_입력을_누르면_이용권_모달이_뜬다() throws {
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

        // 이용권 게이트 — 무료 상태의 제목과 액션(`showVoicePlanLockedAlert`).
        let gate = app.staticTexts["유료 이용권이 필요해요"].firstMatch
        XCTAssertTrue(
            gate.waitForExistence(timeout: 5),
            "직접 입력을 눌렀는데 이용권 모달이 뜨지 않는다"
        )
        XCTAssertTrue(app.buttons["이용권 보기"].exists, "게이트에 '이용권 보기' 액션이 없다")
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
    }
}
