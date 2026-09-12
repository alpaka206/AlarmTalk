import XCTest

/// **버튼이 보이는 만큼 실제로 눌리는지 기기에서 잰다.**
///
/// SwiftUI 는 `.frame(maxWidth:.infinity, minHeight:)`·`.padding()` 이 넓힌 자리를 **투명한
/// 레이아웃 공간**으로 두어 히트테스트에서 건너뛴다. 그래서 라벨이 글자·아이콘뿐인 버튼은
/// **보이는 넓이와 눌리는 넓이가 다르다** — 소스만 읽어서는 갈리지 않는다(채움이 라벨
/// 안인지 밖인지, 그 채움이 배경인지 배지 장식인지).
///
/// ⚠ `XCUIElement.tap()` 은 **가운데(활성화 지점)** 를 누르므로 이 결함을 못 잡는다.
/// 통과해도 아무것도 증명하지 않으니, **프레임 크기 자체를 단언**한다.
///
/// 2026-08-18 실측(수정 전): 탭 셀은 127pt 인데 눌리는 폭이 **알람 21 · 목소리 29 ·
/// 더보기 29**, 높이도 33~45 였다. 셀의 77% 가 죽어 있었고 애플 HIG 최소 44pt 에도
/// 못 미쳤다. `.contentShape(Rectangle())` 을 넣어 123×58 이 됐다.
final class HitAreaProbeUITests: XCTestCase {

    func test_하단탭은_셀_전체가_눌린다() {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreviewSeed", "-UIPreviewTab", "alarms"]
        app.launch()

        let more = app.buttons["더보기"]
        XCTAssertTrue(more.waitForExistence(timeout: 20), "'더보기' 탭이 없다")

        let screenWidth = app.windows.firstMatch.frame.width
        // 셀 3개 + 좌우 패딩 — 한 셀은 화면 폭의 1/4 보다는 넓어야 한다.
        let minCellWidth = screenWidth / 4

        for label in ["알람", "목소리", "더보기"] {
            let frame = app.buttons[label].frame
            XCTAssertGreaterThan(
                frame.width, minCellWidth,
                "'\(label)' 탭의 눌리는 폭이 \(frame.width)pt — 글리프만 눌린다(contentShape 누락)"
            )
            // 애플 HIG 최소 터치 타깃.
            XCTAssertGreaterThanOrEqual(frame.height, 44, "'\(label)' 탭 높이가 44pt 미만이다")
        }

        // 셀 왼쪽 끝에서 8% 지점 — 이제는 글리프에서 충분히 떨어진 자리다.
        more.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).tap()
        let landed = app.staticTexts["이용권"].waitForExistence(timeout: 6)
            || app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "이용권")).firstMatch.exists
        XCTAssertTrue(landed, "탭 셀의 가장자리를 눌렀는데 화면이 안 바뀌었다")
    }
}
