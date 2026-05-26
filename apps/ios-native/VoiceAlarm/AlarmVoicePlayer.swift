import Foundation

#if canImport(AVFoundation)
import AVFoundation
#endif

// MARK: - AlarmVoicePlayer
//
// AlarmKit 의 `AlertConfiguration.AlertSound.named(_)` 는 (Apple 의 사운드 정책상)
// 30초 이하의 짧은 사운드만 안정적으로 재생한다. 사용자 목소리/TTS 가
// 30초를 넘기거나 staging (트랜스코드) 이 실패하면 AlarmKit 으로는 `.default`
// 만 울리고, 우리 앱이 활성화된 동안 AVAudioPlayer 로 같은 목소리를 재생한다.
//
// 동작 패턴:
//   - Pattern A (앱 활성): 알람 fire 직후 ContentView 가 ringing 상태로 진입할 때
//     `playIfNeeded(_:audioCache:)` 가 호출되어 voice 재생을 시작한다.
//   - Pattern B (앱 미활성): AlarmKit `.default` 만 울린다. 사용자가 LiveActivity 의
//     Stop/Snooze 를 누르거나 앱을 직접 열면 그 시점에 `playIfNeeded(...)` 가
//     호출되어 (이미 알람이 멈췄거나 스누즈 상태라면) no-op 으로 끝난다.
//
// 호출자(Phase 2-B2):
//   AlarmKitViewModel.startObserving 가 alarmUpdates 루프에서 `ringing` 상태에 진입한
//   알람을 감지하면 `AlarmVoicePlayer.shared.playIfNeeded(record:audioCache:)` 호출.
//   `dismissed` / `stopped` / `snoozed` 에서는 `AlarmVoicePlayer.shared.stop()`.
//
// 본 클래스는 Phase 2-B4 가 정의만 하고, 실제 호출 주입은 B2 agent 가
// `startObserving` 의 ringing handler 에서 수행한다.

#if canImport(AVFoundation)
@MainActor
final class AlarmVoicePlayer: NSObject, AVAudioPlayerDelegate {
    static let shared = AlarmVoicePlayer()

    private static let voiceRepeatGapNanos: UInt64 = 900_000_000
    private static let voiceFadeInNanos: UInt64 = 6_000_000_000
    private static let voiceFadeSteps = 12
    private static let voiceFadeStartRatio: Float = 0.45
    private static let voiceFadeMinStartVolume: Float = 0.35

    private var player: AVAudioPlayer?
    private var activePlayerID: ObjectIdentifier?
    private var repeatTask: Task<Void, Never>?
    private var fadeTask: Task<Void, Never>?
    private var playbackGeneration = 0
    private var currentVoiceURL: URL?
    private var currentRepeatVoice = false
    private var currentVoiceVolumePercent = 100
    private var voiceHasPlayedThisRing = false
    private(set) var currentRecordID: String?

    private override init() {
        super.init()
    }

