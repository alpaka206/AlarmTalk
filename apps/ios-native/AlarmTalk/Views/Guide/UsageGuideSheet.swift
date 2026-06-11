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
                    body: "'알람음+음성'을 고르면 등록한 목소리가 함께 울려요."
                ),
            ],
            onFinish: {}
        )
    }
}
#endif
