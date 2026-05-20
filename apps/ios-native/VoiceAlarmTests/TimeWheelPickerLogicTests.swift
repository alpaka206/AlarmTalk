import XCTest
@testable import VoiceAlarm

/// TimeWheelPicker 의 변환 로직만 격리해 검증.
///
/// 실제 SwiftUI gesture / state 동작은 UI 테스트 영역이라 본 파일은 다루지
/// 않고, 12h ↔ 24h 변환만 검증한다.
final class TimeWheelPickerLogicTests: XCTestCase {

    // MARK: - 24h -> 12h display

    func test_24hToDisplay_midnightShowsAs12() {
        XCTAssertEqual(TimeWheelMath.hour24To12(0), 12)
    }

    func test_24hToDisplay_noonShowsAs12() {
        XCTAssertEqual(TimeWheelMath.hour24To12(12), 12)
    }

    func test_24hToDisplay_morningHoursUnchanged() {
        XCTAssertEqual(TimeWheelMath.hour24To12(1), 1)
        XCTAssertEqual(TimeWheelMath.hour24To12(7), 7)
        XCTAssertEqual(TimeWheelMath.hour24To12(11), 11)
    }

    func test_24hToDisplay_afternoonWrapsAfter12() {
        XCTAssertEqual(TimeWheelMath.hour24To12(13), 1)
        XCTAssertEqual(TimeWheelMath.hour24To12(18), 6)
        XCTAssertEqual(TimeWheelMath.hour24To12(23), 11)
    }

    func test_24hToDisplay_invalidInputsAreWrappedSafely() {
        // 입력이 24를 넘거나 음수여도 % 연산이 safe 해야 한다.
        XCTAssertEqual(TimeWheelMath.hour24To12(24), 12)
        XCTAssertEqual(TimeWheelMath.hour24To12(25), 1)
        XCTAssertEqual(TimeWheelMath.hour24To12(-1), 11)
    }

    // MARK: - combine(display, isPM) -> 24h

    func test_combine_amHoursMapDirectly() {
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 1, isPM: false), 1)
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 7, isPM: false), 7)
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 11, isPM: false), 11)
    }

    func test_combine_12AmIsMidnight() {
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 12, isPM: false), 0)
    }

    func test_combine_12PmIsNoon() {
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 12, isPM: true), 12)
    }

    func test_combine_pmHoursAddTwelve() {
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 1, isPM: true), 13)
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 6, isPM: true), 18)
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 11, isPM: true), 23)
    }

    func test_combine_outOfRangeDisplayIsClamped() {
        // 휠 wrap 이 실수로 0 이나 13 을 흘려보내도 안전한 값으로 클램프되어야 한다.
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 0, isPM: false), 1)
        XCTAssertEqual(TimeWheelMath.combine(displayHour: 13, isPM: true), 0)
    }

    // MARK: - Round trip

    func test_roundTripAllHours() {
        for h in 0..<24 {
            let display = TimeWheelMath.hour24To12(h)
            let isPM = h >= 12
            let restored = TimeWheelMath.combine(displayHour: display, isPM: isPM)
            XCTAssertEqual(restored, h, "round-trip failed for h=\(h) (display=\(display), isPM=\(isPM))")
        }
    }

    // MARK: - AM/PM toggle behaviour

    func test_amPmToggleAdds12() {
        // 7 AM -> 7 PM = 19
        let am: Int = 7
        let toPM = TimeWheelMath.combine(displayHour: TimeWheelMath.hour24To12(am), isPM: true)
        XCTAssertEqual(toPM, 19)
    }

    func test_amPmToggleSubtracts12() {
        // 18 (6 PM) -> 6 AM = 6
        let pm: Int = 18
        let toAM = TimeWheelMath.combine(displayHour: TimeWheelMath.hour24To12(pm), isPM: false)
        XCTAssertEqual(toAM, 6)
    }
}
