import XCTest
@testable import AlarmTalk

/// **울림 alert 제목** — AlarmKit 은 본문 텍스트 필드를 주지 않으므로 제목 하나가
/// 안드로이드 울림 화면의 시계 + 문구 카드 몫을 함께 한다(2026-09-09 지시).
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

    func test_읽어줄_문장이_있으면_제목에_들어간다() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "아침", voiceText: "일어날 시간이에요"))

        XCTAssertTrue(title.contains("일어날 시간이에요"), "문구가 안 보이면 알럿이 시각만 말한다")
        XCTAssertTrue(title.hasPrefix("오전 7:30"), "시각이 먼저 읽혀야 한다")
    }

    func test_문장이_없으면_라벨을_쓴다() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "아침", voiceText: nil))

        XCTAssertEqual(title, "오전 7:30 · 아침")
    }

    func test_둘_다_없으면_시각만() {
        let title = AlarmKitViewModel.alertTitle(for: record(label: "", voiceText: "   "))

        XCTAssertEqual(title, "오전 7:30")
    }

    /// ⚠ 긴 문장을 그대로 넣으면 시스템이 임의로 자르고 시각까지 밀려난다.
    func test_긴_문장은_잘린다() {
        let long = String(repeating: "가", count: 200)

        let title = AlarmKitViewModel.alertTitle(for: record(label: "아침", voiceText: long))

        XCTAssertTrue(title.hasSuffix("…"))
        XCTAssertLessThan(title.count, 60)
    }

    /// 자를 때 자소를 가르지 않는다 — 이모지가 반쪽으로 남으면 안 된다.
    func test_이모지를_가르지_않는다() {
        let text = String(repeating: "👍", count: 100)

        let shortened = AlarmKitViewModel.shortened(text, limit: 10)

        XCTAssertEqual(shortened, String(repeating: "👍", count: 10) + "…")
    }
}
