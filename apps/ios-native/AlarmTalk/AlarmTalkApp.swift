import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

@main
struct AlarmTalkApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AlarmTalkThemeMode.storageKey) private var themeModeRaw = AlarmTalkThemeMode.system.rawValue

    @StateObject private var alarmStore = LocalAlarmStore()
    @StateObject private var alarmKit = AlarmKitViewModel()
    /// PR3: AlarmAppContext.holidayPredicate 와 timezone 재무장이 서버 sync 공휴일까지
    /// 반영하도록 앱 lifetime 동안 살아있는 단일 HolidayStore. AlarmKitViewModel 에도
    /// `configure(holidayStore:)` 로 이 동일 인스턴스를 주입해 공휴일 집합을 일원화한다
    /// (Android 단일 holidayCalendarStore parity).
    @StateObject private var holidayStore = HolidayStore()
    @StateObject private var auth = AuthViewModel()
    @StateObject private var remoteSync = RemoteAlarmSyncViewModel()
    @StateObject private var voiceStudio = VoiceStudioViewModel()
    @StateObject private var socialFeatures = SocialFeatureViewModel()
    /// 백엔드 최소지원버전 게이팅. 로그인 여부와 무관하게 앱 진입을 막을 수 있어
    /// 앱 lifetime 동안 떠 있어야 한다. Android `MainViewModel.checkAppVersion()`.
    @StateObject private var versionGate = AppVersionGate()

    /// Phase 4-D1: Apple StoreKit2 IAP 관리자. 앱 lifetime 내내 떠 있어야
    /// `Transaction.updates` listener 가 가족 공유 / 자동 갱신 / 환불 등 외부
    /// 트랜잭션을 놓치지 않는다.
    @StateObject private var subscriptions = SubscriptionManager(
        api: AlarmTalkAPI.shared,
        authProvider: { KeychainStore.readSession() }
    )

    /// `BackgroundSyncTask.register` 는 앱 launch 단계에서 1 회만 호출해야 한다.
    /// SwiftUI App 의 view init 은 여러 번 호출될 수 있으므로 boostrap helper 가
    /// 단 한 번만 BGTaskScheduler 에 핸들러를 꽂는다.
    @State private var bootstrap = Bootstrap()

    var body: some Scene {
        WindowGroup {
            AlarmTalkThemeProvider {
                ContentView()
                    .environmentObject(alarmStore)
                    .environmentObject(alarmKit)
                    .environmentObject(auth)
                    .environmentObject(remoteSync)
                    .environmentObject(voiceStudio)
                    .environmentObject(socialFeatures)
                    .environmentObject(subscriptions)
                    .environmentObject(versionGate)
                    // Phase 2: 앱 전역 단일 공휴일 국가 설정을 SettingsView 등이 공유.
                    .environmentObject(holidayStore)
                    .task {
                        // Phase 4-D1: StoreKit 제품 fetch + currentEntitlements 동기화.
                        // 다른 await 들과 병렬로 실행해도 의존성이 없다.
                        // 백엔드 confirm 성공 시 기존 구독 fetch 경로로 서버 구독
                        // 상태를 새로고침하도록 훅을 먼저 연결한다.
                        subscriptions.onServerEntitlementUpdated = { [weak socialFeatures, weak auth] in
                            guard let socialFeatures, let auth else { return }
                            await socialFeatures.refreshSubscriptionSilently(session: auth.session)
                        }
                        await subscriptions.bootstrap()
                    }
                    .task {
                        // 앱 시작 시 최소지원버전 정책 조회 (로그인 무관). Android `checkAppVersion()`.
                        await versionGate.checkAppVersion()
                    }
                    .task {
                        // AlarmAppContext: LiveActivity Intent 가 perform() 시점에
                        // 정적으로 참조한다. Scene 초기화 직후 1회만 설정.
                        if AlarmAppContext.shared == nil {
                            let ctx = AlarmAppContext(store: alarmStore)
                            // PR3: dismiss-time 공휴일 recompute + `.fixed` one-shot 재무장 훅.
                            // ViewModel 을 강하게 잡지 않도록 weak capture (weak-singleton 보존).
                            ctx.holidayPredicate = holidayStore.holidayPredicate()
                            ctx.rearmHolidayOffOneShot = { [weak alarmKit, weak alarmStore] id in
                                guard let alarmKit, let alarmStore else { return }
                                await alarmKit.rearmIfHolidayOffOneShot(localID: id, store: alarmStore)
                            }
                        }
                        // PR3 FIX: AlarmKitViewModel 이 앱-레벨 단일 HolidayStore 를
                        // 쓰도록 주입한다. recoverScheduledAlarms / processAlarmUpdate 가
                        // AlarmAppContext.holidayPredicate·timezone 재무장과 동일한 공휴일
                        // 집합을 본다 (Android 단일 holidayCalendarStore parity).
                        alarmKit.configure(holidayStore: holidayStore)
                        // Phase 2: 공휴일 국가가 바뀌면 활성 공휴일off 알람을 재계산+재무장한다.
                        // (선택 국가의 공휴일 집합 기준으로 다음 발화 시각이 달라질 수 있으므로
                        // timezone 변경과 동일하게 forceHolidayOffRecompute 로 강제.)
                        holidayStore.onCountryChanged = { [weak alarmKit, weak alarmStore] in
                            guard let alarmKit, let alarmStore else { return }
                            Task { @MainActor in
                                guard alarmStore.hasLoadedFromDisk else { return }
                                await alarmKit.recoverScheduledAlarms(
                                    store: alarmStore,
                                    forceHolidayOffRecompute: true
                                )
                            }
                        }
                        await auth.restoreSession()
                        await alarmKit.startObserving(store: alarmStore)

                        // RemoteAlarmSyncViewModel 의존성 주입.
                        // 이후 viewModel.refresh() 는 RemoteAlarmPullSync 를 위임 호출한다.
                        remoteSync.configure(store: alarmStore, alarmKit: alarmKit, auth: auth)

                        // BGAppRefreshTask 핸들러 등록 (1회).
                        bootstrap.registerIfNeeded(
                            store: alarmStore,
                            alarmKit: alarmKit,
                            auth: auth,
                            socialFeatures: socialFeatures
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
                    .task {
                        // PR3: timezone/시간 변경 관찰자 (Android BootCompletedReceiver 의
                        // ACTION_TIMEZONE_CHANGED / ACTION_TIME_CHANGED parity).
                        // `.fixed` one-shot 은 절대 instant 라 새 zone 에 자동 재anchor 되지
                        // 않으므로, 두 알림에서 enabled 공휴일off 서브셋을 강제 recompute+재무장한다.
                        // 네이티브 `.relative` 알람은 AlarmKit 이 스스로 재anchor 하므로 제외(narrow filter).
                        await observeTimeAndTimezoneChanges()
                    }
                    .task(id: auth.session?.token) {
                        // 로그인 직후 또는 토큰 갱신 시 즉시 sync.
                        guard auth.session != nil else { return }
                        remoteSync.configure(store: alarmStore, alarmKit: alarmKit, auth: auth)
                        await remoteSync.runFullSync()
                        await refreshDynamicVoicesIfNeeded()
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
                        // 앱 시작 후 1회: 30일 넘게 미참조 상태로 남은 캐시 음원과
                        // 고아 .meta.json 사이드카를 백그라운드에서 정리한다.
                        // 현재 알람이 참조하는 cacheKey 는 나이와 무관하게 보존.
                        let activeKeys = Set(alarmStore.alarms.compactMap(\.audioCacheKey))
                        let audioCache = AudioCacheStore.shared
                        Task.detached(priority: .utility) {
                            audioCache.sweepStaleCache(activeCacheKeys: activeKeys)
                        }
                    }
            }
            .preferredColorScheme(AlarmTalkThemeMode.normalized(themeModeRaw).preferredColorScheme)
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

    /// PR3: timezone / 시간 변경 알림을 관찰해 `.fixed` 공휴일off one-shot 을 새 시각으로
    /// 재무장한다. Android BootCompletedReceiver 의 ACTION_TIMEZONE_CHANGED /
    /// ACTION_TIME_CHANGED -> reschedulePendingAlarms() parity.
    ///
    ///  - NSSystemTimeZoneDidChange: 시간대 이동 / DST (ACTION_TIMEZONE_CHANGED parity)
    ///  - UIApplication.significantTimeChangeNotification: 자정 / 수동 시계 변경 /
    ///    DST / 통신사 시각 (ACTION_TIME_CHANGED parity)
    ///
    /// 절대 instant 인 `.fixed` 는 어느 방향으로든 이동할 수 있어 미래 건도 강제
    /// recompute 가 필요하므로 forceHolidayOffRecompute:true 로 호출한다.
    @MainActor
    private func observeTimeAndTimezoneChanges() async {
        // 두 알림 스트림을 하나로 합쳐 단일 .task 수명 안에서 관찰한다.
        // self(App 값 타입) 를 task 경계로 넘기지 않도록 필요한 참조만 로컬로 캡처.
        let store = alarmStore
        let kit = alarmKit

        var names: [Notification.Name] = [.NSSystemTimeZoneDidChange]
        #if canImport(UIKit)
        names.append(UIApplication.significantTimeChangeNotification)
        #endif

        await withTaskGroup(of: Void.self) { group in
            for name in names {
                group.addTask { @MainActor in
                    for await _ in NotificationCenter.default.notifications(named: name) {
                        guard store.hasLoadedFromDisk else { continue }
                        await kit.recoverScheduledAlarms(
                            store: store,
                            forceHolidayOffRecompute: true
                        )
                    }
                }
            }
        }
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

    func registerIfNeeded(
        store: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        auth: AuthViewModel,
        socialFeatures: SocialFeatureViewModel
    ) {
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
        BackgroundSyncTask.register(
            pull: pull,
            push: push,
            dynamicVoice: dynamicVoice,
            socialFeatures: socialFeatures,
            // PR3: 백그라운드 사이클의 `.fixed` one-shot proactive 재무장 sweep 용 약참조.
            store: store,
            alarmKit: alarmKit
        )
    }
}
