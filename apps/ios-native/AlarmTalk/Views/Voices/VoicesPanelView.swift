import SwiftUI

/// 음성 탭의 라우팅 enum — 본 화면 + 자식 플로우.
enum VoicesRoute: Hashable {
    case management
    case clone
}

/// 음성 탭 컨테이너 — VoiceProfileManagementPanel 을 중심으로 자식 플로우(녹음)를 라우팅.
///
/// ⚠ 화자 분리(`.separate`)는 **제품에서 사라졌다** — 백엔드 라우트도 `voice_speakers`
/// 테이블도 없다(마이그레이션 #79 DROP). 되살리지 말 것.
///
/// Phase 3-C1 의 인라인 패널을 Phase 3-C4 가 본 3-라우트 구조로 교체. 모든 자식
/// 컴포넌트는 동일한 `VoiceStudioViewModel` 을 공유한다. `MainTabsView` 가 본
/// 컨테이너를 자체 ScrollView 안에서 호출하므로, 본 컨테이너는 추가 ScrollView 를
/// 두지 않고 자식 컴포넌트도 inline 으로 풀어쓴다.
struct VoicesPanelView: View {
    @State private var route: VoicesRoute = .management

    /// Phase 4-D1: PlanGate 시트에서 "결제 화면으로" 를 누르면 Root 의
    /// BillingPanel(auxiliaryScreen = .billing) 을 열도록 부모(MainTabsView) 가
    /// 주입하는 콜백. 콜백이 없으면 PlanGate 는 단순히 닫힌다.
    var onRequestBilling: (() -> Void)? = nil

    var body: some View {
        Group {
            switch route {
            case .management:
                VoiceProfileManagementPanel(route: $route, onRequestBilling: onRequestBilling)
            case .clone:
                VoiceCloneUploadFlow(route: $route)
            }
        }
        .animation(.default, value: route)
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
