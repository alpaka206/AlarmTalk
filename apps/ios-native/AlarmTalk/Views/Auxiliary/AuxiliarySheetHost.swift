import SwiftUI

/// People/Billing 보조 화면들의 단일 시트 진입점.
///
/// ContentView 의 `auxiliarySheet(_:)` 를 옮긴 것. 시트의 NavigationStack 과
/// X 닫기 버튼은 본 호스트가 표준화한다. 부모(MainTabsView)는 어떤 화면을 띄울지만
/// `.sheet(item:)` 으로 결정하면 된다.
struct AuxiliarySheetHost: View {
    /// 맨 위로 올릴 때 쓰는 목적지 표식.
    private static let topAnchorID = "auxiliary-screen-top"

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
            ScrollViewReader { proxy in
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
                    .id(Self.topAnchorID)
                }
                // ⚠ **이용권에서 나가면 맨 위로 올린다**(2026-08-15 지시).
                // 나가기 버튼은 화면 **아래쪽**에 있어서, 나간 뒤 그 자리에 그대로 있으면
                // 바뀐 이용권 카드(맨 위)가 안 보인다 — 무엇이 달라졌는지 알 수 없다.
                // 예전에는 토스트가 그 일을 대신했지만, 화면이 이미 말하는 것을 한 번 더
                // 말하는 것이라 없앴다(같은 지시).
                //
                // 판정은 그룹이 **사라진 순간**이다(있다 → 없다). 처음부터 없던 사람은
                // 화면을 건드리지 않는다.
                //
                // ⚠ **`.billing` 로 한정한다.** 나가기는 코드 등록 화면(`.people` 의
                // `CodeRegisterRow` → '나가고 등록하기')에서도 일어나는데, 거기서는 나간
                // **직후 입력창이 열린다** — 같이 맨 위로 올리면 방금 열린 그 입력창에서
                // 사용자를 끌어내린다. 그쪽은 다음 할 일이 화면에 이미 있다.
                .onChange(of: socialFeatures.familyGroup?.group?.id) { previous, current in
                    guard screen == .billing, previous != nil, current == nil else { return }
                    withAnimation(.snappy(duration: 0.25)) {
                        proxy.scrollTo(Self.topAnchorID, anchor: .top)
                    }
                }
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
