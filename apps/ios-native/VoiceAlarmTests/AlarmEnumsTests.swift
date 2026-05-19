import XCTest
@testable import VoiceAlarm

final class AlarmEnumsTests: XCTestCase {

    func test_repeatDayMaskBits() {
        XCTAssertEqual(RepeatDay.sunday.mask, 1 << 0)
        XCTAssertEqual(RepeatDay.monday.mask, 1 << 1)
        XCTAssertEqual(RepeatDay.tuesday.mask, 1 << 2)
        XCTAssertEqual(RepeatDay.wednesday.mask, 1 << 3)
        XCTAssertEqual(RepeatDay.thursday.mask, 1 << 4)
        XCTAssertEqual(RepeatDay.friday.mask, 1 << 5)
        XCTAssertEqual(RepeatDay.saturday.mask, 1 << 6)
    }

    func test_repeatDayCalendarWeekdayMapping() {
        // Calendar.weekday: 1=Sun..7=Sat
        XCTAssertEqual(RepeatDay.fromCalendarWeekday(1), .sunday)
        XCTAssertEqual(RepeatDay.fromCalendarWeekday(2), .monday)
        XCTAssertEqual(RepeatDay.fromCalendarWeekday(7), .saturday)
        XCTAssertNil(RepeatDay.fromCalendarWeekday(0))
        XCTAssertNil(RepeatDay.fromCalendarWeekday(8))

        // Locale.Weekday 와의 1..7 동등.
        XCTAssertEqual(RepeatDay.sunday.localeWeekdayInt, 1)
        XCTAssertEqual(RepeatDay.saturday.localeWeekdayInt, 7)
    }

    func test_repeatDaysExtension() {
        let mask = RepeatDay.monday.mask | RepeatDay.wednesday.mask | RepeatDay.friday.mask
        XCTAssertEqual(mask.repeatDays, [.monday, .wednesday, .friday])
        XCTAssertTrue(mask.hasRepeatDay(.monday))
        XCTAssertFalse(mask.hasRepeatDay(.sunday))

        // 배열 → mask 환원.
        let days: [RepeatDay] = [.monday, .wednesday, .friday]
        XCTAssertEqual(days.mask, mask)
    }

    func test_allCasesOrderIsSundayFirst() {
        XCTAssertEqual(RepeatDay.allCases, [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday])
    }

    func test_playModeDecode_legacyAlarmVoice() {
        XCTAssertEqual(AlarmPlayMode.decode("alarm_only"), .alarmOnly)
        XCTAssertEqual(AlarmPlayMode.decode("voice_only"), .voiceOnly)
        XCTAssertEqual(AlarmPlayMode.decode("sound_then_voice"), .soundThenVoice)
        // Android raw "alarm_voice" 도 sound_then_voice 로 매핑.
        XCTAssertEqual(AlarmPlayMode.decode("alarm_voice"), .soundThenVoice)
        // 알 수 없는 값은 alarmOnly 폴백.
        XCTAssertEqual(AlarmPlayMode.decode("garbage"), .alarmOnly)
    }

    func test_snoozeRepeatLimitValidValues() {
        XCTAssertTrue(SnoozeRepeatLimit.isValid(0))
        XCTAssertTrue(SnoozeRepeatLimit.isValid(1))
        XCTAssertTrue(SnoozeRepeatLimit.isValid(3))
        XCTAssertTrue(SnoozeRepeatLimit.isValid(5))
        XCTAssertFalse(SnoozeRepeatLimit.isValid(2))
        XCTAssertFalse(SnoozeRepeatLimit.isValid(99))
    }

    func test_vibrationPatternAllCases_matchesAndroidCount() {
        // Android `AlarmEntity.kt:70-98` 의 12종 (default 포함).
        XCTAssertEqual(VibrationPattern.allCases.count, 12)
        XCTAssertTrue(VibrationPattern.allCases.contains(.default))
        XCTAssertTrue(VibrationPattern.allCases.contains(.none))
        XCTAssertTrue(VibrationPattern.allCases.contains(.offBeat))
        // raw value 동등.
        XCTAssertEqual(VibrationPattern.offBeat.rawValue, "off_beat")
    }

    func test_runtimeStateScheduledMapsToArmed() {
        XCTAssertEqual(AlarmRuntimeState.decode("scheduled"), .armed)
        XCTAssertEqual(AlarmRuntimeState.decode("ringing"), .ringing)
        XCTAssertEqual(AlarmRuntimeState.decode("snoozed"), .snoozed)
        XCTAssertEqual(AlarmRuntimeState.decode("unknown"), .idle)
    }
}
