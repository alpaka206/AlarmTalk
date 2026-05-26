import SwiftUI

@main
struct VoiceAlarmApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(VoiceAlarmThemeMode.storageKey) private var themeModeRaw = VoiceAlarmThemeMode.system.rawValue

    @StateObject private var alarmStore = LocalAlarmStore()
    @StateObject private var alarmKit = AlarmKitViewModel()
    @StateObject private var auth = AuthViewModel()
    @StateObject private var remoteSync = RemoteAlarmSyncViewModel()
    @StateObject private var voiceStudio = VoiceStudioViewModel()
    @StateObject private var socialFeatures = SocialFeatureViewModel()
    /// Phase 2-B5: 알람 dismiss/snooze 시 자동 emit 되는 캐릭터 XP 이벤트 큐.
    /// tokenProvider 는 Keychain 직읽기로 둔다 — 클로저가 self.auth 를 capture
    /// 할 수 없는 init 단계라 안전한 source-of-truth 가 Keychain 이다. flush
    /// 호출은 .task(id: auth.session?.token) 에서 안전한 시점에 트리거된다.
    @StateObject private var characterEvents = CharacterEventStore(
        api: VoiceAlarmAPI.shared,
        tokenProvider: { KeychainStore.readSession()?.token }
    )

    /// Phase 4-D1: Apple StoreKit2 IAP 관리자. 앱 lifetime 내내 떠 있어야
    /// `Transaction.updates` listener 가 가족 공유 / 자동 갱신 / 환불 등 외부
    /// 트랜잭션을 놓치지 않는다.
    @StateObject private var subscriptions = SubscriptionManager(
        api: VoiceAlarmAPI.shared,
        authProvider: { KeychainStore.readSession() }
    )

    /// `BackgroundSyncTask.register` 는 앱 launch 단계에서 1 회만 호출해야 한다.
    /// SwiftUI App 의 view init 은 여러 번 호출될 수 있으므로 boostrap helper 가
    /// 단 한 번만 BGTaskScheduler 에 핸들러를 꽂는다.
    @State private var bootstrap = Bootstrap()

    var body: some Scene {
        WindowGroup {
            VoiceAlarmThemeProvider {
                ContentView()
                    .environmentObject(alarmStore)
                    .environmentObject(alarmKit)
                    .environmentObject(auth)
                    .environmentObject(remoteSync)
                    .environmentObject(voiceStudio)
                    .environmentObject(socialFeatures)
                    .environmentObject(characterEvents)
                    .environmentObject(subscriptions)
                    .task {
                        // Phase 4-D1: StoreKit 제품 fetch + currentEntitlements 동기화.
                        // 다른 await 들과 병렬로 실행해도 의존성이 없다.
                        await subscriptions.bootstrap()
                    }
                    .task {
                        // AlarmAppContext: LiveActivity Intent 가 perform() 시점에
                        // 정적으로 참조한다. Scene 초기화 직후 1회만 설정.
                        // Phase 2-B5: characterEvents 를 실제 store 로 주입해 dismiss/
                        // snooze 시 자동 큐잉되게 한다.
                        if AlarmAppContext.shared == nil {
                            _ = AlarmAppContext(
                                store: alarmStore,
                                characterEvents: characterEvents
                            )
                        }
                        await characterEvents.loadFromDisk()
                        await auth.restoreSession()
                        await alarmKit.startObserving(store: alarmStore)

                        // RemoteAlarmSyncViewModel 의존성 주입.
                        // 이후 viewModel.refresh() 는 RemoteAlarmPullSync 를 위임 호출한다.
                        remoteSync.configure(store: alarmStore, alarmKit: alarmKit, auth: auth)

                        // BGAppRefreshTask 핸들러 등록 (1회).
                        bootstrap.registerIfNeeded(
                            store: alarmStore,
                            alarmKit: alarmKit,
                            auth: auth
                        )

                        // 로그인되어 있으면 즉시 한 사이클.
                        if auth.session != nil {
                            await remoteSync.runFullSync()
                            await refreshDynamicVoicesIfNeeded()
                        }

                        // 최초 BGAppRefreshTask 예약. 다음 사이클은 백그라운드 진입/
                        // task 종료 시 재예약.
                        BackgroundSyncTask.scheduleNext()
                    }
                    .task(id: auth.session?.token) {
                        // 로그인 직후 또는 토큰 갱신 시 즉시 sync.
                        guard auth.session != nil else { return }
                        remoteSync.configure(store: alarmStore, alarmKit: alarmKit, auth: auth)
                        await remoteSync.runFullSync()
                        await refreshDynamicVoicesIfNeeded()
                        // Phase 2-B5: 로그인 전에 쌓여 있던 PENDING/FAILED 캐릭터 이벤트를 비운다.
                        await characterEvents.flushPending()
                        BackgroundSyncTask.scheduleNext()
                    }
                    .task(id: auth.session?.user.id) {
                        remoteSync.clearUserScopedRemoteState()
                        voiceStudio.clearUserScopedRemoteState()
                        socialFeatures.restoreAccessSnapshot(session: auth.session)
                    }
                    .task(id: freePlanVoiceLockKey) {
                        await applyFreePlanVoiceLockIfNeeded()
                    }
                    .task(id: alarmStore.hasLoadedFromDisk) {
                        guard alarmStore.hasLoadedFromDisk else { return }
                        await alarmKit.recoverScheduledAlarms(store: alarmStore)
                    }
            }
            .preferredColorScheme(VoiceAlarmThemeMode.normalized(themeModeRaw).preferredColorScheme)
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                Task {
                    guard alarmStore.hasLoadedFromDisk else { return }
                    await alarmKit.recoverScheduledAlarms(store: alarmStore)
                }
                // Phase 4-D2: 포그라운드 진입 시 세션 정합성을 직렬로 점검.
                //  1) Apple credentialState — revoke/notFound 이면 즉시 signOut
                //  2) /auth/me 갱신 — 401 만 signOut, 5xx/네트워크 단절은 lastNetworkError 만 갱신
                //  3) 정상 세션이 남아 있으면 RemoteAlarmPullSync 한 사이클
                Task {
                    await auth.verifyAppleCredentialStateIfNeeded()
                    guard auth.session != nil else { return }
                    await auth.refreshUser()
                    guard auth.session != nil else { return }
                    await remoteSync.runFullSync()
                    await refreshDynamicVoicesIfNeeded()
                }
                // Phase 2-B5: 백그라운드에서 발생했을 수 있는 dismiss/snooze 이벤트의
                // pending queue 를 비운다. 로그인 안 되어 있어도 호출은 안전 (no-op).
                Task { await characterEvents.flushPending() }
                // Phase 4-D1: 백엔드 entitlement 동기화가 직전에 실패했을 수 있다.
                // foreground 진입 시 currentEntitlements 의 모든 verified 트랜잭션을
                // 재전송해 catch-up. 백엔드 라우트 미배포 환경에서도 graceful 하다.
                // refreshPurchasedProducts 는 클라이언트 currentTier 만 갱신하지만,
                // resyncEntitlements 는 백엔드에도 모든 verified 트랜잭션을 재전송한다.
                Task {
                    await subscriptions.refreshPurchasedProducts()
                    await subscriptions.resyncEntitlements()
                }
            case .background:
                // 시스템이 task 를 깨울 수 있도록 다음 사이클 재예약.
                BackgroundSyncTask.scheduleNext()
            default:
                break
            }
        }
    }

    @MainActor
    private func refreshDynamicVoicesIfNeeded() async {
        guard let token = auth.session?.token else { return }
        let refresh = DynamicVoiceRefreshService(store: alarmStore)
        _ = await refresh.refreshDue(token: token)
    }

    private var freePlanVoiceLockKey: String {
        [
            auth.session?.user.id ?? "anonymous",
            alarmStore.hasLoadedFromDisk ? "loaded" : "loading",
            socialFeatures.subscription?.subscription?.id ?? "no-subscription-id",
            socialFeatures.subscription?.subscription?.status ?? "no-subscription-status",
            socialFeatures.subscription?.plan?.key ?? "no-plan-key",
            socialFeatures.subscription?.plan?.planType ?? "no-plan-type",
            subscriptions.currentTier.rawValue,
            subscriptions.hasLoadedEntitlements ? "entitlements-loaded" : "entitlements-loading"
        ].joined(separator: "|")
    }

    @MainActor
    private func applyFreePlanVoiceLockIfNeeded() async {
        guard auth.session != nil,
              alarmStore.hasLoadedFromDisk,
              subscriptions.hasLoadedEntitlements,
              socialFeatures.subscription != nil else {
            return
        }
        let currentPlan = PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        guard !currentPlan.meetsOrExceeds(.personal) else { return }
        _ = await socialFeatures.applyFreePlanVoiceLock(
            alarmStore: alarmStore,
            alarmKit: alarmKit,
            voiceStudio: voiceStudio
        )
    }
}

// MARK: - Bootstrap

/// `BackgroundSyncTask.register` 는 BGTaskScheduler 에 핸들러를 꽂는 호출로
/// process 당 1 회만 허용된다. 두 번 호출하면 crash 한다. `@State` 박스로
/// 인스턴스 수명을 view 와 동기화해 한 번만 등록한다.
@MainActor
private final class Bootstrap {
    private var didRegister = false

    func registerIfNeeded(store: LocalAlarmStore, alarmKit: AlarmKitViewModel, auth: AuthViewModel) {
        guard !didRegister else { return }
        didRegister = true

        let pull = RemoteAlarmPullSync(
            store: store,
            alarmKit: alarmKit,
            audioCache: .shared,
            auth: auth
        )
        let push = RemoteAlarmPushSync(store: store, auth: auth)
        let dynamicVoice = DynamicVoiceRefreshService(store: store)
        BackgroundSyncTask.register(pull: pull, push: push, dynamicVoice: dynamicVoice)
    }
}
