import AVFoundation
import AudioToolbox
import Foundation

enum VoiceTuningRenderError: Error, LocalizedError {
    case renderFailed(String)

    var errorDescription: String? {
        switch self {
        case .renderFailed(let reason): return "Voice tuning render failed (\(reason))."
        }
    }
}

/// 다듬기(목소리 높이)를 **파일로 구워 내는** 곳 — 등록 미리듣기와 알람 스테이징이 같은 것을 쓴다.
///
/// ⚠ 둘을 따로 만들지 말 것. 미리듣기에서 들은 소리와 알람이 실제로 우는 소리가 갈라지면
/// 이 화면을 둔 이유(들으면서 고르기)가 사라진다. 처리는 `VoicePitchShifter.render` 하나다.
enum VoiceTuningRenderer {

    /// 파일을 읽어(앞 `maxSeconds` 만) 높이를 바꾼 **모노** 샘플을 원래 표본률로 돌려준다.
    static func render(url: URL, tuning: VoiceTuning, maxSeconds: Double) throws -> (samples: [Float], sampleRate: Double) {
        let decoded: (samples: [Float], sampleRate: Double)
        do {
            decoded = try VoiceTuningAnalyzer.decodeMono(url: url, maxSeconds: maxSeconds)
        } catch {
            throw VoiceTuningRenderError.renderFailed("decode: \(error.localizedDescription)")
        }
        guard !decoded.samples.isEmpty else { throw VoiceTuningRenderError.renderFailed("empty input") }
        let shifted = VoicePitchShifter.render(
            samples: decoded.samples,
            sampleRate: decoded.sampleRate,
            semitones: tuning.normalized().pitchSt
        )
        return (shifted, decoded.sampleRate)
    }

