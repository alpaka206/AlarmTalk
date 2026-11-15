import XCTest
@testable import AlarmTalk

/// **광고성 정보 수신 스위치는 서버가 가진 값으로 끝난다**(`docs/spec/consent.md` 「광고성 정보 수신 토글」).
///
/// 2026-10-29 두 앱 비교: 예전 iOS 는 쓰는 동안 스위치를 잠갔고, 안드로이드는 열어 두고 마지막 값을 이어 보냈다. iOS 도 열어 두고
/// 같은 판정(`MarketingConsentNext.after`)으로 잇는다 — 안드로이드 `MarketingConsentWritesTest` 와 같은 갈래를 본다.
final class MarketingConsentWritesTests: XCTestCase {

    /// 뷰모델의 순서 그대로 — 끝날 때마다 판정하고, `.send` 면 그 값으로 다음 쓰기를 보낸다.
    private func run(initial: Bool, first: Bool, queuedDuringFirst: Bool?, outcomes: [Bool]) -> (shown: Bool?, failed: Bool) {
        var sent = first
        var rollbackTo: Bool? = initial
        var queued = queuedDuringFirst
        for succeeded in outcomes {
            switch MarketingConsentNext.after(sent: sent, rollbackTo: rollbackTo, succeeded: succeeded, queued: queued) {
            case let .settle(shown, failed):
                return (shown, failed)
            case let .send(agreed, serverValue):
                sent = agreed
                rollbackTo = serverValue
                queued = nil
            }
        }
        XCTFail("쓰기 결과가 모자라다 — 판정이 아직 이어 보내는 중이다")
        return (nil, false)
    }

    func test_켬이_저장된_뒤_이어_보낸_끔이_실패하면_스위치는_켬으로_돌아간다() {
        let settled = run(initial: false, first: true, queuedDuringFirst: false, outcomes: [true, false])
        XCTAssertEqual(settled.shown, true, "서버는 켬이다 — 스위치도 켬이어야 한다")
        XCTAssertTrue(settled.failed, "스위치가 되돌아간 이유를 알린다")
    }

    func test_이어_보낸_쓰기가_성공하면_마지막에_누른_값이다() {
        let settled = run(initial: false, first: true, queuedDuringFirst: false, outcomes: [true, true])
        XCTAssertEqual(settled.shown, false)
        XCTAssertFalse(settled.failed)
    }

    func test_이어_보낼_때_되돌릴_값은_방금_저장된_값이다() {
        XCTAssertEqual(
            MarketingConsentNext.after(sent: true, rollbackTo: false, succeeded: true, queued: false),
            .send(agreed: false, rollbackTo: true)
        )
    }

    func test_첫_쓰기가_실패했고_마지막_값이_서버_값과_같으면_보내지도_알리지도_않는다() {
        XCTAssertEqual(
            MarketingConsentNext.after(sent: true, rollbackTo: false, succeeded: false, queued: false),
            .settle(shown: false, failed: false)
        )
    }

    func test_혼자_보낸_쓰기는_성공하면_그_값_실패하면_보내기_전_값이다() {
        XCTAssertEqual(MarketingConsentNext.after(sent: true, rollbackTo: false, succeeded: true, queued: nil), .settle(shown: true, failed: false))
        XCTAssertEqual(MarketingConsentNext.after(sent: true, rollbackTo: false, succeeded: false, queued: nil), .settle(shown: false, failed: true))
    }
}
