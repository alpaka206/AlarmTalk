import XCTest
@testable import AlarmTalk

/// **울림 alert 제목** — 시각과 알람 이름만.
///
/// ⚠ 읽어 줄 문장(`voiceText`)을 넣지 말 것. 한 줄뿐이라 문장이 들어오면 시각이 밀리고
/// 시스템이 임의로 자른다. 문구는 Live Activity 몫이다.
final class AlertTitleTests: XCTestCase {

    private func record(label: String, voiceText: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var r = LocalAlarmRecord(
            id: "a", label: label, hour: 7, minute: 30,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        r.voiceText = voiceText
        return r
    }

    func test_읽어줄_문장이_있어도_제목에_넣지_않는다() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "아침", voiceText: "일어날 시간이에요"))

        XCTAssertEqual(title, "오전 7:30 · 아침", "알럿 제목은 어느 알람인지만 말한다")
    }

    func test_문장이_없으면_라벨을_쓴다() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "아침", voiceText: nil))

        XCTAssertEqual(title, "오전 7:30 · 아침")
    }

    func test_둘_다_없으면_시각만() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "", voiceText: "   "))

        XCTAssertEqual(title, "오전 7:30")
    }

}
