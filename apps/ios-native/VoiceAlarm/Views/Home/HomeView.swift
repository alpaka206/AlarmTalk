import AVFoundation
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
    @EnvironmentObject private var subscriptions: SubscriptionManager

    let openAuxiliary: (AuxiliaryScreen) -> Void
    let openEditor: (AlarmEditorTarget) -> Void
    let selectTab: (NativeTab) -> Void
    @State private var permissionSnapshot = LoginPermissionSnapshot.unknown

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
                    openAlarmFromHome()
                }
            }
            QuickStartGrid(
                onOpenVoices: openVoicesFromHome,
                onOpenEditor: openAlarmFromHome,
                canCreateFamilyAlarm: canCreateFamilyAlarm,
                onOpenFamilyAlarm: openFamilyAlarmFromHome,
                voiceLocked: !hasPaidVoiceAccess || !permissionSnapshot.microphoneGranted,
                alarmLocked: !permissionSnapshot.alarmAuthorized
            )
            CharacterMiniCard {
                openAuxiliary(.growth)
            }
        }
        .task {
            await refreshPermissionSnapshot()
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
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        .meetsOrExceeds(.personal)
    }

    private func openVoicesFromHome() {
        guard hasPaidVoiceAccess else {
            selectTab(.voices)
            return
        }
        guard permissionSnapshot.microphoneGranted else {
            requestMicrophone()
            return
        }
        selectTab(.voices)
    }

    private func openAlarmFromHome() {
        guard permissionSnapshot.alarmAuthorized else {
            requestAlarmAuthorization()
            return
        }
        openEditor(.create())
    }

    private func openFamilyAlarmFromHome() {
        guard permissionSnapshot.alarmAuthorized else {
            requestAlarmAuthorization()
            return
        }
        openEditor(.createFamily())
    }

    private func requestAlarmAuthorization() {
        Task {
            await alarmKit.requestAuthorization()
            await refreshPermissionSnapshot()
        }
    }

    private func requestMicrophone() {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { _ in
                Task { @MainActor in await refreshPermissionSnapshot() }
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                Task { @MainActor in await refreshPermissionSnapshot() }
            }
        }
    }

    private func refreshPermissionSnapshot() async {
        permissionSnapshot = LoginPermissionSnapshot.current(alarmKit: alarmKit)
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
