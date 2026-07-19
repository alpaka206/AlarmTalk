import XCTest
@testable import AlarmTalk

@MainActor
final class SocialFeatureViewModelTests: XCTestCase {
    func test_receivedAlarmNotificationRequestMatchesAndroidCopy() {
        let request = SocialNotificationTracker.receivedAlarmRequest(
            alarmID: "alarm-1",
            title: "김규원님이 보낸 알람",
            time: "07:30"
        )

        XCTAssertEqual(request.noteID, "alarm-1")
        XCTAssertEqual(request.title, "김규원님이 보낸 알람")
        XCTAssertEqual(request.body, "07:30에 울려요")
    }
}
