import XCTest

/// **입력창 밖을 누르면 입력이 끝난다 — 다만 입력창을 누르는 것은 예외다**(2026-08-27 지시).
///
/// ⚠ 이 규칙은 **두 쪽을 같이** 지켜야 한다. 한쪽만 보면 반대편이 조용히 깨진다:
///  - 밖을 눌렀는데 키보드가 남아 있으면 요청한 동작이 아니고,
///  - 입력칸을 눌렀는데 키보드가 내려가면 **글자를 아예 못 친다**.
///
/// 실제로 안드로이드에서 `detectTapGestures` 를 부모에 걸었다가 두 번째를 밟았다
/// (칸을 눌러도 곧바로 초점이 풀렸다). iOS 도 `simultaneousGesture` 로 만들면 같은 일이
/// 생기므로 창에 단 UIKit 인식기로 가른다(`KeyboardDismissGesture`).
final class TapOutsideEndsEditingUITests: XCTestCase {

    func test_밖을_누르면_끝나고_칸을_누르면_이어진다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewEditor"]
        app.launch()

        // 타임휠의 '그 자리 입력' 을 연다(`EditorKeyboardUITests` 와 같은 식별자).
        let hour = app.otherElements["timeWheel.시"].firstMatch
        XCTAssertTrue(hour.waitForExistence(timeout: 10), "타임휠 시 칼럼이 없다")
        hour.tap()

        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "칸을 눌렀는데 키보드가 안 올라왔다")

        // ① 같은 칸을 다시 눌러도 편집이 이어져야 한다.
        hour.tap()
        XCTAssertTrue(
            keyboard.exists,
            "입력칸을 다시 눌렀는데 키보드가 내려갔다 — 밖 탭 처리가 칸 탭까지 삼키고 있다"
        )

        // ② 입력칸이 아닌 곳을 누르면 끝나야 한다.
        // ⚠ **타임휠 영역(화면 위쪽)을 고르지 말 것** — 거기 숫자를 누르면 그 자리 입력이
        // 다시 열려서, 고쳐도 안 고쳐도 키보드가 남는다(2026-08-27 이 좌표로 오판했다).
        // 휠 아래 카드 사이 여백을 누른다.
        let outside = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
        outside.tap()
        let gone = keyboard.waitForNonExistence(timeout: 5)
        XCTAssertTrue(gone, "입력창 밖을 눌렀는데 키보드가 그대로다")

        // ③ 다시 칸을 누르면 또 열려야 한다(초점이 영구히 막히지 않았는가).
        hour.tap()
        XCTAssertTrue(
            keyboard.waitForExistence(timeout: 5),
            "밖을 누른 뒤에는 입력칸을 눌러도 키보드가 열리지 않는다"
        )
    }
}
