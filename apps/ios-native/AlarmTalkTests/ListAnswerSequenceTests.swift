import XCTest
@testable import AlarmTalk

/// 목소리 목록 갱신은 겹쳐 돈다(`force`) — **먼저 떠난 갱신의 늦은 답이 새 목록을 덮지 않는다**(`ListAnswerSequence`).
/// 예전에는 이름 바꾸기·삭제 뒤의 강제 갱신보다 앞서 떠난 진입 갱신이 늦게 오면 옛 이름·지운 목소리가 돌아왔다.
final class ListAnswerSequenceTests: XCTestCase {
    func test_나중에_떠난_답이_실린_뒤에는_앞서_떠난_답을_버린다() {
        var answers = ListAnswerSequence()
        let entry = answers.begin()
        let forced = answers.begin()
        XCTAssertTrue(answers.accept(forced))
        XCTAssertFalse(answers.accept(entry), "앞서 떠난 진입 갱신의 답(옛 목록)이 새 목록을 덮으면 안 된다")
    }

    func test_나중_답이_실패해_안_실렸으면_앞서_떠난_답은_실린다() {
        var answers = ListAnswerSequence()
        let entry = answers.begin()
        _ = answers.begin() // 강제 갱신 — 실패해 답이 없다
        XCTAssertTrue(answers.accept(entry))
    }

    func test_서버가_확인한_변경을_적은_뒤에는_그_전에_떠난_답을_버리고_그_뒤에_떠난_답은_싣는다() {
        var answers = ListAnswerSequence()
        let before = answers.begin()
        answers.supersedeInFlight() // 이름 바꾸기 성공 — 목록에 직접 적었다
        let after = answers.begin()
        XCTAssertFalse(answers.accept(before), "바꾸기 전 목록이 바꾼 이름을 되돌리면 안 된다")
        XCTAssertTrue(answers.accept(after))
    }
}
