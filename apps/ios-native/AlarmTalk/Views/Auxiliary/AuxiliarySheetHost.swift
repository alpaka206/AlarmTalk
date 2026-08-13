import SwiftUI

/// People/Billing 보조 화면들의 단일 시트 진입점.
///
/// ContentView 의 `auxiliarySheet(_:)` 를 옮긴 것. 시트의 NavigationStack 과
/// X 닫기 버튼은 본 호스트가 표준화한다. 부모(MainTabsView)는 어떤 화면을 띄울지만
/// `.sheet(item:)` 으로 결정하면 된다.
struct AuxiliarySheetHost: View {
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    let screen: AuxiliaryScreen
    let onClose: () -> Void
    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    var body: some View {
        // ⚠ **`NavigationStack` 을 다시 감싸지 말 것.** 이 화면은 `MainTabsView` 의 루트
        // 스택에 **push** 된다(예전에는 시트라 자기 스택이 필요했다). 여기서 또 감싸면
        // 스택이 겹쳐 뒤로가기가 두 벌이 되고, 안쪽 화면의 `.navigationDestination` 이
        // 어느 스택으로 가는지도 어긋난다.
        //
        // ⚠ **상단 X 도 두지 않는다** — 뒤로가기가 이미 같은 일을 한다.
        // `onClose` 는 코드 등록 성공 뒤 화면을 뜨는 데만 쓴다.
        // ⚠ **상단 상태 배너를 되살리지 말 것**(2026-08-13 지시).
        // 이 화면들의 오류는 **그 오류가 난 자리 옆**에서 말한다(코드 등록이면 입력창 밑).
        // 위에 띄우면 (1) 같은 말이 두 번 나오고 (2) 배너가 생겼다 사라지며 본문이
        // 아래로 밀렸다 올라와, 사용자에게는 "경고는 없고 화면만 튀는" 것으로 보인다.
        content
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .homeGradientBackground()
        // 제목은 네비게이션 바가 그린다 — 본문 `ScreenHeader` 를 같이 두면 두 번 나온다.
        .navigationTitle(screen.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var content: some View {
        if screen == .members {
            MemberManagementView()
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // 제목은 네비게이션 바에 있다 — 여기 `ScreenHeader` 를 되살리지 말 것.
                    switch screen {
                    case .people:
                        PeoplePanel(onCodeRegistered: onCodeRegistered)
                    case .billing:
                        BillingPanel()
                    case .members:
                        EmptyView()
                    }
                }
                .padding(20)
            }
            .homeGradientBackground()
        }
    }
}

private struct AuxiliaryStatusBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.primary)
            Text(message)
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#if DEBUG
#Preview("AuxiliarySheet — people (light)") {
    AuxiliarySheetHost(screen: .people, onClose: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("AuxiliarySheet — billing (dark)") {
    AuxiliarySheetHost(screen: .billing, onClose: {})
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
