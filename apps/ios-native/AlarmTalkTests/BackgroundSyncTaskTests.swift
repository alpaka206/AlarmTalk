import XCTest
@testable import AlarmTalk

/// `BackgroundSyncTask` 의 정적 식별자/예약 호출 동작을 검증한다.
///
/// 실제 BGTaskScheduler 동작은 simulator/Test host 에서 권한이 없거나
/// submit 이 정적으로 noop 일 수 있으므로 본 테스트는 다음만 보장한다.
///   1. taskIdentifier 가 Info.plist BGTaskSchedulerPermittedIdentifiers 와 매칭.
///   2. refreshInterval 이 Android 의 15 분 주기와 동일.
///   3. scheduleNext() 가 throw 없이 호출 가능 (시스템 호출 실패를 swallow).
///   4. cancelAll() 이 throw 없이 호출 가능.
///
/// ⚠ **런치 핸들러의 격리는 여기서 못 잡는다.** 이 클래스는 통째로 `@MainActor` 라,
/// 메인 액터에서 부르면 격리 검사가 그냥 통과한다 — 실제 배달은 백그라운드 큐에서 온다.
/// 그 축은 `BackgroundSyncTaskLaunchHandlerTests`(비격리 클래스)가 맡는다. 이 파일에
/// 옮겨 담지 말 것.
@MainActor
final class BackgroundSyncTaskTests: XCTestCase {

    func testConcurrentExpirationAndCompletionFinishOnlyOnce() {
        let handle = CompletionTestHandle()
        let completion = BackgroundTaskCompletion(handle)
        DispatchQueue.concurrentPerform(iterations: 50) { _ in completion.finish(success: false) }
        completion.finish(success: true)
        XCTAssertEqual(handle.results, [false])
    }

    func testOptionalUploadTimeoutPreservesCompletedAlarmSync() {
        let handle = CompletionTestHandle()
        let completion = BackgroundTaskCompletion(handle)
        completion.recordEssentialResult(success: true)
        completion.finish()
        completion.finish(success: false)
        XCTAssertEqual(handle.results, [true])
    }

    func test_taskIdentifier_matchesInfoPlistPermittedIdentifier() {
        // Info.plist 에 등록된 식별자와 일치해야만 BGTaskScheduler 에서 register 가 동작.
        XCTAssertEqual(
            BackgroundSyncTask.taskIdentifier,
            "com.alarmtalk.app.refresh"
        )
    }

    func test_refreshInterval_isFifteenMinutes() {
        XCTAssertEqual(BackgroundSyncTask.refreshInterval, 15 * 60)
    }

    func test_scheduleNext_doesNotThrow() {
        // 시뮬레이터에선 submit 이 실패하지만 swallow 되어야 한다.
        XCTAssertNoThrow(BackgroundSyncTask.scheduleNext())
    }

    func test_cancelAll_doesNotThrow() {
        XCTAssertNoThrow(BackgroundSyncTask.cancelAll())
    }
}

private final class CompletionTestHandle: BackgroundRefreshTaskHandle {
    var expirationHandler: (() -> Void)?
    var results: [Bool] = []
    func setTaskCompleted(success: Bool) { results.append(success) }
}
