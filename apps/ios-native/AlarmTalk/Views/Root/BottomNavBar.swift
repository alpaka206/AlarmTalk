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
                            // ⚠ **세 탭 모두 SF 심볼이다**(2026-08-17 지시 "글리프는 각 OS 것").
                            // 예전에는 알람만 **안드로이드 모양을 손으로 그린 도형**
                            // (`MaterialAlarmShape`)이었다 — iOS 화면에 머티리얼 글리프가
                            // 하나 섞여 있던 셈이다. 안드로이드도 반대 방향으로 같은 일을
                            // 하고 있었다(목소리·더보기가 SF 모양의 자체 드로어블).
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
                    // ⚠ **없으면 셀이 아니라 글리프만 눌린다 — 빼지 말 것**(2026-08-18
                    // 실기기 실측). `frame` 이 넓힌 자리는 SwiftUI 가 **투명한 레이아웃
                    // 공간**으로 두어 히트테스트에서 건너뛴다. 실제로 탭 셀은 127pt 인데
                    // 눌리는 폭이 **알람 21pt · 목소리 29pt · 더보기 29pt** 였다(셀의 77%가
                    // 죽어 있었고, 애플 HIG 최소 44pt 에도 한참 못 미쳤다).
                    .contentShape(Rectangle())
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
