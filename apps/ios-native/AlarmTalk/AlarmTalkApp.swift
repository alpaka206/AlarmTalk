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

    // 화면 확인 모드(-UIPreviewSeed)에서는 **임시 파일**을 쓴다 — 표본 알람이 진짜
    // 저장소에 남으면 다음 실행에서 사용자 알람으로 취급돼 서버에 올라간다
    // (`UIPreviewSeed.ephemeralAlarmStorageURL` 주석).
    // ⚠ 화면 확인 모드에서는 **디스크를 읽지 않는다.** 임시 파일은 매번 비어 있는데,
    // 그 비동기 로드가 끝나면서 `alarms` 를 빈 배열로 덮어써 **방금 심은 표본을 지운다**
    // (2026-08-17 스크린샷에서 목록이 비어 나와 발견). 읽을 것이 없으니 끄는 게 맞다.
    @StateObject private var alarmStore = LocalAlarmStore(
        storageURL: UIPreviewSeed.ephemeralAlarmStorageURL,
        loadFromDisk: !UIPreviewSeed.isEnabled
    )
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

    /// 기본 목소리 테마 클립 선다운로드. **온보딩 화면의 것과 별개로 앱 전역에 하나 둔다** —
    /// 온보딩을 지난 사용자가 시스템 언어를 바꾸면 새 언어분을 받을 길이 그것뿐이다.
    /// 이미 캐시된 클립은 건너뛰므로 중복 실행은 무해하다.
    @StateObject private var stockClipPrefetcher = StockClipPrefetcher()

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
                    // ⚠ **상한을 두는 이유**(2026-08-17). 글자가 사용자 설정을 따라가게
                    // 만들면(`Font.pretendard` 의 `relativeTo:`) 접근성 최대치에서 본문이
                    // **3배**까지 커진다. 그 크기를 견디려면 화면마다 레이아웃을 다시
                    // 짜야 하는데, 지금 못 견디는 곳이 남아 있는 채로 열어 두면 큰 설정을
                    // 쓰는 사람에게 **잘린 화면**을 주게 된다 — 안 커지는 것보다 나쁘다.
                    // 그래서 우선 `accessibility1`(본문 17→28, 약 165%)까지 연다.
                    //
                    // ⚠ 이 값을 올릴 때는 **레이아웃 훑기와 함께** 올릴 것. 애플의
                    // 'Larger Text' 지원 표시 기준은 200%(≈`accessibility2`)라, 그걸
                    // 선언하려면 그 훑기가 선행돼야 한다.
                    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
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
                            ctx.rescheduleForNextBucketClip = { [weak alarmKit, weak alarmStore] _ in
                                guard let alarmKit, let alarmStore else { return }
                                // ⚠ 예전에는 여기서 `schedule` 만 불렀다 — **옛 핸들을 취소하지
                                // 않아** 예약이 하나씩 늘었다(같은 시각에 옛 클립과 새 클립이
                                // 함께 울린다). 리컨사일러가 '새로 예약 → 성공하면 옛것 취소'
                                // 순서를 한 곳에서 지킨다.
                                await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit)
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
                    // ⚠ **언어를 키에 넣는다.** 예전에는 선다운로드가 온보딩
                    // (`VoiceSetupView`)에서만 돌아서, 시스템 언어를 바꾸면 새 언어의
                    // 테마 클립을 **영영 받지 않았다** — 문구 행이 "불러오는 중이에요" 에
                    // 머물거나, 받아 둔 적 없는 클립이 붙어 소리가 안 났다.
                    // 안드로이드는 앱 시작마다 `prefetchStockClips()` 를 부른다.
                    .task(id: stockClipLanguageKey) {
                        guard auth.session != nil else { return }
                        stockClipPrefetcher.start(
                            session: auth.session,
                            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
                        )
                        // ⚠ **매니페스트를 여기서 채운다.** 예전에는 이 자리에서
                        // `loadStockClips` 를 부르지 않아, 아래 재바인딩이 **항상 빈 배열로
                        // 돌아 즉시 0건 반환**했다 — 언어를 바꿔도 아무 일도 일어나지 않았다.
                        // 게다가 매니페스트를 채우는 곳이 알람 편집기 진입 한 곳뿐이라,
                        // 거기서 실패하면 테마 목록이 통째로 비었다.
                        await voiceStudio.loadStockClips(session: auth.session)
                        await StockClipLanguageRebinder(store: alarmStore)
                            .rebindIfLanguageChanged(
                                session: auth.session,
                                clips: voiceStudio.stockClips
                            )
                        // ⚠ **행만 바꾸면 알람은 옛 언어로 운다.** 재바인딩은 클립 키를
                        // 새 언어로 갈아 끼우지만, 이미 예약된 알람은 예약 시점에 넘긴
                        // 옛 언어 파일을 그대로 재생한다 — 이 클래스가 고치려던 증상이
                        // ("앱은 영어인데 알람만 한국어") 예약 쪽에 그대로 남아 있었다.
                        await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit)
                    }
                    .task(id: auth.session?.user.id) {
                        remoteSync.clearUserScopedRemoteState()
                        voiceStudio.clearUserScopedRemoteState()
                        socialFeatures.restoreAccessSnapshot(session: auth.session)
                    }
                    // 목소리를 지우면 그 목소리로 걸어 둔 예약도 곧바로 걷어낸다 —
                    // 파기 대상 생체정보가 알람에 남아 있으면 안 된다.
                    .task(id: voiceStudio.needsScheduleReconcile) {
                        guard voiceStudio.needsScheduleReconcile else { return }
                        voiceStudio.needsScheduleReconcile = false
                        await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit)
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
                // 빠진 테마 클립을 보충한다. 이미 캐시된 것은 건너뛰므로 값이 싸고,
                // 콜드 스타트에서 실패했거나 캐시가 정리된 경우를 여기서 메운다.
                // 안드로이드는 앱 시작마다 `prefetchStockClips()` 로 같은 일을 한다.
                Task {
                    guard auth.session != nil else { return }
                    await voiceStudio.loadStockClips(session: auth.session)
                    stockClipPrefetcher.start(
                            session: auth.session,
                            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
                        )
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
        // 곧 울릴 날씨 알람의 조건도 함께 받아 둔다. 반복 알람은 매일 다시 울리므로
        // 저장할 때 받은 어제 조건으로는 오늘 날씨를 말할 수 없다.
        let weather = WeatherVariantRefreshService(store: alarmStore, alarmKit: alarmKit)
        _ = await weather.refreshDue(token: token)
        // ⚠ **여기가 마지막 관문이다.** 위 두 갱신은 행의 음원을 갈아 끼우는데, 그것만으로는
        // OS 가 예약 때 받아 간 옛 파일이 그대로 울린다(동적 문구 알람은 매일 새 문구를
        // 만들어 놓고 어제 문구로 울었다 — 서버 호출과 월 한도는 매번 차감하면서).
        // 어긋난 예약을 여기서 한 번에 맞춘다.
        await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit)
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

    /// 선다운로드·재바인딩을 다시 돌려야 하는 시점. 계정과 **기기 언어**가 축이다.
    private var stockClipLanguageKey: String {
        "\(auth.session?.user.id ?? "anonymous")|\(VoiceStudioViewModel.appVoiceLanguage())"
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
            // ⚠ **유료로 돌아오면 대기표를 비운다.** 두 가지를 동시에 지킨다:
            // ① 아직 확인 안 한 강등 안내가 남아 있으면, 이미 유료가 된 사람에게
            //    "무료로 바뀌었어요" 를 띄우게 된다.
            // ② 비워 둬야 **다음에 다시 무료가 됐을 때 깨끗이 다시 뜬다**
            //    (2026-08-11 요청 "다시 요금제를 쓰면 나중에 바뀌었을 때 알람 뜰 수 있게").
            DowngradeNoticeStore().clear(userID: auth.session?.user.id)
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
