import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

@main
struct AlarmTalkApp: App {
    /// SwiftUI `App` 에는 원격 알림 콜백이 없어 델리게이트로 받는다.
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
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

    /// iOS 푸시. **알림 권한과 별개** — background push 는 권한 없이도 오고, 그게
    /// 받은 알람을 제때 예약하는 유일한 즉시 경로다(`PushNotificationCoordinator` 주석).
    @StateObject private var push = PushNotificationCoordinator()

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
                        // DEBUG 전용: `-UIPreviewSeed` 실행 인자면 서버·로그인 없이
                        // 실제 화면을 볼 수 있게 가짜 세션과 알람을 심는다(UIPreviewSeed 주석 참조).
                        #if DEBUG
                        if UIPreviewSeed.isEnabled {
                            let seeded = UIPreviewSeed.makeSession()
                            UIPreviewSeed.markGatesPassed(userID: seeded.user.id)
                            auth._setSessionForTesting(seeded)
                            for record in UIPreviewSeed.makeAlarms() {
                                alarmStore.upsert(record)
                            }
                            // 울림 확인용 — `-UIPreviewRingIn <초>` 면 그만큼 뒤에 실제로
                            // 예약한다. iOS 울림 화면은 AlarmKit 이 그리는 시스템 alert 이라
                            // 우리가 띄울 수 없고, 편집기로 만들려면 시각 휠을 드래그해야
                            // 하는데 시뮬레이터에는 그 방법이 없다.
                            if let seconds = UIPreviewSeed.ringInSeconds {
                                var record = UIPreviewSeed.makeRingSoonAlarm(inSeconds: seconds)
                                record.ownerUserId = seeded.user.id
                                alarmStore.upsert(record)
                                _ = await alarmKit.schedule(record: record, store: alarmStore)
                            }
                        }
                        #endif
                    }
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
                        // ⚠ **BGTask 핸들러 등록을 이 task 의 맨 앞에 둔다 — 어떤 await 보다도
                        // 먼저.** 예전에는 `restoreSession()` 등 여러 await 뒤에 있었는데,
                        // 세션이 복원되는 순간 아래 `.task(id: auth.session?.user.id)` 가 깨어나
                        // **등록 전에** `scheduleNext()` 로 submit 해 버렸다. 그러면
                        // `No launch handler registered for task with identifier ...` 로
                        // **앱이 launch 중에 죽는다**(2026-08-06 실기기 재현 — 로그인 세션이
                        // 있는 상태로 켤 때마다). 등록은 동기 호출이고 의존성도 전부 준비돼
                        // 있으므로 앞으로 옮기는 데 대가가 없다.
                        bootstrap.registerIfNeeded(
                            store: alarmStore,
                            alarmKit: alarmKit,
                            auth: auth,
                            socialFeatures: socialFeatures
                        )

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
                            // 무료 테마 회전 — 울린 뒤 다음 클립으로 다시 예약한다.
                            // AlarmKit 은 사운드를 **예약할 때** 받아 가므로, 다시 예약하지
                            // 않으면 인덱스만 올라가고 소리는 지난 회차 그대로다.
                            ctx.rescheduleForNextBucketClip = { [weak alarmKit, weak alarmStore] id in
                                guard let alarmKit, let alarmStore,
                                      let record = alarmStore.alarms.first(where: { $0.id == id })
                                else { return }
                                _ = await alarmKit.schedule(record: record, store: alarmStore)
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
                    // 위와 같은 이유로 user.id 로 건다(토큰은 갱신마다 바뀐다).
                    .task(id: auth.session?.user.id) {
                        // 로그인 직후 또는 토큰 갱신 시 즉시 sync.
                        guard auth.session != nil else { return }
                        // 알림 권한을 **sync 보다 먼저** 물어본다. 받은 알람 알림
                        // (`SocialNotificationTracker.notifyReceivedAlarm`)은 `.notDetermined`
                        // 에서 조용히 버려지므로, 한 번도 묻지 않으면 신규 설치에서 그 알림이
                        // 영영 뜨지 않는다. 이미 답한 뒤에는 no-op 이라 매 토큰 갱신마다 불려도 된다.
                        await SocialNotificationTracker.requestAuthorizationIfNeeded()
                        // ⚠ 권한 결과와 **무관하게** 원격 알림에 등록한다 — 거절해도
                        // background push 는 오고, 그게 받은 알람을 예약한다.
                        PushAppDelegate.coordinator = push
                        PushAppDelegate.currentSession = { auth.session }
                        push.onFamilyAlarm = { await remoteSync.runFullSync() }
                        push.onVoiceChanged = { await voiceStudio.refresh(session: auth.session) }
                        push.onPlanChanged = {
                            await socialFeatures.refreshAll(session: auth.session, force: true)
                            await auth.refreshUser()
                        }
                        push.start()
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
                        // ⚠ **버킷(무료 테마) 클립 키도 사용 중이다.** `audioCacheKey` 만
                        // 모으면 테마 알람이 물고 있는 클립들이 '미참조' 로 보여 지워진다 —
                        // 안드로이드 `AlarmRepository.sweepStaleAudioCache` 는 `bucketClipKeys()`
                        // 를 in-use 에 넣는다. iOS 만 빠져 있었다(2026-08-11).
                        let activeKeys = Set(
                            alarmStore.alarms.compactMap(\.audioCacheKey)
                                + alarmStore.alarms.flatMap { $0.bucketClipKeys ?? [] }
                        )
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

        // 루프 본문을 `@MainActor` 메서드로 빼 둔다. 인라인 `group.addTask { @MainActor in ... }`
        // 로 쓰면 Swift 6.3 의 region-based isolation checker 가
        // "pattern that the region-based isolation checker does not understand how to check"
        // 로 컴파일을 거부한다(컴파일러 한계). 이름 붙은 @MainActor 함수로 넘기면
        // 격리는 그대로 유지되면서 검사기가 이해할 수 있는 형태가 된다.
        // ⚠ 격리를 낮추는 방향으로 고치지 말 것 — 여기서 경쟁 상태가 나면 증상은 "안 울림" 이다.
        await withTaskGroup(of: Void.self) { group in
            for name in names {
                group.addTask {
                    await Self.observeAndRecover(named: name, store: store, kit: kit)
                }
            }
        }
    }

    /// `observeTimeAndTimezoneChanges` 의 감시 루프 한 갈래.
    /// 시간대/유의미한 시각 변경 알림을 받을 때마다 예약을 재계산한다.
    @MainActor
    private static func observeAndRecover(
        named name: Notification.Name,
        store: LocalAlarmStore,
        kit: AlarmKitViewModel
    ) async {
        for await _ in NotificationCenter.default.notifications(named: name) {
            guard store.hasLoadedFromDisk else { continue }
            await kit.recoverScheduledAlarms(store: store, forceHolidayOffRecompute: true)
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
        // ⚠ **유료면 잠긴 것을 되돌린다.** 예전에는 여기서 그냥 return 해서, 한 번
        // 잠긴 알람은 재결제해도 영영 알람음으로 남았다(예전엔 아예 삭제였다).
        guard !currentPlan.meetsOrExceeds(.personal) else {
            _ = await socialFeatures.restorePaidVoiceAlarms(
                alarmStore: alarmStore,
                alarmKit: alarmKit,
                // 잠글 때와 **같은 계정**만 복원한다(안드로이드와 같은 규칙).
                expectedOwnerUserId: auth.session?.user.id
            )
            return
        }
        let ownerID = auth.session?.user.id
        let locked = await socialFeatures.applyFreePlanVoiceLock(
            alarmStore: alarmStore,
            alarmKit: alarmKit,
            voiceStudio: voiceStudio,
            // 같은 기기에서 계정을 바꿨을 때 앞 계정 알람까지 잠그지 않게 한다.
            expectedOwnerUserId: ownerID
        )
        // 대기표에 적어 둔다 — 이 자리는 앱 시작·전경 복귀에서 도는데, 그때 토스트를
        // 띄워 봐야 놓치기 쉽다. 보여줄 수 있을 때 모달이 대신 말한다.
        DowngradeNoticeStore().record(userID: ownerID, cause: .freePlan, count: locked)
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
