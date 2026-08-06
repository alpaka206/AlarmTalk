import AVFoundation
import SwiftUI

/// 홈 탭의 컨테이너 화면.
///
/// ContentView 의 `homeScreen` 을 옮긴 것. 자체 상태는 없고 라우팅 콜백을
/// 자식 컴포넌트에 분배한다.
struct HomeView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

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
            NextAlarmHeroCard(
                nextAlarm: nextAlarm,
                alarmPermissionMissing: !permissionSnapshot.alarmAuthorized
            ) {
                // 권한이 없으면 편집기로 보내지 않는다 — 고쳐야 할 것은 알람이 아니라 권한이다.
                if !permissionSnapshot.alarmAuthorized {
                    requestAlarmAuthorization()
                } else if let nextAlarm {
                    openEditor(.edit(nextAlarm.id))
                } else {
                    Task { await openAlarmFromHome() }
                }
            }
            QuickStartGrid(
                onOpenVoices: openVoicesFromHome,
                onOpenEditor: { Task { await openAlarmFromHome() } },
                canCreateFamilyAlarm: canCreateFamilyAlarm,
                onOpenFamilyAlarm: openFamilyAlarmFromHome,
                voiceLocked: !hasPaidVoiceAccess || !permissionSnapshot.microphoneGranted,
                alarmLocked: !permissionSnapshot.alarmAuthorized
            )
            // ⚠ 여기에 `AlarmPermissionSection` 을 또 두지 말 것.
            // 히어로 헤드라인이 이미 같은 사실을 말하고, 탭이 곧 복구 경로다.
            // 안드로이드가 배너를 걷어내며 못 박은 규칙 — "같은 말을 두 번 하지 않는다"
            // (7b1a967c). 권한 카드는 알람 탭 한 곳에만 둔다.
        }
        .task {
            await refreshPermissionSnapshot()
        }
    }

    private var canCreateFamilyAlarm: Bool {
        guard auth.session != nil, hasFamilyAlarmAccess else { return false }
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return socialFeatures.selectableMembers.contains { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
        }
    }

    private var hasPaidVoiceAccess: Bool {
        currentPlan.meetsOrExceeds(.personal)
    }

    private var hasFamilyAlarmAccess: Bool {
        socialFeatures.familyGroup?.group != nil || currentPlan.meetsOrExceeds(.couple)
    }

    private var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
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

    /// 알람 권한을 같은 제스처 안에서 요청한 뒤 곧바로 에디터를 연다
    /// (AlarmsListView.openCreateAlarm 미러). 거부되면 열지 않고, 거부해도
    /// 에디터 저장 시 AlarmKitViewModel.schedule() 이 다시 권한을 요청한다.
    @MainActor
    private func openAlarmFromHome() async {
        alarmKit.refreshAuthorizationState()
        if !alarmKit.alarmAuthorized {
            // 거부가 굳으면 `requestAuthorization()` 은 프롬프트 없이 같은 상태로 즉시
            // 돌아온다. 그대로 return 하면 버튼이 **문자 그대로 아무 일도 하지 않아**
            // 앱이 고장 난 것처럼 보인다. 유일한 복구 경로로 직접 보낸다.
            if alarmKit.permissionRecoveryNeeded {
                openAppSettings()
                return
            }
            await alarmKit.requestAuthorization()
            alarmKit.refreshAuthorizationState()
            await refreshPermissionSnapshot()
            guard alarmKit.alarmAuthorized else { return }
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
        // 굳은 거부에서는 프롬프트가 뜨지 않는다 — 설정으로 보내지 않으면 무반응이다.
        if permissionSnapshot.alarmRecoveryNeeded {
            openAppSettings()
            return
        }
        Task {
            await alarmKit.requestAuthorization()
            await refreshPermissionSnapshot()
        }
    }

    private func requestMicrophone() {
        // 마이크도 같다 — 한 번 거부한 뒤에는 시스템이 프롬프트를 다시 띄우지 않는다.
        if permissionSnapshot.microphoneRecoveryNeeded {
            openAppSettings()
            return
        }
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
                .foregroundStyle(theme.palette.onBackground)
            Text(greeting.bottom)
                .font(.title.weight(.bold))
                .foregroundStyle(theme.palette.onBackground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
#Preview("HomeView (light)") {
    HomeView(
        openEditor: { _ in },
        selectTab: { _ in }
    )
    .padding()
    .voiceAlarmPreviewEnvironment()
}

#Preview("HomeView (dark)") {
    HomeView(
        openEditor: { _ in },
        selectTab: { _ in }
    )
    .padding()
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
