import XCTest
@testable import VoiceAlarm

final class FortunePromptInputFormatTests: XCTestCase {

    func test_normalizedBirthDate_acceptsEightDigits() {
        XCTAssertEqual(
            FortunePromptInputFormat.normalizedBirthDate("19900102"),
            "1990-01-02"
        )
    }

    func test_normalizedBirthTime_acceptsCompactTimeAndUnknown() {
        XCTAssertEqual(FortunePromptInputFormat.normalizedBirthTime("930"), "09:30")
        XCTAssertEqual(FortunePromptInputFormat.normalizedBirthTime("모름"), "시간 모름")
    }

    func test_isComplete_acceptsUnknownBirthTime() {
        XCTAssertTrue(
            FortunePromptInputFormat.isComplete(
                gender: "여성",
                birthDate: "1990-01-02",
                birthTime: "시간 모름"
            )
        )
    }

    func test_isValidBirthDate_rejectsImpossibleDate() {
        XCTAssertFalse(FortunePromptInputFormat.isValidBirthDate("1990-02-30"))
    }
}
