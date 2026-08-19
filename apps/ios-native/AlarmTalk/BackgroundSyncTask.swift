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
    private let socialFeatures: SocialFeatureViewModel
    /// PR3: 백그라운드 사이클에서 `.fixed` 공휴일off one-shot 을 proactive 재무장하기 위한
    /// 약참조. 앱 lifetime 동안 `@StateObject` 로 살아있으므로 정상 동작 중엔 nil 이 아니다.
    private weak var store: LocalAlarmStore?
    private weak var alarmKit: AlarmKitViewModel?
    /// 목소리 접근권 재확인용. 이 주기가 **푸시를 놓쳤을 때의 그물**이다(아래 주석 참조).
    private weak var voiceStudio: VoiceStudioViewModel?

    init(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        socialFeatures: SocialFeatureViewModel,
        store: LocalAlarmStore? = nil,
        alarmKit: AlarmKitViewModel? = nil,
        voiceStudio: VoiceStudioViewModel? = nil
    ) {
        self.pull = pull
        self.push = push
        self.socialFeatures = socialFeatures
        self.store = store
        self.alarmKit = alarmKit
        self.voiceStudio = voiceStudio
    }

    // MARK: Registration

    /// 의존성이 준비되면 채워지는 **실행기**. 등록(아래 `registerLaunchHandler`)은 launch
    /// 중에 끝나야 하는데, 의존성(뷰모델들)은 그때 아직 없다 — 그래서 둘을 나눈다.
    @MainActor private static var runner: ((BGAppRefreshTask) -> Void)?

    /// 실행기가 준비되기 **전에** 시스템이 깨운 task. 준비되는 즉시 넘긴다.
    @MainActor private static var pendingTask: BGAppRefreshTask?

    /// **launch 중에** 반드시 부른다(`didFinishLaunchingWithOptions`).
    ///
    /// ⚠ **뷰의 `.task` 에서 등록하지 말 것**(2026-08-18 Codex #697 P2). `BGTaskScheduler`
    /// 는 launch 핸들러가 **launch 가 끝나기 전에** 등록돼 있기를 요구한다. 예전에는
    /// SwiftUI `.task` 안에서 등록했는데, 그건 `didFinishLaunchingWithOptions` 가 반환한
    /// **뒤에** 돈다. 특히 시스템이 **백그라운드 새로고침 때문에 앱을 깨운 경우**에는
    /// scene 이 붙지 않아 그 `.task` 가 아예 안 돌 수 있다 — 그러면 핸들러가 없어
    /// 백그라운드 사이클(푸시 유실 시의 그물)이 통째로 죽는다.
    ///
    /// 의존성은 아직 없으므로 **깨어난 task 를 붙들어 두고**, `register(...)` 가 실행기를
    /// 채우는 순간 넘긴다.
    static func registerLaunchHandler() {
        #if canImport(BackgroundTasks)
        guard !didRegisterHandler else { return }
        didRegisterHandler = true
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                if let runner { runner(refresh) } else { pendingTask = refresh }
            }
        }
        #endif
    }

    /// 실제 작업 실행기를 꽂는다. 의존성이 준비된 뒤(앱 화면 진입) 한 번 부른다.
    /// 등록 자체는 `registerLaunchHandler` 가 launch 중에 이미 끝냈다.
    static func register(
        pull: RemoteAlarmPullSync,
        push: RemoteAlarmPushSync,
        socialFeatures: SocialFeatureViewModel,
        store: LocalAlarmStore? = nil,
        alarmKit: AlarmKitViewModel? = nil,
        voiceStudio: VoiceStudioViewModel? = nil
    ) {
        #if canImport(BackgroundTasks)
        // ⚠ 여기서 `BGTaskScheduler.register` 를 **다시 부르지 말 것** — 같은 식별자로 두 번
        // 등록하면 크래시한다. 등록은 `registerLaunchHandler` 가 launch 중에 끝냈다.
        let run: @MainActor (BGAppRefreshTask) -> Void = { refresh in
            // ⚠ Task 핸들을 잡아 둔다. 잡지 않으면 만료·타임아웃에서 `setTaskCompleted` 만
            // 부르고 **실행 중인 사이클은 그대로 살아 있다** — 앱이 서스펜드되면 await 가
            // 매달려 있다가 다음 포그라운드 복귀 때 재개돼, 그때 도는 foreground 사이클과
            // 겹친다. sync 클래스의 타입 게이트가 그 겹침을 직렬화해 주긴 하지만,
            // 창 자체를 안 만드는 편이 낫다.
            let work = Task { @MainActor in
                let runner = BackgroundSyncTask(
                    pull: pull,
                    push: push,
                    socialFeatures: socialFeatures,
                    store: store,
                    alarmKit: alarmKit,
                    voiceStudio: voiceStudio
                )
                await runner.runAndSchedule(task: refresh)
            }
            // 시스템이 예산을 회수하면 실행 중인 사이클도 함께 접는다.
            refresh.expirationHandler = { work.cancel() }
        }
        Task { @MainActor in
            runner = run
            // 실행기가 없던 사이에 시스템이 깨웠으면 지금 넘긴다.
            if let waiting = pendingTask {
                pendingTask = nil
                run(waiting)
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

        // ⚠ 등록부(`register`)가 이미 expirationHandler 로 Task 를 취소하도록 걸어 뒀다.
        // 여기서 덮어쓰면 그 취소가 사라지므로, 완료 통보만 **덧붙인다**.
        let cancelWork = task.expirationHandler
        task.expirationHandler = {
            cancelWork?()
            task.setTaskCompleted(success: false)
        }

        let timeoutTask = Task { @MainActor in
            // ⚠ **취소되면 여기서 끝난다 — `try?` 로 삼키지 말 것**(2026-08-18 Codex #697 P2).
            // 사이클이 25초 전에 정상으로 끝나면 아래에서 `timeoutTask.cancel()` 을 부르는데,
            // 그때 `Task.sleep` 은 **즉시 던진다**. 삼키면 그 경로가 그대로 흘러 내려가
            // **정상 완료마다** `cancelWork()`(막 끝난 작업을 취소)와
            // `setTaskCompleted(success: false)`(같은 task 를 두 번째로 완료)를 부른다.
            // 예전에는 후자만 있어 "중복은 noop" 으로 넘겼지만, 취소까지 부르게 된 지금은
            // 그냥 틀린 동작이다 — 실제로 만료됐을 때만 이 아래가 돌아야 한다.
            do {
                try await Task.sleep(nanoseconds: UInt64(Self.executionTimeout * 1_000_000_000))
            } catch {
                return
            }
            // ⚠ **끝났다고 말하기 전에 실제로 멈춘다.**
            // 예전에는 `setTaskCompleted(false)` 만 불렀다 — 시스템에는 끝났다고 해
            // 놓고 사이클은 계속 돌아, 네트워크 요청과 **알람 쓰기**가 그 뒤에도 이어졌다.
            // iOS 가 그 순간 프로세스를 재우면 **반쯤 적용된 사이클**이 남고, 그게 곧
            // 이어질 재시도 회차와 겹친다. 시스템 만료 경로(위 `expirationHandler`)는
            // 처음부터 취소하고 있었는데 우리 워치독만 안 했다.
            cancelWork?()
            task.setTaskCompleted(success: false)
        }

        do {
            // 만료가 가까우면 여기서 세션을 되살린다. 갱신이 '앱을 여는 것' 에만 걸려
            // 있으면 몇 달씩 안 여는 사용자는 만료된 채로 열게 된다
            // (`SessionTokenRenewal` 주석 참조). 남은 동기화가 굴러간 토큰을 쓰도록
            // **맨 앞**에서 한다.
            await Self.renewSessionTokenIfNeeded()

            // ⚠ **목소리 접근권 재확인은 알람 동기화와 묶지 않는다.**
            // 이 주기가 목소리 쪽의 **유일한** 그물인데, 아래 push/pull 뒤에 두면
            // `/alarms` 만 일시적으로 실패해도(그건 throw 다) 여기까지 오지 못한다 —
            // 목소리 엔드포인트는 멀쩡한데 철회된 오디오가 계속 예약된 채 남는다
            // (2026-08-18 Codex #697 P1). 그래서 **먼저, 그리고 독립적으로** 돌린다.
            //
            // 푸시(`voice_access_revoked`)는 오프라인·스로틀링에서 조용히 버려지고, 앱을
            // 안 열면 시작·탭 진입 새로고침도 없다. 안드로이드는 이 자리를 위해
            // `VoiceAccessSyncWorker` 를 하루 주기로 돌린다 — 그 주석의 표현대로
            // "정확성은 주기와 앱 시작이 보장하고, 푸시는 즉시성만 맡는다".
            //
            // 강등은 새로고침에 매달린 `onAuthoritativeRefresh` 훅이 한다. 조회가 실패한
            // 회차에는 그 훅 안의 판정이 스스로 물러선다(오강등 > 미강등).
            // `refresh` 는 던지지 않는다(내부에서 삼킨다) — try 밖에 둬도 안전하다.
            if let voiceSession = KeychainStore.readSession() {
                // 알람이 디스크에서 올라오기를 기다리는 일은 **강등 훅**
                // (`onAuthoritativeRefresh`)이 한다 — 푸시로 온 회차도 같은 대기가 필요해
                // 한 곳으로 모았다. 여기서 또 기다리지 말 것.
                await voiceStudio?.refresh(session: voiceSession, force: true)
            }

            _ = try await push.runOnce()
            let pullResult = try await pull.runOnce()
            if let session = KeychainStore.readSession() {
                // ⚠ 여기서 랜덤 문구를 **다시 합성하던** 자리다(2026-08-18 제거).
                // 알람 음성은 프리셋 + 직접 입력 둘뿐이라 매일 지어낼 문장이 없다.
                // 아래 날씨 갱신은 **합성이 아니라 variant 재선택**이라 그대로 둔다.
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
