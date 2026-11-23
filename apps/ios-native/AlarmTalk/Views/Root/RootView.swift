import SwiftUI
import UIKit

/// 최상위 라우터. 인증 + 온보딩 상태만 게이팅한다.
///
/// 분기 모델 (Android `App.kt` 의 진입 흐름과 동등)
///   1. 세션 없음 → `NavigationStack { LandingView() }` (Landing → Login)
///   2. 세션 있고 온보딩 미완료 → `OnboardingView` 단독 노출.
///      완료 여부는 Android 처럼 사용자 ID별로 저장한다.
///   3. 온보딩 완료 → `MainTabsView()`.
///      iOS 권한은 홈/알람/목소리 기능 진입 시점에 요청한다.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var versionGate: AppVersionGate
    /// 기본 목소리 교체가 아직 안 끝났는가 — 차단 화면 게이트.
    @ObservedObject private var stockReplacement = StockReplacementStatus.shared
    @Environment(\.openURL) private var openURL
    /// 강등 안내를 다시 판정하는 축 — 장면이 활성이 될 때 대기표를 다시 본다.
    @Environment(\.scenePhase) private var scenePhase
    /// 강등 안내가 **가리킬 알람이 아직 있는지** 확인하는 데만 쓴다(`evaluateDowngradeNotice`).
    @EnvironmentObject private var alarmStore: LocalAlarmStore
    /// 온보딩 완료 후 기본 목소리를 한 번이라도 골랐는지. 안 골랐으면 `VoiceSetupView` 노출.
    /// Android `MainViewModel.showVoiceSetup` 게이팅 미러(판정은 `refreshOnboardingCompletion`).
    @State private var voiceSetupDone: Bool?
    /// 동의 화면에서 띄우는 인앱 약관 뷰어.

    // ⚠ **웰컴 코드 안내 시트를 되살리지 말 것**(2026-09-27 폐지). 무료 계정에 계정당 한 번
    // 쿠폰 입력을 권하던 시트였는데, 기간 한정 개인 플랜으로 무료 계정이 전부 개인이 되면서
    // 권할 이유가 사라졌고 운영 코드도 전부 꺼졌다. 프로모 코드 자체도 2026-10-12 에, 선물 코드와 유료
    // 게이트의 코드 입력은 2026-10-14 에 없앴다(App Store 지침 3.1.1 — 두 번째 반려, 되살리지 말 것).
    // 마지막 코드 입력(초대 코드 등록)도 2026-10-20 에 없앴다. 할인·무료 이용은 스토어 오퍼 코드로 준다.
    @State private var downgradeNotice: DowngradeNoticeStore.Notice?

    /// 이 프로세스에서 앱에 들어온 횟수(콜드 스타트 = 1, 백그라운드 → 활성마다 +1) — 들어올 때마다 강등 안내를
    /// 다시 판정한다. **읽기만 한다** — 세는 곳은 앱의 `scenePhase` 하나다(`AppEntrySignal` 주석).
    @ObservedObject private var appEntrySignal = AppEntrySignal.shared
    /// 시스템 권한 팝업이 걷히면 강등 안내를 다시 판정한다(`overlayKey`).
    @ObservedObject private var permissionPrompts = SystemPermissionPrompts.shared

    /// 번들 법무 문서를 **둘 다** 읽을 수 있는가. 빌드 산출물이라 실행 중에 바뀌지 않으므로
    /// 한 번만 본다(`body` 마다 파일을 열지 않는다).
    ///
    /// 둘 중 하나만 없어도 막는다 — 제출하는 `LegalPolicy.bundledVersion` 은 **두 문서에서
    /// 함께** 뽑은 값이라(`scripts/generate-legal-version.sh` 가 다르면 빌드를 세운다),
    /// 한쪽이 없으면 그 버전이 무엇을 가리키는지 앱이 말할 수 없다.
    private static let bundledLegalDocumentsReadable = BundledLegalDocument.allCases
        .allSatisfy { $0.markdown() != nil }

    var body: some View {
        Group {
            if versionGate.updateRequired || auth.consentUnsupported || UIPreviewSeed.updateRequired {
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
                NavigationStack {
                    // 로그아웃한 순간의 안내(탈퇴 신청 접수 등 `signOut(message:)`)는 곧바로 이 첫 화면에 뜬다 — 안드로이드는 로그인
                    // 전 화면도 같은 위쪽 안내 자리(`TopMessageHost`)를 쓴다. 로그인·가입 화면은 저마다 같은 토스트를 단다.
                    // 스택 **안의 첫 화면**에 단다 — 스택 전체에 달면 그 위로 밀려 들어온 로그인 화면의 토스트와 두 장이 겹친다.
                    LandingView()
                        .authToast(message: auth.statusMessage, isError: auth.statusIsError) { auth.statusMessage = nil }
                }
            } else if !auth.consentStatusChecked && !consentCachedDone {
                // 동의 확인 응답 전에는 온보딩·홈을 아예 그리지 않는다. 응답 전 기본값
                // `false` 가 '아니오' 와 구분되지 않아, 그 틈에 오버레이(강등 안내·첫 권한 안내)가
                // 떠서 뒤늦게 온 차단 화면이 그 위를 덮는다(`docs/spec/gates-and-overlays.md`).
                //
                // ⚠ **이 로딩 화면에는 뒤로가기 차단을 두지 않는다.** 그 가드는 화면에
                // 정식 선택지가 있을 때 실수로 나가는 걸 막는 장치인데, 응답을 기다리는
                // 화면에는 지킬 선택지가 없고 삼키면 앱이 죽은 것처럼 보인다.
                AuthBackdrop {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(AuthSceneColors.accent)
                }
            } else if auth.showConsentScreen && !Self.bundledLegalDocumentsReadable {
                // ⚠ **문서를 못 읽으면 동의를 받지 않는다 — 오류만 띄우고 지나가게 두면 안 된다**
                //   (코덱스 #732). `submitConsents` 는 `LegalPolicy.bundledVersion` 을 함께
                //   보내는데, 그 버전의 **본문이 앱에 없는 상태**다. 사용자가 오류를 닫고
                //   체크만 하면 "보여 준 적 없는 문서"에 동의한 기록이 남는다.
                //
                //   `consentUnsupported` 와 **같은 화면**인 것이 맞다 — 둘 다 "이 빌드로는
                //   동의를 정직하게 받을 수 없다" 이고, 사용자가 할 수 있는 일은 업데이트뿐이다.
                //   막는 범위는 **동의 흐름뿐**이다: 이미 동의를 마친 사용자의 알람까지
                //   세우면 빌드 사고 하나로 앱 전체가 벽돌이 된다.
                UpdateRequiredView(onUpdate: { openURL(versionGate.storeURL) })
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
                    errorMessage: auth.actionErrorMessage(for: .consent),
                    // 약관·처리방침은 각 줄의 화살표로 **그 자리에서** 펼친다(`ConsentRow.document`, 2026-11-16) — 번들본이다.
                    // ⚠ 웹으로 되돌리지 말 것(코덱스 #730 2차): `submitConsents` 가 보내는 버전은 빌드 시점의
                    // `LegalPolicy.bundledVersion` 이라, 랜딩의 실시간 문서를 띄우면 **보여 준 것과 기록한 버전이 달라진다.**
                    onAgree: { agreedOptional in
                        Task { await auth.submitConsents(agreedOptional: agreedOptional) }
                    }
                )
            } else if stockReplacement.isPending(for: auth.session?.user.id) {
                // **기본 목소리 교체가 아직 안 끝났다.** 중간 상태로 쓰면 알람이 이름은 새
                // 이름인데 소리는 옛 목소리로 울 수 있어 막는다(2026-09-03 지시).
                //
                // ⚠⚠ **계정 선행 게이트보다 뒤에 둔다**(2026-09-03 리뷰 17차).
                //   앞에 두면 재동의·탈퇴 유예 화면을 **가려 버린다.** 그 상태에서는
                //   재시도를 눌러도 서버가 `/tts/stock-clips` 를 `CONSENT_REQUIRED`·
                //   `ACCOUNT_PENDING_DELETION` 으로 막으므로 **영영 못 빠져나온다** —
                //   앱을 껐다 켜는 것 말고는 길이 없다.
                //   순서: 업데이트 → 로그인 → 탈퇴 유예 → 동의 → **여기**.
                // 판정 기본값은 '막지 않음' 이다(`StockReplacementStatus` 주석).
                StockReplacementView(
                    working: stockReplacement.working,
                    onRetry: { stockReplacement.retry() }
                )
            } else if voiceSetupDone == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AlarmTalkTheme.background)
            }
            // ⚠ **인트로 캐러셀(OnboardingView)을 되살리지 말 것.** 안드로이드에는 그런
            // 화면이 없다 — 로그인하면 곧바로 '기본 목소리 준비' 로 간다
            // (`VoiceOnboardingScreen` 은 이름만 온보딩이고 스톡 클립 프리페치 진행 화면이다).
            // iOS 에만 3장짜리 소개 페이지가 남아 있어, 로그인 직후 안내·권한 팝업과
            // 겹쳐 뜨고 있었다(2026-08-06 실기기 확인).
            else if voiceSetupDone == false {
                // 온보딩 직후 "기본 목소리 고르기" — 기본 목소리를 아직 안 고른 사용자에게만 1회.
                NavigationStack {
                    VoiceSetupView(onComplete: completeVoiceSetup, onSkip: skipVoiceSetup)
                }
            } else {
                MainTabsView()
            }
        }
        // ⚠ **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시, 안드로이드와 같다).
        // 판정은 창에 단 UIKit 탭 인식기가 한다 — 이유는 `KeyboardDismissGesture` 주석에.
        .onAppear { KeyboardDismissGesture.shared.install() }
        .task(id: auth.session?.user.id) {
            refreshOnboardingCompletion()
        }
        // ⚠ **여기서 진입을 세지 말 것**(2026-09-27 리뷰 2차). 세는 곳은 앱의 `scenePhase`
        //   하나다(`AlarmTalkApp` → `AppEntrySignal`) — 뷰가 따로 세면 한 번의 복귀가 두 진입이 되어
        //   진입 갱신의 신선도 창(`EntryRefreshFreshness`)이 어긋난다.
        // 강등 안내는 **차단 게이트가 없을 때만** 판정한다: 응답 전 기본값 `false` 가 '아니오' 와
        // 구분되지 않아, 그 틈에 뜨면 뒤늦게 온 차단 화면이 그 위를 덮는다
        // (`docs/spec/gates-and-overlays.md`). 그래서 판정 키에 준비 신호(`consentStatusChecked`)를 함께 넣는다.
        //
        // 강등 안내는 소진 플래그가 아니라 **대기표**라, 못 보고 지나가도 지워지지 않는다
        // (지우는 건 '확인' 뿐).
        .task(id: overlayKey) {
            await runOverlayNotices()
        }
        .alert(
            downgradeNoticeTitle(downgradeNotice?.cause),
            isPresented: Binding(
                get: { downgradeNotice != nil },
                // ⚠ 바깥 탭·취소로 닫아도 **지우지 않는다** — 실수로 닫았을 수 있다.
                set: { if !$0 { downgradeNotice = nil } }
            ),
            presenting: downgradeNotice
        ) { notice in
            // 주행동 = 기본 액션(파란 채움) — 안드로이드 `AlarmTalkApp` 의 `emphasized = true` 짝(스펙 alarm-editor §4).
            Button("확인") {
                DowngradeNoticeStore().clear(userID: auth.session?.user.id)
                downgradeNotice = nil
            }
            .keyboardShortcut(.defaultAction)
        } message: { notice in
            // 원인과 무관한 한 문장이다(`downgradeNoticeTitle` 주석).
            Text(downgradeNoticeMessage(notice))
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
                        onAgree: { Task { await auth.agreeToPendingSensitiveConsent() } },
                        onDismiss: {
                            auth.clearActionError(.sensitiveConsent)
                            auth.pendingSensitiveConsent = nil
                        },
                        errorMessage: auth.actionErrorMessage(for: .sensitiveConsent)
                    )
                }
            }
        }
    }

    /// 앱을 못 쓰게 막고 있는 게이트가 떠 있는가.
    ///
    /// ⚠ **목소리 받기 화면도 여기 들어간다.** `voiceSetupDone` 은 아직 판정 전이면 nil,
    /// 안 받았으면 false 이고 그때 `VoiceSetupView`(스톡 클립 다운로드)가 전체 화면을
    /// 차지한다. 이걸 빼 두면 **신규 가입 100% 에서** 그 위에 안내 모달이 얹혀,
    /// 스크림이 다운로드 화면의 '다시 시도'·6초 뒤 탈출구를 가린다(레이스가 아니라
    /// 결정적 재현 — 폐지한 웰컴 코드 시트로 겪었다). 안드로이드도 `showVoiceSetup` 을
    /// 게이트에 넣어 두었다가 끝난 **뒤에** 안내를 띄운다.
    /// ⚠ **교체 게이트도 여기 들어와야 한다**(2026-09-03 리뷰 20차). 빠뜨리면 그 화면 위로
    ///   안내 모달·민감 동의 시트가 겹쳐 뜬다. 안드로이드 `blockingGateActive` 와 같다.
    private var blockingGateActive: Bool {
        versionGate.updateRequired
            || auth.consentUnsupported
            || !auth.isAuthenticated
            || auth.showConsentScreen
            // ⚠ **판정 전에는 '아니오' 가 아니라 '모른다' 다**(리뷰 21차). 아직 모르는
            //   동안 안내가 뜨면 뒤늦게 온 차단 화면이 그 위를 덮는다.
            || !stockReplacement.isChecked(for: auth.session?.user.id)
            || stockReplacement.isPending(for: auth.session?.user.id)
            || voiceSetupDone != true
    }

    /// 안내 판정에 필요한 값이 다 모였는지 나타내는 키(준비 신호 + 차단 게이트).
    /// ⚠ 가드만 넣지 말고 **키에도 넣어야** 응답이 도착한 뒤 효과가 다시 돈다.
    private var promoGateKey: String {
        "\(auth.session?.user.id ?? "-")|\(auth.consentStatusChecked)|\(versionGate.checked)|\(blockingGateActive)"
    }

    /// 강등 안내의 재판정 키. 준비 신호에 더해:
    ///  - **진입 횟수** — 앱에 들어올 때마다 대기표를 다시 본다.
    ///  - **떠 있는 안내** — 닫히면 다시 본다(남은 대기표가 있으면 다시 뜬다).
    ///  - **민감 동의 시트·장면 상태·시스템 권한 팝업** — 바뀌면 다시 본다.
    ///    (다른 모달 — 시트·커버·알럿 — 은 키로 알 수 없어 태스크가 걷힐 때까지 지켜본다.)
    private var overlayKey: String {
        [
            promoGateKey,
            String(appEntrySignal.counter.entry),
            downgradeNotice == nil ? "no-downgrade" : "downgrade",
            auth.pendingSensitiveConsent == nil ? "no-consent-sheet" : "consent-sheet",
            scenePhase == .active ? "scene-active" : "scene-inactive",
            permissionPrompts.isPending ? "permission-pending" : "permission-clear",
        ].joined(separator: "|")
    }

    /// 강등 안내를 판정하고, 떠 있다고 적힌 안내가 **실제로 보이는지** 확인한다.
    ///
    /// ⚠ **SwiftUI 는 이미 다른 모달이 뜬 화면 위에 루트의 `.alert` 를 올리지 못한다** — 경고
    /// 한 줄만 남기고 조용히 건너뛴다. 그러면 상태는 '떠 있음' 인데 화면에는 없다(2026-09-27 리뷰).
    /// 그래서 ① 다른 모달이 떠 있으면 **띄우지 않고 걷힐 때까지 기다리고**, ② 띄웠는데 보이지
    /// 않으면 **걷는다** — 강등 안내는 대기표라 저장소에 남아 다시 뜬다.
    private func runOverlayNotices() async {
        if downgradeNotice != nil {
            await verifyShownNoticeIsVisible()
            return
        }
        while !Task.isCancelled {
            let waiting = evaluateDowngradeNotice()
            if downgradeNotice != nil { return }
            guard waiting else { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    /// 떠 있다고 적힌 강등 안내가 화면에 없으면 걷는다.
    private func verifyShownNoticeIsVisible() async {
        // 표시는 다음 갱신에서 일어난다 — 넉넉히 기다린 뒤 본다.
        try? await Task.sleep(for: .seconds(1))
        guard !Task.isCancelled, downgradeNotice != nil else { return }
        if !ModalPresentationProbe.isShowingAlert() {
            downgradeNotice = nil
        }
    }

    /// ⚠ 반환 타입이 `LocalizedStringKey` 여야 `.alert(_:)`·`Text(_:)` 가 **번역 카탈로그를
    /// 본다.** `String` 을 돌려주면 비-지역화 오버로드에 묶여, 카탈로그에 en·ja 를 넣어도
    /// 한국어 그대로 나온다(고쳐도 안 고쳐지는 것처럼 보인다).
    /// ⚠ **원인과 상관없이 한 문장이다**(2026-10-16 오너 결정 — 안드로이드 `downgrade_notice_title`·`downgrade_notice_message`
    /// 와 같다). 예전에는 무료 강등·공유 해제·목소리 교체로 문구를 갈랐는데, 원인을 맞히는 판정이 틀리면 엉뚱한 안내가 떴다
    /// (2026-10-11 '공유 이용권에서 나가게 됐어요' 오분류). 알람은 언제나 기본 목소리로 바꾸고, 안내는 바뀌었다는 사실만 말한다.
    private func downgradeNoticeTitle(_ cause: DowngradeNoticeStore.Cause?) -> LocalizedStringKey {
        return "알람 목소리가 바뀌었어요"
    }

    /// ⚠ **무료 강등이면 삭제 기한을 덧붙인다**(코덱스 #914 — 안드로이드 `downgrade_notice_free_deadline` 과 같다). 등록한
    /// 목소리는 3일 뒤 영구 삭제되고, 그걸 앱 안에서 말하는 곳은 이 안내뿐이다(예고 푸시는 알림 권한이 없으면 닿지 않는다).
    /// 무료 강등은 결제 쪽이 확정해 적는 원인이라 '누가 지웠나' 같은 추측이 아니다.
    private func downgradeNoticeMessage(_ notice: DowngradeNoticeStore.Notice) -> LocalizedStringKey {
        if notice.cause == .freePlan {
            return "기존에 설정한 알람 \(notice.count)개의 목소리가 기본 목소리로 바뀌었어요. 3일 안에 이용권을 다시 구독하면 내 목소리가 돌아오고, 지나면 영구 삭제돼요."
        }
        return "기존에 설정한 알람 \(notice.count)개의 목소리가 기본 목소리로 바뀌었어요."
    }

    /// 대기표에 적힌 강등 안내가 있으면 모달을 연다 — 준비 신호가 다 오고 차단 게이트가 없을 때만.
    ///
    /// - Returns: 띄울 안내가 있는데 **다른 모달이 떠 있어 기다리는 중**인가. 그 위에 올리면
    ///   SwiftUI 가 조용히 건너뛰어 '떠 있음' 상태만 남는다.
    @discardableResult
    private func evaluateDowngradeNotice() -> Bool {
        guard auth.consentStatusChecked, versionGate.checked, !blockingGateActive else { return false }
        let notice = DowngradeNoticeStore().read(userID: auth.session?.user.id)
        // ⚠ **가리킬 알람이 없으면 안내도 없다**(2026-08-18 실기기 보고: 알람이 하나도 없는데
        // "알람 N개가 기본 알람음으로 바뀌었어요" 가 떴다).
        //
        // 이 안내는 소진 플래그가 아니라 **대기표**라, 못 보고 지나가도 '확인' 을 누를 때까지
        // 남는다 — 못 보고 잃는 것을 막으려는 의도다. 그런데 그 사이 대상 알람이 지워지면
        // 대기표만 남아, 사용자는 **존재한 적 없는 알람**에 대한 안내를 받는다.
        //
        // 판정은 **알람이 하나도 없을 때**로 좁힌다. 강등은 알람을 지우지 않고 기본 목소리로
        // 바꿔 두므로(`DefaultVoiceSubstitute.replacedLostVoice` 등) 대상은 여전히 목록에 있다 — 하나라도 있으면
        // 그중 하나가 그 알람일 수 있어 함부로 지우면 안 된다.
        if notice != nil, alarmStore.alarms.isEmpty {
            DowngradeNoticeStore().clear(userID: auth.session?.user.id)
            downgradeNotice = nil
            return false
        }
        if notice != nil, ModalPresentationProbe.isPresentingModal {
            return true
        }
        downgradeNotice = notice
        return false
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
        // ⚠ **판정 기준은 '받은 적 있다' 가 아니라 '지금 파일이 있다' 다.**
        // 예전에는 `hasCompletedSetup(=고름 또는 건너뜀) || 캐시있음` 이었는데,
        // 다 받고 화면을 닫을 때도 건너뜀 플래그를 세우고 있어서 **플래그 하나로 게이트가
        // 영영 닫혔다.** 그래서 사용자가 앱 데이터를 지우거나 캐시가 정리돼 클립이
        // 사라져도 **다시 받을 길이 없었다**(2026-08-11 확인).
        // 안드로이드 `MainViewModel` 은 처음부터 이렇게 한다:
        //   `showVoiceSetup = cachedStockClips == 0 && !hasSkipped(userId)`
        #if DEBUG
        // 화면 확인 모드는 서버·권한과 함께 이 게이트도 건너뛴다 — 시뮬레이터에는 받아 둔
        // 클립이 없어서, 안 건너뛰면 **모든 화면 확인이 받기 화면에서 멈춘다.**
        if UIPreviewSeed.isEnabled {
            voiceSetupDone = true
            return
        }
        #endif
        // ⚠ **'한 개라도 있다' 로 판정하지 말 것**(2026-09-17). 받다 만 기기가 다시 켜면
        // 받기 화면을 건너뛰고, 알람 관문(`StockClipPrefetcher.defaultVoicesReady`)에서야
        // 막힌다. 매니페스트를 한 번도 못 받은 옛 설치만 파일 유무로 본다.
        // 진행률은 한 번만 센다 — 판정이 같은 값을 다시 쓴다(`StockClipPrefetcher.defaultVoiceGate`).
        let gate = StockClipPrefetcher.defaultVoiceGate()
        let ready = gate.progress == nil ? AudioCacheStore.shared.hasAnyStockClip : gate.ready
        voiceSetupDone = ready || DefaultVoicePreferenceStore().hasSkipped(userID: userID)
    }

    /// 다운로드가 끝났다. **건너뜀으로 기록하지 않는다** — 받아 둔 파일이 증거고,
    /// 그 파일이 사라지면 이 화면이 다시 떠야 한다.
    private func completeVoiceSetup() {
        voiceSetupDone = true
        recordOnboardingStep("voice_setup_completed")
    }

    /// 로그인 뒤 첫 경험 단계(`onboarding_step` — `docs/spec/usage-events.md` §7.1). 이 화면은 로그인·동의 뒤에만 뜬다.
    private func recordOnboardingStep(_ step: String) {
        UsageEventQueue.shared.record(
            .onboardingStep,
            props: UsageEventProps(step: step),
            userID: auth.session?.user.id
        )
    }

    /// 사용자가 '나중에 받기' 를 눌렀다. 이때만 '안 받겠다' 를 영구 기록한다 —
    /// 안 그러면 콜드 스타트마다 같은 화면으로 막는다(안드로이드 `skipVoiceSetup` 미러).
    private func skipVoiceSetup() {
        DefaultVoicePreferenceStore().markSkipped(userID: auth.session?.user.id)
        voiceSetupDone = true
        recordOnboardingStep("voice_setup_skipped")
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
