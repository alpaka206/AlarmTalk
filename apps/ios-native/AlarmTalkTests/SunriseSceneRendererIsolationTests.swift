import SwiftUI
import XCTest
@testable import AlarmTalk

/// **랜딩 일출 씬의 그림은 메인 액터에 묶이지 않는다** — 그 사실을 컴파일로 고정한다.
///
/// 무엇을 놓쳤었나(2026-10-14, 1.2.13 iPad · iOS 27, Sentry ALARMTALK-IOS-4): `SunriseScene.body` 의
/// `TimelineView(.animation)`·`Canvas` 클로저가 표기 없이 메인 액터를 물려받았고, iOS 27 의 SwiftUI 가
/// 그 타임라인을 그리기 전용 스레드(`ViewGraphDisplayLink.asyncThread`)에서 갱신하자 Swift 6 이 심은
/// 격리 검사가 `dispatch_assert_queue` 로 앱을 죽였다.
///
/// `GraphicsContext` 는 공개 생성자가 없어 여기서 실제로 그려 볼 수는 없다. 대신 그리는 함수를
/// `@Sendable` 함수 값으로 받는다 — `SunriseSceneRenderer` 가 다시 `View` 안으로 들어가거나 메인
/// 액터 격리가 붙으면 이 파일이 **컴파일부터** 막힌다. 클로저 쪽 `@Sendable` 은 CI lint
/// (`scripts/check-bgtask-handler-isolation.py`)가 본다.
///
/// ⚠ **이 클래스에 `@MainActor` 를 붙이지 말 것** — 붙이면 격리된 함수도 받아져 아무것도 지키지 못한다.
final class SunriseSceneRendererIsolationTests: XCTestCase {

    func test_그리는_함수는_메인_밖에서_부를_수_있다() {
        let draw: @Sendable (inout GraphicsContext, CGSize, Double) -> Void = SunriseSceneRenderer.draw(in:size:phase:)
        let offMain = expectation(description: "메인이 아닌 큐에서 함수 값을 넘겨받는다")
        DispatchQueue.global(qos: .userInitiated).async {
            XCTAssertFalse(Thread.isMainThread)
            _ = draw
            offMain.fulfill()
        }
        wait(for: [offMain], timeout: 20)
    }
}
