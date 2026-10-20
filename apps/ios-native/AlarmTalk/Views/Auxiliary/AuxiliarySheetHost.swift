import SwiftUI

/// 이용권 보조 화면의 진입점.
///
/// 예전에는 시트였지만 지금은 `MainTabsView`의 `NavigationStack`에 push된다.
struct AuxiliarySheetHost: View {
    let screen: AuxiliaryScreen

    var body: some View {
        // ⚠ **`NavigationStack` 을 다시 감싸지 말 것.** 이 화면은 `MainTabsView` 의 루트
        // 스택에 **push** 된다(예전에는 시트라 자기 스택이 필요했다). 여기서 또 감싸면
        // 스택이 겹쳐 뒤로가기가 두 벌이 되고, 안쪽 화면의 `.navigationDestination` 이
        // 어느 스택으로 가는지도 어긋난다.
        //
        // ⚠ **상단 X 도 두지 않는다** — 뒤로가기가 이미 같은 일을 한다.
        // ⚠ **상단 상태 배너를 되살리지 말 것**(2026-08-13 지시).
        // 이 화면의 오류는 **그 오류가 난 자리 옆**에서 말한다.
        // 위에 띄우면 (1) 같은 말이 두 번 나오고 (2) 배너가 생겼다 사라지며 본문이
        // 아래로 밀렸다 올라와, 사용자에게는 "경고는 없고 화면만 튀는" 것으로 보인다.
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 제목은 네비게이션 바에 있다 — 여기 `ScreenHeader` 를 되살리지 말 것.
                switch screen {
                case .billing:
                    BillingPanel()
                }
            }
            .padding(20)
        }
        .homeGradientBackground()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .homeGradientBackground()
        // 제목은 네비게이션 바가 그린다 — 본문 `ScreenHeader` 를 같이 두면 두 번 나온다.
        .navigationTitle(screen.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

#if DEBUG
#Preview("AuxiliarySheet — billing (dark)") {
    AuxiliarySheetHost(screen: .billing)
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}

#Preview("AuxiliarySheet — billing (light)") {
    AuxiliarySheetHost(screen: .billing)
        .voiceAlarmPreviewEnvironment()
}
#endif
