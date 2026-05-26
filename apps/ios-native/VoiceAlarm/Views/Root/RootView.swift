import SwiftUI

/// 최상위 라우터. 인증 + 온보딩 상태만 게이팅한다.
///
/// 분기 모델 (Android `App.kt` 의 진입 흐름과 동등)
///   1. 세션 없음 → `AuthGateView()` (Landing → Login)
///   2. 세션 있고 온보딩 미완료 → `OnboardingView` 단독 노출.
///      완료 여부는 Android 처럼 사용자 ID별로 저장한다.
///   3. 온보딩 완료 → `MainTabsView()`.
///      iOS 권한은 홈/알람/목소리 기능 진입 시점에 요청한다.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var onboardingCompleted: Bool?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                AuthGateView()
            } else if onboardingCompleted == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(VoiceAlarmTheme.background)
            } else if onboardingCompleted == false {
                NavigationStack {
                    OnboardingView(onComplete: completeOnboarding)
                }
            } else {
                MainTabsView()
            }
        }
        .task(id: auth.session?.user.id) {
            refreshOnboardingCompletion()
        }
    }

    private func refreshOnboardingCompletion() {
        guard let userID = auth.session?.user.id else {
            onboardingCompleted = nil
            return
        }
        onboardingCompleted = OnboardingCompletionStore().hasCompleted(userID: userID)
    }

    private func completeOnboarding() {
        if let userID = auth.session?.user.id {
            OnboardingCompletionStore().markCompleted(userID: userID)
        }
        onboardingCompleted = true
    }
}

#if DEBUG
#Preview("RootView (light)") {
    RootView()
        .voiceAlarmPreviewEnvironment()
}

#Preview("RootView (dark)") {
    RootView()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
