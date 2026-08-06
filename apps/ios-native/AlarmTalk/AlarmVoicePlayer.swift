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

    private var player: AVAudioPlayer?
    private var activePlayerID: ObjectIdentifier?
    private var repeatTask: Task<Void, Never>?
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
    /// 음량: 이 재생은 in-app 폴백이므로 `voiceVolumePercent` 만 게인으로 적용한다.
    ///
    /// ⚠ **`alarmVolumePercent` 를 곱하지 않는다(2026-08-06 변경).** 예전에는 두 값을 곱했는데
    /// 방향이 반대였다 — 이 경로에서는 AlarmKit 이 OS 톤을 `.default` 로 **함께** 울리고
    /// 우리는 `.mixWithOthers` 로 겹쳐 재생한다. 알람 음량을 낮추면 **줄일 수 없는 톤은
    /// 그대로인 채 목소리만 묻힌다** — 사용자 의도와 정반대다. 안드로이드도 두 값을 곱하지
    /// 않으므로(RingingService 는 톤/목소리 플레이어가 분리돼 있다) 의미도 그쪽에 맞춘다:
    /// **목소리 슬라이더 = 목소리 게인.**
    ///
    /// ⚠ **`alarmVolumePercent == 0` 으로 목소리를 막지 않는다.** 그 토글의 라벨은 '알람음'
    /// 인데 실제로는 목소리를 껐다 — 알람음만 끄고 목소리로 깨려던 사용자가 정확히 반대
    /// 결과(톤은 그대로, 목소리만 사라짐)를 얻었다.
    func playIfNeeded(for record: LocalAlarmRecord, audioCache: AudioCacheStore) {
        guard record.playModeEnum != .alarmOnly,
              let key = record.audioCacheKey,
              record.voiceVolumePercent > 0 else {
            return
        }

        if let url = audioCache.cachedURL(for: key) {
            beginPlayback(for: record, url: url)
            return
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
            // in-app 폴백 게인 = **목소리 음량만**. 알람 음량을 곱하지 않는 이유는
            // playIfNeeded 주석 참조(톤을 못 줄이는 경로에서 목소리만 줄이면 대비가 반대로 벌어진다).
            currentVoiceVolumePercent = max(0, min(100, record.voiceVolumePercent))
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
            // ⚠ 이 플래그는 **페이드가 아니라 재진입 가드**다(beginPlayback 의 조기 return).
            // 램프를 지우면서 함께 지우지 말 것 — 지우면 앱을 다시 열 때마다 같은 회차의
            // 목소리가 처음부터 다시 재생된다.
            voiceHasPlayedThisRing = true
            // 게인은 **첫 샘플부터 target**. 램프 없음 — play() 전에 확정하므로 진폭 점프도 없다.
            p.volume = Self.voiceVolume(forPercent: currentVoiceVolumePercent)
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

    private func handlePlaybackFinished(playerID: ObjectIdentifier) {
        guard activePlayerID == playerID else { return }

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