    /// 16-bit LPCM **모노** CAF 로 쓴다. 채널 레이아웃(`AVChannelLayoutKey`)을 함께 적는다 —
    /// 없으면 파일은 생기는데 열리지 않는다(CLAUDE.md 「오디오 스테이징」).
    /// `gain`(알람의 목소리 크기, ≤ 1)은 쓰기 직전에 곱한다.
    static func writeMonoCAF(_ samples: [Float], sampleRate: Double, to url: URL, gain: Float = 1) throws {
        guard !samples.isEmpty,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let data = buffer.floatChannelData?[0] else {
            throw VoiceTuningRenderError.renderFailed("buffer allocation")
        }
        for index in samples.indices { data[index] = max(-1, min(1, samples[index] * gain)) }
        buffer.frameLength = AVAudioFrameCount(samples.count)

        var monoLayout = AudioChannelLayout()
        monoLayout.mChannelLayoutTag = kAudioChannelLayoutTag_Mono
        let layoutData = Data(bytes: &monoLayout, count: MemoryLayout<AudioChannelLayout>.size)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVChannelLayoutKey: layoutData,
        ]
        do {
            let output = try AVAudioFile(forWriting: url, settings: settings)
            try output.write(from: buffer)
        } catch {
            throw VoiceTuningRenderError.renderFailed("write: \(error.localizedDescription)")
        }
    }

    /// 등록 미리듣기 사본을 두는 임시 폴더.
    static var previewDirectory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("voice_tuning_preview", isDirectory: true)
    }

    /// 미리듣기 사본(등록·편집기)을 모두 지운다. 사본도 사용자 목소리의 복사본이다(스펙 §4-3) — 등록 화면을
    /// 떠날 때·세션이 바뀔 때·목소리 삭제/민감 동의 철회/명시적 로그아웃 때 부른다. 다시 필요하면 새로 굽는다.
    ///
    /// ⚠ **세대를 올린다.** 굽기는 백그라운드라 지운 **뒤에** 끝날 수 있다 — 그러면 폴더를 다시 만들고
    /// 사본을 남긴다(Codex #870). [previewFile] 이 끝에서 세대를 보고, 그 사이 지워졌으면 제가 쓴 것을 지운다.
    static func clearPreviewFiles() {
        let dir = previewDirectory
        previewEpoch.bump { try? FileManager.default.removeItem(at: dir) }
    }

    /// 미리듣기 사본 세대 — [clearPreviewFiles] 가 올린다.
    private static let previewEpoch = PreviewEpoch()

    /// 지금 세대 — 테스트가 '굽는 사이 지워짐' 을 재현할 때 쓴다.
    static var currentPreviewEpoch: Int { previewEpoch.current }

    /// 게시와 지우기를 **한 잠금 안에서** 한다 — 세대 확인과 이름 바꾸기 사이에 지우기가 끼지 못하게.
    /// 예전에는 게시한 **뒤에** 세대를 보고 대상을 지웠는데, 그 사이 새 굽기가 같은 이름으로 게시했으면 **새 굽기의
    /// 사본**을 지웠다(Codex #870). 이제 늦은 굽기는 제 임시 파일만 지우고 게시된 이름은 건드리지 않는다.
    private final class PreviewEpoch: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        var current: Int { lock.withLock { value } }

        func bump(then clear: () -> Void) {
            lock.withLock {
                value += 1
                clear()
            }
        }

        /// `tmp` 를 `url` 로 게시한다 — 세대가 그대로일 때만. 같은 클립·같은 높이를 다른 굽기가 먼저 게시했으면 그것을
        /// 그대로 쓴다(내용이 같다). 게시했거나 이미 있으면 true, 그 사이 지워졌으면 false.
        func publish(_ tmp: URL, to url: URL, ifEpoch epoch: Int) throws -> Bool {
            try lock.withLock {
                guard value == epoch else {
                    try? FileManager.default.removeItem(at: tmp)
                    return false
                }
                if FileManager.default.fileExists(atPath: url.path) {
                    try? FileManager.default.removeItem(at: tmp)
                    return true
                }
                try FileManager.default.moveItem(at: tmp, to: url)
                return true
            }
        }
    }

    /// [previewFile] 의 게시 단계(테스트용으로 따로 둔다).
    static func publishPreview(_ tmp: URL, to url: URL, ifEpoch epoch: Int) throws -> Bool {
        try previewEpoch.publish(tmp, to: url, ifEpoch: epoch)
    }

    /// 등록 미리듣기용 — 받은 클립을 이 높이로 구운 파일. 중립이면 원본을 그대로 돌려준다.
    /// 같은 클립·같은 높이는 한 번만 굽는다(임시 폴더, 이름에 높이 꼬리표).
    static func previewFile(for source: URL, tuning: VoiceTuning) throws -> URL {
        guard let tag = tuning.soundTag else { return source }
        let epoch = previewEpoch.current
        let dir = previewDirectory
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(source.deletingPathExtension().lastPathComponent)-t\(tag).caf")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let rendered = try render(url: source, tuning: tuning, maxSeconds: 60)
        let tmp = dir.appendingPathComponent("\(UUID().uuidString).caf")
        try writeMonoCAF(rendered.samples, sampleRate: rendered.sampleRate, to: tmp)
        // 굽는 사이 지워졌으면(화면을 떠남·세션 변경·목소리 삭제 …) 게시하지 않는다.
        guard try publishPreview(tmp, to: url, ifEpoch: epoch) else { throw CancellationError() }
        return url
    }
}

/// 등록 미리듣기 플레이어 — 구워 둔 파일(또는 원본)을 튼다. 끝까지 들었는지를 알려 준다.
///
/// 오디오 세션은 `AudioPreviewPlayer` 와 같다(`.playback` / `.spokenAudio`). 모노 파일도
/// `AVAudioPlayer` 는 원래 크기로 낸다 — 엔진 믹서처럼 −3dB 팬이 걸리지 않는다.
@MainActor
final class VoiceTuningPreviewPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isPlaying = false

    private var player: AVAudioPlayer?
    /// 끝까지 재생하면 `true`, 중간에 멈추면 `false` 로 한 번 불린다.
    private var onFinish: ((Bool) -> Void)?

    func play(url: URL, onFinish: ((Bool) -> Void)? = nil) throws {
        stop()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        let player = try AVAudioPlayer(contentsOf: url)
        player.delegate = self
        player.prepareToPlay()
        guard player.play() else { throw VoiceTuningRenderError.renderFailed("play") }
        self.player = player
        self.onFinish = onFinish
        isPlaying = true
    }

    func stop() {
        let pending = onFinish
        onFinish = nil
        teardown()
        pending?(false)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finished = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == finished else { return }
            let pending = self.onFinish
            self.onFinish = nil
            self.teardown()
            pending?(flag)
        }
    }

    private func teardown() {
        player?.delegate = nil
        player?.stop()
        player = nil
        if isPlaying {
            isPlaying = false
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }
}
