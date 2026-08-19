import XCTest
@testable import AlarmTalk

@MainActor
final class RemoteAlarmSyncViewModelTests: XCTestCase {
    func test_userFacingErrorMessage_hidesEnglishServerMessageLikeAndroid() {
        let error = APIError.server(status: 500, message: "Internal Server Error", errorCode: nil)

        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "알람 정보를 불러오지 못했어요"),
            "알람 정보를 불러오지 못했어요"
        )
    }

    func test_userFacingErrorMessage_keepsKoreanServerMessageLikeAndroid() {
        let error = APIError.server(status: 400, message: "이미 삭제된 알람이에요", errorCode: nil)

        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "알람 삭제에 실패했어요"),
            "이미 삭제된 알람이에요"
        )
    }
}