    /// playMode 가 voice/sound_then_voice 이고 캐시된 목소리가 있을 때만 재생.
    /// 이미 같은 record 가 재생 중이면 no-op. 다른 record 가 재생 중이면 교체.
    func playIfNeeded(for record: LocalAlarmRecord, audioCache: AudioCacheStore) {
        guard record.playModeEnum != .alarmOnly,
              let key = record.audioCacheKey,
              let url = audioCache.cachedURL(for: key),
              record.voiceVolumePercent > 0 else {
            return
        }

        if currentRecordID == record.id,
           player?.isPlaying == true || repeatTask != nil || voiceHasPlayedThisRing {
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            // mixWithOthers: AlarmKit 의 .default 시스템 사운드와 동시 재생을 의도.
            // duckOthers 옵션은 시스템 사운드를 죽일 수 있으므로 사용하지 않는다.
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true, options: [])

            stopPlayback(deactivateSession: false)
            currentRecordID = record.id
            currentVoiceURL = url
            currentRepeatVoice = record.voiceRepeat
            currentVoiceVolumePercent = record.voiceVolumePercent
            voiceHasPlayedThisRing = false
            startVoicePlayback(url: url)
        } catch {
            // silent: best-effort. AlarmKit 의 .default 는 별도로 울리고 있다.
            resetPlaybackState(deactivateSession: false)
        }
    }

    private func startVoicePlayback(url: URL) {
        guard let currentRecordID else { return }

        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.numberOfLoops = 0
            let shouldFadeIn = !voiceHasPlayedThisRing
            voiceHasPlayedThisRing = true
            let targetVolume = Self.voiceVolume(forPercent: currentVoiceVolumePercent)
            applyVoiceVolume(to: p, targetVolume: targetVolume, fadeIn: shouldFadeIn)
            p.prepareToPlay()
            p.play()
            playbackGeneration += 1
            player = p
            activePlayerID = ObjectIdentifier(p)
            self.currentRecordID = currentRecordID
        } catch {
            resetPlaybackState(deactivateSession: false)
        }
    }

    private func applyVoiceVolume(to player: AVAudioPlayer, targetVolume: Float, fadeIn: Bool) {
        fadeTask?.cancel()
        fadeTask = nil

        guard Self.shouldFadeInVoice(targetVolume: targetVolume, fadeIn: fadeIn) else {
            player.volume = targetVolume
            return
        }

        let startVolume = Self.voiceFadeStartVolume(targetVolume: targetVolume)
        player.volume = startVolume
        let generation = playbackGeneration + 1
        fadeTask = Task { @MainActor [weak self] in
            for index in 1...Self.voiceFadeSteps {
                try? await Task.sleep(nanoseconds: Self.voiceFadeInNanos / UInt64(Self.voiceFadeSteps))
                guard let self,
                      self.playbackGeneration == generation,
                      let player = self.player else {
                    return
                }
                let progress = Float(index) / Float(Self.voiceFadeSteps)
                player.volume = startVolume + ((targetVolume - startVolume) * progress)
            }
            if self?.playbackGeneration == generation {
                self?.fadeTask = nil
            }
        }
    }

    private func handlePlaybackFinished(playerID: ObjectIdentifier) {
        guard activePlayerID == playerID else { return }

        fadeTask?.cancel()
        fadeTask = nil
        player = nil
        activePlayerID = nil

        guard currentRepeatVoice,
              let url = currentVoiceURL,
              let recordID = currentRecordID else {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            return
        }

        let generation = playbackGeneration
        repeatTask?.cancel()
        repeatTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.voiceRepeatGapNanos)
            guard let self,
                  self.playbackGeneration == generation,
                  self.currentRecordID == recordID else {
                return
            }
            self.repeatTask = nil
            self.startVoicePlayback(url: url)
        }
    }

    /// 알람이 중지/스누즈 되었을 때 호출. 다중 호출에 안전.
    func stop() {
        stopPlayback(deactivateSession: true)
    }

    private func stopPlayback(deactivateSession: Bool) {
        repeatTask?.cancel()
        repeatTask = nil
        fadeTask?.cancel()
        fadeTask = nil
        player?.stop()
        resetPlaybackState(deactivateSession: deactivateSession)
    }

    private func resetPlaybackState(deactivateSession: Bool) {
        playbackGeneration += 1
        player = nil
        activePlayerID = nil
        currentVoiceURL = nil
        currentRepeatVoice = false
        currentVoiceVolumePercent = 100
        voiceHasPlayedThisRing = false
        currentRecordID = nil
        if deactivateSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    static func voiceVolume(forPercent percent: Int) -> Float {
        max(0.0, min(1.0, Float(percent) / 100.0))
    }

    static func shouldFadeInVoice(targetVolume: Float, fadeIn: Bool) -> Bool {
        fadeIn && targetVolume > voiceFadeMinStartVolume
    }

    static func voiceFadeStartVolume(targetVolume: Float) -> Float {
        min(max(voiceFadeMinStartVolume, targetVolume * voiceFadeStartRatio), targetVolume)
    }

    // MARK: AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor in
            // 자연 종료 — 세션을 비활성화하되 currentRecordID 는 유지하면
            // alarmUpdates handler 가 추가 stop 을 보내도 멱등하다.
            self.handlePlaybackFinished(playerID: playerID)
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.stop()
        }
    }
}
#endif
