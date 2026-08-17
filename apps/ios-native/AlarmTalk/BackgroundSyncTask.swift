import Foundation

#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

// MARK: - BackgroundSyncTask
//
// Android `RemoteAlarmSyncScheduler` (WorkManager 15 분 주기 + initial run) 의
// iOS 대응. `BGAppRefreshTask` 로 15 분 이상 지연된 백그라운드 실행을 시스템에 위임한다.
//
// 식별자 `com.alarmtalk.app.refresh` 는 다음 두 곳에 등록되어야 한다.
//   1. `AlarmTalk/Info.plist` 의 `BGTaskSchedulerPermittedIdentifiers` (Phase 1-B 확정)
//   2. 본 파일의 `BackgroundSyncTask.taskIdentifier`
//
// 라이프사이클:
//   - App init 시점에 `register(...)` 한 번 호출 (BGTaskScheduler 의 등록은 launch 단계).
//   - background 진입 / 포그라운드 진입 / 로그인 직후에 `scheduleNext()` 로 재예약.
//   - 시스템이 task 를 깨우면 `runAndSchedule(task:)` 가 push -> pull 순서로 실행.
@MainActor
final class BackgroundSyncTask {

    /// Info.plist BGTaskSchedulerPermittedIdentifiers 와 정확히 일치해야 한다.
    static let taskIdentifier = "com.alarmtalk.app.refresh"

    /// 핸들러가 꽂혔는가.
    ///
    /// ⚠ **submit 은 등록 전에 부르면 `NSInternalInconsistencyException` 으로 앱을 죽인다**
    /// — throw 가 아니라 예외라 `try?` 로도 못 막는다. 등록과 예약이 서로 다른 `.task` 에서
    /// 시작되는 구조라 순서가 뒤집힐 수 있었고, 실제로 뒤집혀 launch 크래시가 났다
    /// (2026-08-06). 순서는 호출부에서 바로잡았고, 이 플래그는 다시 어긋났을 때
    /// **죽는 대신 예약만 건너뛰게** 하는 안전장치다.
    private static var didRegisterHandler = false

    /// Android WorkManager 의 15 분 주기와 동일.
    static let refreshInterval: TimeInterval = 15 * 60

    /// pull 이 should-retry 결과를 냈을 때 쓰는 더 짧은 재예약 간격.
    /// Android WorkManager 는 Result.retry() 시 지수 백오프(기본 10s 부터)를 쓰지만,
    /// BGAppRefreshTask 에는 동등 API 가 없다. 표준 주기(15분)보다 빠른 재시도를
    /// 유도하는 근사값으로, 시스템 최소 허용 간격을 고려해 보수적으로 잡는다.
    static let retryInterval: TimeInterval = 5 * 60

    /// 단일 task 의 안전 타임아웃. BGTaskScheduler 는 약 30 초 안에 setTaskCompleted 를 요구하므로
    /// 그보다 짧게 잡아 강제 종료를 방지한다.
    private static let executionTimeout: TimeInterval = 25

    private let pull: RemoteAlarmPullSync
    private let push: RemoteAlarmPushSync
    private let dynamicVoice: DynamicVoiceRefreshService
    private let socialFeatures: SocialFeatureViewModel
    /// PR3: 백그라운드 사이클에서 `.fixed` 공휴일off one-shot 을 proactive 재무장하기 위한
    /// 약참조. 앱 lifetime 동안 `@StateObject` 로 살아있으므로 정상 동작 중엔 nil 이 아니다.
    private weak var store: LocalAlarmStore?
    private weak var alarmKit: AlarmKitViewModel?

    init(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        dynamicVoice: DynamicVoiceRefreshService,
        socialFeatures: SocialFeatureViewModel,
        store: LocalAlarmStore? = nil,
        alarmKit: AlarmKitViewModel? = nil
    ) {
        self.pull = pull
        self.push = push
        self.dynamicVoice = dynamicVoice
        self.socialFeatures = socialFeatures
        self.store = store
        self.alarmKit = alarmKit
    }

    // MARK: Registration

