#if DEBUG
import AVFoundation
import XCTest
@testable import AlarmTalk

#if canImport(AlarmKit)
import AlarmKit

/// **폰이 실제로 더 작게 우는지 마이크로 잰다.**
///
/// 파일에 게인이 실린 것은 `AlarmSoundVolumeTests` 가 증명한다. 하지만 그 파일을 넘겨받은
/// **AlarmKit 이 우리가 깎아 둔 크기대로 울리는지**는 파일을 봐서는 알 수 없다 — 시스템이
/// 정규화를 하는지 어떤지는 문서에 없다. 그래서 진짜 알람을 두 번 울려 보고, 그동안
/// **아이폰 자신의 마이크로 녹음해** 크기를 비교한다.
///
/// ⚠ **평소 테스트에 넣지 않는다.** 알람이 실제로 울리고(스피커) 1분 가까이 걸린다.
/// 손으로 돌릴 때만 쓴다:
/// ```
/// xcodebuild test -only-testing:AlarmTalkTests/AlarmSoundAcousticProbe/test_소리_크기를_마이크로_비교한다
/// ```
final class AlarmSoundAcousticProbe: XCTestCase {

    /// 알람이 울리기까지 주는 시간(초). AlarmKit 은 미래 시각만 받는다.
    private let leadSeconds: TimeInterval = 12
    /// 울리는 동안 녹음할 시간(초).
    private let recordSeconds: TimeInterval = 8

