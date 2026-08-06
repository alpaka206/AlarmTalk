import AVFoundation
import XCTest
@testable import AlarmTalk

/// ⚠ **이 파일이 답하는 질문: staging 이 성공하는가, 항상 실패하는가.**
///
/// `AlarmSoundStaging.stage` 는 `AVAssetExportPresetAppleM4A` 로 `.caf` 를 굽는다. 그런데
/// 그 프리셋의 `supportedFileTypes` 에 `.caf` 가 없으면 **모든 목소리 클립의 staging 이 항상
/// 실패**하고, 그러면 AlarmKit 은 `.default` 시스템 톤만 울린다 — 앱이 꺼져 있거나 잠금
/// 화면이면 **목소리가 아예 안 들린다.** 페이드보다 훨씬 큰 문제이고, 코드 독해만으로는
/// 판별되지 않아 감사에서 미결로 남았던 지점이다.
///
/// 실기기가 없어도 여기서 답이 나온다 — 시뮬레이터도 같은 AVFoundation 을 쓴다.
/// (실기기와 결과가 다를 여지는 남지만, '항상 실패' 인지 아닌지는 이걸로 갈린다.)
@MainActor
final class AlarmSoundStagingCapabilityTests: XCTestCase {

    /// 이 프리셋이 `.caf` 를 낼 수 있는가. 못 내면 staging 은 구조적으로 불가능하다.
    func test_appleM4APreset_supportsCafOutput() throws {
        let url = try makeSilentM4A()
        defer { try? FileManager.default.removeItem(at: url) }

        let asset = AVURLAsset(url: url)
        let exporter = try XCTUnwrap(
            AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A)
        )
        let types = exporter.supportedFileTypes

        XCTAssertTrue(
            types.contains(.caf),
            """
            AVAssetExportPresetAppleM4A 가 .caf 를 지원하지 않는다.
            → AlarmSoundStaging.stage 가 **항상** 실패하고, 잠금화면·백그라운드에서
              목소리가 전혀 재생되지 않는다. 지원 목록: \(types.map { $0.rawValue })
            """
        )
    }

    /// 실제로 한 번 구워 본다 — 지원 목록이 있어도 실제 export 가 실패할 수 있다.
    func test_stage_producesPlayableCafFile() async throws {
        let src = try makeSilentM4A()
        defer { try? FileManager.default.removeItem(at: src) }

        let staged: String
        do {
            staged = try AlarmSoundStaging.stage(url: src, key: "capability-probe")
        } catch {
            XCTFail("staging 실패: \(error) — 이러면 잠금화면에서 목소리가 안 울린다")
            return
        }

        // staged 파일은 Library/Sounds/ 에 놓인다(AlarmSoundStaging.ensureSoundsDirectory).
        let dir = try XCTUnwrap(
            FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
        ).appendingPathComponent("Sounds", isDirectory: true)
        let out = dir.appendingPathComponent(staged)
        XCTAssertTrue(FileManager.default.fileExists(atPath: out.path), "staged 파일이 없다")

        // 실제로 재생 가능한 오디오인지 확인한다(빈 파일이 만들어질 수 있다).
        let player = try AVAudioPlayer(contentsOf: out)
        XCTAssertGreaterThan(player.duration, 0, "staged 파일 길이가 0 이다")

        try? FileManager.default.removeItem(at: out)
    }

    // MARK: - Helpers

    /// 1초짜리 무음 m4a 를 만든다(캐시된 TTS 클립과 같은 컨테이너).
    private func makeSilentM4A() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("staging-probe-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        let format = try XCTUnwrap(
            AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)
        )
        let frames = AVAudioFrameCount(44_100)
        let buffer = try XCTUnwrap(
            AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
        )
        buffer.frameLength = frames
        try file.write(from: buffer)
        return url
    }
}
