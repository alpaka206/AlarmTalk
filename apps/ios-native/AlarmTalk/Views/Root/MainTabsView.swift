import SwiftUI

/// 인증된 상태에서 보여주는 본 메인 화면. 3개 탭 라우팅 + 보조 화면 호스트.
///
/// ContentView 의 `mainApp` 을 그대로 옮겨 router 책임에 집중시켰다.
/// 설정/보조/편집 화면을 같은 `NavigationStack`의 push 화면으로 관리한다.
struct MainTabsView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var store: LocalAlarmStore

    @State private var selectedTab: NativeTab = UIPreviewSeed.initialTab ?? .alarms
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

    /// ＋FAB 가 알람 목록에 '만들기' 를 요청하는 신호. 값이 바뀌면 목록이
    /// `openCreateAlarm()`(권한 확인 → 누구를 깨울까요?)을 탄다.
    @State private var alarmCreateRequest: UUID?

    /// 알람 탭이 다중 선택 모드인가(＋FAB 를 숨긴다).
    @State private var alarmSelectionActive = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // ⚠ **알람 탭은 스크롤을 스스로 소유한다.** 헤드라인(선택 모드에서는
                // [취소·삭제] 바)을 목록 **밖에 고정**해야 하기 때문이다. 예전처럼 전부
                // 한 `ScrollView` 에 넣으면, 목록을 내린 상태에서 길게 눌러 선택 모드에
                // 들어갔을 때 **삭제·취소 바가 화면 위로 밀려나 닿을 수 없다.**
                // 안드로이드도 헤더를 `LazyColumn` 밖 `Column` 에 둔다.
                if selectedTab == .alarms {
                    AlarmsListView(createRequest: alarmCreateRequest, openEditor: { editorTarget = $0 })
                        .onPreferenceChange(AlarmSelectionActiveKey.self) { alarmSelectionActive = $0 }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(theme.homeGradient)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            currentTabContent
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                        .padding(.bottom, 24)
                    }
                    .background(theme.homeGradient)
                }

                BottomNavBar(
                    selected: $selectedTab,
                    badgeProvider: badgeCount(for:),
                    onSelect: selectTab
                )
            }
            // ＋FAB — 알람 탭에서 **알람이 하나라도 있을 때만**. 비어 있을 때는 빈 상태
            // 카드의 '새 알람 만들기' 가 이미 그 일을 하고, 둘이 같이 뜨면 오른쪽 아래에서
            // 손가락이 뭘 노리는지 애매해진다(안드로이드 `AlarmTalkApp.kt:855-873`).
            .overlay(alignment: .bottomTrailing) {
                // 선택 모드에서는 숨긴다 — 삭제 바와 ＋가 함께 있으면 오른쪽 아래에서
                // 손가락이 뭘 노리는지 애매해진다(안드로이드 `!alarmSelectionActive`).
                if selectedTab == .alarms && !store.alarms.isEmpty && !alarmSelectionActive {
                    Button {
                        // ⚠ **여기서 편집기를 직접 열지 말 것.** 예전에는 이 버튼이
                        // `editorTarget` 을 곧바로 세워, 알람 목록의 `openCreateAlarm()`
                        // 이 하는 두 가지를 건너뛰었다:
                        //   1. 알람 권한 확인·요청 (굳은 거부면 설정으로 안내)
                        //   2. 「누구를 깨울까요?」 시트
                        // FAB 는 **알람이 하나라도 있을 때만** 뜨고 빈 상태 카드는 그때
                        // 사라지므로, 알람이 생긴 뒤로는 **가족 알람을 만들 길이 아예
                        // 없어졌다**(2026-08-07 수정).
                        alarmCreateRequest = UUID()
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 24, weight: .medium))
                            .foregroundStyle(theme.palette.onPrimary)
                            .frame(width: 56, height: 56)
                            .background(theme.palette.primary, in: Circle())
                            .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 20)
                    // 하단바(76) 위에 얹는다.
                    .padding(.bottom, 92)
                    .accessibilityLabel("알람 만들기")
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
            }
            .animation(.snappy(duration: 0.18), value: selectedTab)
            .task {
                // DEBUG 전용 — 편집기 화면 확인 진입점.
                if UIPreviewSeed.opensEditor, editorTarget == nil {
                    editorTarget = AlarmEditorTarget(id: UUID().uuidString, editingAlarmID: nil, familyAlarmMode: false, recipientUserID: nil)
                }
            }
            .background(theme.homeGradient)
            // ⚠ **상단 바를 두지 않는다.** 안드로이드에는 앱 전체에 TopAppBar 가 하나도
            // 없다(`AlarmListScreen.kt:178-180`). large title 을 켜면 '알람' 대제목과
            // 네비바 머티리얼이 그라데이션 위에 얹혀 배경이 두 겹으로 갈린다.
            .toolbar(.hidden, for: .navigationBar)
            // ⚠ **상단 프로필 드롭다운을 되살리지 말 것.** 여기 있던 항목(코드 등록·
            // 이용권·공유 이용권·설정)은 전부 **더보기 탭**에 그대로 있다. 안드로이드는
            // 이 메뉴를 더보기 탭으로 승격하면서 없앴다 — 같은 곳으로 가는 길이 둘이면
            // 어느 쪽이 정본인지 매번 헷갈린다.
            // ⚠ **화면급 이동은 `.sheet` 가 아니라 push 다.** 편집기·설정·이용권·코드
            // 등록·공유 이용권 다섯 화면이 iOS 만 아래에서 올라오는 시트였고, 안드로이드는
            // 다섯 다 NavHost 목적지(옆에서 밀려옴)다. 안드로이드는 그 push 전환을
            // `ui/app/AlarmTalkApp.kt` 의 `PushEnterTransition` 네 짝으로 **일부러 지정**해
            // 하위 화면 전부에 붙여 뒀다 — 의도한 차이가 아니라 iOS 가 틀린 것이었다
            // (2026-08-10 사용자 지적).
            //
            // 하단바·＋FAB 가 함께 사라지는 것도 안드로이드와 같다 — 그쪽은 `showAppChrome`
            // 이 `currentTab != null` 을 보므로 탭이 아닌 목적지에서는 크롬을 내린다.
            //
            // ⚠ 바텀시트로 남겨 둔 것들과 헷갈리지 말 것. 「누구를 깨울까요?」·목소리
            // 고르기·화면 테마·공휴일 국가·날씨 지역은 **안드로이드도 바텀시트**
            // (`WakerSelectionSheet`)라 그대로 둔다.
            .navigationDestination(item: $editorTarget) { target in
                AlarmEditorSheet(
                    target: target,
                    onClose: { editorTarget = nil },
                    onJumpToVoices: {
                        editorTarget = nil
                        selectedTab = .voices
                    },
                    onRequestBilling: {
                        editorTarget = nil
                        Task { @MainActor in
                            // 편집기가 팝되는 애니메이션과 겹치지 않게 짧게 지연한다.
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            auxiliaryScreen = .billing
                        }
                    },
                    onSchedulingDidFinish: {
                        editorTarget = nil
                        selectedTab = .alarms
                    }
                )
            }
            .navigationDestination(isPresented: $settingsPresented) {
                SettingsView(
                    onClose: { settingsPresented = false }
                )
            }
            .navigationDestination(item: $auxiliaryScreen) { screen in
                AuxiliarySheetHost(
                    screen: screen,
                    onClose: { auxiliaryScreen = nil },
                    onCodeRegistered: handleCodeRegistrationDestination
                )
            }
            // ⚠ **토큰을 id 로 쓰지 말 것 — 스스로를 취소한다.**
            // `GET /auth/me` 는 부를 때마다 **새 JWT** 를 발급하고
            // `refreshUser()` 가 그걸 세션에 갈아 끼운다. 전경 복귀마다 그게
            // 돌므로, 토큰을 id 로 두면 그 순간 이 task 가 접히고 진행 중이던
            // URLSession 요청이 `NSURLErrorCancelled` 로 끊긴다. 그 OS 문구의
            // 한국어가 "취소됨" 이라, 사용자는 취소한 적 없는 "취소됨" 을 본다
            // (2026-08-10 사용자 보고 → 원인 확인).
            // 다시 돌아야 하는 건 **계정이 바뀔 때**뿐이므로 user.id 로 건다.
            .task(id: auth.session?.user.id) {
                loadReceivedAlarmBadgeState()
                await refreshAll()
                ensureReceivedAlarmBadgeBaseline()
            }
            .task(id: selectedTab) {
                await refreshForSelectedTab(selectedTab)
            }
            // ⚠ **알람 탭에 머무는 동안 새로 들어온 것도 '봤다' 로 기록한다**(2026-08-27).
            // 예전에는 탭을 고르는 순간과 새로고침 뒤에만 기록해서, 그 탭을 보고 있는 사이
            // 푸시로 들어온 알람은 수위선이 올라가지 않았다 — 화면에서는 목록에 보이고
            // 배지도 (탭이 알람이라) 숨겨지는데, 다른 탭으로 옮기면 그것이 '안 본 것' 으로
            // 되살아나고 다음 알람이 오면 1 이 아니라 **누적된 값**이 뜬다.
            // 안드로이드는 `LaunchedEffect(currentTab, alarms, ...)` 로 이미 이렇게 한다.
            //
            // ⚠ **개수로는 부족하다**(2026-08-28 리뷰). 재전송은 같은 알람 id 를 덮어쓰므로
            // 개수가 그대로다 — 그 알람 탭을 보고 있는 동안 온 재전송은 수위선을 못 올리고,
            // 탭을 옮기면 다시 '안 본 것' 이 된다(바로 위 사고가 재전송 경로로 되살아난다).
            // 그래서 **받은 알람의 최신 생성 시각**을 본다. 새로 오든 덮어쓰든 이 값이 움직인다.
            .onChange(of: latestReceivedAlarmMillis) { _, _ in
                guard selectedTab == .alarms else { return }
                markReceivedAlarmsSeen()
            }
        }
    }

    /// 받은 알람 중 가장 최근 생성 시각 — 배지 수위선을 올릴 때가 되었는지 보는 값이다.
    /// 재전송(같은 id 를 덮어씀)도 이 값을 움직이므로 개수보다 넓게 잡는다.
    private var latestReceivedAlarmMillis: Int64 {
        store.alarms
            .filter { $0.originEnum == .receivedRemote }
            .map(\.createdAtMillis)
            .max() ?? 0
    }

    /// 알람 탭을 **뺀** 나머지 탭 — 위 `body` 의 공용 `ScrollView` 안에 들어간다.
    /// 알람 탭은 헤더 고정 때문에 스크롤을 스스로 소유하므로 여기 없다.
    @ViewBuilder
    private var currentTabContent: some View {
        switch selectedTab {
        case .alarms:
            EmptyView()
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
        case .menu:
            MenuView(
                onOpenSettings: { settingsPresented = true },
                onOpenBilling: { auxiliaryScreen = .billing },
                onOpenMembers: { auxiliaryScreen = .members },
                onOpenPeople: { auxiliaryScreen = .people },
                hasSharedPass: socialFeatures.familyGroup?.group != nil
            )
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
            selectedTab = .alarms
        case .sharedPass:
            auxiliaryScreen = .members
        }
    }

    private func badgeCount(for tab: NativeTab) -> Int {
        switch tab {
        case .menu, .voices:
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
        case .menu:
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
