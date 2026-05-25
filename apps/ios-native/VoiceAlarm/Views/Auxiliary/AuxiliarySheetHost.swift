import SwiftUI

/// People/Growth/Billing 보조 화면들의 단일 시트 진입점.
///
/// ContentView 의 `auxiliarySheet(_:)` 를 옮긴 것. 시트의 NavigationStack 과
/// X 닫기 버튼은 본 호스트가 표준화한다. 부모(MainTabsView)는 어떤 화면을 띄울지만
/// `.sheet(item:)` 으로 결정하면 된다.
struct AuxiliarySheetHost: View {
    let screen: AuxiliaryScreen
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(title: screen.title)
                    switch screen {
                    case .people:
                        PeoplePanel()
                    case .growth:
                        GrowthPanel()
                    case .billing:
                        BillingPanel()
                    }
                }
                .padding(20)
            }
            .background(VoiceAlarmTheme.background)
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

#Preview("AuxiliarySheet — billing (light)") {
    AuxiliarySheetHost(screen: .billing, onClose: {})
        .voiceAlarmPreviewEnvironment()
}
#endif
