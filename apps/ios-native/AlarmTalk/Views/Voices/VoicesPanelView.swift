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
    @State private var route: VoicesRoute = .management

    /// Phase 4-D1: PlanGate 시트에서 "결제 화면으로" 를 누르면 Root 의
    /// BillingPanel(auxiliaryScreen = .billing) 을 열도록 부모(MainTabsView) 가
    /// 주입하는 콜백. 콜백이 없으면 PlanGate 는 단순히 닫힌다.
    var onRequestBilling: (() -> Void)? = nil

    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var auth: AuthViewModel

    var body: some View {
        VoiceProfileManagementPanel(
            route: $route,
            onRequestBilling: onRequestBilling,
            // 유료 게이트는 **항상** 쿠폰 갈래를 함께 낸다(`PaidGateCopy.redeemCode`).
            onRedeemCode: { code in
                await socialFeatures.registerCodeReportingFailure(code, session: auth.session)
            }
        )
        .fullScreenCover(isPresented: subflowPresented) {
            NavigationStack {
                subflow
            }
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
            ScrollView {
                VoiceCloneUploadFlow(route: $route)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
            }
            .homeGradientBackground()
        case .preview(let draftID):
            if let draft = voice.profiles.first(where: { $0.id == draftID }) ?? voice.pendingDraft {
                ScrollView {
                    VoicePreviewConfirmView(
                        draft: draft,
                        onSaved: { route = .preparation($0) },
                        onDiscarded: { route = .clone }
                    )
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
                }
                .homeGradientBackground()
            } else {
                // 초안을 못 찾으면(새로고침 중 유실 등) 갇히지 않게 목록으로 돌린다.
                Color.clear.onAppear { route = .management }
            }
        case .preparation(let voiceID):
            ClipPreparationView(
                onDismiss: { route = .management },
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
