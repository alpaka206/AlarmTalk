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
    /// 온보딩 완료 후 기본 목소리를 한 번이라도 골랐는지. 안 골랐으면 `VoiceSetupView` 노출.
    /// Android `MainViewModel.showVoiceSetup`(= !hasChosen) 게이팅 미러.
    @State private var voiceSetupDone: Bool?
    /// 동의 화면에서 띄우는 인앱 약관 뷰어.
    @State private var legalDocument: LegalDocumentTarget?

    struct LegalDocumentTarget: Identifiable, Hashable {
        let title: String
        let url: URL
        var id: String { url.absoluteString }
    }

    // 약관/개인정보 처리방침 외부 링크. Android `AlarmTalkApp.kt:539`.
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
            } else if !auth.consentStatusChecked {
                // 동의 확인 응답 전에는 온보딩·홈을 아예 그리지 않는다. 응답 전 기본값
                // `false` 가 '아니오' 와 구분되지 않아, 그 틈에 1회성 오버레이(웰컴 프로모·
                // 첫 권한 안내)가 떠서 소진 플래그까지 태우고 뒤늦게 온 차단 화면이 그
                // 위를 덮는다(CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」).
                //
                // ⚠ **이 로딩 화면에는 뒤로가기 차단을 두지 않는다.** 그 가드는 화면에
                // 정식 선택지가 있을 때 실수로 나가는 걸 막는 장치인데, 응답을 기다리는
                // 화면에는 지킬 선택지가 없고 삼키면 앱이 죽은 것처럼 보인다.
                AuthBackdrop {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(AuthSceneColors.accent)
                }
            } else if auth.showConsentScreen {
                // 받을 동의가 남아 있으면 그 화면을 먼저 통과해야 한다.
                // ⚠ `needsConsent` 가 아니라 `showConsentScreen` 을 본다 — 선택 유형만
                // 재수집하는 경우(collect == ["marketing"]) needsConsent 는 false 라
                // 화면이 영영 안 뜬다. Android `ConsentScreen` 게이팅과 동등.
                ConsentView(
                    busy: auth.isBusy,
                    collect: auth.consentCollect,
                    optional: auth.consentOptional,
                    isReconsent: auth.consentIsReconsent,
                    prechecked: auth.consentPrechecked,
                    onAgree: { agreedOptional in
                        Task { await auth.submitConsents(agreedOptional: agreedOptional) }
                    },
                    // ⚠ 외부 브라우저로 내보내지 말 것 — 동의 화면에서 약관을 보러
                    // 나가면 앱으로 못 돌아오고 체크해 둔 값도 사라진다.
                    onOpenTerms: { legalDocument = .init(title: "서비스 이용약관", url: Self.termsURL) },
                    onOpenPrivacy: { legalDocument = .init(title: "개인정보 처리방침", url: Self.privacyURL) }
                )
            } else if onboardingCompleted == nil || voiceSetupDone == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AlarmTalkTheme.background)
            } else if onboardingCompleted == false {
                NavigationStack {
                    OnboardingView(onComplete: completeOnboarding)
                }
            } else if voiceSetupDone == false {
                // 온보딩 직후 "기본 목소리 고르기" — 기본 목소리를 아직 안 고른 사용자에게만 1회.
                NavigationStack {
                    VoiceSetupView(onComplete: completeVoiceSetup)
                }
            } else {
                MainTabsView()
            }
        }
        .task(id: auth.session?.user.id) {
            refreshOnboardingCompletion()
        }
        .sheet(item: $legalDocument) { target in
            NavigationStack {
                LegalDocumentView(title: target.title, url: target.url)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("닫기") { legalDocument = nil }
                        }
                    }
            }
        }
        // 민감 동의 시트는 **차단 게이트가 없을 때만** 띄운다 — 업데이트 강제·탈퇴 유예·
        // 동의 게이트 위에 겹치면, 사용자는 못 쓰는 화면 위에서 동의부터 하게 된다.
        .overlay {
            if let request = auth.pendingSensitiveConsent, !blockingGateActive {
                ZStack {
                    AlarmTalkTheme.scrim.ignoresSafeArea()
                    VoiceConsentSheet(
                        busy: auth.isBusy,
                        types: request.types,
                        registeringVoice: request.registeringVoice,
                        onAgree: { Task { await auth.submitSensitiveConsents(types: request.types) } },
                        onDismiss: { auth.pendingSensitiveConsent = nil }
                    )
                }
            }
        }
    }

    /// 앱을 못 쓰게 막고 있는 게이트가 떠 있는가.
    private var blockingGateActive: Bool {
        versionGate.updateRequired || !auth.isAuthenticated || auth.pendingDeletion || auth.showConsentScreen
    }

    private func refreshOnboardingCompletion() {
        guard let userID = auth.session?.user.id else {
            onboardingCompleted = nil
            voiceSetupDone = nil
            return
        }
        onboardingCompleted = OnboardingCompletionStore().hasCompleted(userID: userID)
        voiceSetupDone = DefaultVoicePreferenceStore().hasCompletedSetup(userID: userID)
    }

    private func completeOnboarding() {
        if let userID = auth.session?.user.id {
            OnboardingCompletionStore().markCompleted(userID: userID)
        }
        onboardingCompleted = true
    }

    private func completeVoiceSetup() {
        voiceSetupDone = true
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
