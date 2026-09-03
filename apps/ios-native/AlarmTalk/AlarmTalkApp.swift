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
    // ⚠ **백그라운드 사이클이 쓰는 넷은 `BackgroundDependencies` 가 소유한다.**
    // 시스템이 **백그라운드 새로고침만을 위해** 앱을 깨우면 scene 이 붙지 않아 화면의
    // `.task` 가 돌지 않는다 — 여기서 새로 만들면 그 경로에서는 아무 의존성도 없다.
    // 여기서는 같은 인스턴스를 `@StateObject` 로 감쌀 뿐이다(관찰만 한다).
    @StateObject private var alarmStore = BackgroundDependencies.shared.alarmStore
    @StateObject private var alarmKit = BackgroundDependencies.shared.alarmKit
    /// PR3: AlarmAppContext.holidayPredicate 와 timezone 재무장이 서버 sync 공휴일까지
    /// 반영하도록 앱 lifetime 동안 살아있는 단일 HolidayStore. AlarmKitViewModel 에도
    /// `configure(holidayStore:)` 로 이 동일 인스턴스를 주입해 공휴일 집합을 일원화한다
    /// (Android 단일 holidayCalendarStore parity).
    @StateObject private var holidayStore = HolidayStore()
    @StateObject private var auth = BackgroundDependencies.shared.auth
    @StateObject private var remoteSync = RemoteAlarmSyncViewModel()
    @StateObject private var voiceStudio = BackgroundDependencies.shared.voiceStudio
    @StateObject private var socialFeatures = BackgroundDependencies.shared.socialFeatures
    /// 기본 목소리 교체가 아직 안 끝났는가 — 차단 화면과 재시도 축(`stockClipLanguageKey`).
    @StateObject private var stockReplacement = StockReplacementStatus.shared
    /// 백엔드 최소지원버전 게이팅. 로그인 여부와 무관하게 앱 진입을 막을 수 있어
    /// 앱 lifetime 동안 떠 있어야 한다. Android `MainViewModel.checkAppVersion()`.
    @StateObject private var versionGate = AppVersionGate()

    /// iOS 푸시. **알림 권한과 별개** — background push 는 권한 없이도 오고, 그게
    /// 받은 알람을 제때 예약하는 유일한 즉시 경로다(`PushNotificationCoordinator` 주석).
    @StateObject private var push = BackgroundDependencies.shared.push

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
                    // ⚠ **준비 화면도 프리페처를 깨울 수 있어야 한다**(Codex #703 P2).
                    // 위 `.task(id:)` 는 계정·언어로만 키가 걸려 있어, 이번 세션에
                    // 새로 소유하게 된 목소리로는 다시 돌지 않는다 — 그래서 첫 등록이
                    // 앱을 껐다 켤 때까지 100% 미만에 갇혔다.
                    .environmentObject(stockClipPrefetcher)
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
                        // 배경 `plan_changed` 경로가 StoreKit 을 다시 읽을 수 있도록 꽂아 둔다
                        // (그 경로에는 `SubscriptionManager` 가 없다 — 새로 만들면 리스너가 겹친다).
                        BackgroundDependencies.shared.revalidateStoreEntitlement = { [weak subscriptions] in
                            await subscriptions?.refreshPurchasedProducts()
                        }
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
                        // ⚠ **BGTask 등록·실행기 설치는 여기가 아니라 `didFinishLaunching`
                        // 이다**(`PushAppDelegate`). 두 가지 이유가 겹친다:
                        //  1. `BGTaskScheduler` 는 **launch 가 끝나기 전** 등록을 요구한다.
                        //  2. 시스템이 백그라운드 새로고침만을 위해 깨우면 **scene 이 붙지
                        //     않아 이 `.task` 가 아예 돌지 않는다** — 여기서 설치하면 그
                        //     경로에서는 사이클이 통째로 죽는다(2026-08-18).
                        // 예전에는 이 자리에서 했고, 그때는 "어떤 await 보다 먼저" 라는
                        // 순서 규칙으로 버텼다(세션 복원이 등록 전에 `scheduleNext()` 를
                        // 불러 `No launch handler registered ...` 로 죽던 일이 있었다).
                        // 이제 등록이 launch 에서 끝나므로 그 창 자체가 없다.

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
                                await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit, ownerUserId: auth.session?.user.id)
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
                                    ownerUserId: BackgroundDependencies.shared.auth.session?.user.id,
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
                            await refreshWeatherVariantsAndReconcile()
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
                        // ⚠ **계정이 바뀌면 StoreKit 을 다시 읽는다**(2026-08-31 리뷰).
                        // 로그아웃 상태에서는 등급을 아예 세지 않으므로(계정 토큰을 모른다),
                        // 여기서 다시 읽지 않으면 새 계정이 다음 전경 진입 전까지 '모름' 으로
                        // 남는다. 반대로 앞 계정 값이 남아 새 계정을 유료로 만들지도 않는다.
                        await subscriptions.refreshPurchasedProducts()
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
                        // ⚠ 강등은 새로고침 자체(`onAuthoritativeRefresh`, launch 에서 꽂는다)가
                        // 맡는다 — 여기서 또 부르지 말 것. 푸시를 놓쳐도(오프라인·스로틀링)
                        // 다음 시작·탭 진입의 새로고침이 같은 일을 한다.
                        push.onVoiceChanged = {
                            // `force` 가 없으면 진행 중인 새로고침에 막혀 철회 이전 목록으로
                            // 판단하게 된다(Codex #697 P1).
                            await voiceStudio.refresh(session: auth.session, force: true)
                            _ = await voiceStudio.loadStockClips(session: auth.session, force: true)
                            if await voiceStudio.refreshChangedCachedStockClips(session: auth.session).changed {
                                await alarmStore.waitUntilLoadedFromDisk()
                                _ = await AlarmScheduleReconciler.reconcile(
                                    store: alarmStore,
                                    alarmKit: alarmKit,
                                    ownerUserId: auth.session?.user.id
                                )
                            }
                        }
                        push.onPlanChanged = {
                            await socialFeatures.refreshAll(session: auth.session, force: true)
                            await auth.refreshUser()
                            // StoreKit 도 다시 읽는다 — 환불·회수는 캐시된 만료 시각을
                            // 무효로 만드는데 그 신호가 판정 1단이다(배경 경로와 같은 이유).
                            await subscriptions.refreshPurchasedProducts()
                        }
                        // ⚠ 푸시 해제 훅은 **launch 에서** 꽂는다(`PushAppDelegate`) —
                        // 여기서 꽂으면 알림 권한 팝업을 기다리는 동안 '끊긴 로그아웃
                        // 이어서 끝내기' 가 기본값(아무것도 안 함)을 부를 수 있다.
                        push.start()
                        remoteSync.configure(store: alarmStore, alarmKit: alarmKit, auth: auth)
                        await remoteSync.runFullSync()
                        await refreshWeatherVariantsAndReconcile()
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
                        await rebindStockClipsIfNeeded()
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
                        await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit, ownerUserId: auth.session?.user.id)
                    }
                    .task(id: freePlanVoiceLockKey) {
                        await applyFreePlanVoiceLockIfNeeded()
                    }
                    // ⚠ **로그인 확정 직후 남의 계정 예약을 끊는다**(Codex #699 P1).
                    // A 의 세션이 자동 401 로 끊기면 예약은 일부러 살려 두는데, 그 상태에서
                    // B 가 로그인하면 목록·복구는 소유자로 걸러 A 의 알람을 **감추기만 한다** —
                    // 예약은 그대로라 **A 의 알람이 울리는데 B 는 볼 수도 끌 수도 없다.**
                    // 안드로이드는 `onSignedIn` 에서 `cancelAlarmsNotOwnedBy` 로 같은 일을 한다.
                    // ⚠ **판정에 로드 상태를 함께 넣는다**(Codex #699 P1). 계정 id 만 걸면
                    // **콜드 스타트**에서 저장소가 아직 로드 중이라 여기서 그대로 돌아가고,
                    // 그 뒤로 id 가 안 바뀌므로 **다시 돌지 않는다** — 앞 계정의 예약이
                    // 새 계정 아래에 숨은 채 영원히 남는다.
                    .task(id: "\(auth.session?.user.id ?? "-")|\(alarmStore.hasLoadedFromDisk)") {
                        // ⚠ **먼저 계정 세대를 올린다**(Codex #699 P1). 진행 중인 예약이
                        // await 에서 돌아와 이 값을 보고 스스로 물러선다 — 아래 정리는
                        // **아직 저장되지 않은 UUID** 를 못 보므로 그것만으로는 못 닫힌다.
                        alarmKit.noteActiveAccount(auth.session?.user.id)
                        guard alarmStore.hasLoadedFromDisk, let signedIn = auth.session?.user.id else { return }
                        await alarmKit.cancelScheduledAlarmsNotOwnedBy(signedIn, store: alarmStore)
                    }
                    .task(id: alarmStore.hasLoadedFromDisk) {
                        guard alarmStore.hasLoadedFromDisk else { return }
                        // ⚠ **먼저** 못 끈 예약을 다시 끊는다(Codex #699 P1). 로그아웃 때
                        // 취소가 실패해 남겨 둔 손잡이는 여기서만 소비된다 — 그 행은 꺼져
                        // 있어 아래 복구가 건너뛰고, 같은 계정으로 다시 로그인해도
                        // `cancelScheduledAlarmsNotOwnedBy` 가 건너뛴다.
                        await alarmKit.retryPendingCancellations(store: alarmStore)
                        // ⚠ **로드가 끝난 뒤 소유자 새기기를 다시 시도한다**(Codex #699 P1).
                        // 자동 401 이 콜드 스타트 중에 오면 그 시도가 **빈 배열**을 새기고
                        // 끝난다 — 로드가 그 뒤에 옛 행들을 채우기 때문이다. 그러면 그
                        // 행들은 `nil` 로 남아, 다음 계정이 로그아웃할 때 자기 것으로
                        // 오인해 영구히 꺼 버린다. 근거는 `SessionExpiryStore` 뿐이다.
                        // ⚠ **세션 가드보다 **먼저** 처리한다**(Codex #699 P1). 로그인 시점의
                        // 새기기가 로드 상한에 걸려 실패하면 표시가 남는데, 그때는 이미 B 의
                        // 세션이 저장된 뒤다 — `auth.session == nil` 을 요구하면 **유일한
                        // 재시도가 건너뛰어져** A 의 옛 행이 임자 없이 남고, B 가 로그아웃할 때
                        // 영구히 꺼진다.
                        if let expired = SessionExpiryStore.expiredOwnerUserId {
                            alarmStore.claimUnownedAlarms(for: expired)
                            // 다른 계정이 쓰는 중이면 이 표시의 목적(옛 행 확정)은 끝났다.
                            // 아무도 없으면 남겨 둔다 — 복구 대상을 가리는 기준이기도 하다.
                            if let signedIn = auth.session?.user.id.nilIfBlank, signedIn != expired {
                                SessionExpiryStore.clear()
                            }
                        }
                        // ⚠ **끝내지 못한 로그아웃을 마저 한다**(Codex #699 P1). 콜드 스타트
                        // 직후 로그아웃하면 저장소 로드가 상한(3초) 안에 안 끝나 뒷정리가
                        // 통째로 건너뛰어질 수 있다 — 그 계정의 예약은 살아 있는데 화면에는
                        // 못 들어간다. 표시가 남아 있으면 여기서 끝낸다.
                        // ⚠ **계정별로 쌓인다** — 여러 계정의 뒷정리가 밀려 있을 수 있다.
                        for pendingRaw in PendingSignOutStore.pendingUserIds {
                            let pending = pendingRaw.nilIfBlank
                            // ⚠ **그 사이 다른 계정이 로그인했을 수 있다.** 그때 알람을
                            // 건드리면 **지금 쓰는 사람의 알람을 끈다** — 특히 받은 가족
                            // 알람은 소유자가 미기록이라 `claimUnownedAlarms` 가 그걸 떠난
                            // 계정 것으로 낙인찍고 `stopAll` 이 꺼 버린다.
                            // 로컬 뒷정리는 **아무도 없거나 그 계정 본인일 때만** 한다.
                            let signedIn = auth.session?.user.id.nilIfBlank
                            let safeToTouchAlarms = signedIn == nil || (pending != nil && signedIn == pending)
                            if safeToTouchAlarms {
                                alarmStore.claimUnownedAlarms(for: pending)
                                await alarmKit.stopAllScheduledAlarms(store: alarmStore, ownerUserId: pending)
                                // ⚠ **다시 확인한다 — 그 사이 탈퇴가 철회됐을 수 있다.**
                                // 위 호출은 await 이라, 그동안 사용자가 철회하면 표시가
                                // 지워진다. 그런데도 나아가면 **방금 계정을 되살린 사람을
                                // 로그아웃시키고** 그 세션의 토큰까지 폐기한다.
                                guard PendingSignOutStore.pendingUserIds.contains(pendingRaw) else { continue }
                                // ⚠ **계정도 다시 본다.** 위 sweep 가 도는 사이에 로그인이
                                // 끝났을 수 있다 — 그대로 나아가면 지금 쓰는 사람을 끊는다.
                                let stillSafe = auth.session?.user.id.nilIfBlank == nil
                                    || auth.session?.user.id.nilIfBlank == pending
                                guard stillSafe else {
                                    await auth.finishInterruptedServerCleanupOnly(for: pending)
                                    continue
                                }
                                // 세션까지 끝내야 로그아웃이다. 서버 뒷정리(푸시 해제·토큰
                                // 폐기)도 여기서 마친다. 표시는 그 결과가 참일 때만 내려간다.
                                await auth.finishInterruptedSignOut(for: pending)
                            } else {
                                // 다른 계정이 쓰는 중 — 알람과 세션은 그대로 두고 서버만 정리한다.
                                await auth.finishInterruptedServerCleanupOnly(for: pending)
                            }
                        }
                        await alarmKit.recoverScheduledAlarms(store: alarmStore, ownerUserId: auth.session?.user.id)
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
            // ⚠ **`.system` 이면 modifier 를 아예 붙이지 않는다**(2026-08-18).
            //
            // `.preferredColorScheme(nil)` 은 "안 정한다" 가 아니라 **조상에서 자손의 설정을
            // 덮어쓰는 명시적 쓰기**다. 그래서 `AuthBackdrop` 이 자기 서브트리에 걸어 둔
            // `.dark` 가 무효가 됐고, 라이트 아이폰에서 랜딩·로그인·가입·비번재설정·**동의
            // 화면**의 글자가 라이트 팔레트(거의 검정)로 그려졌다 — 배경은 고정 남색이라
            // 안 보인다. 기본값이 `.system` 이라 **출고 상태가 그랬다.**
            // (다크 아이폰에서는 우연히 멀쩡해서 캡처로도 안 잡혔다.)
            .modifier(PreferredColorSchemeIfSet(
                scheme: AlarmTalkThemeMode.normalized(themeModeRaw).preferredColorScheme
            ))
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                Task {
                    guard alarmStore.hasLoadedFromDisk else { return }
                    // 전경 복귀에서도 한 번 — 로그아웃 직후 실패한 취소를 여기서 만회한다.
                    await alarmKit.retryPendingCancellations(store: alarmStore)
                    await alarmKit.recoverScheduledAlarms(store: alarmStore, ownerUserId: auth.session?.user.id)
                }
                // 빠진 테마 클립을 보충한다. 이미 캐시된 것은 건너뛰므로 값이 싸고,
                // 콜드 스타트에서 실패했거나 캐시가 정리된 경우를 여기서 메운다.
                // 안드로이드는 앱 시작마다 `prefetchStockClips()` 로 같은 일을 한다.
                Task {
                    guard auth.session != nil else { return }
                    stockClipPrefetcher.start(
                            session: auth.session,
                            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
                        )
                    // ⚠ **재바인딩도 여기서 한 번 더 돈다**(2026-09-03).
                    //   예전에는 트리거가 콜드 스타트(`.task(id: stockClipLanguageKey)`)
                    //   **하나뿐**이었다. 그런데 프리셋 교체는 서버가 틱마다 조금씩 굽는
                    //   일이라, 그 세션 시작 시점에는 세트가 모자라 재바인딩이
                    //   `replacementIsComplete` 에 걸려 **아무 일도 안 하고 끝난다.**
                    //   앱을 며칠 켜 두는 사용자는 그 세션 내내 지워진 대사를 재생했다.
                    //   안드로이드는 WorkManager 재큐잉·백오프로 여러 번 시도한다 —
                    //   iOS 만 한 번이었다. 전부 멱등이라 여기서 또 돌아도 안전하다.
                    await rebindStockClipsIfNeeded()
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
                    // ⚠ **개정을 여기서도 집는다.** 예전에는 콜드 스타트와 로그인 직후에만
                    // 봤는데, 앱을 계속 켜 두는 사람은 그 사이 올라간 재동의 요구를 며칠씩
                    // 모르고 지낸다 — 그동안 서버는 데이터 라우트를 403 으로 막는다.
                    // 안드로이드는 `LaunchedEffect(authSession?.token)` 이라 토큰이 갱신될
                    // 때마다 다시 본다(`ui/app/AlarmTalkApp.kt`).
                    // 이미 다 받은 사람에게는 아무 일도 일어나지 않는다 — 서버 `collect` 가
                    // 비어 화면이 뜨지 않는다(「한 번 받은 동의는 다시 묻지 않는다」).
                    await auth.checkConsentStatus()
                    guard auth.session != nil else { return }
                    await remoteSync.runFullSync()
                    await refreshWeatherVariantsAndReconcile()
                }
                // Phase 4-D1: 백엔드 entitlement 동기화가 직전에 실패했을 수 있다.
                // foreground 진입 시 currentEntitlements 의 모든 verified 트랜잭션을
                // 재전송해 catch-up. 백엔드 라우트 미배포 환경에서도 graceful 하다.
                // refreshPurchasedProducts 는 클라이언트 currentTier 만 갱신하지만,
                // resyncEntitlements 는 백엔드에도 모든 verified 트랜잭션을 재전송한다.
                Task {
                    await subscriptions.refreshPurchasedProducts()
                    await subscriptions.resyncEntitlements()
                    // 캐시 기록은 `refreshPurchasedProducts` 안에서 한다 — 등급이 다시
                    // 계산되는 **모든** 경로(구매·Transaction.updates 포함)를 덮기 위해서다.
                }
            case .background:
                // 시스템이 task 를 깨울 수 있도록 다음 사이클 재예약.
                BackgroundSyncTask.scheduleNext()
            default:
                break
            }
        }
    }

    /// **새 스톡 클립으로 갈아타고, 다 끝났으면 옛 파일을 지운다.**
    ///
    /// ⚠ **부르는 곳이 둘이다 — 콜드 스타트와 전경 복귀.** 예전에는 콜드 스타트 하나뿐이라,
    ///   교체 시딩이 도는 중에 앱을 켠 사용자는 세트가 모자라 재바인딩이 그냥 넘어가고
    ///   **그 세션 내내 지워진 대사를 재생**했다(안드로이드는 WorkManager 가 여러 번
    ///   시도한다). 전부 멱등이라 여러 번 돌아도 안전하다.
    ///
    /// ⚠ **두 곳에 베껴 두지 말 것** — 한쪽만 고치는 사고가 이 저장소의 단골이다.
    ///
    /// 순서에 뜻이 있다: 매니페스트 → 재바인딩 2종 → 날씨 조건 → **정리** → 예약 재조정.
    @MainActor
    private func rebindStockClipsIfNeeded() async {
        guard auth.session != nil else { return }
        StockReplacementStatus.shared.setWorking(true)
        defer { StockReplacementStatus.shared.setWorking(false) }
        // ⚠ **알람이 다 올라온 뒤에 시작한다**(2026-09-03 리뷰 10차). 저장소는 콜드 스타트에
        //   빈 배열로 시작해 비동기로 채우는데, 이 경로는 세션 복원만 끝나면 곧바로 들어올
        //   수 있다. 빈 목록으로 돌면 재바인딩은 그냥 0건이지만 **정리는 전부를 지운다.**
        await alarmStore.waitUntilLoadedFromDisk()
        guard alarmStore.hasLoadedFromDisk else { return }
        // ⚠ **매니페스트를 강제로 받는다**(2026-09-03 리뷰 8차). 교체 회차의 시딩은 cron 이
        //   틱당 조금씩 채우므로, 다른 화면이 먼저 받아 둔 **부분 매니페스트**가 세션
        //   캐시에 남아 있을 수 있다(`manifestFetchedThisSession`). 그걸로 돌리면 완전성
        //   검사에 걸려 **아무 일도 안 하고** 끝난다.
        // 반환값은 '이번에 서버에서 새로 받았는가' 다 — 교체 미완료 판정의 근거다.
        let manifestFetched = await voiceStudio.loadStockClips(session: auth.session, force: true)

        // ⚠ **앞 회차가 못 앉힌 것이 있으면 먼저 앉힌다**(2026-09-03 리뷰 19차).
        //   `upsert` 는 메모리를 이미 바꿔 놨으므로, 그대로 다시 돌리면 재바인더가 그 행들을
        //   '이미 최신' 으로 보고 아무것도 안 한다 — **못 앉힌 상태 그대로** 정리가 돌고
        //   문이 열린다. 여기서 다시 앉히지 못하면 이 회차도 미완료로 두고 물러난다.
        if StockReplacementStatus.shared.hasUnsavedRebind {
            guard alarmStore.saveNow() else {
                StockReplacementStatus.shared.report(
                    userId: auth.session?.user.id, pending: true, manifestFetched: manifestFetched
                )
                return
            }
            StockReplacementStatus.shared.clearUnsavedRebind()
        }

        let rebinder = StockClipLanguageRebinder(store: alarmStore)
        // 언어가 바뀌었거나, 묶인 클립이 서버에서 사라진 알람을 새 세트로 갈아 끼운다.
        let languageOutcome = await rebinder.rebindIfLanguageChanged(
            session: auth.session,
            clips: voiceStudio.stockClips,
            // 부분 세트로 갈아타지 않도록 완전성 판정에 쓴다.
            expectedVariants: voiceStudio.expectedVariants,
            // 버킷 없이 클립 하나만 물린 옛 알람이 어떤 테마였는지(서버가 안다).
            // 없으면 그 알람은 재바인더 두 갈래 어디에도 안 걸려 영영 옛 소리다.
            legacyHints: voiceStudio.legacyBucketHints,
            // 받는 사람의 지역·사주. 조건형 버킷을 묶을 때 빈 자리에만 채운다 — 받은
            // 알람은 그 값이 비어 있어서, 안 채우면 날씨는 서버 기본값(서울), 운세는
            // 빈 프로필 해시로 떨어진다. 서버 설정이 먼저, 없으면 로컬 저장분이다
            // (편집기 `savedPromptPreferences` 와 같은 순서).
            conditionInputs: {
                let server = DynamicPromptPreferences.from(
                    settings: auth.session?.user.dynamicPromptSettings
                )
                return server == DynamicPromptPreferences()
                    ? .load(userID: auth.session?.user.id)
                    : server
            }(),
            callerUserId: auth.session?.user.id
        )
        // 라이브 랜덤 생성으로 저장된 옛 알람을 테마 클립으로 옮긴다. 멱등이라 매번 돌아도
        // 안전하고, 묶을 클립이 없으면 아무 일도 하지 않고 다음에 다시 시도한다.
        let legacyOutcome = await rebinder.rebindLiveGenerationRows(
            session: auth.session,
            clips: voiceStudio.stockClips,
            expectedVariants: voiceStudio.expectedVariants,
            callerUserId: auth.session?.user.id
        )
        // ⚠ **날씨는 옮기고 나서 조건을 받아 와야 한다**(2026-09-03 리뷰 6차). 방금 만든
        //   행은 `contextVariantIndex` 가 없는데, 날씨 버킷은 그 값이 없으면 발사 때
        //   **마지막 클립("인터넷이 안 돼 날씨를 못 알아봤어요")** 으로 폴백한다
        //   (`BucketVariantResolver`). 지역도 저장돼 있고 인터넷도 되는데 그 안내가 나간다.
        //   아래 예약 재조정보다 **먼저** 해야 그 자리에서 예약에 반영된다.
        //   안드로이드 짝은 `StockClipLanguageRebinder` 의 `DynamicVoiceRefreshScheduler`.
        //   ⚠ **언어 재바인딩(`rebound`)도 함께 본다**(2026-09-03). 조건형 버킷(날씨·운세)을
        //   비켜 가던 우회를 걷어냈으므로, 이제 그 갈래도 조건 없는 행을 만들어 낸다.
        // ⚠⚠ **디스크에 못 앉혔으면 여기서 멈춘다**(2026-09-03 리뷰 18차).
        //   `upsert` 는 저장을 비동기로 걸어 둘 뿐이라, 쓰기가 실패해도 `store.alarms` 는
        //   이미 바뀌어 있다. 그대로 진행하면 아래 정리가 **메모리 위의 행**을 보고 옛
        //   오디오를 지우고, 상태 보고가 문을 연다 — 그 뒤 앱이 종료되면 다음 콜드 스타트가
        //   **없는 파일을 가리키는 옛 행**을 읽는다(내 알람은 서버에서 되받는 경로가 없다).
        //   그래서 정리도 보고도 하지 않고, 교체를 **미완료로 남긴다**(멱등).
        guard languageOutcome.persisted, legacyOutcome.persisted else {
            // 메모리는 이미 바뀌었다 — 그 사실을 남겨 **다음 회차가 정리 전에 먼저 앉히게** 한다.
            StockReplacementStatus.shared.markUnsavedRebind()
            StockReplacementStatus.shared.report(
                userId: auth.session?.user.id, pending: true, manifestFetched: manifestFetched
            )
            return
        }
        let rebound = languageOutcome.rebound
        let converted = legacyOutcome.rebound
        if converted > 0 || rebound > 0, let token = auth.session?.token {
            let weather = WeatherVariantRefreshService(store: alarmStore, alarmKit: alarmKit)
            _ = await weather.refreshDue(token: token)
        }
        // ⚠ **지우는 것은 언제나 맨 마지막이다**(2026-09-03 지시). 위 두 재바인딩이 끝난
        //   **뒤에만** 옛 스톡 클립 파일을 정리한다. 아직 갈아탈 알람이 남아 있으면 함수가
        //   스스로 0을 돌려주고 미룬다 — 중간에 멈추면 지운 것이 없으므로 잃는 것도 없다.
        _ = await rebinder.pruneReplacedStockAudio(
            clips: voiceStudio.stockClips,
            expectedVariants: voiceStudio.expectedVariants,
            // ⚠ **재바인딩과 같은 힌트**여야 한다. 여기만 힌트 없이 물으면 아직 갈아타지
            //   않은 알람을 두고 파일을 지운다 — 그 알람은 무음이 된다.
            legacyHints: voiceStudio.legacyBucketHints,
            callerUserId: auth.session?.user.id
        )
        // ⚠ **삭제 결과는 보지 않는다**(2026-09-03 지시). 여기까지 왔으면 받기와 묶기는
        //   끝났고, 파일 정리가 실패해도 서비스는 정상이다 — 그걸로 화면을 막으면 지울 것이
        //   없는 사용자를 이유 없이 가둔다.
        // ⚠ **행만 바꾸면 알람은 옛 언어로 운다.** 재바인딩은 클립 키를 갈아 끼우지만, 이미
        //   예약된 알람은 예약 시점에 넘긴 옛 파일을 그대로 재생한다 — 이 클래스가 고치려던
        //   증상("앱은 영어인데 알람만 한국어")이 예약 쪽에 그대로 남아 있었다.
        // 이번 회차가 실제로 소리를 갈아 끼운 행. 재조정도 '남은 것' 판정도 여기로 좁힌다 —
        // 전체를 보면 교체와 무관한 알람 하나의 재예약 실패가 사용자를 전체 화면 차단에
        // 가둔다(리뷰 20차).
        // ⚠ **앞 회차가 남긴 것과 합친다**(리뷰 21차). 첫 예약이 실패한 뒤 재시도하면 행은
        //   이미 최신이라 재바인더가 `.none` 을 돌려주고 이 집합이 비어 버린다 — 그러면
        //   재조정도 판정도 그 알람을 건너뛰고, AlarmKit 이 옛 소리를 쥔 채 문이 열린다.
        StockReplacementStatus.shared.noteReplaced(
            ids: languageOutcome.changedIds.union(legacyOutcome.changedIds)
        )
        let replacedIds = StockReplacementStatus.shared.pendingRearmIds
        await AlarmScheduleReconciler.reconcile(
            store: alarmStore, alarmKit: alarmKit, ownerUserId: auth.session?.user.id,
            // 지문이 없는 옛 예약(지문 도입 이전 앱이 건 것)도 이번에 바뀐 행이면 다시 건다.
            forceRearmIds: replacedIds
        )
        // ⚠⚠ **보고는 예약 재조정 뒤에**(2026-09-03 리뷰 19차). AlarmKit 은 예약할 때 넘긴
        //   사운드를 그대로 울리므로, `schedule` 이 실패하면 행을 갈아 끼웠어도 다음 알람은
        //   **은퇴한 목소리**로 운다. 재조정 전에 문을 열면 그 알람을 두고 앱이 열린다.
        //   재조정이 실패를 조용히 넘기므로(무예약보다 낫다) 남은 것을 다시 읽어 확인한다.
        let staleSchedules = AlarmScheduleReconciler.hasStaleSchedules(
            store: alarmStore, alarmKit: alarmKit, ownerUserId: auth.session?.user.id,
            limitedTo: replacedIds
        )
        // 예약이 최신임을 확인했으면 더 들고 있지 않는다.
        if !staleSchedules { StockReplacementStatus.shared.clearRearmIds() }
        // ⚠ **못 받았으면 앞 판정을 지킨다.** 오프라인 재시도가 문을 열면 안 된다
        //   (`report` 가 `manifestFetched` 를 보고 스스로 막는다).
        StockReplacementStatus.shared.report(
            userId: auth.session?.user.id,
            pending: staleSchedules || rebinder.hasPendingReplacement(
                clips: voiceStudio.stockClips,
                // 받아 온 뒤라면 비어 있어도 그건 '성공적으로 빈 카탈로그'(은퇴 직후
                // 게시 전)라 미완료다.
                manifestFetched: manifestFetched,
                legacyHints: voiceStudio.legacyBucketHints,
                callerUserId: auth.session?.user.id
            ),
            manifestFetched: manifestFetched
        )
    }

    /// 곧 울릴 날씨 알람의 조건을 받아 두고, 어긋난 예약을 맞춘다.
    ///
    /// ⚠ 예전 이름은 `refreshDynamicVoicesIfNeeded` 였다 — 랜덤 문구를 매일 **다시 합성**
    /// 하던 시절의 이름이라, 그 갈래를 걷어낸 뒤에는 없는 기능을 광고하는 이름이었다.
    @MainActor
    private func refreshWeatherVariantsAndReconcile() async {
        guard let token = auth.session?.token else { return }
        // ⚠ 여기서 랜덤 문구를 **다시 합성하던** 자리다(2026-08-18 제거 —
        // `DynamicVoiceRefreshService`). 알람 음성은 프리셋 + 직접 입력 둘뿐이라 매일
        // 지어낼 문장이 없다. 되살리지 말 것.
        // 곧 울릴 날씨 알람의 조건도 함께 받아 둔다. 반복 알람은 매일 다시 울리므로
        // 저장할 때 받은 어제 조건으로는 오늘 날씨를 말할 수 없다.
        let weather = WeatherVariantRefreshService(store: alarmStore, alarmKit: alarmKit)
        _ = await weather.refreshDue(token: token)
        // ⚠ **여기가 마지막 관문이다.** 위 두 갱신은 행의 음원을 갈아 끼우는데, 그것만으로는
        // OS 가 예약 때 받아 간 옛 파일이 그대로 울린다(동적 문구 알람은 매일 새 문구를
        // 만들어 놓고 어제 문구로 울었다 — 서버 호출과 월 한도는 매번 차감하면서).
        // 어긋난 예약을 여기서 한 번에 맞춘다.
        await AlarmScheduleReconciler.reconcile(store: alarmStore, alarmKit: alarmKit, ownerUserId: auth.session?.user.id)
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
            await kit.recoverScheduledAlarms(
                store: store,
                ownerUserId: BackgroundDependencies.shared.auth.session?.user.id,
                forceHolidayOffRecompute: true
            )
        }
    }

    /// 선다운로드·재바인딩을 다시 돌려야 하는 시점. 계정과 **기기 언어**가 축이다.
    private var stockClipLanguageKey: String {
        // 재시도 토큰이 축에 있어야 차단 화면의 '다시 시도' 가 이 절차를 다시 돌린다
        // (`StockReplacementStatus.retry`). 계정·언어와 같은 자격이다.
        [
            auth.session?.user.id ?? "anonymous",
            VoiceStudioViewModel.appVoiceLanguage(),
            String(stockReplacement.retryToken),
        ].joined(separator: "|")
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
            subscriptions.hasLoadedEntitlements ? "entitlements-loaded" : "entitlements-loading",
            // ⚠ **`users.plan` 도 키다**(2026-09-01 리뷰). 보류는 구독 id·status·plan 을
            // **그대로 두고** 이 값만 free 로 바꾼다 — 키에 없으면 `/auth/me` 가 갱신해도
            // 키가 같아 이 태스크가 **다시 돌지 않고**, 판정기에 새 입력을 넣은 의미가 없다.
            auth.session?.user.plan ?? "no-user-plan"
        ].joined(separator: "|")
    }

    @MainActor
    private func applyFreePlanVoiceLockIfNeeded() async {
        // ⚠ **`hasLoadedEntitlements` 를 입구에서 요구하지 않는다**(2026-09-01 리뷰).
        // 임자를 알 수 없는 레거시 StoreKit 구매만 있는 계정은 그 플래그를 **일부러 세우지
        // 않는다** — 입구에서 막으면 서버가 유료라고 확인해 줘도 **복원 갈래에 영영 닿지
        // 못해** 잘못 잠긴 알람이 그대로 남는다(`restorePaidVoiceAlarms` 의 유일한 호출부다).
        // 되돌릴 수 없는 **잠금** 쪽에서만 그 플래그를 요구한다(아래).
        guard auth.session != nil,
              alarmStore.hasLoadedFromDisk,
              socialFeatures.subscription != nil else {
            return
        }
        // ⚠ **판정은 `PaidVoiceGate.resolve` 하나로 한다**(2026-09-01 리뷰).
        // `PlanTier.bestKnown` 은 구독 응답이 **있으면** `userPlan` 을 아예 보지 않는다
        // (`serverSubscription == nil` 일 때만 후보에 넣는다). 결제 보류에서 서버는 구독
        // 행을 남긴 채 plan 만 회수하므로, 그 조합이면 이 자리가 유료로 읽혀 **잠그지 않을
        // 뿐 아니라 아래 복원 갈래로 빠져 이미 잠긴 알람까지 되돌린다.**
        // 스토어는 지금 StoreKit 이 들고 있는 값이 곧 1단이라 따로 본다(기한 불필요).
        let storeSaysPaid = subscriptions.currentTier.meetsOrExceeds(.personal)
        let access = PaidVoiceGate.resolve(snapshot: AccessSnapshot(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            storePlanKey: nil,
            storeEntitlementUntilMillis: nil,
            userPlan: auth.session?.user.plan
        ))
        // ⚠ **세 갈래를 분명히 가른다**(2026-09-01 리뷰 2차 정정). 31차에 입구 가드에서
        // `hasLoadedEntitlements` 를 빼면서 `guard ... else` 하나로 묶어 뒀는데, 그러면
        // **스토어 조회가 아직 안 끝난 것만으로 복원 갈래에 들어간다** — 서버가 무료라고
        // 확정한 계정의 잠긴 알람이 콜드 스타트마다 목소리로 되살아난다.
        //  - 유료 **확정** → 복원(되돌릴 수 있는 방향)
        //  - 무료 **확정** + 스토어 확인 완료 → 잠금(되돌릴 수 없으니 둘 다 요구)
        //  - 그 밖(모름·조회 중) → 아무것도 하지 않는다
        let entitled = storeSaysPaid || access == .entitled
        guard !entitled else {
            // ⚠ **유료로 돌아오면 대기표를 비운다.** 두 가지를 동시에 지킨다:
            // ① 아직 확인 안 한 강등 안내가 남아 있으면, 이미 유료가 된 사람에게
            //    "무료로 바뀌었어요" 를 띄우게 된다.
            // ② 비워 둬야 **다음에 다시 무료가 됐을 때 깨끗이 다시 뜬다**
            //    (2026-08-11 요청 "다시 요금제를 쓰면 나중에 바뀌었을 때 알람 뜰 수 있게").
            // ⚠ **무료 강등 안내만 지운다**(Codex #703 P2). 무조건 비우면 다른 기기가 적어
            // 둔 목소리 교체 안내(복원되지 않는 안내)를 띄우기도 전에 지운다.
            DowngradeNoticeStore().clear(userID: auth.session?.user.id, ifCause: .freePlan)
            _ = await socialFeatures.restorePaidVoiceAlarms(
                alarmStore: alarmStore,
                alarmKit: alarmKit,
                // 잠글 때와 **같은 계정**만 복원한다(안드로이드와 같은 규칙).
                expectedOwnerUserId: auth.session?.user.id
            )
            return
        }
        guard access == .notEntitled, subscriptions.hasLoadedEntitlements else { return }
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


/// `nil` 이면 **아무것도 붙이지 않는** `preferredColorScheme`.
///
/// SwiftUI 의 `.preferredColorScheme(nil)` 은 자손의 설정을 지우는 쓰기라, "앱 설정이
/// 시스템 따름" 을 그걸로 표현하면 화면별로 걸어 둔 고정 외관(`AuthBackdrop` 의 `.dark`)이
/// 사라진다. 값이 있을 때만 붙여 그 차이를 없앤다.
private struct PreferredColorSchemeIfSet: ViewModifier {
    let scheme: ColorScheme?

    func body(content: Content) -> some View {
        if let scheme {
            content.preferredColorScheme(scheme)
        } else {
            content
        }
    }
}
