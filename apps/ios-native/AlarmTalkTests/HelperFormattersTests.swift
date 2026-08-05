import XCTest
@testable import AlarmTalk

final class HelperFormattersTests: XCTestCase {

    func test_quietScheduleLabel_smartDayGroupingAndTimeFormat() {
        // 평일 + 시각 앞자리 0 제거. Android quietScheduleLabel/quietDaysLabel 동등.
        XCTAssertEqual(
            HelperFormatters.quietScheduleLabel([
                FamilyAlarmQuietWindow(days: [1, 2, 3, 4, 5], start: "07:00", end: "18:30")
            ]),
            "평일 7:00 ~ 18:30"
        )
        // 주말 / 매일 그룹핑.
        XCTAssertEqual(
            HelperFormatters.quietScheduleLabel([FamilyAlarmQuietWindow(days: [0, 6], start: "22:00", end: "07:00")]),
            "주말 22:00 ~ 7:00"
        )
        XCTAssertEqual(
            HelperFormatters.quietScheduleLabel([
                FamilyAlarmQuietWindow(days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "06:00")
            ]),
            "매일 0:00 ~ 6:00"
        )
    }

    func test_quietScheduleLabel_overflowAndEmpty() {
        XCTAssertEqual(HelperFormatters.quietScheduleLabel([]), "없음")
        XCTAssertEqual(HelperFormatters.quietScheduleLabel(nil), "없음")
        let windows = [
            FamilyAlarmQuietWindow(days: [1, 2, 3, 4, 5], start: "07:00", end: "09:00"),
            FamilyAlarmQuietWindow(days: [0, 6], start: "10:00", end: "11:00"),
            FamilyAlarmQuietWindow(days: [3], start: "12:00", end: "13:00"),
        ]
        XCTAssertEqual(
            HelperFormatters.quietScheduleLabel(windows),
            "평일 7:00 ~ 9:00 · 주말 10:00 ~ 11:00 외 1개"
        )
    }
}
