import SwiftUI

/// 홈 탭의 컨테이너 화면.
///
/// ContentView 의 `homeScreen` 을 옮긴 것. 자체 상태는 없고 라우팅 콜백을
/// 자식 컴포넌트에 분배한다.
struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    let openAuxiliary: (AuxiliaryScreen) -> Void
    let openEditor: (AlarmEditorTarget) -> Void
    let selectTab: (NativeTab) -> Void

    private var nextAlarm: LocalAlarmRecord? {
        store.alarms
            .filter(\.enabled)
            .sorted { $0.nextFireDate < $1.nextFireDate }
            .first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            homeHeader
            NextAlarmHeroCard(nextAlarm: nextAlarm) {
                if let nextAlarm {
                    openEditor(.edit(nextAlarm.id))
                } else {
                    openEditor(.create())
                }
            }
            QuickStartGrid(
                onOpenVoices: { selectTab(.voices) },
                onOpenEditor: { openEditor(.create()) },
                canCreateFamilyAlarm: canCreateFamilyAlarm,
                onOpenFamilyAlarm: { openEditor(.createFamily()) },
                voiceLocked: !hasPaidVoiceAccess,
                alarmLocked: !alarmKit.alarmAuthorized
            )
            CharacterMiniCard {
                openAuxiliary(.growth)
            }
        }
    }

    private var canCreateFamilyAlarm: Bool {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return socialFeatures.selectableMembers.contains { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
        }
    }

    private var hasPaidVoiceAccess: Bool {
        guard socialFeatures.subscription?.subscription?.status == "active" else { return false }
        let key = socialFeatures.subscription?.plan?.key
        let type = socialFeatures.subscription?.plan?.planType
        return ["personal", "plus", "couple", "family"].contains(key ?? "") ||
            ["personal", "individual", "plus", "couple", "family"].contains(type ?? "")
    }

    private var homeHeader: some View {
        let greeting = HelperFormatters.homeGreeting()
        return VStack(alignment: .leading, spacing: 2) {
            Text(greeting.top)
                .font(.title.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
            Text(greeting.bottom)
                .font(.title.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
#Preview("HomeView (light)") {
    HomeView(
        openAuxiliary: { _ in },
        openEditor: { _ in },
        selectTab: { _ in }
    )
    .padding()
    .voiceAlarmPreviewEnvironment()
}

#Preview("HomeView (dark)") {
    HomeView(
        openAuxiliary: { _ in },
        openEditor: { _ in },
        selectTab: { _ in }
    )
    .padding()
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
