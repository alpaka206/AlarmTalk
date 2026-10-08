import AVFoundation
import Foundation

/// 등록 미리듣기를 고른 높이로 **메모리 안에서** 굽는다(스펙 voice-and-message §4-3 — 파일로 남기지 않는다).
///
/// 서버가 준 초안 미리듣기(원래 소리 — 초안 행에는 높이가 없다)를 디코드해 `VoicePitchShifter` 로 높이를 바꾸고,
/// WAV `Data` 로 감싸 `VoiceTuningPreviewPlayer` 가 메모리에서 튼다. 막대를 놓을 때마다 서버를 부르면 합성 비용과
/// 대기가 생긴다. 알람 소리는 등록을 확정한 뒤 서버가 같은 셈으로 굽는다 — 셈은 `VoicePitchShifter` 하나다.
enum VoiceTuningRenderer {
    /// 굽는 길이의 상한(초). 초안 미리듣기는 한 문장이라 한참 짧다 — 이상한 입력이 메모리를 붙들지 않게 자른다.
    static let maxPreviewSeconds: Double = 120

    /// `source`(받은 미리듣기 파일)를 `tuning` 높이로 구운 WAV. 원래 소리(0)거나 굽지 못하면 nil — 그때는 원본을
    /// 그대로 튼다(그때 들은 높이는 0 이다). 무거우니 메인 밖에서 부른다.
    static func previewWAV(source: URL, tuning: VoiceTuning) -> Data? {
        let semitones = tuning.normalized().pitchSt
        guard semitones != 0,
              let decoded = try? VoiceTuningAnalyzer.decodeMono(url: source, maxSeconds: maxPreviewSeconds),
              !decoded.samples.isEmpty, decoded.sampleRate > 0 else { return nil }
        let shifted = VoicePitchShifter.render(
            samples: decoded.samples,
            sampleRate: decoded.sampleRate,
            semitones: semitones
        )
        return wavData(shifted, sampleRate: decoded.sampleRate)
    }

    /// 16-bit PCM **모노** WAV(머리말 44바이트 + 표본, 리틀 엔디언). 범위(−1…1) 밖 표본은 자른다.
    static func wavData(_ samples: [Float], sampleRate: Double) -> Data {
        let rate = UInt32(sampleRate.rounded())
        let pcmBytes = UInt32(samples.count * MemoryLayout<Int16>.size)
        var data = Data(capacity: 44 + Int(pcmBytes))
        func append<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: Array("RIFF".utf8))
        append(36 + pcmBytes)
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))      // fmt 덩이 길이
        append(UInt16(1))       // PCM
        append(UInt16(1))       // 모노
        append(rate)
        append(rate * 2)        // 초당 바이트
        append(UInt16(2))       // 표본 하나의 바이트
        append(UInt16(16))      // 표본 비트
        data.append(contentsOf: Array("data".utf8))
        append(pcmBytes)
        let pcm = samples.map { Int16((max(-1, min(1, $0)) * 32_767).rounded()).littleEndian }
        pcm.withUnsafeBytes { data.append(contentsOf: $0) }
        return data
    }
}

/// 등록 미리듣기 플레이어 — 메모리에서 구운 소리나 받은 원본 파일을 **한 번** 틀고, 어떻게 끝났는지 알려 준다
/// (첫 미리듣기와 다시 듣기가 함께 쓴다).
///
/// 오디오 세션은 `AudioPreviewPlayer` 와 같다(`.playback` / `.spokenAudio`). 모노 소리도
/// `AVAudioPlayer` 는 원래 크기로 낸다 — 엔진 믹서처럼 −3dB 팬이 걸리지 않는다.
@MainActor
final class VoiceTuningPreviewPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isPlaying = false

    /// 재생이 어떻게 끝났는가. **멈춘 것(`stopped`)과 깨진 것(`failed`)을 가른다** — 둘을 한데 모으면 재생 도중 깨진
    /// 소리가 '사용자가 멈췄다' 로 읽혀 원본으로 다시 틀지도, 알리지도 않는다(Codex #870). 틀지 못한 것도 `failed` 다.
    enum PlaybackEnd: Sendable { case finished, stopped, failed }

    enum PlaybackError: Error { case didNotStart }

    private var player: AVAudioPlayer?
    /// 재생이 끝나면 한 번 불린다.
    private var onFinish: ((PlaybackEnd) -> Void)?
    /// [play]·[stop] 을 부를 때마다 오른다 — 구운 소리가 깨져 원본으로 넘어가는 사이에 멈추라고 했거나 새 재생이
    /// 시작됐으면 원본을 틀지 않는다(화면 밖에서 소리가 나거나 새 재생을 끊는다).
    private var generation = 0

    /// 끝날 때까지 튼다 — 구운 소리(`tuned`)가 있으면 그것을, 없으면 원본을. 구운 소리를 **못 틀거나 도중에 깨지면**
    /// 원본으로 처음부터 한 번 더 틀고 `onPlayingOriginalInstead` 를 부른다 — 그때 들은 높이는 0 이다(원본을 들려줘 놓고
    /// 고른 높이를 들었다고 적으면 듣지 않은 값이 등록된다, Codex #870). 멈춘 것(`stopped`)은 다시 틀지 않는다.
    func play(tuned: Data?, original: URL, onPlayingOriginalInstead: (() -> Void)? = nil) async -> PlaybackEnd {
        generation &+= 1
        let mine = generation
        if let tuned {
            let end = await playToEnd { try AVAudioPlayer(data: tuned, fileTypeHint: AVFileType.wav.rawValue) }
            guard end == .failed else { return end }
            guard mine == generation else { return .stopped }
            onPlayingOriginalInstead?()
        }
        return await playToEnd { try AVAudioPlayer(contentsOf: original) }
    }

    func stop() {
        generation &+= 1
        finish(.stopped)
    }

    private func playToEnd(_ makePlayer: () throws -> AVAudioPlayer) async -> PlaybackEnd {
        await withCheckedContinuation { (continuation: CheckedContinuation<PlaybackEnd, Never>) in
            do {
                try start(makePlayer) { continuation.resume(returning: $0) }
            } catch {
                continuation.resume(returning: .failed)
            }
        }
    }

    private func start(_ makePlayer: () throws -> AVAudioPlayer, onFinish: @escaping (PlaybackEnd) -> Void) throws {
        finish(.stopped)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        let player: AVAudioPlayer
        do {
            player = try makePlayer()
            player.delegate = self
            player.prepareToPlay()
            // `play()` 가 false 면 소리가 나지 않았고 끝 알림도 오지 않는다 — 시작한 것으로 치면 끝을 기다리는 쪽이 영영
            // 멈춘다(Codex #870).
            guard player.play() else { throw PlaybackError.didNotStart }
        } catch {
            // 세션을 켠 뒤 실패하면 놓는다 — 안 그러면 다른 앱의 소리가 계속 끊긴 채 남는다(Codex #870).
            try? session.setActive(false, options: [.notifyOthersOnDeactivation])
            throw error
        }
        self.player = player
        self.onFinish = onFinish
        isPlaying = true
    }

    /// 지금 재생을 내리고 기다리던 쪽에 끝을 알린다.
    private func finish(_ end: PlaybackEnd) {
        let pending = onFinish
        onFinish = nil
        teardown()
        pending?(end)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finished = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == finished else { return }
            // 중간에 디코딩이 깨져 끝난 것(`successfully: false`)은 끝까지 들은 것이 아니다(Codex #870).
            self.finish(flag ? .finished : .failed)
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
