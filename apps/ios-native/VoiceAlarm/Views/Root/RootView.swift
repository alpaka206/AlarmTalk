import SwiftUI

/// 최상위 라우터. 인증 + 온보딩 + 권한 단계를 순서대로 게이팅한다.
///
/// 분기 모델 (Android `App.kt` 의 진입 흐름과 동등)
///   1. 세션 없음 → `AuthGateView()` (Landing → Login)
///   2. 세션 있고 온보딩 미완료 → `OnboardingView` 단독 노출.
///      온보딩 완료 콜백이 `@AppStorage("onboarding_completed_v1")` 를 true 로
///      바꾸면 본 View 가 자동으로 다음 단계로 전환한다.
///   3. 온보딩 완료 → `LoginPermissionGateView { MainTabsView() }`
///      — 본문은 MainTabsView 이고, 권한 부족 시 시트로 안내된다.
///
/// `@AppStorage` 키는 향후 onboarding v2 가 도입되면 새 키를 사용해 기존 사용자
/// 에게 한 번 더 보여줄 수 있도록 버전을 suffix 로 둔다.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @AppStorage("onboarding_completed_v1") private var onboardingCompleted: Bool = false

    var body: some View {
        if !auth.isAuthenticated {
            AuthGateView()
        } else if !onboardingCompleted {
            NavigationStack {
                OnboardingView(onComplete: { onboardingCompleted = true })
            }
        } else {
            LoginPermissionGateView {
                MainTabsView()
            }
        }
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
