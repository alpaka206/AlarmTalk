import SwiftUI

/// 드래그-스냅 방식의 시간 휠 picker.
///
/// Android 의 `AlarmTimePicker.kt` / `DraggableTimeWheelColumn.kt` /
/// `AmPmWheelColumn.kt` 3개 파일을 SwiftUI 단일 컴포넌트로 포팅했다.
///
/// 외부 API:
/// - `hour`: 0..23 의 24시간제 값 (내부적으로 12h 표시로 변환).
/// - `minute`: 0..59.
///
/// UX:
/// - 가운데 정렬된 큰 숫자 + 위아래 흐릿한 인접 항목.
/// - 드래그 거리에 따른 자석 스냅 (항목 높이 72pt).
/// - 항목 변경 시 `UISelectionFeedbackGenerator` 햅틱.
/// - 상하단 fade gradient mask 로 wheel-edge 효과.
/// - `snappy(duration: 0.25)` 스프링 애니메이션.
struct TimeWheelPicker: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var hour: Int
    @Binding var minute: Int

    /// Wheel 한 칸 높이. 안드로이드 `AlarmTimePicker.kt:60` 은 **92dp**(× fontScale)다 —
    /// 옛 주석이 "72dp 와 일치" 라고 적었지만 그 값은 안드로이드에 없다. 72 로 두면 같은
    /// 57pt 숫자가 더 좁은 칸에 들어가 위아래가 답답하고, 인접 숫자가 잘려 보인다.
    static let itemHeight: CGFloat = 92

    var body: some View {
        HStack(spacing: 16) {
            AmPmWheelColumn(isPM: amPmBinding)
                .frame(width: 96)

            DraggableNumberColumn(
                value: hour12Binding,
                range: 1...12,
                formatter: { String($0) }
            )
            .frame(maxWidth: .infinity)

            ColonSeparator()

            DraggableNumberColumn(
                value: $minute,
                range: 0...59,
                formatter: { String(format: "%02d", $0) }
            )
            .frame(maxWidth: .infinity)
        }
        .frame(height: Self.itemHeight * 3)
        .padding(.horizontal, 12)
        .padding(.vertical, 24)
        // ⚠ **배경을 칠하지 말 것.** 안드로이드는 `wheelBackgroundColor = Color.Transparent`
        // 다(`AlarmTimePicker.kt:65`). `primaryContainer` 파란 박스를 두면 시각이 한 덩어리
        // 위젯처럼 보여, 화면의 주인공이어야 할 숫자가 배경에 갇힌다.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("시간 선택"))
    }

    // MARK: - 12h ↔ 24h 변환

    private var hour12Binding: Binding<Int> {
        Binding(
            get: { TimeWheelMath.hour24To12(hour) },
            set: { newDisplay in
                hour = TimeWheelMath.combine(displayHour: newDisplay, isPM: hour >= 12)
            }
        )
    }

    private var amPmBinding: Binding<Bool> {
        Binding(
            get: { hour >= 12 },
            set: { isPM in
                let display = TimeWheelMath.hour24To12(hour)
                hour = TimeWheelMath.combine(displayHour: display, isPM: isPM)
            }
        )
    }
}

// MARK: - Conversion math

/// 시간 변환을 한 곳에 모은 유틸. 테스트가 모킹 없이 검증할 수 있도록
/// `TimeWheelPicker` 외부에서도 import 가능한 internal 으로 노출.
enum TimeWheelMath {
    /// 0..23 → 1..12. (0 시는 12 AM, 12 시는 12 PM.)
    static func hour24To12(_ hour24: Int) -> Int {
        let h = ((hour24 % 24) + 24) % 24
        let mod = h % 12
        return mod == 0 ? 12 : mod
    }

    /// 1..12 + AM/PM → 0..23.
    static func combine(displayHour: Int, isPM: Bool) -> Int {
        let bounded = max(1, min(12, displayHour))
        let base = bounded == 12 ? 0 : bounded
        return base + (isPM ? 12 : 0)
    }
}

