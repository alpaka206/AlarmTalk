import SwiftUI

/// 커스텀 바텀 네비게이션 바.
///
/// ContentView 의 `bottomBar` 를 그대로 옮긴 것. 4개 탭에 배지를 띄울 수 있도록
/// `badgeProvider` 클로저를 받는다. (호출부: MainTabsView 가 store.alarms,
/// socialFeatures.unreadNoteCount 등을 합쳐서 넘긴다.)
///
/// 메시지 탭 잠금: 커플/가족 접근이 없으면 잠금 표식을 띄우고 배지를 숨긴다
/// (Android `AlarmTalkBottomBar.kt` 의 `messagesLocked` 동작). 호출부가 따로
/// 플래그를 넘기지 않아도 되도록 접근 상태를 환경 ViewModel 에서 직접 계산한다.
struct BottomNavBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager
    @Binding var selected: NativeTab
    let badgeProvider: (NativeTab) -> Int
    var onSelect: ((NativeTab) -> Void)? = nil

    var body: some View {
        HStack(spacing: 6) {
            ForEach(NativeTab.allCases) { tab in
                let locked = tab == .messages && messagesLocked
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
                            // 잠금 상태에선 배지를 숨긴다 (Android messagesLocked → 배지 억제).
                            let badge = locked ? 0 : badgeProvider(tab)
                            if badge > 0 {
                                Text(badge > 99 ? "99+" : "\(badge)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(theme.palette.onError)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(theme.palette.error, in: Capsule())
                                    .offset(x: 12, y: -8)
                            }
                            if locked {
                                // 메시지 탭 잠금 표식 (Android Lock 오버레이 미러: surface 원형 + 자물쇠).
                                ZStack {
                                    Circle().fill(theme.palette.surface)
                                    Image(systemName: "lock")
                                        .font(.system(size: 9, weight: .semibold))
                                        .foregroundStyle(theme.palette.onSurfaceVariant)
                                }
                                .frame(width: 15, height: 15)
                                .offset(x: 9, y: -4)
                                .accessibilityHidden(true)
                            }
                        }
                        Text(tab.title)
                            .font(.caption2.weight(selected == tab ? .semibold : .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .foregroundStyle(selected == tab ? selectedContentColor : theme.palette.onSurfaceVariant)
                    .background(
                        selected == tab ? selectedBackgroundColor : Color.clear,
                        in: RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
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

    /// 선택 탭 배경: 밝게에선 primaryContainer(파랑 알약), 어둡게에선 surfaceVariant.
    /// Android `AlarmTalkBottomBar.kt:117-121` (isDarkScheme 분기) 미러.
    private var selectedBackgroundColor: Color {
        colorScheme == .dark ? theme.palette.surfaceVariant : theme.palette.primaryContainer
    }

    /// 선택 탭 전경: 밝게 onPrimaryContainer, 어둡게 primary. Android `:122-126` 미러.
    private var selectedContentColor: Color {
        colorScheme == .dark ? theme.palette.primary : theme.palette.onPrimaryContainer
    }

    /// 메시지 탭 잠금 여부 = 커플/가족 접근 없음. MainTabsView.canUseMessages 와 동일한
    /// 판정으로, Android `hasCoupleOrFamilyAccess` 미러.
    private var messagesLocked: Bool {
        !(socialFeatures.familyGroup?.group != nil || currentPlan.meetsOrExceeds(.couple))
    }

    private var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
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
        .voiceAlarmPreviewEnvironment()
}

#Preview("BottomNavBar (dark)") {
    BottomNavBarPreviewHost()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
