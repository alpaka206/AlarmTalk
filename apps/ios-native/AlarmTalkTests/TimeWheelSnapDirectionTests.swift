import XCTest
@testable import AlarmTalk

/// **타임휠은 끌던 방향으로 스냅한다** — 회귀 방지.
///
/// 사용자 보고(2026-08-10): "알람 설정에서 알람 맞춰도 돌아간다".
/// 원인은 손을 뗄 때의 스냅 **부호가 뒤집혀** 있던 것이다.
///
/// - 끄는 동안(`onChanged`): 위로 끌면 값이 **증가**한다.
/// - 손을 뗄 때(`onEnded`): 예전 코드는 `applyStep(-snapStep)` 이라 **감소**시켰다.
///
/// 그래서 반 칸 이상 끌어 올린 뒤 손을 떼면 숫자가 한 칸 **도로 내려갔다.**
/// 두 자리의 방향은 반드시 같아야 한다.
final class TimeWheelSnapDirectionTests: XCTestCase {

    private let itemHeight: CGFloat = 92

    private func snap(_ dragOffset: CGFloat, _ velocity: CGFloat = 0) -> Int {
        DraggableNumberColumn.snapStep(
            dragOffset: dragOffset,
            velocity: velocity,
            itemHeight: itemHeight
        )
    }

    /// 위로 끌면(음수 오프셋) **값이 커지는 쪽(+1)** 이어야 한다.
    func test_위로_끌면_다음_값으로_스냅한다() {
        XCTAssertEqual(snap(-itemHeight * 0.6), 1,
                       "위로 끌어 올렸는데 값이 내려가면 '맞춰도 되돌아간다' 로 보인다")
        // 임계값은 **0.45** — 안드로이드 `DraggableTimeWheelColumn` 과 같은 값이다.
        XCTAssertEqual(snap(-itemHeight * 0.45), 1)
    }

    /// 아래로 끌면(양수 오프셋) **값이 작아지는 쪽(-1)** 이어야 한다.
    func test_아래로_끌면_이전_값으로_스냅한다() {
        XCTAssertEqual(snap(itemHeight * 0.6), -1)
        XCTAssertEqual(snap(itemHeight * 0.45), -1)
    }

    /// 반 칸에 못 미치면 제자리다 — 살짝 건드렸다고 값이 바뀌면 안 된다.
    func test_반_칸에_못_미치면_움직이지_않는다() {
        XCTAssertEqual(snap(-itemHeight * 0.44), 0)
        XCTAssertEqual(snap(itemHeight * 0.44), 0)
        XCTAssertEqual(snap(0), 0)
    }

    /// 빠르게 튕기면 오프셋이 작아도 한 칸 굴린다 — 방향은 끌던 쪽 그대로다.
    func test_빠르게_튕기면_끌던_방향으로_한_칸_굴린다() {
        XCTAssertEqual(snap(0, -itemHeight), 1, "위로 튕겼는데 값이 내려가면 안 된다")
        XCTAssertEqual(snap(0, itemHeight), -1)
        XCTAssertEqual(snap(0, -itemHeight * 0.5), 0, "임계값 미만은 튕김으로 보지 않는다")
    }

    /// ⚠ **한 칸만 굴리면 "휠이 잘 안 돌아간다" 로 돌아간다.** 세게 튕기면 여러 칸이어야 한다.
    func test_세게_튕기면_여러_칸을_굴린다() {
        let many = snap(0, -itemHeight * 5)
        XCTAssertGreaterThan(many, 1, "세게 튕겼는데 한 칸이면 92pt 씩 여러 번 끌어야 한다")
        XCTAssertLessThanOrEqual(many, DraggableNumberColumn.maxStepsPerFling,
                                 "한 번에 넘길 수 있는 칸수 상한을 넘으면 안 된다")
        XCTAssertEqual(snap(0, itemHeight * 5), -many, "반대 방향도 같은 칸수여야 한다")
    }
}
