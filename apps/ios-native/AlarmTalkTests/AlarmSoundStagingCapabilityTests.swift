import AVFoundation
import XCTest
@testable import AlarmTalk

/// ⚠ **이 파일이 답하는 질문: staging 이 성공하는가, 항상 실패하는가.**
///
/// staging 이 실패하면 AlarmKit 은 `.default` 시스템 톤만 울린다 — 앱이 꺼져 있거나 잠금
/// 화면이면 **목소리가 아예 안 들린다.** 코드 독해만으로는 판별되지 않아 감사에서 미결로
/// 남았던 지점이라 테스트로 못박는다.
///
/// 실기기가 없어도 여기서 답이 나온다 — 시뮬레이터도 같은 AVFoundation 을 쓴다.
/// (실기기와 결과가 다를 여지는 남지만, '항상 실패' 인지 아닌지는 이걸로 갈린다.)
@MainActor
final class AlarmSoundStagingCapabilityTests: XCTestCase {

    /// **회귀 방지** — `AVAssetExportSession` 으로 되돌아가지 말 것.
    ///
    /// 예전 구현이 `AVAssetExportPresetAppleM4A` + `outputFileType = .caf` 였는데, 그
    /// 프리셋은 `.m4a` 밖에 못 낸다. 그래서 `supportedFileTypes.contains(.caf)` 가드가
    /// **항상** 걸려 staging 이 매번 실패했다. 이 테스트는 그 사실을 고정해, 누군가
    /// "간단하니까" 하고 export 방식으로 되돌리는 걸 막는다.
    func test_appleM4APreset_cannotProduceCaf_soDoNotUseExportSession() throws {
        let url = try makeSilentM4A()
        defer { try? FileManager.default.removeItem(at: url) }

        let asset = AVURLAsset(url: url)
        let exporter = try XCTUnwrap(
            AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A)
        )
        let types = exporter.supportedFileTypes

        XCTAssertFalse(
            types.contains(.caf),
            """
            이 프리셋이 .caf 를 지원하게 됐다면 이 테스트의 전제가 바뀐 것이다.
            그래도 AVAssetReader/Writer 경로가 더 확실하니 구현을 되돌릴 이유는 없다.
            지원 목록: \(types.map { $0.rawValue })
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
        // `stage` 는 **확장자를 뺀 base name** 을 돌려준다(`AlertSound.named(_)` 규약).
        // 실제 파일은 그 base name + 실제 확장자다.
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        let fileName = try XCTUnwrap(
            contents.first { ($0 as NSString).deletingPathExtension == staged },
            "staged 파일이 없다 (dir: \(contents))"
        )
        let out = dir.appendingPathComponent(fileName)
        XCTAssertEqual((fileName as NSString).pathExtension, "caf", "AlarmKit 이 받는 컨테이너여야 한다")

        // 실제로 재생 가능한 오디오인지 확인한다(빈 파일이 만들어질 수 있다).
        let player = try AVAudioPlayer(contentsOf: out)
        XCTAssertGreaterThan(player.duration, 0, "staged 파일 길이가 0 이다")

        try? FileManager.default.removeItem(at: out)
    }

    /// **기기 벨소리(`.m4r`)도 스테이징돼야 한다.**
    ///
    /// 알람음 픽커가 `/Library/Ringtones` 를 그대로 보여주는데, 그 파일은 전부 `.m4r` 이다.
    /// 2026-08-16 실기기 실측에서 `unsupportedFormat("m4r")` 로 **전부 거부**됐다 —
    /// 그러면 고른 벨소리가 조용히 기본 알람음으로 울린다(화면이 없는 기능을 광고하는 꼴).
    /// `.m4r` 은 MPEG-4 컨테이너 안 AAC 라 `.m4a` 와 같은 것이고 `AVAssetReader` 가 읽는다.
    func test_stage_m4r도_caf로_만든다() throws {
        let m4a = try makeSilentM4A()
        // 확장자만 벨소리와 같게 바꾼다 — 컨테이너는 동일하다.
        let m4r = m4a.deletingPathExtension().appendingPathExtension("m4r")
        try? FileManager.default.removeItem(at: m4r)
        try FileManager.default.moveItem(at: m4a, to: m4r)
        defer { try? FileManager.default.removeItem(at: m4r) }

        let staged = try AlarmSoundStaging.stage(url: m4r, key: "ringtone-probe")
        let dir = try XCTUnwrap(
            FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
        ).appendingPathComponent("Sounds", isDirectory: true)
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        let fileName = try XCTUnwrap(
            contents.first { ($0 as NSString).deletingPathExtension == staged },
            "staged 파일이 없다 (dir: \(contents))"
        )
        XCTAssertEqual((fileName as NSString).pathExtension, "caf")
        let out = dir.appendingPathComponent(fileName)
        let player = try AVAudioPlayer(contentsOf: out)
        XCTAssertGreaterThan(player.duration, 0, "벨소리를 변환했는데 길이가 0 이다")
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