    /// 시스템에 task 핸들러를 등록한다. App init 시 한 번만 호출해야 한다.
    /// register 자체는 BGAppRefreshTask 의 실제 실행 시점에 클로저를 호출한다.
    static func register(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        dynamicVoice: DynamicVoiceRefreshService,
        socialFeatures: SocialFeatureViewModel,
        store: LocalAlarmStore? = nil,
        alarmKit: AlarmKitViewModel? = nil
    ) {
        #if canImport(BackgroundTasks)
        didRegisterHandler = true
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            // ⚠ Task 핸들을 잡아 둔다. 잡지 않으면 만료·타임아웃에서 `setTaskCompleted` 만
            // 부르고 **실행 중인 사이클은 그대로 살아 있다** — 앱이 서스펜드되면 await 가
            // 매달려 있다가 다음 포그라운드 복귀 때 재개돼, 그때 도는 foreground 사이클과
            // 겹친다. sync 클래스의 타입 게이트가 그 겹침을 직렬화해 주긴 하지만,
            // 창 자체를 안 만드는 편이 낫다.
            let work = Task { @MainActor in
                let runner = BackgroundSyncTask(
                    pull: pull,
                    push: push,
                    dynamicVoice: dynamicVoice,
                    socialFeatures: socialFeatures,
                    store: store,
                    alarmKit: alarmKit
                )
                await runner.runAndSchedule(task: refresh)
            }
            // 시스템이 예산을 회수하면 실행 중인 사이클도 함께 접는다.
            refresh.expirationHandler = { work.cancel() }
        }
        #endif
    }

    // MARK: Execution

    /// 백그라운드 task 한 사이클을 실행하고 다음 사이클을 예약.
    ///
    /// 동작 순서:
    ///   1. scheduleNext: 어떤 결과든 다음 사이클을 먼저 예약 (Android `ExistingPeriodicWorkPolicy.KEEP` 와 동등)
    ///   2. expirationHandler 설치: 시스템이 cancel 하면 setTaskCompleted(false)
    ///   3. push -> pull 순서로 실행 (로컬 변경을 먼저 서버에 올린 뒤 최신 상태를 내려받기)
    ///   4. setTaskCompleted: 성공/실패 모두 호출
    #if canImport(BackgroundTasks)
    func runAndSchedule(task: BGAppRefreshTask) async {
        scheduleNext()

        // ⚠ 등록부(`register`)가 이미 expirationHandler 로 Task 를 취소하도록 걸어 뒀다.
        // 여기서 덮어쓰면 그 취소가 사라지므로, 완료 통보만 **덧붙인다**.
        let cancelWork = task.expirationHandler
        task.expirationHandler = {
            cancelWork?()
            task.setTaskCompleted(success: false)
        }

        let timeoutTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(Self.executionTimeout * 1_000_000_000))
            // 타임아웃 시 false. 아래 setTaskCompleted 가 중복 호출되어도 시스템 noop.
            task.setTaskCompleted(success: false)
        }

        do {
            // 만료가 가까우면 여기서 세션을 되살린다. 갱신이 '앱을 여는 것' 에만 걸려
            // 있으면 몇 달씩 안 여는 사용자는 만료된 채로 열게 된다
            // (`SessionTokenRenewal` 주석 참조). 남은 동기화가 굴러간 토큰을 쓰도록
            // **맨 앞**에서 한다.
            await Self.renewSessionTokenIfNeeded()

            _ = try await push.runOnce()
            let pullResult = try await pull.runOnce()
            if let session = KeychainStore.readSession() {
                _ = await dynamicVoice.refreshDue(token: session.token)
                // 곧 울릴 날씨 알람의 조건을 미리 받아 둔다. **발사 시점에는 못 받는다** —
                // iOS 는 그때 우리 코드가 돌지 않고 예약해 둔 사운드가 그대로 울린다.
                if let store {
                    let weather = WeatherVariantRefreshService(store: store, alarmKit: alarmKit)
                    _ = await weather.refreshDue(token: session.token)
                }
            }
            // 위 갱신들이 행의 음원을 갈아 끼웠다면 예약도 맞춰야 한다 — iOS 는 예약 시점에
            // 받아 간 파일을 그대로 울리므로, 행만 고치면 옛 소리가 그대로 난다.
            if let store, let alarmKit {
                await AlarmScheduleReconciler.reconcile(store: store, alarmKit: alarmKit)
            }
            // PR3: `.fixed` 공휴일off one-shot proactive 재무장 sweep. iOS 의 유일한 주기
            // wake 가 BGAppRefreshTask 이므로, kill 상태에서 발화 후 dismiss-재무장을 놓친
            // 스테일 one-shot 을 여기서 다음 비공휴일 회차로 재무장한다 (Android WorkManager
            // + boot receiver parity). best-effort — BG 실행이 발화 전에 보장되지 않으므로
            // dismiss 경로 + foreground recovery 가 1차. 25s executionTimeout 안에서 동작.
            #if canImport(AlarmKit)
            if let store, let alarmKit, store.hasLoadedFromDisk {
                await alarmKit.recoverScheduledAlarms(store: store)
            }
            #endif
            timeoutTask.cancel()

            // Android `RemoteAlarmSyncWorker.doWork` 의 retry 조건과 동일:
            // pull 이 전부 실패(failed>0)했고 새로 반영된 게 하나도 없으면(imported==0
            // && updated==0) 재시도가 의미 있다. WorkManager 는 이때 Result.retry() 로
            // 지수 백오프 재실행하지만, BGAppRefreshTask 에는 동등한 exponential backoff
            // API 가 없다. setTaskCompleted(success:false) + 더 짧은 earliestBeginDate
            // 로 재예약하는 것이 가장 근접한 근사다(정확한 지수 백오프는 재현 불가).
            if pullResult.failed > 0 && pullResult.imported == 0 && pullResult.updated == 0 {
                scheduleNext(earliestBeginDate: Date(timeIntervalSinceNow: Self.retryInterval))
                task.setTaskCompleted(success: false)
            } else {
                task.setTaskCompleted(success: true)
            }
        } catch {
            timeoutTask.cancel()
            // Android `RemoteAlarmSyncWorker` 의 외부 getOrElse { Result.retry() } 와 동일:
            // push/pull 이 예외를 던지면 표준 주기 대신 더 짧은 주기로 재시도를 유도한다.
            scheduleNext(earliestBeginDate: Date(timeIntervalSinceNow: Self.retryInterval))
            task.setTaskCompleted(success: false)
        }
    }
    #endif

    /// 만료가 가까울 때만 `GET /auth/me` 로 토큰을 굴려 Keychain 에 다시 넣는다.
    ///
    /// ⚠ **실패해도 던지지 않는다.** 갱신은 알람 동기화의 전제 조건이 아니다 — 여기서
    /// 던지면 네트워크가 잠깐 나빴다는 이유로 push/pull 까지 통째로 재시도로 밀려난다.
    ///
    /// ⚠ **저장 직전에 Keychain 을 다시 읽는다.** 네트워크 왕복 중 로그아웃·계정 전환이
    /// 끼면 비운 저장소에 끝난 세션을 되쓰게 된다. 사용자 id 가 다르면 버린다
    /// (안드로이드는 같은 자리를 `saveTokenIfGeneration` 의 세션 세대로 막는다).
    static func renewSessionTokenIfNeeded() async {
        guard let session = KeychainStore.readSession(),
              SessionTokenRenewal.shouldRenew(token: session.token) else { return }
        do {
            let (rolledToken, _) = try await AlarmTalkAPI.shared.me(token: session.token)
            guard let rolledToken, !rolledToken.isEmpty else { return }
            guard var current = KeychainStore.readSession(),
                  current.user.id == session.user.id else { return }
            current.token = rolledToken
            try KeychainStore.saveSession(current)
        } catch {
            // 갱신 실패는 조용히 넘어간다 — 만료까지 아직 여유가 있고(임계값이 90일),
            // 다음 백그라운드 회차나 앱 오픈이 다시 시도한다.
        }
    }

    /// 다음 BGAppRefreshTask 를 시스템에 예약한다. 실패는 무시 (예: 시뮬레이터, 권한 없음).
    /// `earliestBeginDate` 를 주면 그 시각으로, 없으면 표준 주기(15분 뒤)로 예약한다.
    func scheduleNext(earliestBeginDate: Date? = nil) {
        Self.scheduleNext(earliestBeginDate: earliestBeginDate)
    }

    static func scheduleNext(earliestBeginDate: Date? = nil) {
        #if canImport(BackgroundTasks)
        // BGTaskScheduler 는 identifier 당 pending 요청을 하나만 유지한다. 이미 pending 인
        // 요청이 있으면 submit 이 throw 하고(아래 catch 가 swallow), 기존 요청이 유지된다.
        // 그 결과 runAndSchedule:115 의 초기 15분 예약이 살아남아 153/163 의 5분 재시도
        // 재예약이 조용히 버려진다. cancel-then-submit 으로 last-writer-wins 를 보장한다:
        // 초기 예약은 expiration safety 를 그대로 제공하고, 재시도 submit 이 그것을 취소한 뒤
        // 5분 요청으로 교체한다. submit 이 즉시 뒤따르므로 pending 0 인 의미 있는 창은 없다.
        // 등록 전이면 조용히 건너뛴다. 잃는 것은 이번 회차 예약 하나뿐이고,
        // 등록 직후 호출부가 다시 예약한다.
        guard didRegisterHandler else { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = earliestBeginDate ?? Date(timeIntervalSinceNow: refreshInterval)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // 시뮬레이터 / 권한 없음 — silent.
        }
        #endif
    }

    /// 등록된 모든 pending task 를 취소. 로그아웃 시 호출.
    static func cancelAll() {
        #if canImport(BackgroundTasks)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
        #endif
    }
}
