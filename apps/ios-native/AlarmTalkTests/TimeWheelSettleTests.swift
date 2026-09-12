import XCTest
@testable import AlarmTalk

/// 휠이 **굴러가서** 멎는지 — 순간이동으로 되돌아가는 회귀를 막는다.
///
/// 계산부만 검증한다(구동은 `CADisplayLink` 라 테스트에서 돌릴 수 없다). 대신
/// 프레임 진행을 손으로 흉내 내어 **칸 경계 통과 횟수**가 정확한지까지 본다.
final class TimeWheelSettleTests: XCTestCase {

    // MARK: - 감속 곡선

    func test_곡선은_0에서_시작해_1에서_끝난다() {
        XCTAssertEqual(TimeWheelSettle.ease(0), 0, accuracy: 0.001)
        XCTAssertEqual(TimeWheelSettle.ease(1), 1, accuracy: 0.001)
    }

    func test_곡선은_단조증가한다() {
        var previous = -1.0
        for i in 0...100 {
            let value = TimeWheelSettle.ease(Double(i) / 100)
            XCTAssertGreaterThanOrEqual(value, previous, "감속 곡선이 뒤로 갔다 — 숫자가 되돌아 보인다")
            previous = value
        }
    }

    /// 감속이어야 한다 — 앞이 빠르고 뒤가 느리다. 반대면 굴러오는 느낌이 안 난다.
    func test_앞이_빠르고_뒤가_느리다() {
        let firstHalf = TimeWheelSettle.ease(0.5)
        XCTAssertGreaterThan(firstHalf, 0.5, "절반 시간에 절반도 못 갔다면 감속이 아니다")
        XCTAssertGreaterThan(TimeWheelSettle.ease(0.25), 0.25)
    }

    /// 범위를 벗어난 값도 잘라서 받는다(프레임이 밀려 progress 가 1을 넘을 수 있다).
    func test_범위를_벗어나면_자른다() {
        XCTAssertEqual(TimeWheelSettle.ease(-0.5), 0, accuracy: 0.001)
        XCTAssertEqual(TimeWheelSettle.ease(1.5), 1, accuracy: 0.001)
    }

    // MARK: - 길이

    func test_길이는_안드로이드와_같다() {
        // 붙기만 할 때(튕기지 않음).
        XCTAssertEqual(TimeWheelSettle.duration(steps: 0), 0.170, accuracy: 0.0001)
        // 190 + 42×n 을 230~720ms 로 조인다.
        XCTAssertEqual(TimeWheelSettle.duration(steps: 1), 0.232, accuracy: 0.0001)
        XCTAssertEqual(TimeWheelSettle.duration(steps: 5), 0.400, accuracy: 0.0001)
        XCTAssertEqual(TimeWheelSettle.duration(steps: 15), 0.720, accuracy: 0.0001)
        // 방향이 달라도 길이는 같다.
        XCTAssertEqual(TimeWheelSettle.duration(steps: -5), TimeWheelSettle.duration(steps: 5))
    }

    func test_길이는_상한을_넘지_않는다() {
        XCTAssertEqual(TimeWheelSettle.duration(steps: 100), 0.720, accuracy: 0.0001)
    }

    // MARK: - 칸 경계 통과

    /// ⚠ **한 번에 N칸을 대입하면 이 테스트가 통과하지 못한다.** 굴러가는 동안
    /// 경계를 지날 때마다 **한 칸씩** 넘어야 중간 숫자가 보인다.
    func test_굴러가는_동안_한_칸씩_넘어간다() {
        let emitted = simulateSettle(steps: 5, itemHeight: 92, startOffset: -20)
        XCTAssertEqual(emitted, Array(repeating: 1, count: 5),
                       "5칸을 한 번에 넘기지 말고 한 칸씩 다섯 번 넘겨야 한다")
    }

    func test_반대_방향도_한_칸씩() {
        let emitted = simulateSettle(steps: -3, itemHeight: 92, startOffset: 20)
        XCTAssertEqual(emitted, Array(repeating: -1, count: 3))
    }

    func test_붙기만_할_때는_아무_칸도_안_넘긴다() {
        XCTAssertTrue(simulateSettle(steps: 0, itemHeight: 92, startOffset: 30).isEmpty)
    }

    /// 마지막 프레임이 경계를 정확히 밟지 못해도 총합은 맞아야 한다.
    func test_프레임이_거칠어도_총합은_맞는다() {
        // 프레임을 4개만 주는(=매우 거친) 경우에도 15칸이 다 넘어간다.
        let emitted = simulateSettle(steps: 15, itemHeight: 92, startOffset: 0, frames: 4)
        XCTAssertEqual(emitted.reduce(0, +), 15)
    }

    // MARK: - Helper (구동부 `tick` 과 같은 식)

    private func simulateSettle(
        steps: Int,
        itemHeight: CGFloat,
        startOffset: CGFloat,
        frames: Int = 60
    ) -> [Int] {
        var emitted: [Int] = []
        var consumed = 0
        let target = -CGFloat(steps) * itemHeight

        for frame in 1...frames {
            let progress = Double(frame) / Double(frames)
            let eased = CGFloat(TimeWheelSettle.ease(progress))
            let current = startOffset + (target - startOffset) * eased
            if steps > 0 {
                while current <= -CGFloat(consumed + 1) * itemHeight, consumed < steps {
                    consumed += 1
                    emitted.append(1)
                }
            } else if steps < 0 {
                while current >= CGFloat(consumed + 1) * itemHeight, consumed < -steps {
                    consumed += 1
                    emitted.append(-1)
                }
            }
        }
        // 마지막 프레임이 못 밟은 칸을 채운다(구동부와 같다).
        while consumed < abs(steps) {
            consumed += 1
            emitted.append(steps > 0 ? 1 : -1)
        }
        return emitted
    }
}
