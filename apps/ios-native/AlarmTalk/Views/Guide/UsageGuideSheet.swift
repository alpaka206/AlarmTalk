import SwiftUI

/// 사용 가이드 한 단계의 내용.
struct UsageGuideStep {
    let systemImage: String
    let title: String
    let body: String
}

/// 첫 사용 단계 가이드 시트.
///
/// handoff 프로토타입의 코치마크("가이드 n/N" 스텝 표시 + 건너뛰기/다음/시작하기)를
/// 시트 형태로 옮긴 것. 알람 만들기·목소리 만들기처럼 폼이 긴 화면은 특정 요소
/// 스포트라이트 대신 단계 카드로 흐름을 안내한다. 노출 이력은 호출자가
/// `UsageGuideStore` 로 관리한다 (시트 onDismiss 에서 markSeen).
struct UsageGuideSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let steps: [UsageGuideStep]
    /// "건너뛰기" 또는 마지막 단계의 "시작하기"를 누르면 호출. 호출자가 시트를 닫는다.
    let onFinish: () -> Void

    @State private var index = 0

    private var isLastStep: Bool { index >= steps.count - 1 }

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Text("가이드 \(index + 1) / \(steps.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.palette.primary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(theme.palette.primaryContainer, in: Capsule())
                Spacer()
                Button("건너뛰기", action: onFinish)
                    .font(.subheadline)
                    .tint(theme.palette.onSurfaceVariant)
            }

            TabView(selection: $index) {
                ForEach(Array(steps.enumerated()), id: \.offset) { offset, step in
                    VStack(spacing: 14) {
                        ZStack {
                            Circle()
                                .fill(theme.palette.primaryContainer)
                                .frame(width: 84, height: 84)
                            Image(systemName: step.systemImage)
                                .font(.system(size: 34, weight: .semibold))
                                .foregroundStyle(theme.palette.primary)
                        }
                        Text(step.title)
                            .font(.title3.weight(.bold))
                            .multilineTextAlignment(.center)
                        Text(step.body)
                            .font(.callout)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            HStack(spacing: 7) {
                ForEach(steps.indices, id: \.self) { dot in
                    Circle()
                        .fill(dot == index ? theme.palette.primary : theme.palette.outlineVariant)
                        .frame(width: dot == index ? 9 : 7, height: dot == index ? 9 : 7)
                }
            }

            Button {
                if isLastStep {
                    onFinish()
                } else {
                    withAnimation { index += 1 }
                }
            } label: {
                Text(isLastStep ? "시작하기" : "다음")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
        }
        .padding(20)
        .presentationDetents([.height(430)])
        .presentationDragIndicator(.visible)
    }
}

#if DEBUG
#Preview("UsageGuideSheet") {
    Color.gray.sheet(isPresented: .constant(true)) {
        UsageGuideSheet(
            steps: [
                UsageGuideStep(
                    systemImage: "clock.fill",
                    title: "시간과 반복부터",
                    body: "휠을 돌려 시각을 맞추고 반복할 요일을 골라요."
                ),
                UsageGuideStep(
                    systemImage: "waveform",
                    title: "재생 방식을 골라요",
                    body: "'알람 + 음성'을 고르면 등록한 목소리가 함께 울려요."
                ),
            ],
            onFinish: {}
        )
    }
}
#endif

// MARK: - 앵커형 스포트라이트 코치마크 (Android `ui/guide/CoachMarkOverlay.kt` parity)
//
// `UsageGuideSheet`(중앙 카드 캐러셀)는 폼이 긴 화면(목소리 만들기 등)용 — Android
// `UsageGuideOverlay`/`UsageGuideDialog` 와 대응. 아래 코치마크는 홈·목소리 등록처럼
// 실제 컨트롤을 가리켜야 하는 화면용으로, Android `CoachMarkOverlay` 와 동작이 같다:
// 어두운 스크림에 대상 위치만 구멍을 뚫고(동심 라운드 + 하이라이트 보더) 그 위/아래에
// 설명 카드를 붙인다. 호스트(탭 화면)가 자손에 `coachMarkTarget(_:)` 으로 대상을
// 등록하고 루트에 `coachMarkOverlay(steps:isPresented:onFinish:)` 를 얹어 쓴다.

/// 코치마크 한 단계 — [targetKey] 로 등록된 컨트롤 위치에 스포트라이트를 띄우고
/// 그 옆에 설명 카드를 붙인다. Android `CoachMarkStep`(targetKey/title/body) 와 1:1.
struct CoachMarkStep {
    let targetKey: String
    let title: String
    let body: String
}

extension CoachMarkStep {
    /// 스포트라이트 대상 키 — Android `GUIDE_TARGET_*`(AlarmListScreen.kt:49-53) 와 동일.
    enum Target {
        static let homeHero = "home_next_alarm"
        static let homeQuick = "home_quick_start"
        static let voiceCreate = "voice_register_create"
    }

