import SwiftUI

/// 커스텀 바텀 네비게이션 바.
///
/// ContentView 의 `bottomBar` 를 그대로 옮긴 것. 3개 탭에 배지를 띄울 수 있도록
/// `badgeProvider` 클로저를 받는다. (호출부: MainTabsView 가 store.alarms 기반
/// 받은-알람 카운트 등을 넘긴다.)
struct BottomNavBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var selected: NativeTab
    let badgeProvider: (NativeTab) -> Int
    var onSelect: ((NativeTab) -> Void)? = nil

    var body: some View {
        HStack(spacing: 6) {
            ForEach(NativeTab.allCases) { tab in
                Button {
                    if let onSelect {
                        onSelect(tab)
                    } else {
                        selected = tab
                    }
                } label: {
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: selected == tab ? tab.selectedSystemImage : tab.systemImage)
                                .font(.system(size: 22, weight: .semibold))
                            let badge = badgeProvider(tab)
                            if badge > 0 {
                                Text(badge > 99 ? "99+" : "\(badge)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(theme.palette.onError)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(theme.palette.error, in: Capsule())
                                    .offset(x: 12, y: -8)
                            }
                        }
                        Text(tab.title)
                            .font(.caption2.weight(selected == tab ? .semibold : .medium))
                    }
                    // ⚠ **선택 탭에 배경 알약을 두지 않는다.** 안드로이드는 색(+채워진
                    // 아이콘 스왑)만으로 선택을 표시한다(`AlarmTalkBottomBar.kt:107` 주석
                    // "배경 인디케이터 없이 색으로만"). 알약을 다시 넣지 말 것.
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .foregroundStyle(selected == tab ? theme.palette.primary : theme.palette.onSurfaceVariant)
                }
                .buttonStyle(.plain)
                .disabled(selected == tab)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        // 배경색과 같게 깔아 시스템 홈 인디케이터 영역과 이음새 없이 이어지게 한다
        // (안드로이드 `AlarmTalkBottomBar.kt:49-52`). 구분선도 두지 않는다 —
        // `surface` + 상단 1px 선은 옛 iOS 전용 처리였다.
        .background(theme.palette.background)
    }


    /// 선택 탭 전경: 밝게 onPrimaryContainer, 어둡게 primary. Android `:122-126` 미러.
}

#if DEBUG
private struct BottomNavBarPreviewHost: View {
    @State private var tab: NativeTab = .alarms
    var body: some View {
        BottomNavBar(selected: $tab) { tab in
            switch tab {
            case .alarms: return 2
            default: return 0
            }
        }
    }
}

#Preview("BottomNavBar (light)") {
    BottomNavBarPreviewHost()
        .voiceAlarmPreviewEnvironment()
}

#Preview("BottomNavBar (dark)") {
    BottomNavBarPreviewHost()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
