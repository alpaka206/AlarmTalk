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

    func test_voiceVolumeRampPlan_firstPlaybackStartsQuietAndReachesTargetVolume() {
        let plan = AlarmVoicePlayer.voiceVolumeRampPlan(targetVolume: 1.0, fadeIn: true)

        XCTAssertEqual(plan.startVolume, 0.15, accuracy: 0.001)
        XCTAssertEqual(plan.stepVolumes.count, AlarmVoicePlayer.voiceFadeSteps)
        XCTAssertEqual(plan.stepVolumes.last ?? -1, 1.0, accuracy: 0.001)
        XCTAssertTrue(zip(plan.stepVolumes, plan.stepVolumes.dropFirst()).allSatisfy { pair in pair.1 > pair.0 })
    }

    func test_voiceVolumeRampPlan_repeatedPlaybackStartsAtTargetVolume() {
        let plan = AlarmVoicePlayer.voiceVolumeRampPlan(targetVolume: 1.0, fadeIn: false)

        XCTAssertEqual(plan.startVolume, 1.0, accuracy: 0.001)
        XCTAssertTrue(plan.stepVolumes.isEmpty)
    }

    func test_voiceVolumeRampPlan_lowConfiguredVoiceVolumeStillFadesWhenThereIsRoom() {
        let plan = AlarmVoicePlayer.voiceVolumeRampPlan(targetVolume: 0.30, fadeIn: true)

        XCTAssertLessThan(plan.startVolume, 0.30)
        XCTAssertEqual(plan.stepVolumes.count, AlarmVoicePlayer.voiceFadeSteps)
        XCTAssertEqual(plan.stepVolumes.last ?? -1, 0.30, accuracy: 0.001)
    }

    func test_voiceVolumeRampPlan_mutedVoiceStaysMuted() {
        let plan = AlarmVoicePlayer.voiceVolumeRampPlan(targetVolume: 0, fadeIn: true)

        XCTAssertEqual(plan.startVolume, 0, accuracy: 0.001)
        XCTAssertTrue(plan.stepVolumes.isEmpty)
    }
}
#endif
