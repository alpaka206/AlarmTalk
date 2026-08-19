import XCTest
@testable import AlarmTalk

#if canImport(AVFoundation)
@MainActor
final class AlarmVoicePlayerTests: XCTestCase {

    func test_voiceVolume_clampsPercent() {
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: -10), 0)
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: 50), 0.5, accuracy: 0.001)
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: 120), 1)
    }

}
#endif
