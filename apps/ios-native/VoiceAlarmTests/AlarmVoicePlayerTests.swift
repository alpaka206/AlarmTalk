import XCTest
@testable import VoiceAlarm

#if canImport(AVFoundation)
@MainActor
final class AlarmVoicePlayerTests: XCTestCase {

    func test_voiceVolume_clampsPercent() {
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: -10), 0)
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: 50), 0.5, accuracy: 0.001)
        XCTAssertEqual(AlarmVoicePlayer.voiceVolume(forPercent: 120), 1)
    }

    func test_voiceFadeStartVolume_matchesAndroidConstants() {
        XCTAssertTrue(AlarmVoicePlayer.shouldFadeInVoice(targetVolume: 1.0, fadeIn: true))
        XCTAssertEqual(AlarmVoicePlayer.voiceFadeStartVolume(targetVolume: 1.0), 0.45, accuracy: 0.001)
        XCTAssertEqual(AlarmVoicePlayer.voiceFadeStartVolume(targetVolume: 0.5), 0.35, accuracy: 0.001)
        XCTAssertFalse(AlarmVoicePlayer.shouldFadeInVoice(targetVolume: 0.35, fadeIn: true))
        XCTAssertFalse(AlarmVoicePlayer.shouldFadeInVoice(targetVolume: 1.0, fadeIn: false))
    }
}
#endif
