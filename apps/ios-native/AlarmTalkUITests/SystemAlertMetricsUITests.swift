import XCTest

/// **시스템 알럿의 실제 치수를 재는 자.**
///
/// 애플은 알럿의 픽셀 규격을 공개하지 않는다(HIG 는 '무엇을 언제 쓰는가'와 글쓰기 규칙만
/// 적는다). 그래서 블로그 숫자를 베끼는 대신 **UIKit 이 실제로 그린 알럿의 프레임**을
/// 접근성 트리에서 읽는다 — 이게 우리가 구할 수 있는 가장 정확한 근거다.
///
/// 여기서 나온 값이 안드로이드 `ui/components/IosAlertDialog.kt` 의 기준이 된다.
/// 값을 바꿀 일이 생기면 이 테스트를 다시 돌려 로그를 근거로 삼는다.
final class SystemAlertMetricsUITests: XCTestCase {

    func test_시스템_알럿_치수를_찍는다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "menu"]
        app.launch()

        let settings = app.buttons.containing(.staticText, identifier: "내 정보 · 앱 설정").firstMatch
        guard settings.waitForExistence(timeout: 20) else { throw XCTSkip("설정 입구를 못 찾았다") }
        settings.tap()

        let logout = app.buttons.containing(.staticText, identifier: "로그아웃").firstMatch
        guard logout.waitForExistence(timeout: 10) else { throw XCTSkip("로그아웃 버튼을 못 찾았다") }
        logout.tap()

        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 10) else { throw XCTSkip("시스템 알럿이 뜨지 않았다") }

        let screen = app.windows.firstMatch.frame
        var report = ["", "===== 시스템 알럿 실측 (화면 \(screen.width)×\(screen.height)pt) ====="]
        report.append("알럿 프레임: \(fmt(alert.frame))")
        report.append("  화면 폭 대비: \(String(format: "%.1f", alert.frame.width / screen.width * 100))%")
        report.append("  좌우 여백: \(String(format: "%.1f", alert.frame.minX))pt")

        for text in alert.staticTexts.allElementsBoundByIndex {
            report.append("텍스트 \"\(text.label)\": \(fmt(text.frame))")
        }
        for button in alert.buttons.allElementsBoundByIndex {
            report.append("버튼 \"\(button.label)\": \(fmt(button.frame))")
        }

        // 버튼이 둘이면 가로 배치인지 세로 배치인지 프레임으로 판별된다.
        let buttons = alert.buttons.allElementsBoundByIndex
        if buttons.count == 2 {
            let sameRow = abs(buttons[0].frame.minY - buttons[1].frame.minY) < 1
            report.append("버튼 2개 배치: \(sameRow ? "가로(한 줄)" : "세로(두 줄)")")
            report.append("버튼 높이: \(buttons[0].frame.height)pt")
        }
        print(report.joined(separator: "\n"))

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "system-alert"
        shot.lifetime = .keepAlways
        add(shot)

        XCTAssertGreaterThan(alert.frame.width, 0)
    }

    private func fmt(_ r: CGRect) -> String {
        String(format: "x=%.1f y=%.1f w=%.1f h=%.1f", r.minX, r.minY, r.width, r.height)
    }
}
