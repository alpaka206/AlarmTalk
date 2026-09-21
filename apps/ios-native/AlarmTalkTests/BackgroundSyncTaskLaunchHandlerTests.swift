import XCTest
@testable import AlarmTalk

// 이 파일이 부르는 주입구(`overrideRunnerForTesting` 등)는 앱 타깃에서 `#if DEBUG` 안에만
// 있다. 감싸지 않으면 Release 구성으로 테스트 타깃만 빌드할 때 링크가 깨진다 —
// 같은 이유로 `StockClipProgressScanTests` 도 감싼다.
#if DEBUG
/// **런치 핸들러는 메인이 아닌 큐에서 불린다** — 그 사실 하나를 고정한다.
///
/// 무엇을 놓쳤었나(2026-09-21, Sentry ALARMTALK-IOS-4/-7/-8): `BGTaskScheduler.register` 에
/// 넘기는 클로저에 `@Sendable` 이 없으면 감싸는 `@MainActor` 클래스의 격리를 물려받는데,
/// `using: nil` 은 **기본 백그라운드 큐**라 Swift 6 이 심은 격리 검사가 배달되는 즉시
/// 실패한다(`dispatch_assert_queue(main)`). 그래서 `runAndSchedule` 은 **한 번도 실행된 적이
/// 없었다** — 토큰 롤링 갱신·못 끊은 예약 회수·목소리 접근권 재확인·push/pull·날씨
/// variant·리컨사일러가 전부 죽은 코드였다.
///
/// ⚠ **이 클래스에 `@MainActor` 를 붙이지 말 것.** 기존 `BackgroundSyncTaskTests` 가
/// 통째로 `@MainActor` 라 이 버그를 못 잡았다 — 테스트가 메인 액터에서 부르면 격리 검사가
/// 통과해 버린다. 여기서는 **비격리 테스트**가 `DispatchQueue.global` 로 부른다.
/// 겸해서 `handleLaunch` 에 메인 액터 격리가 다시 붙으면 이 파일이 **컴파일부터** 막힌다.
final class BackgroundSyncTaskLaunchHandlerTests: XCTestCase {

    /// (a) 백그라운드 큐에서 불러도 트랩하지 않고 (b) 실행기는 메인 액터에서 인계받는다.
    func test_handleLaunch_백그라운드_큐에서_불려도_메인_액터로_인계한다() async {
        let handedOff = expectation(description: "실행기가 메인 액터에서 task 를 인계받는다")
        let task = LaunchTaskDouble()

        await MainActor.run {
            BackgroundSyncTask.overrideRunnerForTesting { received in
                XCTAssertTrue(
                    Thread.isMainThread,
                    "실행기는 메인 액터에서 불려야 한다 — 그 안에서 뷰모델과 알람 저장소를 만진다"
                )
                XCTAssertTrue(received === task, "인계된 task 가 시스템이 준 것과 달라졌다")
                handedOff.fulfill()
            }
        }

        // ⚠ 이 줄이 회귀 감시자다. 시스템은 `using: nil` 로 등록한 핸들러를 **기본 백그라운드
        // 큐**에서 부른다. 메인 큐에서 부르도록 바꾸면 이 테스트는 버그를 다시 못 잡는다.
        DispatchQueue.global(qos: .background).async {
            BackgroundSyncTask.handleLaunch(task)
        }

        await fulfillment(of: [handedOff], timeout: 5)
        await MainActor.run { BackgroundSyncTask.clearRunnerOverrideForTesting() }
    }

    /// 실행기가 아직 없으면 **붙들어 둔다.** 등록(launch)과 실행기 주입(의존성 준비)은 서로
    /// 다른 시점이라, 백그라운드 새로고침만으로 깨어난 콜드 실행은 이 보관 경로로만 산다.
    func test_handleLaunch_실행기가_없으면_task_를_붙들어_둔다() async {
        let task = LaunchTaskDouble()
        await MainActor.run { BackgroundSyncTask.overrideRunnerForTesting(nil) }

        DispatchQueue.global(qos: .background).async {
            BackgroundSyncTask.handleLaunch(task)
        }

        // 인계는 메인 액터로 건너뛰는 한 번의 hop 뒤에 끝난다 — 그 hop 을 기다린다.
        var held = false
        for _ in 0..<200 {
            let now = await MainActor.run { BackgroundSyncTask.pendingTaskForTesting === task }
            if now {
                held = true
                break
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertTrue(held, "실행기가 없는 동안 깨어난 task 를 버렸다 — 그 회차가 통째로 사라진다")
        await MainActor.run { BackgroundSyncTask.clearRunnerOverrideForTesting() }
    }
}

/// 런치 핸들러가 받는 task 의 더블.
///
/// 진짜 `BGAppRefreshTask` 는 **시스템만 만든다**(헤더에서 `init` 이 `NS_UNAVAILABLE`) —
/// 그래서 핸들러가 실제로 쓰는 두 멤버만 `BackgroundRefreshTaskHandle` 로 잘라내 두었다.
///
/// `@unchecked Sendable`: 테스트가 만든 뒤 백그라운드 큐로 한 번 넘기고, 그 뒤로는 메인
/// 액터에서만 읽는다. 두 쪽이 동시에 만지지 않도록 expectation 이 순서를 잡는다.
private final class LaunchTaskDouble: BackgroundRefreshTaskHandle, @unchecked Sendable {
    var expirationHandler: (() -> Void)?
    private(set) var completedSuccess: Bool?

    func setTaskCompleted(success: Bool) {
        completedSuccess = success
    }
}
#endif
