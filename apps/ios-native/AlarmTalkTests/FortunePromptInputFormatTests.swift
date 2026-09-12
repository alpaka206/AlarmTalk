import XCTest
@testable import AlarmTalk

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

// MARK: - 시진 구간 (세 구현이 갈라져 있던 자리)

extension FortunePromptInputFormatTests {

    /// ⚠ 예전 iOS 는 대략 시간대 4종(새벽/오전/오후/저녁)이었다. 사주는 두 시간짜리
    /// 시진 단위라, 같은 사람이 두 기기에서 **다른 사주**를 갖게 된다.
    /// 값의 단일 출처는 `packages/shared/src/schemas/fortune.ts`,
    /// 안드로이드는 `ui/editor/AlarmFortuneSettings.kt` 의 `FortuneBirthTimeChoices`.
    func test_timeChoices_matchSharedContract() {
        let expected = [
            "시간 모름",
            "00:00~01:30", "01:31~03:30", "03:31~05:30", "05:31~07:30",
            "07:31~09:30", "09:31~11:30", "11:31~13:30", "13:31~15:30",
            "15:31~17:30", "17:31~19:30", "19:31~21:30", "21:31~23:30",
            "23:31~24:00",
        ]
        XCTAssertEqual(FortunePromptInputFormat.timeChoices.map(\.value), expected)
    }

    /// 라벨을 번역하면 저장값이 기기 언어를 타서 사주가 갈린다.
    func test_timeChoiceLabels_equalStoredValues() {
        for choice in FortunePromptInputFormat.timeChoices {
            XCTAssertEqual(choice.label, choice.value, "\(choice.value) 의 라벨이 저장값과 다르다")
        }
    }

    /// ⚠ 서버가 받는 것과 **정확히 같아야** 한다. 여기가 더 빡빡하면 저장 버튼이 안 켜지고,
    /// 더 느슨하면 서버가 400 을 내며 같은 payload 의 날씨 지역까지 날아간다.
    func test_isValidBirthTime_acceptsEveryChoice() {
        for choice in FortunePromptInputFormat.timeChoices {
            XCTAssertTrue(
                FortunePromptInputFormat.isValidBirthTime(choice.value),
                "\(choice.value) 을 거절한다"
            )
        }
    }

    /// 옛 값(단일 시각)도 계속 받아야 한다 — 기존 사용자가 저장을 못 하게 되면 안 된다.
    func test_isValidBirthTime_stillAcceptsSingleTime() {
        XCTAssertTrue(FortunePromptInputFormat.isValidBirthTime("07:30"))
    }

    func test_isValidBirthTime_rejectsNonsense() {
        XCTAssertFalse(FortunePromptInputFormat.isValidBirthTime("25:00"))
        XCTAssertFalse(FortunePromptInputFormat.isValidBirthTime("아무거나"))
        XCTAssertFalse(FortunePromptInputFormat.isValidBirthTime("07:30~99:99"))
    }

    /// 구간 문자열이 normalize 를 거쳐도 원형 그대로여야 한다
    /// (숫자만 뽑아 `HH:MM` 으로 재조립하는 갈래에 걸리면 값이 망가진다).
    func test_normalizedBirthTime_leavesRangesIntact() {
        for choice in FortunePromptInputFormat.timeChoices.dropFirst() {
            XCTAssertEqual(FortunePromptInputFormat.normalizedBirthTime(choice.value), choice.value)
        }
    }
}
