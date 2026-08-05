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
// 식별자 `com.voicealarm.nativeapp.ios.refresh` 는 다음 두 곳에 등록되어야 한다.
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
    static let taskIdentifier = "com.voicealarm.nativeapp.ios.refresh"

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
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
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

        task.expirationHandler = {
            // 시스템이 task 를 종료하면 더 이상 실행할 수 없다.
            task.setTaskCompleted(success: false)
        }

        let timeoutTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(Self.executionTimeout * 1_000_000_000))
            // 타임아웃 시 false. 아래 setTaskCompleted 가 중복 호출되어도 시스템 noop.
            task.setTaskCompleted(success: false)
        }

        do {
            _ = try await push.runOnce()
            let pullResult = try await pull.runOnce()
            if let session = KeychainStore.readSession() {
                _ = await dynamicVoice.refreshDue(token: session.token)
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
