import AVFoundation
import XCTest
@testable import AlarmTalk

/// **iOS 에서 음량이 실제로 알람에 닿는가** — 주석이 아니라 파일을 재서 답한다.
///
/// 배경: 잠금·앱 종료 상태에서 우리 목소리가 울리는 경로는 하나뿐이다.
/// `AlarmSoundStaging` 이 만든 파일을 `Library/Sounds` 에 두고 AlarmKit 에
/// `AlertConfiguration.AlertSound.named(_)` 로 **이름만** 넘긴다. AlarmKit 설정에는
/// 음량 인자가 없다(SDK 인터페이스에 vibration/haptic 과 마찬가지로 volume 도 없다).
/// 그러니 음량을 바꿀 수 있는 자리는 **우리가 쓰는 그 파일의 샘플값** 하나뿐이다.
///
/// 그래서 여기서 재는 것은 "고른 음량이 스테이징 산출물에 반영되는가" 다.
@MainActor
final class AlarmSoundVolumeTests: XCTestCase {

    // MARK: - 측정 도구

    /// 1초짜리 사인파(진폭 `amplitude`)를 WAV 로 쓴다.
    private func makeSineWAV(amplitude: Float, name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(name)-\(UUID().uuidString).wav")
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false
        )!
        let file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ]
        )
        let frames = AVAudioFrameCount(44_100)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for i in 0..<Int(frames) {
            samples[i] = amplitude * sinf(2 * .pi * 440 * Float(i) / 44_100)
        }
        try file.write(from: buffer)
        return url
    }

    /// 파일 전체의 RMS(제곱평균제곱근). 사람이 듣는 크기에 비례하는 값이다.
    private func rms(of url: URL) throws -> Float {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))!
        try file.read(into: buffer)
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += channel[i] * channel[i] }
        return sqrt(sum / Float(buffer.frameLength))
    }

    private func stagedURL(named baseName: String) throws -> URL {
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
        let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        let match = try XCTUnwrap(
            entries.first { $0.hasPrefix(baseName + ".") },
            "스테이징 산출물을 찾지 못했다 (\(baseName), 목록: \(entries))"
        )
        return dir.appendingPathComponent(match)
    }

    // MARK: - 목소리 음량

    func test_고른_목소리_음량이_스테이징_파일에_실린다() throws {
        let source = try makeSineWAV(amplitude: 0.5, name: "voice")
        let sourceRMS = try rms(of: source)
        XCTAssertGreaterThan(sourceRMS, 0.1, "테스트 소스가 무음이다")

        let key100 = "vol-test-100-\(UUID().uuidString)"
        let key30 = "vol-test-30-\(UUID().uuidString)"
        defer {
            AlarmSoundStaging.clearStagedSound(forKey: key100)
            AlarmSoundStaging.clearStagedSound(forKey: key30)
            try? FileManager.default.removeItem(at: source)
        }

        let full = try AlarmSoundStaging.stage(url: source, key: key100, volumePercent: 100)
        let quiet = try AlarmSoundStaging.stage(url: source, key: key30, volumePercent: 30)

        let fullRMS = try rms(of: stagedURL(named: full))
        let quietRMS = try rms(of: stagedURL(named: quiet))

        // 100% 는 소스 그대로.
        XCTAssertEqual(fullRMS, sourceRMS, accuracy: sourceRMS * 0.05, "100% 인데 크기가 변했다")

        // 30% 는 소스의 0.3배. **이게 깨지면 iOS 목소리 슬라이더는 아무 일도 하지 않는다** —
        // 잠금화면에서 울리는 경로에는 이 파일 말고 음량을 실을 자리가 없기 때문이다.
        XCTAssertEqual(
            quietRMS, sourceRMS * 0.3, accuracy: sourceRMS * 0.05,
            "30% 로 스테이징했는데 크기가 \(quietRMS / sourceRMS) 배다 — 게인이 실리지 않았다"
        )
    }

    func test_음량이_다르면_다른_파일로_스테이징한다() throws {
        let source = try makeSineWAV(amplitude: 0.5, name: "voice-cache")
        let key = "vol-cache-\(UUID().uuidString)"
        defer {
            AlarmSoundStaging.clearStagedSound(forKey: key)
            try? FileManager.default.removeItem(at: source)
        }

        // ⚠ 스테이징은 **이미 있으면 재사용**한다. 음량이 이름에 들어가지 않으면
        // 슬라이더를 내려도 예전 파일이 그대로 쓰여 아무것도 바뀌지 않는다.
        let full = try AlarmSoundStaging.stage(url: source, key: key, volumePercent: 100)
        let quiet = try AlarmSoundStaging.stage(url: source, key: key, volumePercent: 40)
        XCTAssertNotEqual(full, quiet, "음량이 달라도 같은 이름이라 옛 파일이 재사용된다")

        let fullRMS = try rms(of: stagedURL(named: full))
        let quietRMS = try rms(of: stagedURL(named: quiet))
        XCTAssertLessThan(quietRMS, fullRMS * 0.6, "40% 파일이 100% 파일보다 작지 않다")
    }

    /// 0% 는 '무음' 이다 — 파일이 없어지는 게 아니라 **소리 없는 파일**이 되어야 한다.
    /// (파일이 없으면 AlarmKit 은 `.default` 시스템 톤으로 되돌아가 오히려 소리가 난다.)
    func test_0퍼센트는_무음_파일이_된다() throws {
        let source = try makeSineWAV(amplitude: 0.5, name: "silent")
        let key = "vol-zero-\(UUID().uuidString)"
        defer {
            AlarmSoundStaging.clearStagedSound(forKey: key)
            try? FileManager.default.removeItem(at: source)
        }

        let staged = try AlarmSoundStaging.stage(url: source, key: key, volumePercent: 0)
        let stagedRMS = try rms(of: stagedURL(named: staged))
        XCTAssertLessThan(stagedRMS, 0.001, "0% 인데 소리가 남아 있다")
    }
}
