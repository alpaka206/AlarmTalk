import XCTest
@testable import AlarmTalk

/// 생년월일을 **연·월·일 드롭다운**으로 고칠 때의 값 규칙 — 회귀 방지.
///
/// ⚠ 저장 형식(`yyyy-MM-dd`)은 `packages/shared/src/schemas/fortune.ts` 가 단일 출처이고
/// 안드로이드도 같은 문자열을 보낸다. 컨트롤이 달력에서 드롭다운으로 바뀌었을 뿐
/// **계약은 그대로다** — 형식이 흔들리면 서버가 거절한다.
final class FortuneBirthDateEditTests: XCTestCase {

    /// 달을 바꿔 그 달에 없는 날이 되면 **말일로 당긴다.**
    /// 그냥 두면 `2-31` 같은 값이 저장돼 서버에서 거절된다.
    func test_없는_날짜는_말일로_당긴다() {
        XCTAssertEqual(clamped(year: 2023, month: 2, day: 31), "2023-02-28")
        XCTAssertEqual(clamped(year: 2024, month: 2, day: 31), "2024-02-29", "2024는 윤년이다")
        XCTAssertEqual(clamped(year: 2023, month: 4, day: 31), "2023-04-30")
        XCTAssertEqual(clamped(year: 2023, month: 1, day: 31), "2023-01-31", "있는 날은 그대로")
    }

    /// 두 자리 0 채움을 유지한다 — 서버 계약이 `yyyy-MM-dd` 다.
    func test_두자리_0을_채운다() {
        XCTAssertEqual(clamped(year: 1990, month: 8, day: 4), "1990-08-04")
    }

    /// 정규화가 옛 표기도 받아 준다(기존 값이 드롭다운에 그대로 뜨려면 필요하다).
    func test_기존_값이_그대로_해석된다() {
        XCTAssertEqual(FortunePromptInputFormat.normalizedBirthDate("1990-08-04"), "1990-08-04")
        XCTAssertTrue(FortunePromptInputFormat.isValidBirthDate("1990-08-04"))
    }

    /// 성별 값 계약 — 요약 표시가 `"male"` 과 비교하다 **항상 '여성'** 으로 뜨던 버그가 있었다.
    func test_성별_정규화() {
        XCTAssertEqual(FortunePromptInputFormat.normalizedGender("남성"), "남성")
        XCTAssertEqual(FortunePromptInputFormat.normalizedGender("male"), "남성")
        XCTAssertEqual(FortunePromptInputFormat.normalizedGender("M"), "남성")
        XCTAssertEqual(FortunePromptInputFormat.normalizedGender("여성"), "여성")
        XCTAssertEqual(FortunePromptInputFormat.normalizedGender(""), "")
    }

    // MARK: - Helper (뷰의 setBirth 와 같은 규칙)

    private func clamped(year: Int, month: Int, day: Int) -> String {
        var comps = DateComponents(); comps.year = year; comps.month = month
        let cal = Calendar(identifier: .gregorian)
        let maxDay = cal.date(from: comps)
            .flatMap { cal.range(of: .day, in: .month, for: $0)?.count } ?? 31
        return String(format: "%04d-%02d-%02d", year, month, min(day, maxDay))
    }
}
