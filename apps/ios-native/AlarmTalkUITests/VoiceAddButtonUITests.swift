import XCTest

/// 목소리 탭 '추가' 버튼의 **실제 높이**를 잰다.
///
/// `.frame(minHeight: 44)` 가 `.buttonStyle` **앞**에 있으면 그 44 는 **라벨**에 걸리고,
/// 그 위에 `borderedProminent` 의 세로 패딩이 또 붙어 버튼이 44보다 훨씬 커진다.
/// 안드로이드 M3 `Button` 기본 높이는 40dp 다.
final class VoiceAddButtonUITests: XCTestCase {

    func test_추가_버튼_높이를_잰다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "voices"]
        app.launch()

        let add = app.buttons["추가"].firstMatch
        guard add.waitForExistence(timeout: 30) else { throw XCTSkip("'추가' 버튼을 못 찾았다") }
        print(String(format: "추가 버튼: w=%.1f h=%.1f", add.frame.width, add.frame.height))

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "voices-add-button"
        shot.lifetime = .keepAlways
        // ⚠ **여기서 재는 건 '보이는' 버튼 크기다** — `borderedProminent` 는 **라벨**에
        // 맞춰 캡슐을 그리므로, 버튼 **바깥**에 건 `.frame(minHeight:)` 은 투명 여백만
        // 얹고 캡슐은 그대로 둔다. 그렇게 둔 채 주석만 "44를 지킨다" 고 적혀 있었고
        // 실측(스크린샷 픽셀)은 **31pt** 였다. 여백을 **라벨에** 준 뒤 40pt 가 됐다.
        // 안드로이드 M3 `Button` 기본 높이가 40dp 라 그쪽에 맞춘 값이다.
        XCTAssertGreaterThanOrEqual(
            add.frame.height, 38,
            "'추가' 버튼이 안드로이드(40dp)보다 눈에 띄게 작다 — 여백을 라벨이 아니라 버튼 바깥에 줬나?"
        )
    }

    func test_목소리_만들기_첫화면이_안드로이드와_같은_안내를_쓴다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "voices"]
        app.launch()

        let addButton = app.buttons["추가"].firstMatch
        XCTAssertTrue(addButton.waitForExistence(timeout: 30))
        addButton.tap()

        XCTAssertTrue(app.staticTexts["목소리 만들기"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["녹음"].exists)
        XCTAssertTrue(app.buttons["파일"].exists)
        XCTAssertTrue(app.staticTexts["너무 짧으면 목소리가 다르게 나올 수 있어요."].exists)
        XCTAssertTrue(app.staticTexts["원하는 목소리 파일이 없다면 영상을 틀고 녹음해도 돼요."].exists)
        XCTAssertFalse(app.staticTexts["12초 이상 2분 이하로 녹음해 주세요"].exists)

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "voice-clone-source"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
