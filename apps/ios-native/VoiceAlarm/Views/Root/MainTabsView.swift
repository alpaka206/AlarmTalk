import SwiftUI

/// 인증된 상태에서 보여주는 본 메인 화면. 4개 탭 라우팅 + 시트 호스트.
///
/// ContentView 의 `mainApp` 을 그대로 옮겨 router 책임에 집중시켰다.
/// 설정/보조/편집 화면을 독립 sheet 로 관리한다.
struct MainTabsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager
    @EnvironmentObject private var store: LocalAlarmStore

    @State private var selectedTab: NativeTab = .home
    @State private var planGate: PlanGateState?
    @State private var receivedAlarmSeenAtMillis: Int64 = 0

    /// `editorTarget` 이 nil 이 아니면 알람 편집 시트가 뜬다.
    @State private var editorTarget: AlarmEditorTarget?

    /// 설정 시트 표시 여부.
    @State private var settingsPresented = false

    /// 보조 시트 표시 — People/Growth/Billing.
    @State private var auxiliaryScreen: AuxiliaryScreen?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        currentTabContent
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                }
                .background(VoiceAlarmTheme.background)

                BottomNavBar(
                    selected: $selectedTab,
                    badgeProvider: badgeCount(for:),
                    onSelect: selectTab
                )
            }
            .background(VoiceAlarmTheme.background)
            .navigationTitle(selectedTab.navigationTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if socialFeatures.familyGroup?.group == nil {
                            Button {
                                auxiliaryScreen = .people
                            } label: {
                                Label("초대 코드 등록", systemImage: "qrcode")
                            }
                        }
                        Button {
                            auxiliaryScreen = .growth
                        } label: {
                            Label("캐릭터", systemImage: "sparkles")
                        }
                        Button {
                            auxiliaryScreen = .billing
                        } label: {
                            Label("이용권", systemImage: "creditcard")
                        }
                        if socialFeatures.familyGroup?.group != nil {
                            Button {
                                auxiliaryScreen = .members
                            } label: {
                                Label("공유 이용권", systemImage: "person.2")
                            }
                        }
                        Divider()
                        Button {
                            settingsPresented = true
                        } label: {
                            Label("설정", systemImage: "gearshape")
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("프로필")
                }
            }
            .sheet(item: $editorTarget) { target in
                NavigationStack {
                    AlarmEditorSheet(
                        target: target,
                        onClose: { editorTarget = nil },
                        onJumpToVoices: {
                            editorTarget = nil
                            selectedTab = .voices
                        },
                        onSchedulingDidFinish: {
                            editorTarget = nil
                            selectedTab = .alarms
                        }
                    )
                }
            }
            .sheet(isPresented: $settingsPresented) {
                NavigationStack {
                    SettingsView(
                        onClose: { settingsPresented = false }
                    )
                }
            }
            .sheet(item: $auxiliaryScreen) { screen in
                AuxiliarySheetHost(
                    screen: screen,
                    onClose: { auxiliaryScreen = nil },
                    onCodeRegistered: handleCodeRegistrationDestination
                )
            }
            .planGate(item: $planGate) {
                openBillingAfterPlanGate()
            }
            .task(id: auth.session?.token) {
                loadReceivedAlarmBadgeState()
                await refreshAll()
                ensureReceivedAlarmBadgeBaseline()
            }
            .task(id: selectedTab) {
                await refreshForSelectedTab(selectedTab)
            }
        }
    }

    @ViewBuilder
    private var currentTabContent: some View {
        switch selectedTab {
        case .home:
            HomeView(
                openAuxiliary: { auxiliaryScreen = $0 },
                openEditor: { editorTarget = $0 },
                selectTab: selectTab
            )
        case .voices:
            // Phase 4-D1: 슬롯 가득 PlanGate 의 "결제 화면으로" 가 눌리면 BillingPanel
            // auxiliary 시트로 chain. PlanGate 시트가 자신을 닫는 dismiss animation 과
            // BillingPanel 시트의 present 가 겹치지 않도록 300ms 지연 후 띄운다.
            //
            // Settings sheet dismiss animation 과 BillingPanel present 가 겹치지
            // 않도록 직접 라우팅은 짧게 지연한다.
            VoicesPanelView(onRequestBilling: {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    auxiliaryScreen = .billing
                }
            })
        case .alarms:
            AlarmsListView(openEditor: { editorTarget = $0 })
        case .messages:
            MessagesView(
                selectTab: selectTab,
                onCodeRegistered: handleCodeRegistrationDestination
            )
        }
    }

    private func selectTab(_ tab: NativeTab) {
        guard selectedTab != tab else { return }
        if let gate = planGateFor(tab) {
            planGate = gate
            return
        }
        selectedTab = tab
    }

    private func planGateFor(_ tab: NativeTab) -> PlanGateState? {
        switch tab {
        case .voices:
            guard auth.session != nil,
                  socialFeatures.subscription != nil,
                  !currentPlan.meetsOrExceeds(.personal)
            else { return nil }
            return PlanGateState(
                title: "이용권이 필요한 기능이에요",
                message: "유료 이용권에서 사용할 수 있어요.",
                confirmLabel: "이용권 보기",
                currentPlan: currentPlan,
                requiredPlan: .personal
            )
        case .messages:
            guard auth.session != nil,
                  socialFeatures.subscription != nil,
                  socialFeatures.familyGroup != nil,
                  !canUseMessages
            else { return nil }
            return PlanGateState(
                title: "이용권이 필요한 기능이에요",
                message: "메시지는 커플/가족 이용권에서 사용할 수 있어요.",
                confirmLabel: "이용권 보기",
                currentPlan: currentPlan,
                requiredPlan: .couple
            )
        case .home, .alarms:
            return nil
        }
    }

    private var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    private var canUseMessages: Bool {
        socialFeatures.familyGroup?.group != nil || currentPlan.meetsOrExceeds(.couple)
    }

    private func openBillingAfterPlanGate() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            auxiliaryScreen = .billing
        }
    }

    private func handleCodeRegistrationDestination(_ destination: CodeRegistrationDestination) {
        switch destination {
        case .home:
            auxiliaryScreen = nil
            selectedTab = .home
        case .sharedPass:
            auxiliaryScreen = .members
        }
    }

    private func badgeCount(for tab: NativeTab) -> Int {
        switch tab {
        case .home, .voices:
            return 0
        case .alarms:
            return selectedTab == .alarms ? 0 : unreadReceivedAlarmCount
        case .messages:
            return socialFeatures.unreadNoteCount
        }
    }

    private var unreadReceivedAlarmCount: Int {
        store.alarms.count { alarm in
            alarm.originEnum == .receivedRemote &&
                alarm.createdAtMillis > receivedAlarmSeenAtMillis
        }
    }

    private func refreshAll() async {
        await remoteSync.refresh(session: auth.session)
        await voiceStudio.refresh(session: auth.session)
        await socialFeatures.refreshAll(session: auth.session)
        alarmKit.refreshAuthorizationState()
    }

    private func refreshForSelectedTab(_ tab: NativeTab) async {
        guard auth.session != nil else { return }
        switch tab {
        case .home:
            await socialFeatures.refreshAll(session: auth.session)
        case .voices:
            await voiceStudio.refresh(session: auth.session)
            await socialFeatures.refreshAll(session: auth.session)
        case .alarms:
            await remoteSync.refresh(session: auth.session)
            alarmKit.refreshAuthorizationState()
            markReceivedAlarmsSeen()
        case .messages:
            await socialFeatures.refreshAll(session: auth.session)
            await voiceStudio.refresh(session: auth.session)
        }
    }

    private func loadReceivedAlarmBadgeState() {
        guard let userID = auth.session?.user.id else {
            receivedAlarmSeenAtMillis = 0
            return
        }
        receivedAlarmSeenAtMillis = ReceivedAlarmBadgeStore().readSeenAtMillis(userID: userID)
    }

    private func ensureReceivedAlarmBadgeBaseline() {
        guard let userID = auth.session?.user.id else { return }
        let badgeStore = ReceivedAlarmBadgeStore()
        if badgeStore.hasBaseline(userID: userID) {
            receivedAlarmSeenAtMillis = badgeStore.readSeenAtMillis(userID: userID)
        } else {
            receivedAlarmSeenAtMillis = badgeStore.markSeen(userID: userID, alarms: store.alarms)
        }
    }

    private func markReceivedAlarmsSeen() {
        guard let userID = auth.session?.user.id else { return }
        receivedAlarmSeenAtMillis = ReceivedAlarmBadgeStore().markSeen(userID: userID, alarms: store.alarms)
    }
}

#if DEBUG
#Preview("MainTabsView (light)") {
    MainTabsView()
        .voiceAlarmPreviewEnvironment()
}

#Preview("MainTabsView (dark)") {
    MainTabsView()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
