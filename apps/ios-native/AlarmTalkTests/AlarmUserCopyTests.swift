import XCTest
@testable import AlarmTalk

final class AlarmUserCopyTests: XCTestCase {

    func test_authorizationDisplayLabel_mapsSystemStatesToKorean() {
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("authorized"), "허용됨")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("notAuthorized"), "거부됨")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("notDetermined"), "확인 필요")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("unavailable"), "사용 불가")
    }

    func test_voiceRecorderMicrophoneDeniedCopy_isKorean() {
        XCTAssertEqual(
            VoiceRecorderError.microphoneDenied.errorDescription,
            "녹음하려면 마이크 권한이 필요해요."
        )
    }
}