// MARK: - Number column

/// 드래그 스냅이 동작하는 숫자 단일 칼럼.
///
/// 무한 wrap (range 의 시작/끝이 이어짐) 을 지원한다. Android
/// `DraggableTimeWheelColumn` 의 `floorMod` 동작과 동일.
struct DraggableNumberColumn: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var value: Int
    let range: ClosedRange<Int>
    let formatter: (Int) -> String

    @State private var dragOffset: CGFloat = 0
    @GestureState private var isDragging: Bool = false
    @State private var selectionGenerator = UISelectionFeedbackGenerator()

    private let itemHeight = TimeWheelPicker.itemHeight

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                let centerY = proxy.size.height / 2

                ForEach(-1...1, id: \.self) { offset in
                    let displayValue = wrap(value + offset)
                    let yPosition = centerY + CGFloat(offset) * itemHeight + dragOffset
                    let normalized = abs(CGFloat(offset) * itemHeight + dragOffset) / itemHeight
                    let clamped = min(normalized, 1.4)

                    // ⚠ **선택/인접 크기가 다르다.** 안드로이드는 선택 `displayLarge`(57),
                    // 인접 `displayMedium`(45)을 쓴다(`DraggableTimeWheelColumn.kt:152-154`).
                    // 같은 크기로 그리면 알파만으로 초점을 만들어야 해서, 스크롤 중에
                    // 어느 숫자가 골라질 것인지가 흐릿하다.
                    //
                    // ⚠ 글꼴은 **Pretendard** 다. `design: .rounded`(SF Rounded)로 두면
                    // 이 화면만 다른 서체가 되어 앱에서 가장 큰 글자가 튄다.
                    Text(formatter(displayValue))
                        .font(.pretendard(.bold, size: clamped < 0.5 ? 57 : 45))
                        .monospacedDigit()
                        .foregroundStyle(theme.palette.onSurface.opacity(textAlpha(for: clamped)))
                        .frame(maxWidth: .infinity)
                        .frame(height: itemHeight)
                        .position(x: proxy.size.width / 2, y: yPosition)
                }
            }
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .mask(fadeMask)
        }
        .frame(height: itemHeight * 3)
        .accessibilityElement()
        .accessibilityLabel(Text(formatter(value)))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: applyStep(1)
            case .decrement: applyStep(-1)
            @unknown default: break
            }
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .updating($isDragging) { _, state, _ in state = true }
            .onChanged { gesture in
                let delta = gesture.translation.height
                let stepsConsumed = (delta / itemHeight).rounded(.towardZero)
                let residual = delta - stepsConsumed * itemHeight

                let stepDelta = Int(stepsConsumed)
                if stepDelta != lastEmittedSteps {
                    let diff = stepDelta - lastEmittedSteps
                    // 위로 드래그하면 다음 숫자 (value 증가).
                    applyStep(-diff)
                    lastEmittedSteps = stepDelta
                }
                dragOffset = residual
            }
            .onEnded { gesture in
                let velocity = gesture.predictedEndTranslation.height - gesture.translation.height
                // velocity 가 크면 한 칸 더 굴린다.
                let flingThreshold: CGFloat = itemHeight * 0.6
                let snapStep: Int
                if dragOffset <= -itemHeight * 0.5 || velocity < -flingThreshold {
                    snapStep = 1
                } else if dragOffset >= itemHeight * 0.5 || velocity > flingThreshold {
                    snapStep = -1
                } else {
                    snapStep = 0
                }
                if snapStep != 0 {
                    applyStep(-snapStep)
                }
                withAnimation(.snappy(duration: 0.25)) {
                    dragOffset = 0
                }
                lastEmittedSteps = 0
            }
    }

    // SwiftUI @State 가 closure 외부에서 mutate 안 되므로 보조 wrapper 필요.
    @State private var lastEmittedSteps: Int = 0

    private func applyStep(_ delta: Int) {
        guard delta != 0 else { return }
        value = wrap(value + delta)
        selectionGenerator.selectionChanged()
        selectionGenerator.prepare()
    }

    private func wrap(_ raw: Int) -> Int {
        let span = range.upperBound - range.lowerBound + 1
        let shifted = raw - range.lowerBound
        let mod = ((shifted % span) + span) % span
        return mod + range.lowerBound
    }

    private func textAlpha(for normalized: CGFloat) -> Double {
        // 중앙(=0) -> 1.0, 한 칸 멀어질수록 0.18, 두 칸이면 0.08.
        if normalized <= 0.05 { return 1.0 }
        if normalized <= 1.05 { return 0.18 + (1.0 - 0.18) * Double(1.0 - normalized) }
        return 0.08
    }

    private var fadeMask: some View {
        LinearGradient(
            gradient: Gradient(stops: [
                .init(color: .clear, location: 0.0),
                .init(color: .white, location: 0.22),
                .init(color: .white, location: 0.78),
                .init(color: .clear, location: 1.0),
            ]),
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - AM/PM column

struct AmPmWheelColumn: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var isPM: Bool
    @State private var selectionGenerator = UISelectionFeedbackGenerator()

    private let itemHeight = TimeWheelPicker.itemHeight

    var body: some View {
        VStack(spacing: 0) {
            label(title: "오전", selected: !isPM)
                .frame(height: itemHeight)
                .onTapGesture { setIsPM(false) }

            label(title: "오후", selected: isPM)
                .frame(height: itemHeight)
                .onTapGesture { setIsPM(true) }
        }
        .frame(height: itemHeight * 3)
        // 중앙 정렬: 선택된 항목이 가운데에 오도록 offset.
        .offset(y: isPM ? -itemHeight / 2 : itemHeight / 2)
        .animation(.snappy(duration: 0.25), value: isPM)
        .accessibilityElement()
        .accessibilityLabel(Text(isPM ? "오후 선택됨" : "오전 선택됨"))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment, .decrement:
                setIsPM(!isPM)
            @unknown default:
                break
            }
        }
        .gesture(swipeGesture)
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onEnded { gesture in
                let delta = gesture.translation.height
                if delta < -itemHeight * 0.35 {
                    setIsPM(true)
                } else if delta > itemHeight * 0.35 {
                    setIsPM(false)
                }
            }
    }

    private func setIsPM(_ newValue: Bool) {
        guard newValue != isPM else { return }
        isPM = newValue
        selectionGenerator.selectionChanged()
        selectionGenerator.prepare()
    }

    @ViewBuilder
    private func label(title: String, selected: Bool) -> some View {
        Text(title)
            .font(.pretendard(selected ? .bold : .semibold, size: selected ? 38 : 32))
            .foregroundStyle(theme.palette.onSurface.opacity(selected ? 1.0 : 0.18))
            .frame(maxWidth: .infinity)
    }
}

// MARK: - Colon

private struct ColonSeparator: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        Text(":")
            .font(.pretendard(.bold, size: 57))
            .foregroundStyle(theme.palette.onSurface)
            // 안드로이드는 36dp 폭을 준다(`AlarmTimePicker.kt:135`). 18 이면 절반이라
            // 시:분 사이가 붙어 보인다.
            .frame(width: 36)
            .accessibilityHidden(true)
    }
}

// MARK: - Preview

#if DEBUG
private struct TimeWheelPreviewHost: View {
    @State private var hour = 7
    @State private var minute = 30

    var body: some View {
        VStack(spacing: 16) {
            Text(String(format: "%02d:%02d (24h)", hour, minute))
                .font(.headline)
            TimeWheelPicker(hour: $hour, minute: $minute)
        }
        .padding(24)
    }
}

#Preview("TimeWheelPicker — light") {
    TimeWheelPreviewHost()
        .background(Color(.systemBackground))
}

#Preview("TimeWheelPicker — dark") {
    TimeWheelPreviewHost()
        .background(Color(.systemBackground))
        .preferredColorScheme(.dark)
}
#endif
