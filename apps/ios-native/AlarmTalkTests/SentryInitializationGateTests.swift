import XCTest
@testable import AlarmTalk

/// **유닛 테스트가 Sentry 로 쏘지 않는다** 를 고정한다 — 안드로이드
/// `SentryInitializationGateTest` 의 짝이고 축도 같다(테스트면 꺼짐 / 실기기 모양이면 켜짐 /
/// DSN 없으면 꺼짐).
///
/// iOS 는 막는 겹이 **하나뿐**이라 이 게이트가 전부다. 안드로이드는 Robolectric 이 세우는
/// Application 자체를 `robolectric.properties` 로 바꿔치기하는 1차 방어선이 따로 있지만,
/// `AlarmTalkTests` 는 TEST_HOST 를 잡는 `bundle.unit-test` 라 **테스트 실행마다 진짜 호스트
/// 앱이 launch** 하고 그 첫 훅(`PushAppDelegate.application(_:didFinishLaunchingWithOptions:)`)이
/// `AlarmTalkLog.startCrashReporting()` 을 부른다 — 바꿔칠 수 있는 자리가 없다.
/// 그리고 이 맥의 `Local.xcconfig` 에는 **진짜 DSN** 이 들어 있다.
final class SentryInitializationGateTests: XCTestCase {

    /// 게이트가 무엇을 보고 판단하는지. 이 값이 거짓이 되면(= XCTest 신호가 바뀌면)
    /// 아래 단언들은 통과해도 **실제로는 게이트가 조용히 열린다.**
    /// `TestIsolationTests.test_유닛테스트로_인식된다` 와 같은 자리를 지킨다.
    func test_테스트_프로세스로_인식된다() {
        XCTAssertTrue(
            AlarmTalkLog.isRunningUnderXCTest,
            "XCTest 안인데 테스트 판정이 거짓이다 — 유닛 테스트가 만든 실패가 전부 이슈로 올라간다"
        )
    }

    func test_진짜_DSN이_있어도_테스트에서는_켜지_않는다() {
        // 로컬 빌드는 늘 DSN 이 채워진 상태다(`Local.xcconfig`).
        XCTAssertFalse(AlarmTalkLog.shouldStartCrashReporting(dsn: Self.realLookingDSN, isRunningTests: true))
    }

    /// ⚠ **실기기에서 올라오는 것은 무엇이든 그대로 올라가야 한다.** 게이트를 예외 이름이나
    /// 메시지 기준으로 넓히면 이 줄이 무너지고, 진짜 사고가 나도 우리에게 오는 신호가 없다.
    func test_실기기_모양에서는_켠다() {
        XCTAssertTrue(AlarmTalkLog.shouldStartCrashReporting(dsn: Self.realLookingDSN, isRunningTests: false))
    }

    func test_DSN이_없으면_끈다() {
        XCTAssertFalse(AlarmTalkLog.shouldStartCrashReporting(dsn: "", isRunningTests: false))
        // 빌드 설정이 비면 `$(VOICE_ALARM_SENTRY_DSN)` 가 공백만 남기도 한다 — 그것도 '없음' 이다.
        XCTAssertFalse(AlarmTalkLog.shouldStartCrashReporting(dsn: "   \n", isRunningTests: false))
    }

    /// 값은 쓰이지 않는다 — 형태만 실제와 같게 둔다(이 테스트는 SDK 를 켜지 않는다).
    private static let realLookingDSN = "https://0123456789abcdef@o0.ingest.sentry.io/1234567"
}
