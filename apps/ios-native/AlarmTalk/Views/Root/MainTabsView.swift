import SwiftUI

/// 인증된 상태에서 보여주는 본 메인 화면. 4개 탭 라우팅 + 시트 호스트.
///
/// ContentView 의 `mainApp` 을 그대로 옮겨 router 책임에 집중시켰다.
/// 설정/보조/편집 화면을 독립 sheet 로 관리한다.
struct MainTabsView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var store: LocalAlarmStore

    @State private var selectedTab: NativeTab = .home
    @State private var receivedAlarmSeenAtMillis: Int64 = 0

    /// 탭 전환 시 매번 네트워크 요청이 나가면 살짝 버벅인다. 탭+토큰별 마지막
    /// 새로고침 시각을 기억해, 60초 안에 다시 들른 경우엔 재요청을 건너뛴다.
    /// (토큰이 바뀌면 키가 달라져 자연히 새로 받는다.) Android `lastTabRefreshAt`
    /// (`AlarmTalkApp.kt`) parity — 키는 "탭.token" 문자열.
    @State private var lastRefreshAt: [String: Date] = [:]
    private let tabRefreshThrottle: TimeInterval = 60

    /// `editorTarget` 이 nil 이 아니면 알람 편집 시트가 뜬다.
    @State private var editorTarget: AlarmEditorTarget?

    /// 설정 시트 표시 여부.
    @State private var settingsPresented = false

    /// 보조 시트 표시 — People/Billing.
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
                .background(theme.palette.background)

                BottomNavBar(
                    selected: $selectedTab,
                    badgeProvider: badgeCount(for:),
                    onSelect: selectTab
                )
            }
            .background(theme.palette.background)
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
        }
    }

    private func selectTab(_ tab: NativeTab) {
        guard selectedTab != tab else { return }
        selectedTab = tab
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
        }
    }

    private var unreadReceivedAlarmCount: Int {
        store.alarms.filter { alarm in
            alarm.originEnum == .receivedRemote &&
                alarm.createdAtMillis > receivedAlarmSeenAtMillis
        }.count
    }

    private func refreshAll() async {
        await remoteSync.refresh(session: auth.session)
        await voiceStudio.refresh(session: auth.session)
        await socialFeatures.refreshAll(session: auth.session)
        alarmKit.refreshAuthorizationState()
    }

    private func refreshForSelectedTab(_ tab: NativeTab) async {
        // 세션이 없으면 알람 탭은 로그인 안내를 띄우고(Android syncNow parity),
        // 나머지 탭은 조용히 빠진다. (각 refresh 는 session nil 이면 자체 no-op)
        guard auth.session != nil else {
            if tab == .alarms {
                remoteSync.statusMessage = "동기화하려면 먼저 로그인해 주세요"
            }
            return
        }

        // 알람 탭 진입 시 받은-알람 seen 기준선은 네트워크 새로고침과 무관하게 항상
        // 갱신해야 한다. 60초 스로틀에 막혀 아래에서 일찍 return 되면 markReceivedAlarmsSeen
        // 가 지연돼 배지가 늦게 사라지므로, 스로틀 판정 전에 먼저 갱신한다. 권한 상태
        // 새로고침도 로컬-only 라 저렴해 함께 둔다.
        if tab == .alarms {
            alarmKit.refreshAuthorizationState()
            markReceivedAlarmsSeen()
        }

        // 탭+토큰 키로 60초 스로틀. 탭에 필요한 데이터가 비어 있으면(예: 무료 플랜
        // 정리로 목소리 목록이 비워진 직후) 스로틀을 무시하고 즉시 다시 불러와
        // 빈 화면이 남지 않게 한다. (Android lastTabRefreshAt + tabDataEmpty parity)
        let throttleKey = "\(tab).\(auth.session?.token ?? "")"
        let now = Date()
        let tabDataEmpty: Bool = {
            switch tab {
            case .voices: return voiceStudio.profiles.isEmpty
            default: return false
            }
        }()
        if !tabDataEmpty,
           let last = lastRefreshAt[throttleKey],
           now.timeIntervalSince(last) < tabRefreshThrottle {
            return
        }
        lastRefreshAt[throttleKey] = now

        switch tab {
        case .home:
            await socialFeatures.refreshAll(session: auth.session)
        case .voices:
            await voiceStudio.refresh(session: auth.session)
            await socialFeatures.refreshAll(session: auth.session)
        case .alarms:
            // Android: NativeTab.Alarms -> viewModel.syncNow() (push → pull).
            // 기존 pull-only refresh 대신 전체 동기화로 로컬 변경을 먼저 밀어 올린다.
            // 권한 상태는 스로틀 전에 이미 새로고침했다. seen 기준선은 풀로 새 받은-알람이
            // 들어왔을 수 있으니 동기화 후 한 번 더 갱신한다.
            await remoteSync.runFullSync()
            markReceivedAlarmsSeen()
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
