import SwiftUI

/// People/Growth/Billing 보조 화면들의 단일 시트 진입점.
///
/// ContentView 의 `auxiliarySheet(_:)` 를 옮긴 것. 시트의 NavigationStack 과
/// X 닫기 버튼은 본 호스트가 표준화한다. 부모(MainTabsView)는 어떤 화면을 띄울지만
/// `.sheet(item:)` 으로 결정하면 된다.
struct AuxiliarySheetHost: View {
    let screen: AuxiliaryScreen
    let onClose: () -> Void
    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    var body: some View {
        NavigationStack {
            content
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel(Text("닫기"))
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if screen == .members {
            MemberManagementView()
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(title: screen.title)
                    switch screen {
                    case .people:
                        PeoplePanel(onCodeRegistered: onCodeRegistered)
                    case .growth:
                        GrowthPanel()
                    case .billing:
                        BillingPanel()
                    case .members:
                        EmptyView()
                    }
                }
                .padding(20)
            }
            .background(VoiceAlarmTheme.background)
        }
    }
}

#if DEBUG
#Preview("AuxiliarySheet — people (light)") {
    AuxiliarySheetHost(screen: .people, onClose: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("AuxiliarySheet — growth (dark)") {
    AuxiliarySheetHost(screen: .growth, onClose: {})
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}

#Preview("AuxiliarySheet — members (light)") {
    AuxiliarySheetHost(screen: .members, onClose: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("AuxiliarySheet — billing (light)") {
    AuxiliarySheetHost(screen: .billing, onClose: {})
        .voiceAlarmPreviewEnvironment()
}
#endif
