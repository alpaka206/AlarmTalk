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
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    /// 온보딩 완료 후 기본 목소리를 한 번이라도 골랐는지. 안 골랐으면 `VoiceSetupView` 노출.
    /// Android `MainViewModel.showVoiceSetup`(= !hasChosen) 게이팅 미러.
    @State private var voiceSetupDone: Bool?
    /// 동의 화면에서 띄우는 인앱 약관 뷰어.
    @State private var legalDocument: LegalDocumentTarget?

    /// 웰컴 프로모 코드 안내(계정당 1회, 무료 플랜만).
    @State private var showWelcomePromo = false
    @State private var promoBusy = false
    @State private var promoError: String?

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
            if versionGate.updateRequired || auth.consentUnsupported {
                // 최소지원버전 미만 — 로그인 여부와 무관하게 앱 진입을 막고 업데이트만 유도.
                //
                // ⚠ **`consentUnsupported` 도 같은 화면이다.** 서버가 앱이 번들한 것보다
                // 새 문서 버전을 요구하면 `POST /user/consents` 가 409 로 전부 거부되는데,
                // 그때 동의 화면에 남겨 두면 **제출이 영영 안 되는 화면에 갇힌다.**
                // 사용자가 할 수 있는 일이 업데이트뿐이라 안드로이드도 같은 화면으로 보낸다
                // (`AlarmTalkApp.kt` 의 `updateRequired || consentUnsupported`).
                // 예전 iOS 는 이 값을 세우기만 하고 **읽는 뷰가 하나도 없었다**(2026-08-07 수정).
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
            } else if !auth.consentStatusChecked && !consentCachedDone {
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
            } else if voiceSetupDone == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AlarmTalkTheme.background)
            }
            // ⚠ **인트로 캐러셀(OnboardingView)을 되살리지 말 것.** 안드로이드에는 그런
            // 화면이 없다 — 로그인하면 곧바로 '기본 목소리 준비' 로 간다
            // (`VoiceOnboardingScreen` 은 이름만 온보딩이고 스톡 클립 프리페치 진행 화면이다).
            // iOS 에만 3장짜리 소개 페이지가 남아 있어, 로그인 직후 웰컴 프로모·권한 팝업과
            // 겹쳐 뜨고 있었다(2026-08-06 실기기 확인).
            else if voiceSetupDone == false {
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
        // ⚠ **차단 게이트가 없을 때만** 띄운다. 응답 전 기본값 `false` 가 '아니오' 와
        // 구분되지 않아, 그 틈에 1회성 오버레이가 뜨면 **소진 플래그까지 태우고** 뒤늦게
        // 온 차단 화면이 그 위를 덮는다 — 사용자는 본 적도 없이 잃는다
        // (CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」).
        // 그래서 판정 키에 준비 신호(`consentStatusChecked`)를 함께 넣는다.
        .task(id: promoGateKey) { evaluateWelcomePromo() }
        .overlay {
            if showWelcomePromo, !blockingGateActive {
                ZStack {
                    AlarmTalkTheme.scrim.ignoresSafeArea()
                    WelcomePromoDialog(
                        busy: promoBusy,
                        errorText: promoError,
                        onSubmitCode: { code in
                            Task {
                                promoBusy = true
                                promoError = nil
                                let result = await socialFeatures.registerCode(code, session: auth.session)
                                promoBusy = false
                                if result != nil {
                                    showWelcomePromo = false
                                } else {
                                    promoError = socialFeatures.statusMessage ?? "코드를 등록하지 못했어요."
                                }
                            }
                        },
                        onOpenInstagram: { openURL(URL(string: "https://instagram.com/alarmtalk.app")!) },
                        onDismiss: { showWelcomePromo = false }
                    )
                }
            }
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
        versionGate.updateRequired
            || auth.consentUnsupported
            || !auth.isAuthenticated
            || auth.pendingDeletion
            || auth.showConsentScreen
    }

    /// 프로모 판정에 필요한 값이 다 모였는지 나타내는 키.
    /// ⚠ 가드만 넣지 말고 **키에도 넣어야** 응답이 도착한 뒤 효과가 다시 돈다.
    private var promoGateKey: String {
        "\(auth.session?.user.id ?? "-")|\(auth.consentStatusChecked)|\(blockingGateActive)"
    }

    /// 웰컴 코드 안내를 띄울지 판정한다. 조건이 하나라도 어긋나면 조용히 넘어간다.
    ///  - 동의 확인 응답이 **도착했을 것**(그 전에는 차단 화면 여부를 알 수 없다)
    ///  - 차단 게이트가 없을 것
    ///  - 무료 플랜일 것(이미 유료면 보여줄 이유가 없다)
    ///  - 이 계정에 아직 안 띄웠을 것
    /// 노출과 동시에 '봤음' 을 기록한다 — 닫든 등록하든 다시 뜨지 않는다.
    private func evaluateWelcomePromo() {
        guard auth.consentStatusChecked, !blockingGateActive else { return }
        guard let userID = auth.session?.user.id, !userID.isEmpty else { return }
        guard (auth.session?.user.plan ?? "free").lowercased() == "free" else { return }
        let store = PromoPromptStore()
        guard !store.hasPrompted(userID: userID) else { return }
        store.markPrompted(userID: userID)
        showWelcomePromo = true
    }

    /// 이 기기에서 이미 동의를 마친 계정인가 — **로딩 게이트 통과에만** 쓴다.
    ///
    /// ⚠ 1회성 오버레이 판정에는 쓰지 말 것. 그건 `auth.consentStatusChecked`(이 계정의
    /// 응답을 실제로 받았나)가 봐야 한다 — 받을 게 남은 계정은 완료 캐시가 아예 안
    /// 만들어져, 캐시로 판정하면 오버레이가 영영 안 뜬다.
    private var consentCachedDone: Bool {
        ConsentCompletionStore().hasCompleted(
            userID: auth.session?.user.id,
            policyVersion: AuthViewModel.currentPolicyVersion
        )
    }

    private func refreshOnboardingCompletion() {
        guard let userID = auth.session?.user.id else {
            voiceSetupDone = nil
            return
        }
        // 받아 둔 스톡 클립이 있으면 게이트를 열지 않는다 — 안드로이드도 캐시 개수로
        // 판정한다. 다운로드가 성공한 사람에게 다시 받으라고 하지 않기 위해서다.
        voiceSetupDone = DefaultVoicePreferenceStore().hasCompletedSetup(userID: userID)
            || AudioCacheStore.shared.hasAnyStockClip
    }

    private func completeVoiceSetup() {
        // ⚠ **메모리만 바꾸면 콜드 스타트마다 다시 뜬다.** 판정은 저장된 플래그를
        // 읽으므로(`hasCompletedSetup`), 통과했다는 사실을 **영구 저장**해야 한다.
        // 안드로이드는 `skipVoiceSetup()` → `markSkipped` 로 그렇게 한다.
        DefaultVoicePreferenceStore().markSkipped(userID: auth.session?.user.id)
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
