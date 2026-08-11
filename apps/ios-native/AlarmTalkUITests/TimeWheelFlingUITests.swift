import XCTest

/// 타임휠을 **튕겼을 때** 손을 뗀 뒤에도 굴러가는지.
///
/// ⚠ 계산부 테스트(`TimeWheelSettleTests`)만으로는 부족하다 — 그건 식이 맞는지만 보고,
/// 그 식이 **실제로 연결돼 있는지**는 보지 못한다. 예전 코드는 손을 떼는 순간 N칸을
/// 즉시 대입해서 숫자가 순간이동했는데, 계산부 테스트는 그래도 통과한다.
/// 여기서는 손을 뗀 **직후**와 **잠시 뒤**의 값을 비교해 굴러가는 중이었음을 확인한다.
final class TimeWheelFlingUITests: XCTestCase {

    func test_세게_튕기면_손을_뗀_뒤에도_계속_굴러간다() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreviewSeed", "-UIPreviewTab", "alarms", "-UIPreviewEditor"]
        app.launch()

        let minutes = app.otherElements["timeWheel.분"]
        guard minutes.waitForExistence(timeout: 20) else {
            throw XCTSkip("타임휠 분 칼럼을 찾지 못했다")
        }

        let before = minutes.label
        // 빠르게 튕긴다. 느린 드래그는 fling 판정에 못 들어가 한 칸만 붙는다.
        minutes.swipeUp(velocity: .fast)

        // 손을 뗀 직후 — 아직 굴러가는 중이어야 한다.
        let justAfter = minutes.label
        // 굴러가다 멎을 때까지 기다린다(가장 긴 정착이 720ms).
        Thread.sleep(forTimeInterval: 1.2)
        let settled = minutes.label

        XCTAssertNotEqual(before, settled, "튕겼는데 값이 그대로다 — 휠이 아예 안 돌았다")
        XCTAssertNotEqual(
            justAfter, settled,
            """
            손을 뗀 직후 값과 멎은 뒤 값이 같다 — 굴러가지 않고 **순간이동**했다는 뜻이다.
            `onEnded` 에서 `applyStep(snapStep)` 으로 한꺼번에 넘기던 옛 코드로 되돌아갔는지 볼 것.
            """
        )
    }
}
