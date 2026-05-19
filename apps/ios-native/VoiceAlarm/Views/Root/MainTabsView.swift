import SwiftUI

/// 인증된 상태에서 보여주는 본 메인 화면. 4개 탭 라우팅 + 시트 호스트.
///
/// ContentView 의 `mainApp` 을 그대로 옮겨 router 책임에 집중시켰다.
/// 기존의 `DispatchQueue.main.asyncAfter(deadline: .now() + 0.25)` 로 시트 충돌을
/// 회피하던 코드는 제거하고, `.sheet(item:)` + `onDismiss` + `pendingAuxiliary`
/// 큐로 안전하게 연쇄 전환한다.
struct MainTabsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var store: LocalAlarmStore

    @State private var selectedTab: NativeTab = .home

    /// `editorTarget` 이 nil 이 아니면 알람 편집 시트가 뜬다.
    @State private var editorTarget: AlarmEditorTarget?

    /// 설정 시트 표시 여부.
    @State private var settingsPresented = false

    /// 보조 시트 표시 — People/Growth/Billing.
    @State private var auxiliaryScreen: AuxiliaryScreen?

    /// 설정 시트에서 보조 화면을 누른 경우, 설정 시트가 dismiss 된 뒤 이 값을
    /// auxiliaryScreen 에 옮긴다. ContentView 의 0.25s 지연 우회를 대체.
    @State private var pendingAuxiliary: AuxiliaryScreen?

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

                BottomNavBar(selected: $selectedTab, badgeProvider: badgeCount(for:))
            }
            .background(VoiceAlarmTheme.background)
            .navigationTitle(selectedTab.navigationTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        settingsPresented = true
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
            .sheet(isPresented: $settingsPresented, onDismiss: presentPendingAuxiliaryIfNeeded) {
                NavigationStack {
                    SettingsView(
                        onRequestAuxiliary: { screen in
                            // 시트 충돌 회피: 우선 pendingAuxiliary 에 담아두고 시트를 닫으면
                            // onDismiss 에서 auxiliaryScreen 으로 옮겨 띄운다. ContentView 의
                            // asyncAfter 0.25s 우회보다 결정적이고 race 없다.
                            pendingAuxiliary = screen
                            settingsPresented = false
                        },
                        onClose: { settingsPresented = false }
                    )
                }
            }
            .sheet(item: $auxiliaryScreen) { screen in
                AuxiliarySheetHost(screen: screen) {
                    auxiliaryScreen = nil
                }
            }
            .task(id: auth.session?.token) {
                await refreshAll()
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
                selectTab: { selectedTab = $0 }
            )
        case .voices:
            // Phase 4-D1: 슬롯 가득 PlanGate 의 "결제 화면으로" 가 눌리면 BillingPanel
            // auxiliary 시트로 chain. PlanGate 시트가 자신을 닫는 dismiss animation 과
            // BillingPanel 시트의 present 가 겹치지 않도록 300ms 지연 후 띄운다.
            //
            // SettingsView 의 onRequestAuxiliary 경로와는 분리된 직접 라우팅이라
            // pendingAuxiliary 큐를 거치지 않는다 (큐를 거치면 Settings 의 onDismiss
            // 핸들러와 race 가능).
            VoicesPanelView(onRequestBilling: {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    auxiliaryScreen = .billing
                }
            })
        case .alarms:
            AlarmsListView(openEditor: { editorTarget = $0 })
        case .messages:
            MessagesView(selectTab: { selectedTab = $0 })
        }
    }

    /// SettingsView 가 닫힐 때 호출. pendingAuxiliary 가 있으면 그 화면을 띄운다.
    private func presentPendingAuxiliaryIfNeeded() {
        guard let queued = pendingAuxiliary else { return }
        pendingAuxiliary = nil
        auxiliaryScreen = queued
    }

    private func badgeCount(for tab: NativeTab) -> Int {
        switch tab {
        case .home, .voices:
            return 0
        case .alarms:
            return store.alarms.filter { !$0.enabled }.count
        case .messages:
            return socialFeatures.unreadNoteCount
        }
    }

    private func refreshAll() async {
        await remoteSync.refresh(session: auth.session)
        await voiceStudio.refresh(session: auth.session)
        await socialFeatures.refreshAll(session: auth.session)
        alarmKit.refreshAuthorizationState()
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
