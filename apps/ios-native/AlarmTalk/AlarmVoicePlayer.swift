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
// 음량에 대한 정직한 한계:
//   AlarmKit 이 OS 알람음(.default 시스템 알람 톤)을 소유하며, iOS 에는 알람별
//   음량을 지정하는 공개 API 가 없다. 즉 시스템 알람 톤은 항상 사용자의 *시스템
//   알람 음량* 으로 울린다. 따라서 `voiceVolumePercent`/`alarmVolumePercent` 는
//   여기 IN-APP 폴백 재생(AVAudioPlayer)의 게인에만 적용되며, OS 알람 톤에는
//   영향을 주지 못한다. (Android 는 자체적으로 ringing 을 소유하므로 이 두 값을
//   실제 알람음에 적용하지만, iOS 는 그 동등성을 가질 수 없다.)
//   `alarmVolumePercent == 0` 이면 in-app 폴백 재생 자체를 건너뛴다.
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

    /// 최후 폴백 다운로드의 짧은 타임아웃 (초). 알람이 울리는 동안만 의미가
    /// 있으므로 길게 기다리지 않는다. `downloadVoice` 가 nonisolated 라 명시적
    /// nonisolated 로 표기.
    private nonisolated static let fallbackDownloadTimeoutSeconds: TimeInterval = 8

    private var player: AVAudioPlayer?
    private var activePlayerID: ObjectIdentifier?
    private var repeatTask: Task<Void, Never>?
    private var fadeTask: Task<Void, Never>?
    private var fallbackTask: Task<Void, Never>?
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
    ///
    /// 캐시가 비어 있더라도 record.rawAudioUri 를 알고 있으면 짧은 타임아웃으로
    /// 원본 오디오를 받아 같은 cacheKey 로 저장한 뒤 재생하는 최후 폴백을 탄다.
    /// 그것도 불가하면 기존 동작(무음, AlarmKit .default 만 울림)을 유지한다.
    ///
    /// 음량: 이 재생은 in-app 폴백이므로 AVAudioPlayer.volume 으로
    /// `voiceVolumePercent` 와 `alarmVolumePercent` 를 곱한 게인을 적용한다.
    /// `alarmVolumePercent == 0` ("무음") 이면 in-app 폴백 재생 자체를 건너뛴다.
    /// (OS 알람 톤은 AlarmKit 이 시스템 알람 음량으로 별도 재생하며 여기서 제어
    /// 불가.)
    func playIfNeeded(for record: LocalAlarmRecord, audioCache: AudioCacheStore) {
        guard record.playModeEnum != .alarmOnly,
              let key = record.audioCacheKey,
              record.voiceVolumePercent > 0,
              record.alarmVolumePercent > 0 else {
            return
        }

        if let url = audioCache.cachedURL(for: key) {
            beginPlayback(for: record, url: url)
            return
        }
        startLastResortFallback(for: record, cacheKey: key, audioCache: audioCache)
    }

    /// 캐시 미존재 + rawAudioUri 보유 시의 최후 폴백. 다운로드가 끝나기 전에
    /// `stop()` 이 호출되면 (알람 dismiss/snooze) 재생하지 않는다.
    private func startLastResortFallback(
        for record: LocalAlarmRecord,
        cacheKey: String,
        audioCache: AudioCacheStore
    ) {
        guard fallbackTask == nil else { return }
        guard let raw = record.rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let remoteURL = URL(string: raw),
              remoteURL.scheme == "https" || remoteURL.scheme == "http" else {
            return
        }
        fallbackTask = Task { @MainActor [weak self] in
            defer { self?.fallbackTask = nil }
            guard let payload = await Self.downloadVoice(from: remoteURL) else { return }
            guard let self, !Task.isCancelled else { return }
            guard let url = try? audioCache.cacheBytes(
                payload.data,
                cacheKey: cacheKey,
                mimeType: payload.mimeType,
                source: "raw_audio",
                messageId: record.ttsMessageId,
                rawAudioUri: raw,
                durationOverrideMs: nil,
                enforceMaxDuration: false
            ) else {
                return
            }
            self.beginPlayback(for: record, url: url)
        }
    }

    /// 짧은 타임아웃으로 원본 음원 다운로드. 실패 시 nil (best-effort).
    private nonisolated static func downloadVoice(
        from remoteURL: URL
    ) async -> (data: Data, mimeType: String)? {
        var request = URLRequest(url: remoteURL)
        request.timeoutInterval = fallbackDownloadTimeoutSeconds
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  !data.isEmpty else {
                return nil
            }
            let responseMime = http.mimeType?.lowercased()
            if let responseMime, responseMime.hasPrefix("audio/") {
                return (data, responseMime)
            }
            let format = AudioCacheStore.normalizedFormat(remoteURL.pathExtension)
            return (data, AudioCacheStore.mimeType(forFormat: format))
        } catch {
            return nil
        }
    }

    private func beginPlayback(for record: LocalAlarmRecord, url: URL) {
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
            // in-app 폴백 게인: voice 음량 × 알람 음량 (둘 다 OS 톤이 아닌 우리
            // AVAudioPlayer 재생에만 적용되는 상대 게인). 호출자가 이미 두 값이
            // 모두 0 보다 큼을 보장한다.
            currentVoiceVolumePercent = Self.combinedVolumePercent(
                voicePercent: record.voiceVolumePercent,
                alarmPercent: record.alarmVolumePercent
            )
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

        let plan = Self.voiceVolumeRampPlan(targetVolume: targetVolume, fadeIn: fadeIn)
        player.volume = plan.startVolume
        guard !plan.stepVolumes.isEmpty else {
            return
        }

        let generation = playbackGeneration + 1
        fadeTask = Task { @MainActor [weak self] in
            for volume in plan.stepVolumes {
                try? await Task.sleep(nanoseconds: Self.voiceFadeInNanos / UInt64(Self.voiceFadeSteps))
                guard let self,
                      self.playbackGeneration == generation,
                      let player = self.player else {
                    return
                }
                player.volume = volume
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
        // 진행 중인 최후 폴백 다운로드도 함께 무효화한다 — 알람이 이미 멈춘 뒤
        // 뒤늦게 목소리가 재생되는 것을 막는다. (폴백 task 내부에서 재생 직전
        // 본 메서드가 호출되는 self-cancel 은 cooperative 라 재생에 영향 없음.)
        fallbackTask?.cancel()
        fallbackTask = nil
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

    /// voice 음량(%)과 알람 음량(%)을 곱해 in-app 폴백 재생의 실효 게인(%)을
    /// 구한다. 두 값 모두 OS 알람 톤이 아닌 우리 AVAudioPlayer 재생에만 적용되는
    /// 상대값이다. 결과는 0...100 으로 클램프.
    static func combinedVolumePercent(voicePercent: Int, alarmPercent: Int) -> Int {
        let voice = max(0, min(100, voicePercent))
        let alarm = max(0, min(100, alarmPercent))
        return Int((Double(voice) * Double(alarm) / 100.0).rounded())
    }

    static let voiceFadeInNanos: UInt64 = 6_000_000_000
    static let voiceFadeSteps = 12

    static func voiceVolumeRampPlan(targetVolume: Float, fadeIn: Bool) -> VoiceVolumeRampPlan {
        let target = max(0.0, min(1.0, targetVolume))
        guard fadeIn, target > 0 else {
            return VoiceVolumeRampPlan(startVolume: target, stepVolumes: [])
        }

        let start = min(max(VoiceVolumeRampPlan.minimumStartVolume, target * VoiceVolumeRampPlan.startRatio), target)
        guard start < target else {
            return VoiceVolumeRampPlan(startVolume: target, stepVolumes: [])
        }

        let stepVolumes = (1...voiceFadeSteps).map { step in
            let progress = Float(step) / Float(voiceFadeSteps)
            return start + ((target - start) * progress)
        }
        return VoiceVolumeRampPlan(startVolume: start, stepVolumes: stepVolumes)
    }

    static func voiceFadeStartVolume(targetVolume: Float) -> Float {
        voiceVolumeRampPlan(targetVolume: targetVolume, fadeIn: true).startVolume
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

struct VoiceVolumeRampPlan: Equatable {
    static let startRatio: Float = 0.15
    static let minimumStartVolume: Float = 0.10

    let startVolume: Float
    let stepVolumes: [Float]
}
#endif
