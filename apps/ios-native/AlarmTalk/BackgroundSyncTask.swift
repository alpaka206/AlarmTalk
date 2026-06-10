import Foundation

#if canImport(BackgroundTasks)
import BackgroundTasks
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

    /// 단일 task 의 안전 타임아웃. BGTaskScheduler 는 약 30 초 안에 setTaskCompleted 를 요구하므로
    /// 그보다 짧게 잡아 강제 종료를 방지한다.
    private static let executionTimeout: TimeInterval = 25

    private let pull: RemoteAlarmPullSync
    private let push: RemoteAlarmPushSync
    private let dynamicVoice: DynamicVoiceRefreshService
    private let socialFeatures: SocialFeatureViewModel

    init(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        dynamicVoice: DynamicVoiceRefreshService,
        socialFeatures: SocialFeatureViewModel
    ) {
        self.pull = pull
        self.push = push
        self.dynamicVoice = dynamicVoice
        self.socialFeatures = socialFeatures
    }

    // MARK: Registration

    /// 시스템에 task 핸들러를 등록한다. App init 시 한 번만 호출해야 한다.
    /// register 자체는 BGAppRefreshTask 의 실제 실행 시점에 클로저를 호출한다.
    static func register(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        dynamicVoice: DynamicVoiceRefreshService,
        socialFeatures: SocialFeatureViewModel
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
                    socialFeatures: socialFeatures
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
            try await pull.runOnce()
            if let session = KeychainStore.readSession() {
                await socialFeatures.refreshNotesSilently(session: session)
                _ = await dynamicVoice.refreshDue(token: session.token)
            }
            timeoutTask.cancel()
            task.setTaskCompleted(success: true)
        } catch {
            timeoutTask.cancel()
            task.setTaskCompleted(success: false)
        }
    }
    #endif

    /// 다음 BGAppRefreshTask 를 시스템에 예약한다. 실패는 무시 (예: 시뮬레이터, 권한 없음).
    func scheduleNext() {
        Self.scheduleNext()
    }

    static func scheduleNext() {
        #if canImport(BackgroundTasks)
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: refreshInterval)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // 시뮬레이터 / 권한 없음 / 중복 제출 — silent.
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
