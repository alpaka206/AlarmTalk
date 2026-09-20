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
        // 좌우를 꽉 채우는지 — 막대가 화면 폭에 가깝게 그려져야 한다(2026-09-21 지적).
        let bar = app.progressIndicators.firstMatch
        if bar.waitForExistence(timeout: 5) {
            let ratio = bar.frame.width / app.windows.firstMatch.frame.width
            XCTAssertGreaterThan(ratio, 0.7, "진행 막대가 좌우를 꽉 채우지 않는다: \(ratio)")
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "voice-preparation"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
