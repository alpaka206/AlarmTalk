import QuartzCore

/// 손을 뗀 뒤 휠이 **굴러가서 멈추는** 동작.
///
/// ⚠ **여러 칸을 한 번에 대입하지 말 것 — 그게 "돌아가는 게 저게 최선이냐" 의 원인이었다.**
/// 예전 iOS 는 손을 떼는 순간 `value` 에 N칸을 **즉시** 더하고 남은 오프셋만 0으로
/// 되돌렸다. 그래서 세게 튕기면 숫자가 굴러가는 게 아니라 **순간이동**했고, 중간 숫자가
/// 하나도 안 보여 몇 칸을 넘겼는지 알 수 없었다(2026-08-11 지적).
/// 안드로이드 `ui/editor/DraggableTimeWheelColumn.kt` 의 `animateWheelSettle` 은
/// 오프셋을 감속 곡선으로 굴리며 **칸 경계를 지날 때마다** 한 칸씩 넘긴다 — 같게 맞춘다.
///
/// 계산부(`TimeWheelSettle`)와 구동부(`WheelSettleDriver`)를 나눈 건 계산을 제스처 없이
/// 검증하기 위해서다(`TimeWheelSettleTests`).
enum TimeWheelSettle {

    /// 안드로이드 `TimeWheelEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)` 와 같은 곡선.
    /// 초반이 빠르고 끝에서 길게 늘어지는 감속이라, 굴러와 멎는 느낌이 난다.
    static func ease(_ progress: Double) -> Double {
        let x = min(max(progress, 0), 1)
        let x1 = 0.16, y1 = 1.0, x2 = 0.3, y2 = 1.0

        func curve(_ t: Double, _ a: Double, _ b: Double) -> Double {
            let mt = 1 - t
            return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t
        }

        // ⚠ **뉴턴법을 쓰지 말 것.** 이 곡선은 끝부분 기울기가 0에 가까워 나눗셈이 폭주한다.
        // 이분법 20회면 오차가 1e-6 아래라 60fps 에서 충분하다.
        var lo = 0.0, hi = 1.0
        for _ in 0..<20 {
            let mid = (lo + hi) / 2
            if curve(mid, x1, x2) < x { lo = mid } else { hi = mid }
        }
        return curve((lo + hi) / 2, y1, y2)
    }

    /// 굴릴 칸수에 따른 애니메이션 길이(초). 안드로이드와 같은 값이다 —
    /// 붙기만 할 땐 170ms, 튕겼으면 `190 + 42×칸수` 를 230~720ms 로 조인다.
    static func duration(steps: Int) -> Double {
        guard steps != 0 else { return 0.170 }
        let ms = 190 + abs(steps) * 42
        return Double(min(max(ms, 230), 720)) / 1000
    }
}

/// 정착 애니메이션을 프레임마다 굴리는 구동부.
///
/// ⚠ **`withAnimation` 으로 대체할 수 없다.** SwiftUI 애니메이션은 중간값을 돌려주지
/// 않는데, 여기서는 **칸 경계를 지나는 순간**마다 값을 한 칸 넘기고 햅틱을 울려야 한다.
/// 그래서 화면 갱신에 맞춰 직접 프레임을 받는다.
final class WheelSettleDriver: NSObject {
    private var link: CADisplayLink?
    private var startTime: CFTimeInterval = 0
    private var duration: Double = 0
    private var startOffset: CGFloat = 0
    private var itemHeight: CGFloat = 1
    private var steps: Int = 0
    private var consumed: Int = 0
    private var onStep: ((Int) -> Void)?
    private var onOffset: ((CGFloat) -> Void)?

    /// 굴리기 시작한다. 이미 굴러가고 있으면 그걸 버리고 새로 시작한다
    /// (안드로이드 `settleJob?.cancel()` 과 같다 — 손을 다시 대면 즉시 잡힌다).
    func start(
        from offset: CGFloat,
        steps: Int,
        itemHeight: CGFloat,
        onStep: @escaping (Int) -> Void,
        onOffset: @escaping (CGFloat) -> Void
    ) {
        cancel()
        guard itemHeight > 0 else { return }
        self.startOffset = offset
        self.steps = steps
        self.itemHeight = itemHeight
        self.consumed = 0
        self.onStep = onStep
        self.onOffset = onOffset
        self.duration = TimeWheelSettle.duration(steps: steps)
        self.startTime = CACurrentMediaTime()

        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    /// 굴리기를 멈춘다. **남은 칸은 넘기지 않는다** — 손이 다시 닿았다는 뜻이라,
    /// 사용자가 잡은 자리에서 그대로 이어져야 한다.
    func cancel() {
        link?.invalidate()
        link = nil
        onStep = nil
        onOffset = nil
    }

    @objc private func tick() {
        let elapsed = CACurrentMediaTime() - startTime
        let progress = duration > 0 ? min(elapsed / duration, 1) : 1
        let eased = CGFloat(TimeWheelSettle.ease(progress))

        let target = -CGFloat(steps) * itemHeight
        let current = startOffset + (target - startOffset) * eased

        // 칸 경계를 지날 때마다 한 칸씩. 여기서 한꺼번에 더하면 순간이동으로 되돌아간다.
        if steps > 0 {
            while current <= -CGFloat(consumed + 1) * itemHeight, consumed < steps {
                consumed += 1
                onStep?(1)
            }
        } else if steps < 0 {
            while current >= CGFloat(consumed + 1) * itemHeight, consumed < -steps {
                consumed += 1
                onStep?(-1)
            }
        }

        let residual = steps >= 0
            ? current + CGFloat(consumed) * itemHeight
            : current - CGFloat(consumed) * itemHeight
        onOffset?(residual)

        guard progress >= 1 else { return }

        // 마지막 프레임이 경계를 정확히 못 밟고 끝날 수 있다 — 남은 칸을 여기서 채운다.
        let total = abs(steps)
        let direction = steps > 0 ? 1 : -1
        while consumed < total {
            consumed += 1
            onStep?(direction)
        }
        onOffset?(0)
        cancel()
    }
}
