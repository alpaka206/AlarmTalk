import SwiftUI

/// 커스텀 바텀 네비게이션 바.
///
/// ContentView 의 `bottomBar` 를 그대로 옮긴 것. 치수는 안드로이드 `AlarmTalkBottomBar` 와 같다 — 높이 **76**(위아래 6 포함,
/// 홈 인디케이터 몫은 따로), 아이콘 칸 30 ↔ 라벨 4, 라벨 12(2026-11-22 두 앱 통일. 그전 iOS 는 70 · 26 · 3 · 시스템 글꼴 11).
struct BottomNavBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var selected: NativeTab
    var onSelect: ((NativeTab) -> Void)? = nil

    /// 바의 높이(홈 인디케이터 몫 제외). ＋FAB 와 켜면 뜨는 안내가 이 위에 뜬다(`FloatingChrome.bottomInset`).
    /// `nonisolated` — 뷰 밖의 상수(`FloatingChrome`)가 읽는다.
    nonisolated static let height: CGFloat = 76
    /// 바 안쪽 위아래·좌우 여백.
    private static let inset: CGFloat = 6

    var body: some View {
        HStack(spacing: 6) {
            ForEach(NativeTab.allCases) { tab in
                Button {
                    // 고른 탭을 다시 눌러도 아무 일도 하지 않는다. ⚠ **`.disabled` 로 막지 말 것** — 잠긴 버튼은 SwiftUI 가
                    // 흐리게 칠해, 고른 탭이 primary 가 아니라 칙칙한 #58708B 로 보였다(안 고른 탭보다 어두웠다). 안드로이드는
                    // 고른 탭이 primary 그대로다(2026-11-15 두 앱 화면 대조).
                    guard selected != tab else { return }
                    if let onSelect {
                        onSelect(tab)
                    } else {
                        selected = tab
                    }
                } label: {
                    VStack(spacing: 4) {
                        // ⚠ **세 탭 모두 SF 심볼이다**(2026-08-17 지시 "글리프는 각 OS 것").
                        // 예전에는 알람만 **안드로이드 모양을 손으로 그린 도형**
                        // (`MaterialAlarmShape`)이었다 — iOS 화면에 머티리얼 글리프가
                        // 하나 섞여 있던 셈이다. 안드로이드도 반대 방향으로 같은 일을
                        // 하고 있었다(목소리·더보기가 SF 모양의 자체 드로어블).
                        Image(systemName: selected == tab ? tab.selectedSystemImage : tab.systemImage)
                            .font(.system(size: 22, weight: .semibold))
                            // 아이콘 자리는 높이를 같게 둔다 — ••• 처럼 낮은 글리프도 글자 줄이 다른 탭과 맞는다(안드로이드는
                            // 30 높이 아이콘 상자). 예전에는 '더보기' 글자만 위로 떠 있었다.
                            .frame(height: 30)
                        Text(tab.title)
                            .font(.pretendard(selected == tab ? .semibold : .medium, size: 12, relativeTo: .caption))
                    }
                    // ⚠ **선택 탭에 배경 알약을 두지 않는다.** 안드로이드는 색(+채워진
                    // 아이콘 스왑)만으로 선택을 표시한다(`AlarmTalkBottomBar.kt:104` 주석
                    // "배경 인디케이터 없이 색으로만"). 알약을 다시 넣지 말 것.
                    .frame(maxWidth: .infinity, minHeight: Self.height - Self.inset * 2)
                    // ⚠ **없으면 셀이 아니라 글리프만 눌린다 — 빼지 말 것**(2026-08-18
                    // 실기기 실측). `frame` 이 넓힌 자리는 SwiftUI 가 **투명한 레이아웃
                    // 공간**으로 두어 히트테스트에서 건너뛴다. 실제로 탭 셀은 127pt 인데
                    // 눌리는 폭이 **알람 21pt · 목소리 29pt · 더보기 29pt** 였다(셀의 77%가
                    // 죽어 있었고, 애플 HIG 최소 44pt 에도 한참 못 미쳤다).
                    .contentShape(Rectangle())
                    .foregroundStyle(selected == tab ? theme.palette.primary : theme.palette.onSurfaceVariant)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected == tab ? .isSelected : [])
            }
        }
        .padding(.horizontal, Self.inset)
        .padding(.vertical, Self.inset)
        // 배경색과 같게 깔아 시스템 홈 인디케이터 영역과 이음새 없이 이어지게 한다
        // (안드로이드 `AlarmTalkBottomBar.kt:46-49`). 구분선도 두지 않는다 —
        // `surface` + 상단 1px 선은 옛 iOS 전용 처리였다.
        .background(theme.palette.background)
    }


    /// 선택 탭 전경: 밝게 onPrimaryContainer, 어둡게 primary. Android `:122-126` 미러.
}

#if DEBUG
private struct BottomNavBarPreviewHost: View {
    @State private var tab: NativeTab = .alarms
    var body: some View {
        BottomNavBar(selected: $tab)
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
