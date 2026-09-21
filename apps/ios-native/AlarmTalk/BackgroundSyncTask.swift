import Foundation

#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

// MARK: - BackgroundRefreshTaskHandle
//
// 런치 핸들러가 받는 task 의 **최소 계약**. 핸들러와 사이클이 task 에게 실제로 시키는 일은
// 두 가지뿐이다 — 만료 핸들러를 걸고, 끝났다고 알리는 것.
//
// 왜 프로토콜로 자르나: `BGAppRefreshTask` 는 **시스템만 만든다**(헤더에서 `init` 이
// `NS_UNAVAILABLE`). 그래서 진짜 task 를 손에 쥘 수 없는 유닛 테스트는 런치 핸들러를
// 아예 부를 수 없었고, 아래 격리 사고가 배포 전에 한 번도 걸리지 않았다.
protocol BackgroundRefreshTaskHandle: AnyObject {
    var expirationHandler: (() -> Void)? { get set }
    func setTaskCompleted(success: Bool)
}

#if canImport(BackgroundTasks)
// 두 멤버는 `BGTask` 에 있다 — 상위에 한 번만 붙이면 `BGAppRefreshTask` 가 물려받는다.
extension BGTask: BackgroundRefreshTaskHandle {}
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
    @MainActor private static var runner: ((any BackgroundRefreshTaskHandle) -> Void)?

    /// 실행기가 준비되기 **전에** 시스템이 깨운 task. 준비되는 즉시 넘긴다.
    @MainActor private static var pendingTask: (any BackgroundRefreshTaskHandle)?

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
        // ⚠ **`@Sendable` 을 지우지 말 것 — 지우면 이 핸들러는 배달되는 순간 트랩한다**
        // (2026-09-21, Sentry ALARMTALK-IOS-4/-7/-8). `launchHandler` 는 SDK 에
        // `void (^)(BGTask *)` 로 선언돼 있어 **Sendable 표기가 없는** 클로저다. 표기가
        // 없으면 클로저가 감싸는 `@MainActor` 클래스의 격리를 그대로 물려받는데, `using: nil`
        // 은 헤더 문서 그대로 **기본 백그라운드 큐**다 — Swift 6 이 클로저 진입부에 심는
        // 동적 격리 검사가 거기서 즉시 실패한다(`dispatch_assert_queue(main)`).
        // 잃은 것은 크래시 한 줄이 아니라 **백그라운드 사이클 전체**였다: 토큰 롤링 갱신·못
        // 끊은 예약 회수·목소리 접근권 재확인·push/pull·날씨 variant·리컨사일러가 한 번도
        // 돈 적이 없다(`runAndSchedule`).
        // `@Sendable` 클로저는 격리를 물려받지 않으므로 그 검사가 아예 심기지 않는다.
        // 메인 액터로의 이동은 아래 `handleLaunch` 가 **명시적으로** 한다.
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { @Sendable task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Self.handleLaunch(refresh)
        }
        #endif
    }

    /// 시스템이 **백그라운드 큐에서** 배달한 task 를 메인 액터의 실행기로 인계한다.
    ///
    /// ⚠ **`nonisolated` 를 지우지 말 것.** 이 함수에 메인 액터 격리가 붙으면 위 런치
    /// 핸들러가 다시 메인 큐를 요구하게 되고 같은 트랩이 그대로 되돌아온다. 큐를 건너는
    /// 일은 **여기 안의 `Task` 하나**로만 한다.
    ///
    /// 인자를 `BGAppRefreshTask` 가 아니라 프로토콜로 받는 이유는 테스트다 — 진짜 task 는
    /// 시스템만 만든다(`BackgroundRefreshTaskHandle` 주석).
    /// 회귀 테스트: `AlarmTalkTests/BackgroundSyncTaskLaunchHandlerTests`.
    nonisolated static func handleLaunch(_ task: some BackgroundRefreshTaskHandle) {
        // task 는 Sendable 이 아니다. 시스템이 이 큐로 넘긴 뒤로는 아무도 건드리지 않으니
        // 메인 액터로 옮기는 것이 안전한데, 컴파일러에 그 사실을 말해 줄 수단이
        // `nonisolated(unsafe)` 뿐이다(없으면 `sending ... risks causing data races`).
        nonisolated(unsafe) let handle = task
        Task { @MainActor in
            if let runner { runner(handle) } else { pendingTask = handle }
        }
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
        let run: @MainActor (any BackgroundRefreshTaskHandle) -> Void = { refresh in
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
            // ⚠ **`@Sendable` 을 명시한다.** 만료 핸들러도 시스템이 **어느 큐에서든** 부른다.
            // 지금 본문은 `Task.cancel()`(Sendable) 하나뿐이라 표기가 없어도 컴파일되지만,
            // 한 줄만 늘어나면 메인 액터 격리를 물려받은 채 백그라운드에서 불리는 —
            // 위 런치 핸들러와 똑같은 — 덫이 된다.
            refresh.expirationHandler = { @Sendable in work.cancel() }
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
    func runAndSchedule(task: any BackgroundRefreshTaskHandle) async {
        scheduleNext()

        // ⚠ 등록부(`register`)가 이미 expirationHandler 로 Task 를 취소하도록 걸어 뒀다.
        // 여기서 덮어쓰면 그 취소가 사라지므로, 완료 통보만 **덧붙인다**.
        // ⚠ 여기도 `@Sendable` 을 명시한다(이유는 `registerLaunchHandler` 주석). 그러면
        // 캡처 둘이 비-Sendable 이라 컴파일이 막히는데, 둘 다 **이 task 한 건에만** 묶인
        // 값이고 만료 핸들러는 시스템이 한 번 부르고 스스로 비운다(헤더). 그래서
        // `nonisolated(unsafe)` 로 받아 넘긴다.
        nonisolated(unsafe) let cancelWork = task.expirationHandler
        nonisolated(unsafe) let handle = task
        task.expirationHandler = { @Sendable in
            cancelWork?()
            handle.setTaskCompleted(success: false)
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
            // ⚠ **못 끊은 예약 회수도 동기화와 묶지 않는다**(Codex #703 P1).
            // 위 목소리 갱신과 **같은 이유**다 — push/pull 뒤에 두면 `/alarms` 하나만
            // 일시적으로 실패해도(그건 throw 다) 여기까지 오지 못하고, 그 사이 회수된
            // 목소리나 밀어낸 알람의 예약이 **그대로 울린다.** 게다가 이 일은 통째로
            // 로컬이라 네트워크 성패와 아무 상관이 없다. 그래서 **먼저, 독립적으로** 돌린다.
            if let store, let alarmKit {
                await alarmKit.retryPendingCancellations(store: store)
            }

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
                    _ = await weather.refreshDue(token: session.token, ownerUserId: session.user.id)
                }
            }
            // 위 갱신들이 행의 음원을 갈아 끼웠다면 예약도 맞춰야 한다 — iOS 는 예약 시점에
            // 받아 간 파일을 그대로 울리므로, 행만 고치면 옛 소리가 그대로 난다.
            if let store, let alarmKit {
                await AlarmScheduleReconciler.reconcile(store: store, alarmKit: alarmKit, ownerUserId: BackgroundDependencies.shared.auth.session?.user.id)
            }
            // PR3: `.fixed` 공휴일off one-shot proactive 재무장 sweep. iOS 의 유일한 주기
            // wake 가 BGAppRefreshTask 이므로, kill 상태에서 발화 후 dismiss-재무장을 놓친
            // 스테일 one-shot 을 여기서 다음 비공휴일 회차로 재무장한다 (Android WorkManager
            // + boot receiver parity). best-effort — BG 실행이 발화 전에 보장되지 않으므로
            // dismiss 경로 + foreground recovery 가 1차. 25s executionTimeout 안에서 동작.
            #if canImport(AlarmKit)
            if let store, let alarmKit, store.hasLoadedFromDisk {
                await alarmKit.recoverScheduledAlarms(
                    store: store,
                    // 백그라운드에도 세션이 있다(launch 에서 키체인으로 채택한다).
                    ownerUserId: KeychainStore.readSession()?.user.id
                )
            }
            #endif
            timeoutTask.cancel()

            // Android `RemoteAlarmSyncWorker.doWork` 의 retry 조건과 동일:
            // 하나라도 전달 미완료면 재시도한다. 로컬 행·음원까지 저장됐어도 OS 예약이
            // 실패한 알람은 5분 리드타임 안에 다시 걸어야 해서 부분 성공도 미룰 수 없다.
            // WorkManager 는 이때 Result.retry() 로
            // 지수 백오프 재실행하지만, BGAppRefreshTask 에는 동등한 exponential backoff
            // API 가 없다. setTaskCompleted(success:false) + 더 짧은 earliestBeginDate
            // 로 재예약하는 것이 가장 근접한 근사다(정확한 지수 백오프는 재현 불가).
            if pullResult.failed > 0 {
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
            let (rolledToken, user) = try await AlarmTalkAPI.shared.me(token: session.token)
            // ⚠ **plan 도 반영한다**(2026-09-01 리뷰). `plan_changed` 를 놓친 기기에서는 이
            // 갱신이 **유일하게 성공한 `/auth/me`** 일 수 있는데, 토큰만 저장하면 예약·울림
            // 게이트가 읽는 값이 옛 등급 그대로다 — 보류·환불 뒤에도 클론이 예약되거나,
            // 회복됐는데 계속 막힌다. 스펙: "`/auth/me` 로 plan 을 받아 온 경로는 전부 적는다".
            //
            // ⚠ **토큰 에폭을 본다.** 같은 계정으로 로그아웃→재로그인하면 id 는 그대로라,
            // 이 응답을 인가한 토큰이 아직 그대로일 때만 반영해야 새 세션을 덮지 않는다.
            // **plan 만** 갈아 끼운다 — 프로필 전체를 덮으면 그 사이 바꾼 이름이 되돌아간다.
            // ⚠ **읽고-대조하고-쓰기를 한 덩어리로**(2026-09-01 리뷰 2차 정정). 따로 하면
            // 그 사이의 로그아웃→**같은 계정** 재로그인에서 옛 작업이 방금 발급된 토큰을
            // 덮는다 — 계정 id 만 대조해서는 못 거른다(같은 id 다). 토큰 에폭까지 보는
            // `saveSessionIfCurrent` 로 원자적으로 바꾼다.
            // 세션과 판정 스냅샷을 **같은 잠금 안에서** 함께 바꾼다 — 문이 그 조합을 갖고 있다.
            // 결과를 **일부러 버린다**(2026-09-02 리뷰에서 명시하기로 함). 거절은 '그 사이
            // 로그아웃·재로그인이 있었다' 는 뜻인데, 이 함수는 여기서 끝나고 뒤따르는 상태
            // 발행이 없다 — 그대로 두는 것이 맞다. 같은 파일의 다른 문 호출과 같은 처리다.
            // (`AlarmTalkLog` 에는 오류 채널만 있어서, 이건 오류가 아니므로 남기지 않는다.)
            _ = EntitlementWriter().renewSession(
                AccessTicket(userID: session.user.id, token: session.token),
                rolledToken: rolledToken,
                plan: user.plan
            )
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
            // ⚠ **취소는 이미 끝났다 — 여기서 그냥 넘어가면 pending 이 0 이 된다**
            //   (코덱스 #730 3차). 위 cancel-then-submit 은 "submit 이 즉시 뒤따르므로
            //   창이 없다" 를 전제로 하는데, 그 submit 이 던지면 **멀쩡히 예약돼 있던
            //   15분 요청까지 사라진다.** 가족 알람 푸시를 놓쳤을 때의 폴백이 주기 pull
            //   하나뿐이라, 그게 없어지면 다음 전경 진입까지 받은 알람이 안 들어온다.
            //
            //   그래서 표준 주기로 한 번 더 넣어 본다. 시뮬레이터·백그라운드 새로고침
            //   꺼짐처럼 **기기가 아예 안 받는** 경우에는 이것도 실패하는데, 그때는
            //   애초에 예약이란 게 없으니 잃는 것이 없다. 건지려는 것은 방금 넘긴
            //   `earliestBeginDate` 때문에 거절당한 경우다.
            let fallback = BGAppRefreshTaskRequest(identifier: taskIdentifier)
            fallback.earliestBeginDate = Date(timeIntervalSinceNow: refreshInterval)
            try? BGTaskScheduler.shared.submit(fallback)
        }
        #endif
    }

    /// 등록된 모든 pending task 를 취소. 로그아웃 시 호출.
    static func cancelAll() {
        #if canImport(BackgroundTasks)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
        #endif
    }

    // MARK: - Testing support

    #if DEBUG
    /// 테스트가 잠시 밀어낸 **진짜 실행기**. 유닛 테스트는 호스트 앱 프로세스에서 돌아
    /// launch 가 꽂아 둔 실행기가 이미 있다 — 테스트가 그걸 지운 채 끝내면 같은 프로세스의
    /// 뒤따르는 테스트가 다른 상태를 본다.
    @MainActor private static var runnerSavedByTest: ((any BackgroundRefreshTaskHandle) -> Void)?

    /// 테스트가 밀어내기 **전에 이미 붙들려 있던 task**.
    ///
    /// 실행기와 **같이** 보관·복원해야 한다. 유닛 테스트는 호스트 앱 프로세스에서 돌고 그
    /// 앱은 launch 에서 이미 런치 핸들러를 꽂았으므로, 테스트가 도는 중에도 시스템은 진짜
    /// task 를 배달할 수 있다. 실행기가 아직 없어 보관 경로에 들어와 있던 그 task 를 주입구가
    /// 그냥 `nil` 로 밀어 버리면 **그 회차가 통째로 사라진다** — 백그라운드로 깨어난 콜드
    /// 실행에는 그 경로 말고 살 길이 없다.
    @MainActor private static var pendingTaskSavedByTest: (any BackgroundRefreshTaskHandle)?
    @MainActor private static var runnerOverriddenByTest = false

    /// 테스트 전용 주입구(출시 빌드에는 없다). `handleLaunch` 가 메인이 아닌 큐에서 불려도
    /// 메인 액터로 인계하는지 보려면 실행기가 있어야 하는데, 운영 경로(`register`)는 뷰모델
    /// 일습을 요구해 유닛 테스트가 만들 수 없다. `nil` 을 주면 '실행기 없음'(보관 경로)이 된다.
    @MainActor static func overrideRunnerForTesting(
        _ handler: ((any BackgroundRefreshTaskHandle) -> Void)?
    ) {
        if !runnerOverriddenByTest {
            runnerSavedByTest = runner
            pendingTaskSavedByTest = pendingTask
            runnerOverriddenByTest = true
        }
        runner = handler
        // 보관 경로를 **비운 상태에서** 시작해야 테스트가 심은 task 만 보게 된다.
        // 원래 있던 것은 위에서 챙겨 뒀고, 걷어낼 때 되돌린다.
        pendingTask = nil
    }

    /// 주입을 걷어내고 앱이 launch 에서 꽂아 둔 실행기와 붙들려 있던 task 를 되돌린다.
    ///
    /// ⚠ **`pendingTask` 를 `nil` 로 밀어내지 말 것.** 치울 것은 **테스트가 심은 것**뿐이고,
    /// 주입 전부터 있던 진짜 task 는 그대로 돌려놔야 한다. 저장해 둔 값이 있었다는 것은
    /// 그때 실행기가 없었다는 뜻이므로(있었으면 `register` 가 이미 넘겼다), 실행기를 되돌리는
    /// 것과 같은 짝으로 원래 상태가 복원된다.
    @MainActor static func clearRunnerOverrideForTesting() {
        guard runnerOverriddenByTest else { return }
        runner = runnerSavedByTest
        pendingTask = pendingTaskSavedByTest
        runnerSavedByTest = nil
        pendingTaskSavedByTest = nil
        runnerOverriddenByTest = false
    }

    /// 실행기가 없을 때 붙들어 둔 task. 보관 경로가 사라지면 **백그라운드로 깨어난 콜드
    /// 실행의 첫 회차**가 통째로 버려지므로 테스트가 이 값으로 고정한다.
    @MainActor static var pendingTaskForTesting: (any BackgroundRefreshTaskHandle)? { pendingTask }
    #endif
}
