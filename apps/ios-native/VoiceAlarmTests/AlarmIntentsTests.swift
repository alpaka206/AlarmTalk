import XCTest
@testable import VoiceAlarm

@MainActor
final class AlarmIntentsTests: XCTestCase {

    // MARK: - StopAlarmIntent

    func test_stopIntent_defaultInit_emptyAlarmID() {
        let intent = StopAlarmIntent()
        XCTAssertEqual(intent.alarmID, "")
    }

    func test_stopIntent_parameterInit_preservesAlarmID() {
        let uuid = UUID().uuidString
        let intent = StopAlarmIntent(alarmID: uuid)
        XCTAssertEqual(intent.alarmID, uuid)
    }

    func test_stopIntent_perform_invalidUUID_returnsResult() async throws {
        // 빈 ID 또는 비-UUID 문자열은 early-return 으로 graceful no-op.
        let intent = StopAlarmIntent(alarmID: "not-a-uuid")
        _ = try await intent.perform()
        // perform 이 throw 하지 않으면 OK. AlarmKit stop 은 호출되지 않는다.
    }

    func test_stopIntent_perform_validUUID_noContext_isNoOp() async throws {
        // AlarmAppContext.shared 가 nil 이면 store 변형 없이 AlarmKit stop 만
        // 시도. 시뮬레이터에서 AlarmKit 이 없거나 unknown id 면 catch.
        AlarmAppContext.shared = nil
        let intent = StopAlarmIntent(alarmID: UUID().uuidString)
        _ = try await intent.perform()
    }

    // MARK: - SnoozeAlarmIntent

    func test_snoozeIntent_defaultInit_zeroMinutes() {
        let intent = SnoozeAlarmIntent()
        XCTAssertEqual(intent.alarmID, "")
        XCTAssertEqual(intent.snoozeMinutes, 0)
    }

    func test_snoozeIntent_parameterInit_preservesValues() {
        let uuid = UUID().uuidString
        let intent = SnoozeAlarmIntent(alarmID: uuid, snoozeMinutes: 9)
        XCTAssertEqual(intent.alarmID, uuid)
        XCTAssertEqual(intent.snoozeMinutes, 9)
    }

    func test_snoozeIntent_perform_invalidUUID_returnsResult() async throws {
        let intent = SnoozeAlarmIntent(alarmID: "", snoozeMinutes: 5)
        _ = try await intent.perform()
    }
}
