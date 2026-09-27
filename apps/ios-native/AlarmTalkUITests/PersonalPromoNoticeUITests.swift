import XCTest

/// **기간 한정 개인 플랜 종료 안내**는 앱에 **들어올 때마다** 뜨고, '다시 보지 않기' 뒤에는
/// 뜨지 않는다. 화면 이동으로는 뜨지 않는다.
///
/// `-UIPreviewPersonalPromo <남은 일수>` 가 서버 없이 프로모 계정을 심는다 — 남은 일수가
/// 7 이하면 안내 창 안이다. 종료 시각은 실행마다 '지금 + 일수' 라, 앞 실행의 '다시 보지
/// 않기' 가 다음 실행을 삼키지 않는다(기록은 그 프로모의 종료 시각에 묶인다).
///
/// ⚠ UI 테스트는 CI 에서 돌지 않는다(CLAUDE.md). 안내 문구·버튼 이름을 바꾸면 여기도 고친다.
final class PersonalPromoNoticeUITests: XCTestCase {

    private let title = "개인 플랜 무료 이용이 곧 끝나요"

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPersonalPromo", "3"] + extra
        app.launch()
        return app
    }

    /// 백그라운드에 보냈다가 다시 연다 — '앱에 들어온 것' 이다.
    private func reenter(_ app: XCUIApplication) {
        XCUIDevice.shared.press(.home)
        _ = app.wait(for: .runningBackgroundSuspended, timeout: 10)
        app.activate()
        _ = app.wait(for: .runningForeground, timeout: 10)
    }

    func test_들어올_때마다_뜨고_다시_보지_않기면_멈춘다() {
        let app = launch()
        let alert = app.alerts[title]
        XCTAssertTrue(alert.waitForExistence(timeout: 20), "콜드 스타트에 안내가 뜨지 않았다")
        XCTAssertTrue(alert.buttons["다시 보지 않기"].exists)
        XCTAssertTrue(alert.buttons["확인"].exists)
        shot("01-콜드스타트")

        alert.buttons["확인"].tap()
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5))

        // 화면 이동으로는 다시 뜨지 않는다.
        let voicesTab = app.buttons["목소리"].firstMatch
        if voicesTab.waitForExistence(timeout: 5) {
            voicesTab.tap()
            XCTAssertFalse(app.alerts[title].waitForExistence(timeout: 3), "화면 이동에 안내가 떴다")
        }

        // 백그라운드 → 다시 열기 = 들어온 것.
        reenter(app)
        XCTAssertTrue(app.alerts[title].waitForExistence(timeout: 10), "다시 들어왔는데 안내가 뜨지 않았다")
        shot("02-다시-들어옴")

        app.alerts[title].buttons["다시 보지 않기"].tap()
        XCTAssertTrue(app.alerts[title].waitForNonExistence(timeout: 5))

        reenter(app)
        XCTAssertFalse(app.alerts[title].waitForExistence(timeout: 5), "'다시 보지 않기' 뒤에 또 떴다")
    }

    /// 창 밖(종료까지 7일 넘게 남음)이면 뜨지 않는다.
    func test_안내_창_밖이면_뜨지_않는다() {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPersonalPromo", "20"]
        app.launch()
        XCTAssertTrue(app.buttons["목소리"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertFalse(app.alerts[title].waitForExistence(timeout: 5))
    }

    /// 이용권 화면은 **한 줄만** 말한다 — 가짜 구독 카드·해지 버튼이 없고, 개인 카드에는
    /// 결제 버튼이 남는다(프로모는 산 이용권이 아니다).
    func test_이용권_화면에_무료_이용_중_한_줄() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewPersonalPromo", "20", "-UIPreviewTab", "menu"]
        app.launch()

        let billing = app.buttons.containing(.staticText, identifier: "이용권").firstMatch
        guard billing.waitForExistence(timeout: 20) else {
            throw XCTSkip("더보기에서 '이용권' 을 찾지 못했다")
        }
        billing.tap()

        let line = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "개인 플랜 무료 이용 중")
        ).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 10), "이용권 화면에 프로모 한 줄이 없다")
        XCTAssertFalse(app.buttons["이용권 해지"].exists, "해지할 구독이 없는데 해지 버튼이 떴다")
        shot("03-이용권")
    }
}
