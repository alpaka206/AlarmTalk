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

    /// 이 폭이면 축소 없이 그대로 그린다. 안드로이드 `AlarmTimePicker` 의 392dp 기준과 같다.
    private static let referenceWidth: CGFloat = 392
    /// 아무리 좁아도 이보다 더 줄이지는 않는다(안드로이드 `coerceIn(0.78, 1)`).
    private static let minimumScale: CGFloat = 0.78

    var body: some View {
        // ⚠ **폭에 맞춰 휠 타이포를 줄인다.** 좁은 화면(360pt급)에서 '오전/오후' 고정폭 +
        // 57pt 숫자가 컬럼 폭을 넘어 분 숫자 오른쪽이 잘렸다. 안드로이드는
        // `BoxWithConstraints` 로 같은 축소를 이미 하고 있었고 iOS 에만 없었다.
        GeometryReader { proxy in
            let scale = wheelScale(for: proxy.size.width)
            HStack(spacing: 16 * scale) {
                AmPmWheelColumn(isPM: amPmBinding, scale: scale)
                    .frame(width: 96 * scale)

                // ⚠ **12시간이 아니라 24시간 값을 굴린다.** 예전에는 1...12 를 굴리면서
                // 오전/오후를 **그대로 유지**해서, 11시에서 12시로 넘겨도 오전/오후가
                // 바뀌지 않았다(2026-08-10 사용자 보고 "시간 바꿨을 때 오전·오후가 안 바뀐다").
                // 안드로이드는 24시간 값(`workingHour`)을 굴리고 표시만 `hour12` 로 하며,
                // 오전/오후 칼럼은 `hour >= 12` 에서 **파생**된다 — 같은 구조로 맞춘다.
                DraggableNumberColumn(
                    value: $hour,
                    range: 0...23,
                    formatter: { String(TimeWheelMath.hour24To12($0)) },
                    scale: scale,
                    typeInTitle: "시",
                    // 사용자는 화면에 보이는 **12시간** 숫자를 넣는다 — 지금 오전/오후를
                    // 유지한 채 24시간으로 되돌린다. (오전/오후를 바꾸려면 그 칼럼을 쓴다.)
                    applyTypedValue: { typed in
                        let display = min(max(typed, 1), 12)
                        hour = TimeWheelMath.combine(displayHour: display, isPM: hour >= 12)
                    }
                )
                .frame(maxWidth: .infinity)

                ColonSeparator(scale: scale)

                DraggableNumberColumn(
                    value: $minute,
                    range: 0...59,
                    formatter: { String(format: "%02d", $0) },
                    scale: scale,
                    typeInTitle: "분",
                    applyTypedValue: { typed in minute = min(max(typed, 0), 59) }
                )
                .frame(maxWidth: .infinity)
            }
            .frame(width: proxy.size.width, height: Self.itemHeight * 3 * scale)
        }
        .frame(height: Self.itemHeight * 3)
        // ⚠ **접근성 글꼴에서 휠은 더 커지지 않는다.** 휠은 3칸 높이가 고정된 **컨트롤**이라
        // 글자만 커지면 칸을 넘쳐 '오전' 이 "…" 으로, 분이 "0" 으로 잘린다(시뮬레이터
        // accessibility-extra-large 에서 확인). 본문 글자는 그대로 커지고 여기만 묶는다.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .padding(.horizontal, 12)
        .padding(.vertical, 24)
        // ⚠ **배경을 칠하지 말 것.** 안드로이드는 `wheelBackgroundColor = Color.Transparent`
        // 다(`AlarmTimePicker.kt:65`). `primaryContainer` 파란 박스를 두면 시각이 한 덩어리
        // 위젯처럼 보여, 화면의 주인공이어야 할 숫자가 배경에 갇힌다.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("시간 선택"))
    }

    /// 가용 폭에 비례한 휠 축소 배율. 안드로이드와 같은 식·같은 하한.
    private func wheelScale(for width: CGFloat) -> CGFloat {
        guard width > 0 else { return 1 }
        return min(max(width / Self.referenceWidth, Self.minimumScale), 1)
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
    /// 가용 폭에 따른 축소 배율. 상위 `TimeWheelPicker` 가 계산해 내려준다.
    var scale: CGFloat = 1

    /// 탭했을 때 뜨는 직접 입력 알럿의 제목(예: "시" / "분"). 비면 탭 입력을 열지 않는다.
    var typeInTitle: String?
    /// 직접 입력한 값을 실제 값으로 바꾼다. 시 칼럼은 12시간 표기를 24시간으로 되돌려야 해서
    /// 칼럼마다 규칙이 다르다 — 그래서 호출부가 준다.
    var applyTypedValue: ((Int) -> Void)?

    @State private var dragOffset: CGFloat = 0
    @GestureState private var isDragging: Bool = false
    @State private var selectionGenerator = UISelectionFeedbackGenerator()
    @State private var typeInOpen = false
    @State private var typeInDraft = ""


    private var itemHeight: CGFloat { TimeWheelPicker.itemHeight * scale }

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
                        .font(.pretendard(.bold, size: (clamped < 0.5 ? 57 : 45) * scale))
                        .monospacedDigit()
                        .foregroundStyle(theme.palette.onSurface.opacity(textAlpha(for: clamped)))
                        .frame(maxWidth: .infinity)
                        .frame(height: itemHeight)
                        .position(x: proxy.size.width / 2, y: yPosition)
                }
            }
            .contentShape(Rectangle())
            // ⚠ **탭이 드래그를 잡아먹지 않게 순서를 지킨다.** `.onTapGesture` 를
            // `.gesture(dragGesture)` **뒤에** 두면 SwiftUI 가 드래그를 우선 인식하고,
            // 손가락을 움직이지 않은 경우에만 탭으로 떨어진다.
            .gesture(dragGesture)
            .onTapGesture {
                guard typeInTitle != nil else { return }
                typeInDraft = ""
                typeInOpen = true
            }
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
        // 휠을 굴리지 않고 **숫자로 바로** 넣는 길. 멀리 있는 값(7시 → 11시)을 고를 때
        // 92pt 씩 끌지 않아도 된다.
        .alert(typeInTitle.map { "\($0) 직접 입력" } ?? "", isPresented: $typeInOpen) {
            TextField(typeInTitle ?? "", text: $typeInDraft)
                .keyboardType(.numberPad)
            Button("취소", role: .cancel) { }
            Button("확인") {
                // 범위를 벗어나면 **거절하지 않고 잘라서** 넣는다 — 여기서 튕기면
                // 사용자는 왜 안 되는지 모른 채 같은 값을 다시 넣는다(스누즈 알럿과 같은 규칙).
                guard let typed = Int(typeInDraft.filter(\.isNumber)) else { return }
                if let applyTypedValue {
                    applyTypedValue(typed)
                } else {
                    value = min(max(typed, range.lowerBound), range.upperBound)
                }
                selectionGenerator.selectionChanged()
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
                let snapStep = Self.snapStep(
                    dragOffset: dragOffset,
                    velocity: velocity,
                    itemHeight: itemHeight
                )
                // ⚠ **부호를 뒤집지 말 것 — 뒤집혀 있었다.**
                // 예전에는 `applyStep(-snapStep)` 이었다. 끌 때(`onChanged`)는 위로 끌면
                // 값이 **증가**하는데, 놓을 때만 반대로 적용돼서 **반 칸 이상 끌어 올린 뒤
                // 손을 떼면 값이 한 칸 도로 내려갔다** — 사용자에겐 "맞춰도 되돌아간다"
                // 로 보인다(2026-08-10 보고). 두 자리의 방향은 반드시 같아야 한다.
                if snapStep != 0 {
                    applyStep(snapStep)
                }
                withAnimation(.snappy(duration: 0.25)) {
                    dragOffset = 0
                }
                lastEmittedSteps = 0
            }

    }

    /// 손을 뗄 때 몇 칸 더 굴릴지 판정한다. **+ 는 값 증가(위로 끌기)** 다.
    ///
    /// 제스처 없이 검증할 수 있게 순수 함수로 뺐다 — 이 방향이 `onChanged` 와 어긋나면
    /// 휠이 되돌아간다(실제로 뒤집혀 있었다).
    ///
    /// ⚠ **한 칸만 굴리지 말 것 — 그게 "휠이 잘 안 돌아간다" 의 원인이었다.**
    /// 예전에는 아무리 세게 튕겨도 최대 한 칸이라, 7시에서 11시로 가려면 92pt 씩 네 번을
    /// 끌어야 했다. 안드로이드는 속도에 비례해 여러 칸을 굴린다
    /// (`ui/editor/DraggableTimeWheelColumn.kt` 의 `flingStepsFor`).
    ///
    /// - Parameter velocity: SwiftUI 는 px/s 가 아니라 `predictedEndTranslation - translation`
    ///   (남은 이동 거리)을 준다. UIKit 감속이 대략 0.15초이므로 `px/s ≈ 거리 / 0.15` 로 보고
    ///   안드로이드 계수를 환산했다 — 최소 속도 `itemHeight*4.2/s` → 거리 `itemHeight*0.63`,
    ///   칸수 `(|v|/h)*0.12` → `(|거리|/h)*0.8`.
    static func snapStep(dragOffset: CGFloat, velocity: CGFloat, itemHeight: CGFloat) -> Int {
        let flingDistance = itemHeight * 0.63
        if abs(velocity) >= flingDistance {
            let raw = max(Int(((abs(velocity) / itemHeight) * 0.8).rounded()), 1)
            let steps = min(raw, maxStepsPerFling)
            return velocity < 0 ? steps : -steps
        }
        // 튕기지 않았으면 반 칸 넘긴 쪽으로만 붙인다(안드로이드 0.45 와 같은 기준).
        if dragOffset <= -itemHeight * 0.45 { return 1 }
        if dragOffset >= itemHeight * 0.45 { return -1 }
        return 0
    }

    /// 한 번의 튕김으로 넘길 수 있는 최대 칸수. 안드로이드 `maxStepsPerGesture = 15` 와 같다.
    static let maxStepsPerFling = 15

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
    /// 가용 폭에 따른 축소 배율. 상위 `TimeWheelPicker` 가 계산해 내려준다.
    var scale: CGFloat = 1
    @State private var selectionGenerator = UISelectionFeedbackGenerator()

    private var itemHeight: CGFloat { TimeWheelPicker.itemHeight * scale }

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
            .font(.pretendard(selected ? .bold : .semibold, size: (selected ? 38 : 32) * scale))
            // 좁은 폭에서 "오전"/"오후" 가 "…" 으로 사라지지 않게 줄어들어 맞춘다.
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(theme.palette.onSurface.opacity(selected ? 1.0 : 0.18))
            .frame(maxWidth: .infinity)
    }
}

// MARK: - Colon

private struct ColonSeparator: View {
    @Environment(\.voiceAlarmTheme) private var theme
    /// 가용 폭에 따른 축소 배율. 상위 `TimeWheelPicker` 가 계산해 내려준다.
    var scale: CGFloat = 1

    var body: some View {
        Text(":")
            .font(.pretendard(.bold, size: 57 * scale))
            .foregroundStyle(theme.palette.onSurface)
            // 안드로이드는 36dp 폭을 준다(`ui/editor/AlarmTimePicker.kt`). 18 이면 절반이라
            // 시:분 사이가 붙어 보인다.
            .frame(width: 36 * scale)
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
