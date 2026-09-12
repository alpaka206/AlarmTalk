import XCTest

/// 동의 화면 캡처 — 「전체 동의」 라벨과 **민감 동의 2종의 접힘/펼침**을 눈으로 확인한다.
///
/// 이 화면은 실제로는 가입/로그인 뒤에만 뜨고 '동의 기록이 없는 계정' 이 있어야 해서
/// 화면 확인이 번거로웠다. `-UIPreviewAuthScreen consent` 진입점으로 바로 연다.
final class ConsentScreenshotUITests: XCTestCase {

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func test_동의화면_접힘과_펼침을_캡처한다() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewAuthScreen", "consent"]
        app.launch()

        // 마스터 행 — 라벨이 '전체 동의' 여야 한다(예전에는 '필수 약관 전체 동의').
        let master = app.staticTexts["전체 동의"]
        XCTAssertTrue(master.waitForExistence(timeout: 20), "'전체 동의' 행이 없다")
        shot(app, "01-접힌상태")

        // 민감 동의 2종의 설명은 **기본으로 접혀 있어야** 한다.
        // ⚠ 목록 순서상 **첫 화살표는 '국외 이전' 행**이다(생체정보가 아니다).
        // 처음엔 생체정보 설명을 찾다가 "펼쳤는데 안 나온다" 로 헛짚었다.
        let firstDetail = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "국외 처리자에게 전송될 수 있습니다")
        ).firstMatch
        XCTAssertFalse(firstDetail.exists, "설명이 접히지 않고 처음부터 보인다")

        // 제목과 [선택] 표기는 **접혀도 보여야** 한다.
        XCTAssertTrue(
            app.staticTexts["[선택] 음성 생체정보 처리 동의"].exists,
            "접힌 상태에서 제목·[선택] 표기가 사라졌다"
        )

        // 펼침 — 체크와 다른 동작이어야 한다(펼쳤다고 체크되면 안 된다).
        let expand = app.buttons.matching(
            NSPredicate(format: "label == %@", "설명 펼치기")
        ).firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 3), "펼침 버튼이 없다")
        expand.tap()

        XCTAssertTrue(
            firstDetail.waitForExistence(timeout: 3),
            "펼쳤는데 설명이 안 나온다"
        )
        // ⚠ **펼침이 동의로 이어지면 안 된다** — 읽으려던 사람이 동의해 버린다.
        XCTAssertFalse(
            app.checkBoxes.allElementsBoundByIndex.contains { $0.value as? String == "1" },
            "설명을 펼쳤을 뿐인데 체크가 켜졌다"
        )
        shot(app, "02-펼친상태")
    }
}
