import SwiftUI

/// 첫 로그인 후 노출되는 3페이지 페이저.
///
/// Android `apps/android-native/.../ui/onboarding/OnboardingScreen.kt:63-179` 의
/// 카피를 그대로 옮겼다. 첫 페이지 = 목소리, 두 번째 = 가족, 세 번째 = 캐릭터.
/// dot indicator + skip + 다음/시작하기 버튼을 모두 포함한다.
///
/// 사용처
///   1. 로그인 직후 `RootView` 가 `onboarding_completed_v1` AppStorage 가 false 일
///      때 push 한다.
///   2. 랜딩 화면에서 "계정 만들기" 흐름의 일부로도 진입 가능 (선택).
///
/// 진행 모델
///   `TabView(selection: $page).tabViewStyle(.page)` 로 swipe + tap 모두 지원.
///   "다음" 누르면 page += 1, 마지막 페이지에서는 onComplete 가 호출되어 외부
///   AppStorage 가 true 로 바뀌고 본 화면이 사라진다.
struct OnboardingView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    /// 외부에서 완료를 받는 콜백. RootView 가 `@AppStorage` 변경을 담당하고,
    /// LandingView 에서 "처음 사용" 진입 흐름에서는 navigation pop 을 한다.
    var onComplete: (() -> Void)?

    @State private var page = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button("건너뛰기", action: complete)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .font(theme.typography.labelLarge)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .padding(.top, 4)

            TabView(selection: $page) {
                ForEach(Array(OnboardingPage.all.enumerated()), id: \.offset) { index, item in
                    OnboardingPageContent(page: item, pageIndex: index)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .indexViewStyle(.page(backgroundDisplayMode: .never))

            DotIndicator(current: page, total: OnboardingPage.all.count)
                .padding(.vertical, 12)

            Button(action: nextOrComplete) {
                Text(page == OnboardingPage.all.count - 1 ? "시작하기" : "다음")
                    .font(theme.typography.labelLarge)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .foregroundStyle(theme.palette.onPrimary)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
            .padding(.horizontal, 32)
            .padding(.vertical, 16)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
    }

    private func nextOrComplete() {
        if page < OnboardingPage.all.count - 1 {
            withAnimation(.easeInOut(duration: 0.18)) {
                page += 1
            }
        } else {
            complete()
        }
    }

    private func complete() {
        if let onComplete {
            onComplete()
        } else {
            dismiss()
        }
    }
}

/// 한 페이지에 담기는 카피 + 일러스트 정의. Android `OnboardingPages:45-61` 와
/// 동일한 카피, 동일한 순서를 유지한다.
private struct OnboardingPage {
    let systemImage: String
    let title: String
    let description: String
    /// 페이지별 컬러 강조. iOS 는 Compose 의 `secondaryContainer/tertiaryContainer`
    /// 대신 palette 의 primaryContainer / tertiaryContainer 를 쓴다.
    let useTertiary: Bool

    static let all: [OnboardingPage] = [
        OnboardingPage(
            systemImage: "mic.fill",
            title: "좋아하는 목소리로 깨어나요",
            description: "녹음하거나 만든 목소리로\n내 알람을 울릴 수 있어요.",
            useTertiary: false
        ),
        OnboardingPage(
            systemImage: "person.2.fill",
            title: "소중한 사람들과 함께",
            description: "목소리와 메시지를 주고받고\n서로의 아침을 챙길 수 있어요.",
            useTertiary: false
        ),
        OnboardingPage(
            systemImage: "sparkles",
            title: "알람을 끄며 함께 성장해요",
            description: "하루를 시작할 때마다\n캐릭터의 성장 기록이 쌓여요.",
            useTertiary: true
        ),
    ]
}

private struct OnboardingPageContent: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let page: OnboardingPage
    let pageIndex: Int

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            ZStack {
                Circle()
                    .fill(page.useTertiary ? theme.palette.tertiaryContainer : theme.palette.secondaryContainer)
                Image(systemName: page.systemImage)
                    .font(.system(size: 56, weight: .semibold))
                    .foregroundStyle(page.useTertiary ? theme.palette.onTertiaryContainer : theme.palette.onSecondaryContainer)
            }
            .frame(width: 112, height: 112)

            Spacer().frame(height: 28)

            Text(page.title)
                .font(theme.typography.headlineMedium)
                .foregroundStyle(theme.palette.onBackground)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 14)

            Text(page.description)
                .font(theme.typography.bodyLarge)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// dot indicator. Android `repeat(size) { Surface(size = if active 10 else 8 dp) }`
/// 와 같은 모양 — active 점은 약간 크고 primary 색이다.
private struct DotIndicator: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                let active = current == index
                Circle()
                    .fill(active ? theme.palette.primary : theme.palette.outlineVariant)
                    .frame(width: active ? 10 : 8, height: active ? 10 : 8)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

#if DEBUG
#Preview("OnboardingView (light)") {
    OnboardingView(onComplete: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("OnboardingView (dark)") {
    OnboardingView(onComplete: {})
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
