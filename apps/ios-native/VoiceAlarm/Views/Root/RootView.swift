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
    @EnvironmentObject private var versionGate: AppVersionGate
    @Environment(\.openURL) private var openURL
    @State private var onboardingCompleted: Bool?

    // 약관/개인정보 처리방침 외부 링크. Android `VoiceAlarmApp.kt:539`.
    private static let termsURL = URL(string: "https://alarm-talk.com/ko/terms")!
    private static let privacyURL = URL(string: "https://alarm-talk.com/ko/privacy")!

    var body: some View {
        Group {
            if versionGate.updateRequired {
                // 최소지원버전 미만 — 로그인 여부와 무관하게 앱 진입을 막고 업데이트만 유도.
                // Android `UpdateRequiredScreen` 게이팅과 동등.
                UpdateRequiredView(onUpdate: { openURL(versionGate.storeURL) })
            } else if !auth.isAuthenticated {
                AuthGateView()
            } else if auth.pendingDeletion {
                // 탈퇴 유예 상태 — 복구하거나 로그아웃하기 전까지 앱 진입을 막는다.
                // Android `AccountPendingDeletionScreen` 게이팅과 동등.
                AccountPendingDeletionView(
                    busy: auth.isBusy,
                    onRecover: { Task { await auth.cancelAccountDeletion() } },
                    onLogout: { auth.signOut() }
                )
            } else if auth.needsConsent {
                // 필수 약관 미동의 — 동의 전까지 앱 진입을 막는다.
                // Android `ConsentScreen` 게이팅과 동등.
                ConsentView(
                    busy: auth.isBusy,
                    onAgree: { marketingAgreed in
                        Task { await auth.submitConsents(marketingAgreed: marketingAgreed) }
                    },
                    onOpenTerms: { openURL(Self.termsURL) },
                    onOpenPrivacy: { openURL(Self.privacyURL) }
                )
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