    func test_소리_크기를_마이크로_비교한다() async throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["ALARMTALK_ACOUSTIC_PROBE"] == "1",
            "손으로 돌리는 프로브다 — ALARMTALK_ACOUSTIC_PROBE=1 일 때만 돈다"
        )

        let state = try await AlarmManager.shared.requestAuthorization()
        try XCTSkipUnless(state == .authorized, "알람 권한이 없다")

        let loud = try await measure(gainPercent: 100, label: "100%")
        let quiet = try await measure(gainPercent: 25, label: "25%")

        print("[ACOUSTIC] 100% RMS=\(loud)  25% RMS=\(quiet)  비율=\(quiet / max(loud, .leastNonzeroMagnitude))")
        XCTAssertGreaterThan(loud, quiet * 1.8, "25% 로 구운 파일이 100% 와 비슷하게 울린다 — OS 가 우리 게인을 무시한다")
    }

    /// 위 측정이 0 에 가깝게 나올 때 **무엇이 0인지** 가르는 대조군.
    /// 스피커로 직접 틀고 같은 방식으로 녹음한다 — 여기서도 0 이면 못 잰 것이지
    /// 소리가 안 난 것이 아니다.
    func test_대조군_스피커로_직접_틀면_마이크에_잡힌다() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["ALARMTALK_ACOUSTIC_PROBE"] == "1",
            "손으로 돌리는 프로브다"
        )
        let source = try makeBeepWAV()
        defer { try? FileManager.default.removeItem(at: source) }

        print("[ACOUSTIC] 마이크 권한=\(AVAudioApplication.shared.recordPermission.rawValue) 출력볼륨=\(AVAudioSession.sharedInstance().outputVolume)")
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
        try session.setActive(true)
        let player = try AVAudioPlayer(contentsOf: source)
        player.volume = 1.0
        player.numberOfLoops = -1
        player.play()
        defer { player.stop() }

        let rms = try recordRMS(seconds: 3, configureSession: false)
        print("[ACOUSTIC] 대조군(직접 재생) RMS=\(rms)")
        XCTAssertGreaterThan(rms, 0.01, "스피커로 직접 튼 소리도 마이크에 안 잡힌다 — 측정 장치 자체가 안 되는 것이다")
    }

    /// **자(ruler)를 먼저 재는 시험.** 위 비교가 "25% 인데 81% 로 들린다" 로 나왔을 때,
    /// 그게 OS 가 우리 게인을 무시한 것인지 **마이크가 큰 소리를 눌러 담은 것(AGC)** 인지
    /// 구분할 수 없다. 그래서 AlarmKit 을 빼고 **같은 두 파일을 우리가 직접 틀어** 같은
    /// 방식으로 잰다. 여기서도 0.25 가 0.8 로 나오면 자가 휘어 있는 것이다.
    func test_대조군_같은_파일을_직접_틀어_자를_잰다() async throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["ALARMTALK_ACOUSTIC_PROBE"] == "1",
            "손으로 돌리는 프로브다"
        )
        let source = try makeBeepWAV()
        defer { try? FileManager.default.removeItem(at: source) }

        func stagedFile(_ gain: Int) async throws -> URL {
            let key = "ruler-\(gain)"
            let name = try await MainActor.run {
                AlarmSoundStaging.clearStagedSound(forKey: key)
                return try AlarmSoundStaging.stage(url: source, key: key, volumePercent: gain)
            }
            let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
            let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
            let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            return dir.appendingPathComponent(entries.first { $0.hasPrefix(name + ".") }!)
        }

        // ⚠ **`.measurement` 모드여야 자가 곧다.** `.default` 는 마이크에 AGC 가 붙어
        // 큰 소리를 눌러 담는다 — 실제로 0.25배 신호가 0.90배로 잡혔다. 이 모드는 신호
        // 처리를 끄는 대신 **우리 AVAudioPlayer 출력도 같이 작아지므로**, 소리는
        // `AudioServices`(시스템 사운드 경로 — 알림·알람음이 지나가는 그 길)로 낸다.
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
        try session.setActive(true)

        func loudness(of url: URL) throws -> Float {
            var soundID: SystemSoundID = 0
            AudioServicesCreateSystemSoundID(url as CFURL, &soundID)
            defer { AudioServicesDisposeSystemSoundID(soundID) }
            AudioServicesPlaySystemSound(soundID)
            return try recordRMS(seconds: 2.5, configureSession: false)
        }

        let loud = try loudness(of: try await stagedFile(100))
        try await Task.sleep(nanoseconds: 1_000_000_000)
        let quiet = try loudness(of: try await stagedFile(25))

        let ratio = quiet / max(loud, .leastNonzeroMagnitude)
        print("[ACOUSTIC] 자 재기 — 100% RMS=\(loud)  25% RMS=\(quiet)  비율=\(ratio)")
        XCTAssertLessThan(
            ratio, 0.45,
            "우리가 직접 튼 0.25배 신호조차 \(ratio) 배로 잡힌다 — 마이크가 눌러 담고 있어서(AGC) 알람 비교값을 믿을 수 없다"
        )
    }

    // MARK: -

    /// 주어진 게인으로 구운 파일을 알람음으로 걸어 실제로 울리고, 그동안의 마이크 RMS 를 돌려준다.
    private func measure(gainPercent: Int, label: String) async throws -> Float {
        let source = try makeBeepWAV()
        let key = "acoustic-probe-\(gainPercent)"
        defer { try? FileManager.default.removeItem(at: source) }
        let name = try await MainActor.run {
            AlarmSoundStaging.clearStagedSound(forKey: key)
            return try AlarmSoundStaging.stage(url: source, key: key, volumePercent: gainPercent)
        }

        let id = UUID()
        let fireAt = Date().addingTimeInterval(leadSeconds)
        let schedule = Alarm.Schedule.fixed(fireAt)
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: "음량 측정 \(label)"),
            stopButton: AlarmButton(text: "끄기", textColor: .white, systemImageName: "stop.fill")
        )
        let attributes = AlarmAttributes<AlarmTalkMetadata>(
            presentation: AlarmPresentation(alert: alert),
            metadata: AlarmTalkMetadata(localAlarmID: "acoustic-probe", label: "음량 측정"),
            tintColor: AlarmTalkTheme.primary
        )
        _ = try await AlarmManager.shared.schedule(
            id: id,
            configuration: AlarmManager.AlarmConfiguration(
                schedule: schedule,
                attributes: attributes,
                sound: .named(name)
            )
        )
        defer { try? AlarmManager.shared.cancel(id: id) }

        // 울리기 시작할 때까지 기다렸다가 녹음한다.
        try await Task.sleep(nanoseconds: UInt64((leadSeconds + 1) * 1_000_000_000))
        let rms = try recordRMS(seconds: recordSeconds)
        try? AlarmManager.shared.stop(id: id)
        // 다음 측정과 겹치지 않게 잠깐 둔다.
        try await Task.sleep(nanoseconds: 2_000_000_000)
        return rms
    }

    /// 마이크로 `seconds` 초 녹음하고 전체 RMS 를 돌려준다.
    private func recordRMS(seconds: TimeInterval, configureSession: Bool = true) throws -> Float {
        if configureSession {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
            try session.setActive(true)
        }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        let total = Mutex<(sum: Double, frames: Int)>((0, 0))
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            var sum: Double = 0
            for i in 0..<Int(buffer.frameLength) { sum += Double(channel[i] * channel[i]) }
            total.mutate { $0.sum += sum; $0.frames += Int(buffer.frameLength) }
        }
        try engine.start()
        Thread.sleep(forTimeInterval: seconds)
        engine.stop()
        input.removeTap(onBus: 0)

        let snapshot = total.get()
        guard snapshot.frames > 0 else { return 0 }
        return Float((snapshot.sum / Double(snapshot.frames)).squareRoot())
    }

    /// 3초짜리 440Hz 비프(진폭 0.7) — 마이크로 잡히도록 충분히 크게.
    private func makeBeepWAV() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("probe-\(UUID().uuidString).wav")
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
        let frames = AVAudioFrameCount(44_100 * 3)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for i in 0..<Int(frames) {
            samples[i] = 0.7 * sinf(2 * .pi * 440 * Float(i) / 44_100)
        }
        try file.write(from: buffer)
        return url
    }

    private final class Mutex<Value>: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Value
        init(_ value: Value) { self.value = value }
        func get() -> Value { lock.lock(); defer { lock.unlock() }; return value }
        func mutate(_ body: (inout Value) -> Void) { lock.lock(); body(&value); lock.unlock() }
    }
}
#endif
#endif
