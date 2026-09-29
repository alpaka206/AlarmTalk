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
    /// 기간 한정 개인 플랜 종료 안내는 **앱에 들어올 때마다** 뜬다 — 들어온 것을 세는 축.
    @Environment(\.scenePhase) private var scenePhase
    /// 강등 안내가 **가리킬 알람이 아직 있는지** 확인하는 데만 쓴다(`evaluateDowngradeNotice`).
    @EnvironmentObject private var alarmStore: LocalAlarmStore
    /// 온보딩 완료 후 기본 목소리를 한 번이라도 골랐는지. 안 골랐으면 `VoiceSetupView` 노출.
    /// Android `MainViewModel.showVoiceSetup` 게이팅 미러(판정은 `refreshOnboardingCompletion`).
    @State private var voiceSetupDone: Bool?
    /// 동의 화면에서 띄우는 인앱 약관 뷰어.
    @State private var bundledLegalDocument: BundledLegalDocument?

    // ⚠ **웰컴 코드 안내 시트를 되살리지 말 것**(2026-09-27 폐지). 무료 계정에 계정당 한 번
    // 쿠폰 입력을 권하던 시트였는데, 기간 한정 개인 플랜으로 무료 계정이 전부 개인이 되면서
    // 권할 이유가 사라졌고 운영 코드도 전부 꺼졌다. 쿠폰 입력 자체는 남아 있다 —
    // 더보기의 코드 등록(`CodeRegisterRow`)과 유료 게이트의 '쿠폰이 있어요'(`RedeemCodeSheet`).
    @State private var downgradeNotice: DowngradeNoticeStore.Notice?

    /// 이 프로세스에서 앱에 들어온 횟수(콜드 스타트 = 1, 백그라운드 → 활성마다 +1). **읽기만
    /// 한다** — 세는 곳은 앱의 `scenePhase` 하나다(`AppEntrySignal` 주석).
    @ObservedObject private var appEntrySignal = AppEntrySignal.shared
    /// 종료 안내의 판정을 **끝낸** 진입 — `PersonalPromoNotice.marker`. 같은 진입에서 두 번
    /// 판정하지 않는다. 적는 때는 셋뿐이다: 띄울 것이 없다고 판정했을 때(`nothingToShow`),
    /// 띄운 안내가 **화면에 나온 것을 확인했을 때**, 사용자가 닫았을 때.
    @State private var personalPromoNoticeHandled: String?
    /// 떠 있는 기간 한정 개인 플랜 종료 안내. nil 이면 없음.
    @State private var personalPromoNotice: ShownPromoNotice?
    /// 띄웠는데 **화면에 나오지 않은** 횟수(진입·계정 `marker` 별). 다른 창과 같은 순간에 겹쳐
    /// 조용히 건너뛰어진 것이라 그 창이 닫히면 다시 띄운다 — 다만 끝없이 되풀이하지 않도록
    /// 상한(`maxUnseenPromoNotices`)에서 그 진입을 끝낸다.
    @State private var unseenPromoNotice: UnseenPromoNotice?
    /// 한 진입에서 '띄웠는데 안 보임' 을 몇 번까지 다시 해 보는가.
    private static let maxUnseenPromoNotices = 3

    private struct UnseenPromoNotice: Equatable {
        var marker: String
        var count: Int
    }
    /// 시스템 권한 팝업이 떠 있거나 곧 뜰 수 있는가 — 그 위·아래에 안내를 겹치지 않는다.
    @ObservedObject private var permissionPrompts = SystemPermissionPrompts.shared

    /// 띄운 종료 안내와 **누구의 것인지**. 로그아웃·계정 전환 뒤에 남의 안내가 남지 않게 한다.
    private struct ShownPromoNotice: Equatable {
        var promo: PersonalPromo
        var userID: String
    }

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
                NavigationStack {
                    LandingView()
                }
            } else if auth.pendingDeletion {
                // 탈퇴 유예 상태 — 복구하거나 로그아웃하기 전까지 앱 진입을 막는다.
                // Android `AccountPendingDeletionScreen` 게이팅과 동등.
                AccountPendingDeletionView(
                    busy: auth.isBusy,
                    onRecover: { Task { await auth.cancelAccountDeletion() } },
                    onLogout: { auth.signOutExplicitly() }
                )
            } else if !auth.consentStatusChecked && !consentCachedDone {
                // 동의 확인 응답 전에는 온보딩·홈을 아예 그리지 않는다. 응답 전 기본값
                // `false` 가 '아니오' 와 구분되지 않아, 그 틈에 오버레이(강등 안내·프로모
                // 종료 안내·첫 권한 안내)가 떠서 뒤늦게 온 차단 화면이 그 위를 덮는다
                // (`docs/spec/gates-and-overlays.md`).
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
                    onAgree: { agreedOptional in
                        Task { await auth.submitConsents(agreedOptional: agreedOptional) }
                    },
                    // ⚠ 외부 브라우저로 내보내지 말 것 — 동의 화면에서 약관을 보러
                    // 나가면 앱으로 못 돌아오고 체크해 둔 값도 사라진다.
                    // ⚠ **동의 화면은 번들본을 연다 — 웹으로 되돌리지 말 것**(코덱스 #730 2차).
                    //   `submitConsents` 가 보내는 버전은 빌드 시점의
                    //   `LegalPolicy.bundledVersion` 이다. 랜딩의 실시간 문서를 띄우면
                    //   출시 뒤 개정될 때 **보여 준 것과 기록한 버전이 달라진다.**
                    //   (설정의 뷰어는 웹 그대로다 — 거긴 안내용이고 안드로이드도 같다.)
                    onOpenTerms: { bundledLegalDocument = .terms },
                    onOpenPrivacy: { bundledLegalDocument = .privacy }
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
        //   하나다(`AlarmTalkApp` → `AppEntrySignal`) — 계정 요청이 보낼 때 진입 번호를 받아
        //   가므로, 뷰가 따로 세면 한 번의 복귀가 두 진입이 되어 복귀의 `/auth/me` 가 영영 이
        //   진입의 답이 되지 못한다.
        // 안내 둘(강등·프로모 종료)은 **한 태스크에서 순서대로** 판정한다 — 따로 돌리면
        // 두 알럿이 같은 순간에 서로를 밀어내고 하나가 조용히 사라진다. 강등 안내가 먼저다
        // (할 수 있는 일이 걸린 안내다). 판정 조건은 둘 다 **차단 게이트가 없을 때**다:
        // 응답 전 기본값 `false` 가 '아니오' 와 구분되지 않아, 그 틈에 뜨면 뒤늦게 온 차단
        // 화면이 그 위를 덮는다(`docs/spec/gates-and-overlays.md`). 그래서 판정 키에 준비
        // 신호(`consentStatusChecked`)를 함께 넣는다.
        //
        // 강등 안내는 소진 플래그가 아니라 **대기표**라, 못 보고 지나가도 지워지지 않는다
        // (지우는 건 '확인' 뿐). 프로모 종료 안내도 소진 플래그가 없다 — 다음 진입에 또 뜬다.
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
            Button("확인") {
                DowngradeNoticeStore().clear(userID: auth.session?.user.id)
                downgradeNotice = nil
            }
        } message: { notice in
            // ⚠ **세 원인의 결말이 다르다.** 무료 강등은 이용권을 다시 등록하면 돌아오지만,
            // 공유 해제는 **돌아오지 않고**(다시 공유받아야 한다), 목소리 교체는 이용권과
            // 아예 무관하다 — 같은 말로 뭉치면 기다리거나 결제하면 될 줄 안다.
            Text(downgradeNoticeMessage(notice))
        }
        // 기간 한정 개인 플랜 종료 안내 — **시스템 `.alert`** 다(iOS 의 확인 모달 규약.
        // 안드로이드 `IosAlertDialog` 가 이걸 흉내 낸 것이라 껍데기를 새로 만들지 않는다).
        // 액션은 둘: '다시 보지 않기'(이 계정·이 종료 시각에 다시 안 띄움) · '확인'(이번만 닫음).
        // 문구는 안드로이드(`personal_promo_end_notice_*`)가 원본이다 — ko·en·ja 모두 같게 둔다.
        .alert(
            Self.personalPromoNoticeTitleKey,
            isPresented: Binding(
                get: { personalPromoNotice != nil },
                set: { if !$0 { personalPromoNotice = nil } }
            ),
            presenting: personalPromoNotice
        ) { shown in
            Button("다시 보지 않기") {
                PersonalPromoNoticeStore().optOut(userID: shown.userID, promo: shown.promo)
                closePersonalPromoNotice(shown)
            }
            Button("확인", role: .cancel) {
                closePersonalPromoNotice(shown)
            }
        } message: { shown in
            if let days = PersonalPromoNotice.dayLabels(for: shown.promo) {
                // 날짜는 **서버 값**을 기기 로케일로 찍는다 — 마지막 날은 `ends_at − 1초`,
                // 뒤의 날은 그다음 날이다.
                // ⚠ 삭제 문장은 **서버가 대상이라고 할 때만** 싣는다(`deletes_voices_at_end`).
                // 보류 중인 구독 행이 남은 계정은 종료 전환 대상이 아니라 목소리가 지워지지 않는다.
                if shown.promo.deletesVoicesAtEnd {
                    Text("\(days.lastDay)까지 개인 플랜을 무료로 쓸 수 있어요. \(days.firstFreeDay)부터는 무료 플랜으로 돌아가고, 등록한 목소리는 3일 보관 후 삭제돼요.")
                } else {
                    Text("\(days.lastDay)까지 개인 플랜을 무료로 쓸 수 있어요. \(days.firstFreeDay)부터는 무료 플랜으로 돌아가요.")
                }
            }
        }
        .sheet(item: $bundledLegalDocument) { doc in
            NavigationStack {
                BundledLegalDocumentView(document: doc)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("닫기") { bundledLegalDocument = nil }
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
            || auth.pendingDeletion
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

    /// 안내 두 개(강등·프로모 종료)의 재판정 키. 준비 신호에 더해:
    ///  - **진입 횟수** — 프로모 종료 안내는 앱에 들어올 때마다 다시 판정한다.
    ///  - **이 진입의 계정 응답** — 이 진입에 보낸 `/auth/me` 가 오거나 실패하면 그때 판정한다
    ///    (그 전에는 안 본다 — `auth.accountEntryAnswer`).
    ///  - **프로모 값** — 세션이 새 값을 받으면(시작·연장·종료·삭제 대상 여부) 다시 본다.
    ///  - **떠 있는 안내** — 하나가 닫혀야 다른 하나를 띄운다(한 번에 알럿 하나).
    ///  - **민감 동의 시트** — 그 위에 겹쳐 띄우지 않는다. 닫히면 다시 본다.
    ///  - **장면 상태·시스템 권한 팝업** — 그 위·아래에 겹쳐 띄우지 않는다. 걷히면 다시 본다.
    ///    (다른 모달 — 시트·커버·알럿 — 은 키로 알 수 없어 태스크가 걷힐 때까지 지켜본다.)
    private var overlayKey: String {
        [
            promoGateKey,
            String(appEntrySignal.counter.entry),
            auth.accountEntryAnswer.map { "answer-\($0.entry)-\($0.outcome)" } ?? "no-answer",
            auth.session?.user.personalPromo?.endsAt ?? "-",
            auth.session?.user.personalPromo?.noticeFrom ?? "-",
            auth.session?.user.personalPromo.map { $0.deletesVoicesAtEnd ? "deletes" : "keeps" } ?? "-",
            downgradeNotice == nil ? "no-downgrade" : "downgrade",
            personalPromoNotice == nil ? "no-promo-notice" : "promo-notice",
            auth.pendingSensitiveConsent == nil ? "no-consent-sheet" : "consent-sheet",
            scenePhase == .active ? "scene-active" : "scene-inactive",
            permissionPrompts.isPending ? "permission-pending" : "permission-clear",
        ].joined(separator: "|")
    }

    /// 안내 둘을 판정하고, 떠 있다고 적힌 안내가 **실제로 보이는지** 확인한다.
    ///
    /// ⚠ **SwiftUI 는 이미 다른 모달이 뜬 화면 위에 루트의 `.alert` 를 올리지 못한다** — 경고
    /// 한 줄만 남기고 조용히 건너뛴다. 그러면 상태는 '떠 있음' 인데 화면에는 없어, 그 상태가
    /// 다른 안내까지 막고(서로 `== nil` 을 기다린다) 다음 진입도 삼켰다(2026-09-27 리뷰).
    /// 그래서 ① 다른 모달이 떠 있으면 **띄우지 않고 걷힐 때까지 기다리고**, ② 띄웠는데 보이지
    /// 않으면 **걷는다** — 프로모 안내는 이 진입을 끝내지 않은 채 걷어, 가린 창이 닫히면 같은
    /// 진입 안에서 다시 뜬다(안드로이드 `PersonalPromoLedger.deferEndNotice` — `evaluateEndNotice` 가 부른다). 강등 안내는 대기표라
    /// 저장소에 남아 다시 뜬다.
    private func runOverlayNotices() async {
        if downgradeNotice != nil || personalPromoNotice != nil {
            await verifyShownNoticeIsVisible()
            return
        }
        while !Task.isCancelled {
            let downgradeWaiting = evaluateDowngradeNotice()
            if downgradeNotice != nil { return }
            let promoWaiting: Bool
            switch personalPromoDecision() {
            case .skip:
                promoWaiting = false
            case .nothingToShow(let marker):
                // 이 진입의 판정은 끝났다 — 같은 진입에 뒤늦게 오는 계정 응답(제어 센터를 닫을
                // 때의 재조회·결제 뒤 갱신)이 세션 한가운데서 안내를 띄우지 않게 적는다.
                personalPromoNoticeHandled = marker
                promoWaiting = false
            case .wait:
                promoWaiting = true
            case .show(let promo, _):
                guard let userID = auth.session?.user.id else { return }
                // ⚠ **여기서 진입을 끝내지 않는다**(2026-09-27 리뷰 2차). 띄운다고 적은 것이
                //   화면에 나온다는 보장이 없다 — 같은 프레임에 시트가 올라오면 SwiftUI 가 조용히
                //   건너뛴다. 끝내는 것은 보인 것을 확인한 뒤다(`verifyShownNoticeIsVisible`).
                personalPromoNotice = ShownPromoNotice(promo: promo, userID: userID)
                return
            }
            guard downgradeWaiting || promoWaiting else { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    /// 사용자가 종료 안내를 닫았다 — 본 것이므로 **이 진입을 끝낸다.** 확인 단계(1초)보다 먼저
    /// 닫혀도 여기서 적는다 — 안 적으면 같은 진입에 곧바로 또 뜬다.
    private func closePersonalPromoNotice(_ shown: ShownPromoNotice) {
        let entry = appEntrySignal.counter.entry
        if entry > 0 {
            personalPromoNoticeHandled = PersonalPromoNotice.marker(entry: entry, userID: shown.userID)
        }
        personalPromoNotice = nil
    }

    /// 종료 안내의 제목 — 알럿과 '보였는가' 확인(`verifyShownNoticeIsVisible`)이 같은 값을 쓴다.
    /// 알럿은 번역 카탈로그 키로, 확인은 그 키를 번역한 문자열로 본다(`.alert` 가 싣는 제목과 같다).
    private static var personalPromoNoticeTitleKey: LocalizedStringKey { "개인 플랜 무료 이용이 곧 끝나요" }
    private static var personalPromoNoticeTitle: String {
        String(localized: "개인 플랜 무료 이용이 곧 끝나요")
    }

    /// 떠 있다고 적힌 안내를 확인한다 — 남의 것이면 걷고, 화면에 없으면 걷는다.
    private func verifyShownNoticeIsVisible() async {
        if let shown = personalPromoNotice {
            guard shown.userID == auth.session?.user.id else {
                // 로그아웃·계정 전환 — 남의 안내를 새 화면 위에 남기지 않는다.
                personalPromoNotice = nil
                return
            }
            // 떠 있는 동안 새 계정 응답이 왔으면 거기에 맞춘다 — 결제·쿠폰으로 프로모가
            // 사라졌으면 닫고, 삭제 대상 여부가 바뀌었으면 문장을 바꾼다.
            guard let latest = PersonalPromoNotice.reconcileShown(
                shown.promo, latest: auth.session?.user.personalPromo, now: Date()
            ) else {
                personalPromoNotice = nil
                return
            }
            // 받은 시각만 다른 것은 같은 안내다 — 화면에 보이는 것이 바뀔 때만 갈아 끼운다.
            if latest.deletesVoicesAtEnd != shown.promo.deletesVoicesAtEnd
                || latest.noticeFrom != shown.promo.noticeFrom {
                personalPromoNotice = ShownPromoNotice(promo: latest, userID: shown.userID)
            }
        }
        // 표시는 다음 갱신에서 일어난다 — 넉넉히 기다린 뒤 본다.
        try? await Task.sleep(for: .seconds(1))
        guard !Task.isCancelled, downgradeNotice != nil || personalPromoNotice != nil else { return }
        let entry = appEntrySignal.counter.entry
        // 프로모 안내는 **그 제목의** 알럿이 떠야 보인 것이다 — 남의 알럿을 안내로 읽지 않는다.
        let visible = personalPromoNotice != nil
            ? ModalPresentationProbe.isShowingAlert(titled: Self.personalPromoNoticeTitle)
            : ModalPresentationProbe.isShowingAlert()
        guard visible else {
            // 안 보였다 — 걷는다. 프로모 안내는 **이 진입을 끝내지 않는다**: 가린 창이 닫히면
            // 같은 진입 안에서 다시 뜬다(스펙 「다른 창 위에 띄우지 않는다」). 끝없이 되풀이하지
            // 않도록 상한에서만 끝낸다.
            if let shown = personalPromoNotice, entry > 0 {
                noteUnseenPromoNotice(marker: PersonalPromoNotice.marker(entry: entry, userID: shown.userID))
            }
            downgradeNotice = nil
            personalPromoNotice = nil
            return
        }
        // **보인 것을 확인했다 — 이 진입을 끝낸다.** 앞 진입에서 띄운 안내가 아직 떠 있어도
        // 이번 진입은 그걸로 본 것으로 친다 — 안 그러면 닫자마자 같은 안내가 또 뜬다.
        if let shown = personalPromoNotice, entry > 0 {
            personalPromoNoticeHandled = PersonalPromoNotice.marker(entry: entry, userID: shown.userID)
        }
    }

    /// '띄웠는데 안 보임' 을 센다. 상한에 닿으면 그 진입을 끝낸다 — 무엇이 가리는지 모르는 채
    /// 1초마다 띄웠다 걷기를 되풀이하지 않는다(다음 진입이 다시 본다).
    private func noteUnseenPromoNotice(marker: String) {
        let count = unseenPromoNotice?.marker == marker ? (unseenPromoNotice?.count ?? 0) + 1 : 1
        unseenPromoNotice = UnseenPromoNotice(marker: marker, count: count)
        if count >= Self.maxUnseenPromoNotices {
            personalPromoNoticeHandled = marker
        }
    }

    /// 기간 한정 개인 플랜 종료 안내를 띄울지 판정한다(규칙은 `PersonalPromoNotice.decide`).
    ///  - **확인 응답이 다 도착했을 것** — 동의(`consentStatusChecked`)·버전(`versionGate.checked`).
    ///    아니면 이번 진입을 끝내지 않고 다음 키 변화에서 다시 본다(`skip`).
    ///  - **이 진입의 계정 응답**(`auth.accountEntryAnswer`) — 오기 전에는 `skip`, 실패했으면 이
    ///    진입은 띄우지 않고 끝낸다(`nothingToShow`).
    ///  - 차단 게이트가 없을 것(업데이트 강제·동의·탈퇴 유예·목소리 받기·교체)
    ///  - 서버가 준 창 `[notice_from, ends_at)` 안이고 이 계정이 '다시 보지 않기' 를 안 눌렀을 것
    ///    — 아니면 이 진입은 끝난다(`nothingToShow`)
    ///  - 강등 안내·민감 동의 시트·다른 모달·시스템 권한 팝업이 없을 것 — 있으면 **기다린다**
    private func personalPromoDecision() -> PersonalPromoNotice.Decision {
        let user = auth.session?.user
        let promo = user?.personalPromo
        let entry = appEntrySignal.counter.entry
        return PersonalPromoNotice.decide(
            PersonalPromoNotice.Inputs(
                gatesClear: auth.consentStatusChecked && versionGate.checked && !blockingGateActive,
                entry: entry,
                userID: user?.id,
                promo: promo,
                accountAnswer: PersonalPromoNotice.entryAnswer(auth.accountEntryAnswer, entry: entry),
                handledMarker: personalPromoNoticeHandled,
                optedOut: PersonalPromoNoticeStore().isOptedOut(userID: user?.id, promo: promo),
                otherNoticeOpen: downgradeNotice != nil || auth.pendingSensitiveConsent != nil,
                sceneActive: scenePhase == .active,
                permissionPromptPending: permissionPrompts.isPending,
                modalPresented: ModalPresentationProbe.isPresentingModal
            ),
            now: Date()
        )
    }

    /// ⚠ 반환 타입이 `LocalizedStringKey` 여야 `.alert(_:)`·`Text(_:)` 가 **번역 카탈로그를
    /// 본다.** `String` 을 돌려주면 비-지역화 오버로드에 묶여, 카탈로그에 en·ja 를 넣어도
    /// 한국어 그대로 나온다(고쳐도 안 고쳐지는 것처럼 보인다).
    private func downgradeNoticeTitle(_ cause: DowngradeNoticeStore.Cause?) -> LocalizedStringKey {
        switch cause {
        case .freePlan: return "무료 이용권으로 바뀌었어요"
        case .voiceReplaced: return "새 목소리로 바뀌었어요"
        default: return "공유 이용권에서 나가게 됐어요"
        }
    }

    private func downgradeNoticeMessage(_ notice: DowngradeNoticeStore.Notice) -> LocalizedStringKey {
        switch notice.cause {
        case .freePlan:
            return "목소리 알람 \(notice.count)개가 기본 목소리로 바뀌었어요. 3일 안에 이용권을 다시 등록하면 내 목소리가 돌아오고, 지나면 영구 삭제돼요."
        case .voiceReplaced:
            return "목소리를 새로 등록하면서 직접 입력한 문구로 만든 알람 \(notice.count)개가 기본 목소리로 바뀌었어요. 새 목소리로 문구를 다시 만들어 주세요."
        case .sharedReleased:
            return "공유받던 목소리가 끊겨서 알람 \(notice.count)개가 기본 목소리로 바뀌었어요. 다시 쓰려면 이용권을 등록하거나 새 초대 코드를 받아야 해요."
        }
    }

    /// 대기표에 적힌 강등 안내가 있으면 모달을 연다. 준비 신호·차단 게이트 조건은 프로모
    /// 종료 안내와 같다. 그 안내가 떠 있으면 닫힐 때까지 기다린다(`overlayKey` 에 들어 있다) —
    /// 알럿 둘을 한꺼번에 올리면 하나가 조용히 사라진다.
    ///
    /// - Returns: 띄울 안내가 있는데 **다른 모달이 떠 있어 기다리는 중**인가. 그 위에 올리면
    ///   SwiftUI 가 조용히 건너뛰어 '떠 있음' 상태만 남고, 그 상태가 종료 안내를 막는다.
    @discardableResult
    private func evaluateDowngradeNotice() -> Bool {
        guard auth.consentStatusChecked, versionGate.checked, !blockingGateActive else { return false }
        guard personalPromoNotice == nil else { return false }
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
        // ⚠ **'내가 만든' 알람만 센다.** 강등 대상은 `localOwned` 뿐이라(받은 알람은
        // 보낸 사람의 구독으로 성립한다) 받은 알람 하나가 남아 있으면 이 가드가 영영
        // 통과하지 못했다 — 대기표가 안 지워져 **모달이 켤 때마다 다시 떴다**
        // (2026-08-18 실기기: 로컬에 받은 알람 1건만 남은 채 안내가 계속 떴다).
        if notice != nil, !alarmStore.alarms.contains(where: { $0.originEnum == .localOwned }) {
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
        let ready = StockClipPrefetcher.defaultVoiceProgress() == nil
            ? AudioCacheStore.shared.hasAnyStockClip
            : StockClipPrefetcher.defaultVoicesReady()
        voiceSetupDone = ready || DefaultVoicePreferenceStore().hasSkipped(userID: userID)
    }

    /// 다운로드가 끝났다. **건너뜀으로 기록하지 않는다** — 받아 둔 파일이 증거고,
    /// 그 파일이 사라지면 이 화면이 다시 떠야 한다.
    private func completeVoiceSetup() {
        voiceSetupDone = true
    }

    /// 사용자가 '나중에 받기' 를 눌렀다. 이때만 '안 받겠다' 를 영구 기록한다 —
    /// 안 그러면 콜드 스타트마다 같은 화면으로 막는다(안드로이드 `skipVoiceSetup` 미러).
    private func skipVoiceSetup() {
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
