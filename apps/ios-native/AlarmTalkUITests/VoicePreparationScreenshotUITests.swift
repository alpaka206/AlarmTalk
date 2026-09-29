import XCTest

/// **목소리 등록 마지막 화면**(생성·다운로드 하나의 진행률)을 열어 눈으로 대조하기 위한 진입점.
/// 실제로는 녹음 12초 + 서버 클론을 거쳐야 나오는 화면이라, 시뮬레이터에서는
/// `-UIPreviewVoicePrep` 로만 볼 수 있다(`BillingScreenshotUITests` 와 같은 이유).
final class VoicePreparationScreenshotUITests: XCTestCase {

    func test_목소리_준비_화면을_연다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "voices", "-UIPreviewVoicePrep"]
        app.launch()

        // 전체화면 커버가 접근성 트리에 늦게 붙을 수 있어 **화면 전체**에서 찾는다.
        let title = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "알람 문구를 만들고"))
            .firstMatch
        guard title.waitForExistence(timeout: 30) else {
            throw XCTSkip("준비 화면이 뜨지 않았다")
        }
        let window = app.windows.firstMatch.frame
        // 이 화면에는 상단바 제목이 없다(2026-09-29 지시 — 뒤로가기도 없는 자리에 제목만 떠 있었다).
        XCTAssertFalse(app.staticTexts["목소리 만들기"].exists, "준비 화면에 상단바 제목 '목소리 만들기' 가 남아 있다")
        // '백그라운드에서 계속' 은 블록 아래가 아니라 화면 맨 아래에 있다(같은 지시).
        let background = app.buttons["백그라운드에서 계속"]
        XCTAssertTrue(background.waitForExistence(timeout: 5), "'백그라운드에서 계속' 이 없다")
        XCTAssertGreaterThan(
            background.frame.midY, window.minY + window.height * 0.85,
            "'백그라운드에서 계속' 이 화면 맨 아래가 아니다: \(background.frame)"
        )
        // 좌우를 꽉 채우는지 — 막대가 화면 폭에 가깝게 그려져야 한다(2026-09-21 지적).
        let bar = app.progressIndicators.firstMatch
        if bar.waitForExistence(timeout: 5) {
            let ratio = bar.frame.width / window.width
            XCTAssertGreaterThan(ratio, 0.7, "진행 막대가 좌우를 꽉 채우지 않는다: \(ratio)")
            // 제목부터 막대까지의 블록이 세로 가운데에 선다(2026-09-29 지시). 창과 안전 영역의
            // 가운데는 상하 인셋 차이의 절반만큼 어긋나므로 그만큼은 허용한다.
            // 제목 글자 자체의 프레임을 잰다 — 위 `title` 은 아무 요소나 잡는 검색이라
            // 글자를 품은 컨테이너가 걸릴 수 있다.
            let heading = app.staticTexts["이 목소리로 알람 문구를 만들고 있어요"]
            XCTAssertTrue(heading.exists, "준비 화면 제목 글자를 못 찾았다")
            let blockMidY = (heading.frame.minY + bar.frame.maxY) / 2
            XCTAssertEqual(
                blockMidY, window.midY, accuracy: window.height * 0.06,
                "진행 블록이 세로 가운데가 아니다: \(blockMidY) vs \(window.midY)"
            )
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "voice-preparation"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
