import SwiftUI

/// 휠이 자기 폭을 위로 보고한다(축소 배율 계산용).
private struct TimeWheelWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

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
/// - 드래그 거리에 따른 자석 스냅 (항목 높이 `itemHeight`).
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

    /// 축소 배율을 정하려고 **폭만** 잰다. 높이는 우리가 정하므로 순환하지 않는다.
    @State private var measuredWidth: CGFloat = 0
    /// 지금 그 자리에서 고쳐 쓰는 칼럼("시"/"분"). 두 칼럼이 **함께** 본다 —
    /// 한쪽을 고치는 동안 양쪽의 회색 이웃 숫자를 숨기기 위해서다.
    @State private var editingColumn: String?

    var body: some View {
        // ⚠ **폭에 맞춰 휠 타이포를 줄인다.** 좁은 화면(360pt급)에서 '오전/오후' 고정폭 +
        // 57pt 숫자가 컬럼 폭을 넘어 분 숫자 오른쪽이 잘렸다. 안드로이드는
        // `BoxWithConstraints` 로 같은 축소를 이미 하고 있었고 iOS 에만 없었다.
        //
        // ⚠ **`GeometryReader` 로 감싸지 말 것 — 아래에 빈 공간이 생긴다.** `GeometryReader`
        // 는 주어진 자리를 전부 차지하고 자식을 **위쪽 정렬**로 놓는다. 바깥 높이를
        // 축소 전 값(`itemHeight*3`)으로 두고 안쪽만 배율을 곱하면, 그 차이(392pt 기준
        // 폭이 좁을수록 커진다)가 **휠 아래 죽은 공간**으로 남는다 — 실기에서 시각과
        // 반복 카드 사이가 안드로이드의 44pt 대신 100pt 가까이 벌어졌다
        // (2026-08-10 지적 "시간 돌리는 거랑 날짜가 살짝 거리가 멀어 보인다").
        // 폭은 배경으로 재고 높이는 **같은 배율을 곱해** 준다.
        let scale = wheelScale(for: measuredWidth)
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
                },
                editingColumn: $editingColumn
            )
            .frame(maxWidth: .infinity)

            ColonSeparator(scale: scale)

            DraggableNumberColumn(
                value: $minute,
                range: 0...59,
                formatter: { String(format: "%02d", $0) },
                scale: scale,
                typeInTitle: "분",
                applyTypedValue: { typed in minute = min(max(typed, 0), 59) },
                editingColumn: $editingColumn
            )
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        // 높이도 **같은 배율**을 따른다(안드로이드 `scaledItemHeight * 3` 과 같다).
        .frame(height: Self.itemHeight * 3 * scale)
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: TimeWheelWidthKey.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(TimeWheelWidthKey.self) { measuredWidth = $0 }
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

    /// 탭했을 때 **그 자리에서** 고쳐 쓸 수 있는 칼럼인지, 그리고 그 이름("시"/"분").
    /// 비면 탭 입력을 열지 않는다(오전/오후 칼럼).
    var typeInTitle: String?
    /// 직접 입력한 값을 실제 값으로 바꾼다. 시 칼럼은 12시간 표기를 24시간으로 되돌려야 해서
    /// 칼럼마다 규칙이 다르다 — 그래서 호출부가 준다.
    var applyTypedValue: ((Int) -> Void)?
    /// 지금 어느 칼럼을 고쳐 쓰는 중인가(`typeInTitle` 값). 두 칼럼이 공유한다 —
    /// 한쪽을 고치는 동안 **양쪽의** 회색 이웃 숫자를 숨기기 위해서다.
    @Binding var editingColumn: String?

    @State private var dragOffset: CGFloat = 0
    @State private var selectionGenerator = UISelectionFeedbackGenerator()
    @State private var typeInDraft = ""
    @FocusState private var typeInFocused: Bool
    /// 손을 뗀 뒤 굴러가서 멎는 애니메이션(`TimeWheelSettle.swift` 주석 참조).
    @State private var settleDriver = WheelSettleDriver()

    private var itemHeight: CGFloat { TimeWheelPicker.itemHeight * scale }
    /// 이 칼럼을 고쳐 쓰는 중인가.
    private var isEditing: Bool { typeInTitle != nil && editingColumn == typeInTitle }
    /// 둘 중 어느 칼럼이든 고쳐 쓰는 중인가.
    private var anyEditing: Bool { editingColumn != nil }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                let centerY = proxy.size.height / 2

                ForEach(-1...1, id: \.self) { offset in
                    // ⚠ **고쳐 쓰는 동안에는 위아래 회색 숫자를 숨긴다**(2026-08-11 요청).
                    // 큰 입력 글자 옆에 흐린 숫자가 남아 있으면 어느 게 지금 치는 값인지
                    // 헷갈리고, 커서가 그 사이에 끼어 보인다.
                    if offset == 0 || !anyEditing {
                        row(offset: offset, centerY: centerY, width: proxy.size.width)
                    }
                }
            }
            .contentShape(Rectangle())
            // ⚠ **탭이 드래그를 잡아먹지 않게 순서를 지킨다.** `.onTapGesture` 를
            // `.gesture(dragGesture)` **뒤에** 두면 SwiftUI 가 드래그를 우선 인식하고,
            // 손가락을 움직이지 않은 경우에만 탭으로 떨어진다.
            //
            // ⚠ 고쳐 쓰는 동안에는 휠 드래그를 받지 않는다(`.subviews` = 자식만) —
            // 안 그러면 입력창을 누르는 순간 휠이 같이 끌린다.
            .gesture(dragGesture, including: anyEditing ? .subviews : .all)
            .onTapGesture {
                guard typeInTitle != nil else { return }
                beginTypeIn()
            }
            // 고쳐 쓰는 동안에는 위아래 페이드를 걸지 않는다 — 커서와 글자 윗동이 깎인다.
            .mask {
                if anyEditing { Color.white } else { fadeMask }
            }
        }
        .frame(height: itemHeight * 3)
        // 화면이 사라지면 굴리기를 멈춘다 — 안 그러면 `CADisplayLink` 가 사라진 뷰의
        // 상태를 계속 건드린다.
        .onDisappear { settleDriver.cancel() }
        .accessibilityElement()
        .accessibilityLabel(Text(formatter(value)))
        // UI 테스트가 이 칼럼 하나를 집어 값 변화를 읽는다(`TimeWheelFlingUITests`).
        // 라벨은 값 자체라 칼럼을 특정할 수 없어 식별자를 따로 둔다.
        .accessibilityIdentifier(typeInTitle.map { "timeWheel.\($0)" } ?? "timeWheel")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: applyStep(1)
            case .decrement: applyStep(-1)
            @unknown default: break
            }
        }
    }

    // MARK: - 행 하나 / 그 자리 입력

    /// 휠의 한 줄. 가운데 줄은 고쳐 쓰는 중이면 **입력창**이 된다.
    @ViewBuilder
    private func row(offset: Int, centerY: CGFloat, width: CGFloat) -> some View {
        let yPosition = centerY + CGFloat(offset) * itemHeight + dragOffset
        let normalized = abs(CGFloat(offset) * itemHeight + dragOffset) / itemHeight
        let clamped = min(normalized, 1.4)

        Group {
            if offset == 0, isEditing {
                typeInField
            } else {
                // ⚠ **선택/인접 크기가 다르다.** 안드로이드는 선택 `displayLarge`(57),
                // 인접 `displayMedium`(45)을 쓴다(`ui/editor/DraggableTimeWheelColumn.kt`).
                // 같은 크기로 그리면 알파만으로 초점을 만들어야 해서, 스크롤 중에
                // 어느 숫자가 골라질 것인지가 흐릿하다.
                //
                // ⚠ 글꼴은 **Pretendard** 다. `design: .rounded`(SF Rounded)로 두면
                // 이 화면만 다른 서체가 되어 앱에서 가장 큰 글자가 튄다.
                Text(formatter(wrap(value + offset)))
                    .font(.pretendardFixed(.bold, size: (clamped < 0.5 ? 57 : 45) * scale))
                    .monospacedDigit()
                    .foregroundStyle(theme.palette.onSurface.opacity(textAlpha(for: clamped)))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: itemHeight)
        .position(x: width / 2, y: yPosition)
    }

    /// 숫자를 **그 자리에서** 고쳐 쓰는 입력창.
    ///
    /// ⚠ **알럿으로 되돌리지 말 것**(2026-08-11 요청). 예전에는 숫자를 누르면 '시 직접 입력'
    /// 알럿이 떠서, 고치려는 숫자가 알럿에 가리고 확인까지 두 번을 더 눌러야 했다.
    /// 지금은 그 숫자가 그대로 입력창이 된다 — 누르고, 치고, 완료다.
    private var typeInField: some View {
        TextField(
            "",
            text: $typeInDraft,
            // 비워 두면 큰 글자 자리가 텅 비어 무엇을 치는 자리인지 알 수 없다 —
            // 지금 값을 흐리게 깔아 둔다(치면 대체된다).
            prompt: Text(formatter(value))
                .foregroundColor(theme.palette.onSurface.opacity(0.28))
        )
        .keyboardType(.numberPad)
        .multilineTextAlignment(.center)
        .font(.pretendardFixed(.bold, size: 57 * scale))
        .monospacedDigit()
        .foregroundStyle(theme.palette.onSurface)
        .tint(theme.palette.primary)
        .focused($typeInFocused)
        .onChange(of: typeInDraft) { _, next in
            // 두 자리까지만 — 세 자리를 받아 봐야 어차피 잘린다.
            let digits = String(next.filter(\.isNumber).prefix(2))
            if digits != next { typeInDraft = digits }
        }
        // 포커스를 잃으면(바깥 탭) 그때까지 친 값을 넣는다 —
        // 취소 버튼이 없으므로 여기서 안 받으면 친 게 조용히 사라진다.
        .onChange(of: typeInFocused) { _, focused in
            if !focused { commitTypeIn() }
        }
        // ⚠ **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시).
        // `@FocusState` 를 푸는 것만으로는 안 된다 — 인라인 입력칸이 **떠 있는 동안**
        // SwiftUI 가 곧바로 다시 focus 해서 키보드가 그대로다(시뮬레이터 확인).
        // `commitTypeIn` 이 `editingColumn` 을 닫아 입력칸 자체를 걷어내며, 그때까지 친
        // 값도 함께 확정한다(취소 버튼이 없으므로 버리면 조용히 사라진다).
        .onReceive(NotificationCenter.default.publisher(for: .alarmTalkEndEditing)) { _ in
            guard isEditing else { return }
            typeInFocused = false
            commitTypeIn()
        }
        // ⚠ **다른 칼럼으로 옮겨갈 때는 이 경로로 들어온다 — 포커스 변화로는 못 잡는다.**
        // 시를 치다가 분을 누르면 `editingColumn` 이 바뀌면서 이 입력창이 **뷰 트리에서
        // 사라지는데**, 그때 `onChange(of: typeInFocused)` 는 오지 않는다(바인딩이 함께
        // 헐린다). 그래서 친 값이 조용히 버려지고 원래 값으로 되돌아갔다
        // (2026-08-11 지적 "분 누르면 시간에 써놨던 게 저장 안 되고 롤백된다").
        // 사라질 때 한 번 더 확정한다 — `commitTypeIn` 은 draft 를 비우고 시작하므로
        // 위 경로와 겹쳐 불려도 두 번 적용되지 않는다.
        .onDisappear { commitTypeIn() }
        // ⚠ **키보드 툴바 '완료' 를 되살리지 말 것**(2026-08-11 요청).
        // 숫자 키패드에 리턴 키가 없어 툴바를 냈었는데, 누를 곳이 하나 더 생겼을 뿐이다 —
        // **다른 곳을 누르면 끝난다**(편집기 루트의 `simultaneousGesture` 가 first responder 를
        // 내려놓고, 그 순간 `commitTypeIn` 이 값을 넣는다). 툴바가 있으면 키패드 위에 바가
        // 한 겹 더 붙어 화면도 그만큼 가린다.
    }

    private func beginTypeIn() {
        settleDriver.cancel()
        dragOffset = 0
        typeInDraft = ""
        editingColumn = typeInTitle
        typeInFocused = true
    }

    private func commitTypeIn() {
        let draft = typeInDraft
        typeInDraft = ""
        if editingColumn == typeInTitle { editingColumn = nil }
        // 범위를 벗어나면 **거절하지 않고 잘라서** 넣는다 — 여기서 튕기면
        // 사용자는 왜 안 되는지 모른 채 같은 값을 다시 넣는다(스누즈 알럿과 같은 규칙).
        guard let typed = Int(draft.filter(\.isNumber)) else { return }
        if let applyTypedValue {
            applyTypedValue(typed)
        } else {
            value = min(max(typed, range.lowerBound), range.upperBound)
        }
        selectionGenerator.selectionChanged()
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { gesture in
                // 굴러가는 중에 손을 대면 **그 자리에서 잡힌다**(안드로이드 `settleJob?.cancel()`).
                settleDriver.cancel()
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
                //
                // ⚠ **여기서 `applyStep(snapStep)` 으로 한꺼번에 넘기지 말 것.**
                // 그러면 세게 튕겼을 때 숫자가 굴러가지 않고 **순간이동**한다
                // (2026-08-11 지적). 칸 경계를 지날 때마다 한 칸씩 넘기는 건 정착
                // 구동부(TimeWheelSettle.swift)가 맡는다 — 안드로이드 `animateWheelSettle`
                // 과 같은 곡선·같은 시간이다.
                settleDriver.start(
                    from: dragOffset,
                    steps: snapStep,
                    itemHeight: itemHeight,
                    onStep: { applyStep($0) },
                    onOffset: { dragOffset = $0 }
                )
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
    ///   안드로이드 계수를 환산한 값이 출발점이었다 — 최소 속도 `itemHeight*4.2/s` →
    ///   거리 `itemHeight*0.63`, 칸수 `(|v|/h)*0.12` → `(|거리|/h)*0.8`.
    ///
    /// ⚠ **이제 두 앱의 숫자는 각자 조율한다.** 2026-08-15 에 안드로이드만 0.12 → 0.09 로
    /// 낮췄다("안드로이드 휠 돌릴 때 너무 많이 넘어가져" — iOS 는 그대로가 좋다고 확인됨).
    /// 들어오는 양 자체가 다른 값(px/s vs 남은 거리)이라 한쪽 숫자를 그대로 옮기면 안 된다.
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
                // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                .contentShape(Rectangle())
                .onTapGesture { setIsPM(false) }

            label(title: "오후", selected: isPM)
                .frame(height: itemHeight)
                .contentShape(Rectangle())
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
            .font(.pretendardFixed(selected ? .bold : .semibold, size: (selected ? 38 : 32) * scale))
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
            .font(.pretendardFixed(.bold, size: 57 * scale))
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
