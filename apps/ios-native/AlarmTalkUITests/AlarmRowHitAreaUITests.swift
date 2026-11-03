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

    /// 스위치는 **제 폭만** 갖고, 둘째 줄("날짜 · 목소리")은 스위치 앞까지 남은 폭을 다 쓴다.
    ///
    /// 공용 토글 스타일(`Views/Common/AlarmTalkSwitch.swift`)의 본체가 `HStack { 라벨; Spacer; 캡슐 }` 이라,
    /// 라벨을 숨겨도 토글이 **남는 폭을 달라고** 한다. 옆의 글자 칸도 `maxWidth: .infinity` 면 둘이
    /// **반씩** 나눠 가져, 둘째 줄이 폭이 남는데도 잘렸다(2026-11-03 시뮬레이터 실측 — 글자 칸 ≈ 행의 절반).
    /// 안드로이드 `AlarmRow` 는 `Column(weight(1f))` + 고유 크기 스위치다 — iOS 도 스위치에 `.fixedSize()`.
    func test_스위치는_제_폭만_갖고_둘째_줄이_남은_폭을_쓴다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms"]
        // ⚠ 글자를 앱 상한(accessibility1)까지 키운다 — 그러면 둘째 줄이 **어느 날짜든** 칸을 넘쳐
        // 잘리므로, 재는 폭이 문장의 길이가 아니라 **칸의 폭**이 된다. 기본 크기면 "1월 1일 (월) · …"
        // 처럼 짧은 날짜는 ≈196pt 라 고쳐도 문턱에 못 미쳐 달력에 따라 결과가 갈린다(코덱스 #982).
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityM"]
        app.launch()

        let sw = app.switches.firstMatch
        XCTAssertTrue(sw.waitForExistence(timeout: 20), "알람 행의 스위치가 없다")
        // ⚠ 스위치 요소의 프레임은 **캡슐(51)뿐**이다 — 스타일의 HStack 이 가져간 폭은 접근성에 안 보인다
        // (고치기 전에도 w=51 로 재졌다). 그래서 판정은 둘째 줄의 폭으로 한다.
        // 둘째 줄("날짜 · 목소리")은 **정적 글자 요소**로, 날짜로 시작하는 것을 잡는다. 합쳐진 행 요소
        // (`children: .combine`)도 " · " 를 담지만 그건 늘 행 폭 전체(x=20..382)라 잘림을 못 보고, 위의 다음
        // 알람 상태 카드 제목("다음 알람 · 엄마 목소리")도 " · " 를 담아 먼저 잡힌다(w≈110 으로 오판했다).
        let second = app.staticTexts
            .matching(NSPredicate(format: "label MATCHES %@", "^[0-9]{1,2}월 [0-9]{1,2}일 \\(.\\) · .*"))
            .firstMatch
        XCTAssertTrue(second.waitForExistence(timeout: 5), "'날짜 · 목소리' 줄이 없다")
        print(String(
            format: "둘째 줄: x=%.1f..%.1f w=%.1f / 스위치: x=%.1f..%.1f / 화면 폭 %.0f",
            second.frame.minX, second.frame.maxX, second.frame.width, sw.frame.minX, sw.frame.maxX,
            app.windows.firstMatch.frame.width
        ))
        // 큰 글씨의 둘째 줄은 칸보다 길어 칸 폭에서 잘린다 — 그래서 잰 폭 = 칸 폭이다(iPhone 18 Pro 실측:
        // 고친 뒤 264.3, 글자 칸이 반으로 갈린 채면 154.0). 그 사이 200 으로 가른다.
        XCTAssertGreaterThan(second.frame.width, 200, "둘째 줄이 스위치 앞 폭을 다 못 쓰고 잘린다")
    }
}
