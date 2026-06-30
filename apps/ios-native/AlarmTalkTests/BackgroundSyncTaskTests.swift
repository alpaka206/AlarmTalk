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
@MainActor
final class BackgroundSyncTaskTests: XCTestCase {

    func test_taskIdentifier_matchesInfoPlistPermittedIdentifier() {
        // Info.plist 에 등록된 식별자와 일치해야만 BGTaskScheduler 에서 register 가 동작.
        XCTAssertEqual(
            BackgroundSyncTask.taskIdentifier,
            "com.voicealarm.nativeapp.ios.refresh"
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