    /// 홈 탭 첫 방문 코치마크 — Android `homeCoachSteps`(AlarmListScreen.kt:139-150) parity.
    static let homeSteps: [CoachMarkStep] = [
        CoachMarkStep(
            targetKey: Target.homeHero,
            title: "다음 알람을 한눈에",
            body: "다음에 울릴 알람을 여기서 바로 볼 수 있어요."
        ),
        CoachMarkStep(
            targetKey: Target.homeQuick,
            title: "여기서 바로 시작해요",
            body: "목소리를 만들고 알람을 추가하는 건 여기서 시작해요."
        ),
    ]

    /// 목소리 탭 첫 방문 코치마크 — Android `voiceRegisterCoachSteps`(AlarmListScreen.kt:151-157) parity.
    static let voiceRegisterSteps: [CoachMarkStep] = [
        CoachMarkStep(
            targetKey: Target.voiceCreate,
            title: "내 목소리를 만들어요",
            body: "내 목소리를 만들어 두면, 그 목소리로 알람이 깨워줘요."
        ),
    ]
}

/// 코치마크 대상 위치 — [coachMarkTarget] 로 등록되고 [coachMarkOverlay] 가 읽어 그린다.
/// Android `CoachMarkRegistry`(bounds + radii) 의 SwiftUI PreferenceKey 판.
struct CoachMarkAnchor {
    let bounds: Anchor<CGRect>
    /// 대상의 모서리 반경 — 구멍 라운드를 대상과 동심(concentric)으로 맞추는 데 쓴다.
    let cornerRadius: CGFloat
}

private struct CoachMarkAnchorKey: PreferenceKey {
    static let defaultValue: [String: CoachMarkAnchor] = [:]
    static func reduce(value: inout [String: CoachMarkAnchor], nextValue: () -> [String: CoachMarkAnchor]) {
        value.merge(nextValue()) { _, new in new }
    }
}

private struct CoachMarkCardHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

extension View {
    /// 이 뷰를 [key] 코치마크의 스포트라이트 대상으로 등록한다. [cornerRadius] 는 대상의
    /// 모서리 반경 — 구멍 라운드를 대상과 평행하게 맞춘다(카드면 그 카드 shape dp,
    /// pill/원형이면 큰 값, 모르면 기본 16). Android `Modifier.coachMarkTarget` parity.
    func coachMarkTarget(_ key: String, cornerRadius: CGFloat = 16) -> some View {
        anchorPreference(key: CoachMarkAnchorKey.self, value: .bounds) { anchor in
            [key: CoachMarkAnchor(bounds: anchor, cornerRadius: cornerRadius)]
        }
    }

    /// 위치 앵커형 첫 사용 가이드 오버레이를 이 뷰 위에 얹는다. 대상은 자손이
    /// [coachMarkTarget] 으로 등록한다. Android `CoachMarkOverlay` 와 동작 동일.
    /// 화면 전체를 덮도록 탭 콘텐츠 루트(스크롤 컨테이너)에 적용한다.
    func coachMarkOverlay(
        steps: [CoachMarkStep],
        isPresented: Binding<Bool>,
        onFinish: @escaping () -> Void
    ) -> some View {
        overlayPreferenceValue(CoachMarkAnchorKey.self) { anchors in
            GeometryReader { proxy in
                if isPresented.wrappedValue && !steps.isEmpty {
                    CoachMarkOverlay(
                        steps: steps,
                        frames: anchors.mapValues { proxy[$0.bounds] },
                        radii: anchors.mapValues { $0.cornerRadius },
                        containerSize: proxy.size,
                        onFinish: onFinish
                    )
                }
            }
        }
    }
}

