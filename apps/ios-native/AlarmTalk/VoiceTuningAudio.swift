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
/// (톤 카드의 `원본 듣기`·`현재 톤 듣기` 가 함께 쓴다 — 한 번에 하나만 소리 난다).
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

/// 등록 확정 화면 톤 카드의 **두 재생 버튼**(`원본 듣기`·`현재 톤 듣기`) 규칙 — 화면 상태와 떼어 낸 순수 셈이다(스펙
/// voice-and-message §4-3 「누가 어디서 바꾸는가」). 재생 자체는 `VoiceTuningPreviewPlayer` 가 한다.
///
/// - 둘 다 **한 번** 튼다(반복은 울릴 때의 일이다). 트는 중인 버튼을 다시 누르면 멈추고, 다른 버튼을 누르면 지금 것을
///   멈추고 그것을 처음부터 튼다. 서버에서 받는 동안에도 두 버튼은 살아 있다 — 받는 중의 진행 표시도 '트는 중' 이라
///   그 버튼을 누르면 받은 뒤에 틀지 않고, 다른 버튼을 누르면 받은 뒤에 그것을 튼다(안드로이드 `TuningListenAction` 과
///   같은 셈).
/// - 저장은 **지금 막대 값**을 끝까지 들었을 때만 열린다. '들었다' 는 실제로 걸린 높이로 센다 — 원본 듣기는 0 이다.
enum VoiceTonePreview {
    /// 어느 버튼의 소리인가.
    enum Kind: Equatable, Sendable {
        /// `원본 듣기` — 받은 클립 그대로(높이 0).
        case original
        /// `현재 톤 듣기` — 막대 값으로 메모리에서 구운 소리.
        case current
    }

    /// 버튼을 눌렀을 때 할 일.
    enum Press: Equatable, Sendable {
        /// 트는(굽는) 중인 그 버튼을 다시 눌렀다 — 멈춘다.
        case stop
        /// 지금 것을 멈추고 이것을 처음부터 튼다.
        case play(Kind)
    }

    /// `active` 는 지금 트는(굽는·받는) 버튼이다. 아무것도 안 틀고 있으면 nil.
    static func press(_ kind: Kind, active: Kind?) -> Press {
        active == kind ? .stop : .play(kind)
    }

    /// 그 버튼이 실을 높이 — 원본은 언제나 0, 현재 톤은 막대 값(눈금에 맞춘 값).
    static func target(of kind: Kind, slider: VoiceTuning) -> VoiceTuning {
        switch kind {
        case .original: return .neutral
        case .current: return slider.normalized()
        }
    }

    /// 끝까지 튼 재생에 **실제로 걸린** 높이. 현재 톤은 구운 소리를 끝까지 틀었을 때만 그 높이다 — 굽지 못했거나
    /// (0 이라 굽지 않은 것 포함) 구운 소리가 깨져 원본을 대신 틀었으면 0 이다. 원본을 들려줘 놓고 고른 높이를
    /// 들었다고 적으면 듣지 않은 값이 등록된다(Codex #870).
    static func applied(_ kind: Kind, target: VoiceTuning, baked: Bool, playedOriginalInstead: Bool) -> VoiceTuning {
        guard kind == .current, baked, !playedOriginalInstead else { return .neutral }
        return target.normalized()
    }

    /// 막대에서 손을 뗐을 때 할 일.
    enum SliderRelease: Equatable, Sendable {
        /// 받은 클립이 아직 없다 — 막대는 서버를 부르지 않는다(받으면 그때의 막대 값으로 튼다).
        case ignore
        /// 서버가 청취를 확인하기 전(첫 재생)에 소리가 나고 있다 — 끊지 않고, 그 재생이 끝난 직후 새 높이로 다시 튼다.
        case afterCurrentPlayback
        /// 곧바로 현재 톤을 다시 굽고 처음부터 한 번 튼다.
        case replayNow
    }

    /// `audible` 은 실제로 소리가 나는 중인가다 — 굽는 중(아직 소리 전)이면 거짓이라 새 값으로 다시 굽는다.
    static func sliderReleased(hasClip: Bool, listenConfirmed: Bool, audible: Bool) -> SliderRelease {
        guard hasClip else { return .ignore }
        return !listenConfirmed && audible ? .afterCurrentPlayback : .replayNow
    }

    /// 저장(등록 확정)을 열어도 되는가 — 서버가 청취를 확인했고, 새 높이를 굽는 중이 아니고, **지금 막대 값**을 이
    /// 클립으로 끝까지 들었을 때만. 등록 뒤에는 높이를 바꿀 수 없고 그 값이 이 목소리의 모든 알람 소리에 구워진다.
    static func canSave(listenConfirmed: Bool, rendering: Bool, hearing: Hearing, slider: VoiceTuning) -> Bool {
        listenConfirmed && !rendering && hearing.hasHeard(slider)
    }

    /// 한 클립으로 **끝까지 들은 높이들**. 클립이 바뀌면(문구를 고쳐 새로 받으면) 새로 센다.
    ///
    /// 하나가 아니라 모아 두는 까닭: 두 버튼은 번갈아 들으라고 둔 것이다(2026-10-08 사용자). 마지막 하나만 기억하면
    /// `현재 톤 듣기` 를 끝까지 들은 뒤 `원본 듣기` 로 비교하는 순간 저장이 다시 잠긴다 — 막대 값은 이미 들었는데도.
    struct Hearing: Equatable, Sendable {
        private(set) var pitches: Set<Double> = []

        /// 재생 하나가 끝까지 갔다 — `applied` 는 그 재생에 실제로 걸린 높이다(`VoiceTonePreview.applied`).
        mutating func record(_ applied: VoiceTuning) {
            pitches.insert(applied.normalized().pitchSt)
        }

        func hasHeard(_ tuning: VoiceTuning) -> Bool {
            pitches.contains(tuning.normalized().pitchSt)
        }
    }
}
