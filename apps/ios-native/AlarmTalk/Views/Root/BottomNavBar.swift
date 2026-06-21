import SwiftUI

/// 커스텀 바텀 네비게이션 바.
///
/// ContentView 의 `bottomBar` 를 그대로 옮긴 것. 4개 탭에 배지를 띄울 수 있도록
/// `badgeProvider` 클로저를 받는다. (호출부: MainTabsView 가 store.alarms,
/// socialFeatures.unreadNoteCount 등을 합쳐서 넘긴다.)
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
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 22, weight: .semibold))
                            let badge = badgeProvider(tab)
                            if badge > 0 {
                                Text(badge > 99 ? "99+" : "\(badge)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(theme.palette.error, in: Capsule())
                                    .offset(x: 12, y: -8)
                            }
                        }
                        Text(tab.title)
                            .font(.caption2.weight(selected == tab ? .semibold : .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .foregroundStyle(selected == tab ? theme.palette.onSurface : theme.palette.onSurfaceVariant)
                    .background(
                        selected == tab ? theme.palette.surfaceVariant : Color.clear,
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                }
                .buttonStyle(.plain)
                .disabled(selected == tab)
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .background(theme.palette.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.palette.surfaceVariant)
                .frame(height: 1)
        }
    }
}

#if DEBUG
private struct BottomNavBarPreviewHost: View {
    @State private var tab: NativeTab = .home
    var body: some View {
        BottomNavBar(selected: $tab) { tab in
            switch tab {
            case .alarms: return 2
            case .messages: return 5
            default: return 0
            }
        }
    }
}

#Preview("BottomNavBar (light)") {
    BottomNavBarPreviewHost()
}

#Preview("BottomNavBar (dark)") {
    BottomNavBarPreviewHost()
        .preferredColorScheme(.dark)
}
#endif