/// 스포트라이트 코치마크 본체 — 스크림 + 구멍 + 하이라이트 보더 + 설명 카드.
private struct CoachMarkOverlay: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let steps: [CoachMarkStep]
    /// 대상 키 → 루트 좌표 사각형 (이미 GeometryProxy 로 해석됨).
    let frames: [String: CGRect]
    let radii: [String: CGFloat]
    let containerSize: CGSize
    let onFinish: () -> Void

    @State private var index = 0
    @State private var cardHeight: CGFloat = 0

    /// Android `WakerScrimColor`(0xBD05080E) — 테마 무관 고정 딤. 전역 토큰이 아직
    /// 없어 코치마크 전용으로 여기 둔다(디자인 토큰 정리 시 공용 토큰으로 승격).
    private static let scrim = Color(.sRGB, red: 5 / 255, green: 8 / 255, blue: 14 / 255, opacity: 0.741)
    private let holePadding: CGFloat = 6
    private let cardGap: CGFloat = 12

    private var clampedIndex: Int { min(max(index, 0), steps.count - 1) }
    private var step: CoachMarkStep { steps[clampedIndex] }
    private var isLast: Bool { clampedIndex >= steps.count - 1 }

    /// 대상보다 holePadding 만큼 부풀린 구멍 사각형. 미등록 대상이면 nil(중앙 폴백).
    private var hole: CGRect? {
        guard let frame = frames[step.targetKey] else { return nil }
        return frame.insetBy(dx: -holePadding, dy: -holePadding)
    }

    /// 동심으로 보이도록 구멍 반경 = 대상 반경 + holePadding. 짧은 변 절반으로 클램프.
    private var holeCornerRadius: CGFloat {
        guard let hole else { return 16 }
        let base = (radii[step.targetKey] ?? 16) + holePadding
        return min(base, min(hole.width, hole.height) / 2)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            scrimWithHole
            holeBorder
            cardLayer
        }
        .frame(width: containerSize.width, height: containerSize.height)
        .animation(.easeInOut(duration: 0.32), value: clampedIndex)
    }

    private var scrimWithHole: some View {
        Rectangle()
            .fill(Self.scrim)
            .overlay {
                if let hole {
                    RoundedRectangle(cornerRadius: holeCornerRadius, style: .continuous)
                        .frame(width: hole.width, height: hole.height)
                        .position(x: hole.midX, y: hole.midY)
                        .blendMode(.destinationOut)
                }
            }
            .compositingGroup()
            .contentShape(Rectangle())
            .onTapGesture {} // 스크림 탭이 뒤 화면으로 통과하지 않게 (Android clickable parity)
    }

    @ViewBuilder
    private var holeBorder: some View {
        if let hole {
            RoundedRectangle(cornerRadius: holeCornerRadius, style: .continuous)
                .stroke(theme.palette.primary, lineWidth: 2)
                .frame(width: hole.width, height: hole.height)
                .position(x: hole.midX, y: hole.midY)
                .allowsHitTesting(false)
        }
    }

    private var cardLayer: some View {
        let cardWidth = min(containerSize.width - 40, 480)
        return CoachMarkCardBody(
            step: step,
            stepIndex: clampedIndex,
            stepCount: steps.count,
            isLast: isLast,
            onSkip: onFinish,
            onNext: advance
        )
        .frame(width: cardWidth)
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: CoachMarkCardHeightKey.self, value: geo.size.height)
            }
        )
        .position(x: containerSize.width / 2, y: cardTopY + cardHeight / 2)
        .opacity(cardHeight == 0 ? 0 : 1) // 높이 측정 전 한 프레임 깜빡임 숨김
        .onPreferenceChange(CoachMarkCardHeightKey.self) { cardHeight = $0 }
    }

    /// 카드 상단 y — 구멍 아래 공간이 충분하면 아래, 아니면 위. 화면 밖으로 나가지 않게 클램프.
    private var cardTopY: CGFloat {
        let maxY = max(containerSize.height - cardHeight, 0)
        guard let hole else {
            return min(max((containerSize.height - cardHeight) / 2, 0), maxY)
        }
        let below = hole.maxY + cardGap
        let above = hole.minY - cardGap - cardHeight
        let y: CGFloat = (below + cardHeight <= containerSize.height) || (above < 0) ? below : above
        return min(max(y, 0), maxY)
    }

    private func advance() {
        if isLast {
            onFinish()
        } else {
            index += 1
        }
    }
}

/// 설명 카드 — 진행 표시(단계>1) + 제목/본문 + 건너뛰기/다음 액션.
/// Android `CoachMarkCard`(CoachMarkOverlay.kt:222-314) 의 레이아웃·여백과 동일.
private struct CoachMarkCardBody: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let step: CoachMarkStep
    let stepIndex: Int
    let stepCount: Int
    let isLast: Bool
    let onSkip: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 단계가 여럿일 때만 진행 표시(가이드 N / M). 한 단계뿐이면 생략.
            if stepCount > 1 {
                Text("가이드 \(stepIndex + 1) / \(stepCount)")
                    .font(.pretendard(.semibold, size: 12))
                    .foregroundStyle(theme.palette.primary)
                Spacer().frame(height: 8)
            }
            Text(step.title)
                .font(.pretendard(.bold, size: 16))
                .foregroundStyle(theme.palette.onSurface)
            Spacer().frame(height: 6)
            Text(step.body)
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
            Spacer().frame(height: 16)
            HStack {
                Button("건너뛰기", action: onSkip)
                    .font(theme.typography.labelLarge)
                    .tint(theme.palette.onSurfaceVariant)
                Spacer()
                Button(action: onNext) {
                    Text(isLast ? "시작하기" : "다음")
                        .font(theme.typography.labelLarge)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                .fill(theme.palette.surface)
        )
    }
}
