import XCTest

/// 알람 행은 **행 전체**가 눌려야 한다 — 시각 숫자만이 아니라 그 옆 빈 자리도.
///
/// `.contentShape(Rectangle())` 이 없으면 SwiftUI 는 **그려진 픽셀만** 히트테스트하므로,
/// 폭을 `.infinity` 로 늘려도 빈 자리는 죽는다(2026-08-11 실기기 지적).
/// 안드로이드는 카드 전체에 `combinedClickable` 을 건다.
final class AlarmRowHitAreaUITests: XCTestCase {

    func test_행의_빈_자리를_눌러도_편집기가_열린다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms"]
        app.launch()

        // 시드 알람의 시각 텍스트로 행을 찾는다.
        let clock = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}:[0-9]{2}$")).firstMatch
        guard clock.waitForExistence(timeout: 30) else { throw XCTSkip("시드 알람 행을 못 찾았다") }
        let row = clock.frame
        print(String(format: "시각 텍스트: x=%.1f..%.1f y=%.1f..%.1f", row.minX, row.maxX, row.minY, row.maxY))

        // ⚠ 좌표를 짐작하지 말고 **행 버튼 자체**의 오른쪽 끝을 누른다 —
        // 거기가 글자 없는 빈 자리다(토글은 이 버튼 밖에 있다).
        let rowButton = app.buttons.containing(.staticText, identifier: clock.label).firstMatch
        guard rowButton.waitForExistence(timeout: 5) else { throw XCTSkip("행 버튼을 못 찾았다") }
        print(String(format: "행 버튼: x=%.1f..%.1f h=%.1f", rowButton.frame.minX, rowButton.frame.maxX, rowButton.frame.height))
        // ⚠ 버튼 프레임(라벨 크기)이 아니라 **행 전체 기준**으로 오른쪽 빈 자리를 누른다.
        // 토글은 더 오른쪽이라 화면 폭의 62% 지점은 글자도 스위치도 없는 자리다.
        let screen = app.windows.firstMatch.frame
        print(String(format: "화면 폭 %.1f", screen.width))
        let sw = app.switches.firstMatch
        if sw.exists {
            print(String(format: "스위치: x=%.1f..%.1f y=%.1f..%.1f", sw.frame.minX, sw.frame.maxX, sw.frame.minY, sw.frame.maxY))
        } else { print("스위치 없음") }
        // 글자 오른쪽 끝과 스위치 왼쪽 끝 **사이**의 정중앙을 누른다 — 확실한 빈 자리.
        let gapX = sw.exists ? (rowButton.frame.maxX + sw.frame.minX) / 2 : screen.width * 0.62
        print(String(format: "누를 지점 x=%.1f y=%.1f", gapX, rowButton.frame.midY))
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: gapX, dy: rowButton.frame.midY))
            .tap()

        sleep(3)
        print("=== 탭 후 화면의 글자 ===")
        for t in app.staticTexts.allElementsBoundByIndex.prefix(20) where !t.label.isEmpty {
            print("  \(t.label)")
        }
        print("=== 버튼 ===")
        for b in app.buttons.allElementsBoundByIndex.prefix(12) where !b.label.isEmpty {
            print("  [\(b.label)]")
        }
        // 편집기가 열렸는가 — 목록에 있던 시각 텍스트가 사라졌으면 화면이 바뀐 것이다.
        // ⚠ 편집기 저장 버튼 라벨은 **"수정 저장"** 이다 — "저장" 으로 찾으면 정확 일치가
        // 아니라 영영 못 찾는다(2026-08-11: 이 오단언 때문에 멀쩡한 수정도 실패로 읽혔다).
        let opened = app.buttons["수정 저장"].waitForExistence(timeout: 6)
            || app.buttons["취소"].exists
        XCTAssertTrue(
            opened,
            "행의 빈 자리를 눌렀는데 편집기가 안 열렸다 — .contentShape(Rectangle()) 가 빠졌나?"
        )
    }
}
