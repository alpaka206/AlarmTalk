import SwiftUI

/// 음성 탭의 라우팅 enum — 본 화면 + 자식 플로우.
enum VoicesRoute: Hashable {
    case management
    case clone
    /// 등록 직후 '이 목소리로 저장할까요?' 확인 스텝. 서버가 초안(draft)으로 만들어 둔
    /// 프로필을 여기서 들어보고 승격하거나 지운다 — 이 스텝이 없으면 사용자는 결과를
    /// 한 번도 못 들어보고 이번 달 등록 횟수를 써 버린다.
    case preview(String)
    /// 승격 직후 서버 생성과 기기 다운로드를 한 진행률로 잇는다.
    case preparation(String)
}

/// 음성 탭 컨테이너 — VoiceProfileManagementPanel 을 중심으로 자식 플로우(녹음)를 라우팅.
///
/// ⚠ 화자 분리(`.separate`)는 **제품에서 사라졌다** — 백엔드 라우트도 `voice_speakers`
/// 테이블도 없다(마이그레이션 #79 DROP). 되살리지 말 것.
///
/// 목록은 탭 안에 두고, 등록·미리듣기·준비는 안드로이드의 전체화면 등록 다이얼로그처럼
/// `fullScreenCover` 로 잇는다. 모든 자식은 동일한 `VoiceStudioViewModel` 을 공유한다.
struct VoicesPanelView: View {
    @State private var route: VoicesRoute = UIPreviewSeed.opensVoicePreparation
        ? .preparation("preview-voice")
        : .management

    /// Phase 4-D1: PlanGate 시트에서 "결제 화면으로" 를 누르면 Root 의
    /// BillingPanel(auxiliaryScreen = .billing) 을 열도록 부모(MainTabsView) 가
    /// 주입하는 콜백. 콜백이 없으면 PlanGate 는 단순히 닫힌다.
    var onRequestBilling: (() -> Void)? = nil
    /// '이 목소리로 새 알람 만들기'(`VoiceProfileManagementPanel.onCreateAlarmWithVoice`).
    var onCreateAlarmWithVoice: ((String) -> Void)? = nil

    @EnvironmentObject private var voice: VoiceStudioViewModel

    /// 등록 창이 월 등록 한도 거절로 닫힌 뒤 띄우는 알럿(`VoiceProfileManagementPanel` 이 그린다).
    @State private var monthlyLimitNoticeOpen = false

    var body: some View {
        // ⚠ 유료 게이트의 코드 입력 갈래(`onRedeemCode`)는 2026-10-14 에 없앴다(App Store 지침 3.1.1 두 번째
        // 반려 — 선물 코드 폐지). 되살리지 말 것 — 할인·무료 이용은 스토어 오퍼 코드로 준다.
        VoiceProfileManagementPanel(
            route: $route,
            monthlyLimitNoticeOpen: $monthlyLimitNoticeOpen,
            onRequestBilling: onRequestBilling,
            onCreateAlarmWithVoice: onCreateAlarmWithVoice
        )
        // ⚠ **알럿은 창이 다 내려간 뒤에 연다 — `onDismiss` 가 그 시점이다.** 창을 닫는 것과 같은
        // 순간에 열면 내려가는 창과 겹쳐, 알럿이 뜨지 않은 채 끝날 수 있다(목소리 탭의 액션시트 →
        // 알럿이 한 박자 늦게 여는 것과 같은 이유다). 못 보면 사용자는 창이 왜 닫혔는지 모른다.
        // 꺼내고 내리는 것은 뷰모델이다(`VoiceStudioViewModel.consumeMonthlyLimitNotice`).
        .fullScreenCover(isPresented: subflowPresented, onDismiss: {
            if voice.consumeMonthlyLimitNotice() { monthlyLimitNoticeOpen = true }
        }) {
            NavigationStack {
                subflow
            }
            .toolbar(.hidden, for: .navigationBar)
            .interactiveDismissDisabled()
        }
    }

    private var subflowPresented: Binding<Bool> {
        Binding(
            get: { route != .management },
            set: { presented in
                if !presented { route = .management }
            }
        )
    }

    @ViewBuilder
    private var subflow: some View {
        switch route {
        case .management:
            EmptyView()
        case .clone:
            VoiceCloneUploadFlow(route: $route)
        case .preview(let draftID):
            if let draft = voice.profiles.first(where: { $0.id == draftID }) ?? voice.pendingDraft {
                VoicePreviewConfirmView(
                    draft: draft,
                    onSaved: { route = .preparation($0) },
                    onDiscarded: { route = .clone },
                    onMonthlyLimitRejected: { route = .management }
                )
            } else {
                // 초안을 못 찾으면(새로고침 중 유실 등) 갇히지 않게 목록으로 돌린다.
                Color.clear.onAppear { route = .management }
            }
        case .preparation(let voiceID):
            ClipPreparationView(
                onDismiss: { route = .management },
                registrationStyle: true,
                targetVoiceID: voiceID
            )
        }
    }
}

#if DEBUG
#Preview("VoicesPanelView (light)") {
    ScrollView {
        VoicesPanelView()
            .padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("VoicesPanelView (dark)") {
    ScrollView {
        VoicesPanelView()
            .padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
