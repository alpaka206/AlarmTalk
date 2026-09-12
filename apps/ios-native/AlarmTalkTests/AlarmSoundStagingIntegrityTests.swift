import AVFoundation
import XCTest
@testable import AlarmTalk

/// ⚠ **이 파일이 답하는 질문: 망가진 staged 파일이 알람에 채택되는가.**
///
/// `AlarmSoundStaging.stage` 가 낸 이름은 `AlertConfiguration.AlertSound.named(_)` 로
/// AlarmKit 에 박히고, 그 경로는 `requiresInAppFallback == false` 라 **인앱 폴백이 돌지
/// 않는다.** 그래서 잘리거나 빈 파일이 한 번 채택되면 알람은 뜨는데 **소리가 없고**,
/// 재사용 판정이 파일 존재 하나뿐이라 **스스로 복구되지도 않는다.**
///
/// 2026-08-10 이전 구현은 (1) 최종 경로에 직접 써서 중단 시 잘린 파일이 남았고,
/// (2) 완료 판정이 `reader.status != .failed` 라 중간에 끊긴 결과를 통과시켰다.
@MainActor
final class AlarmSoundStagingIntegrityTests: XCTestCase {

    private var soundsDir: URL {
        get throws {
            try XCTUnwrap(FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first)
                .appendingPathComponent("Sounds", isDirectory: true)
        }
    }

    private func stagedFile(forBaseName base: String) throws -> URL? {
        let dir = try soundsDir
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        guard let name = contents.first(where: { ($0 as NSString).deletingPathExtension == base })
        else { return nil }
        return dir.appendingPathComponent(name)
    }

    /// **0바이트 소스는 staged 산출물로 채택되면 안 된다.**
    ///
    /// 서버가 빈 `audio_base64` 를 주면 캐시에 0바이트 파일이 앉는다
    /// (`Data(base64Encoded: "")` 는 nil 이 아니라 0바이트 Data 다). 그게 staging 까지
    /// 흘러가면 무음 알람이 된다 — 여기서 **throw 로 막아야** 호출자가 인앱 폴백으로 내려간다.
    func test_빈_소스는_staging이_거부한다() throws {
        let key = "integrity-empty-\(UUID().uuidString)"
        let src = FileManager.default.temporaryDirectory
            .appendingPathComponent("empty-\(UUID().uuidString).caf")
        FileManager.default.createFile(atPath: src.path, contents: Data())
        defer { try? FileManager.default.removeItem(at: src) }

        XCTAssertThrowsError(
            try AlarmSoundStaging.stage(url: src, key: key),
            "0바이트 소스가 통과하면 알람이 조용히 무음으로 운다"
        )
        XCTAssertNil(try stagedFile(forBaseName: "voice-\(key)"),
                     "실패했는데 최종 이름의 파일이 남으면 안 된다 — 그 파일이 영원히 재사용된다")
    }

    /// **최종 이름에 이미 망가진 파일이 있으면 재사용하지 않고 다시 만든다.**
    ///
    /// 예전 구현의 잔해(잘린 파일)를 물고 있는 기기가 스스로 복구되려면 이게 필요하다.
    /// 존재만 보고 재사용하면 그 기기는 영원히 무음이다.
    func test_망가진_기존_staged파일은_재사용하지_않고_다시_만든다() throws {
        let key = "integrity-corrupt-\(UUID().uuidString)"
        let base = "voice-\(AudioCacheStore.safeCacheKey(key))"
        let dir = try soundsDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // 잘린 잔해를 심는다: 헤더 흉내만 낸 몇 바이트.
        let corrupt = dir.appendingPathComponent("\(base).caf")
        FileManager.default.createFile(atPath: corrupt.path, contents: Data(repeating: 0, count: 24))
        defer { try? FileManager.default.removeItem(at: corrupt) }

        let src = try makeSilentM4A()
        defer { try? FileManager.default.removeItem(at: src) }

        let staged = try AlarmSoundStaging.stage(url: src, key: key)
        XCTAssertEqual(staged, base)

        let out = try XCTUnwrap(try stagedFile(forBaseName: base))
        defer { try? FileManager.default.removeItem(at: out) }

        let player = try AVAudioPlayer(contentsOf: out)
        XCTAssertGreaterThan(player.duration, 0, "망가진 잔해를 그대로 재사용했다 — 무음 알람이 된다")
    }

    /// **실패한 staging 은 임시 파일도 남기지 않는다.**
    /// 남으면 `Library/Sounds` 가 쓰레기로 차고, 최악의 경우 이름이 겹쳐 오해를 만든다.
    func test_실패해도_임시파일을_남기지_않는다() throws {
        let dir = try soundsDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let before = Set((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [])

        let src = FileManager.default.temporaryDirectory
            .appendingPathComponent("empty-\(UUID().uuidString).m4a")
        FileManager.default.createFile(atPath: src.path, contents: Data())
        defer { try? FileManager.default.removeItem(at: src) }

        _ = try? AlarmSoundStaging.stage(url: src, key: "integrity-tmp-\(UUID().uuidString)")

        let after = Set((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [])
        let leftovers = after.subtracting(before).filter { $0.hasPrefix(".staging-") }
        XCTAssertTrue(leftovers.isEmpty, "임시 파일이 남았다: \(leftovers)")
    }

    // MARK: - Helpers

    private func makeSilentM4A() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("integrity-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1))
        let frames = AVAudioFrameCount(44_100)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames))
        buffer.frameLength = frames
        try file.write(from: buffer)
        return url
    }
}
