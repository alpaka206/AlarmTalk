import AVFoundation
import Foundation

@MainActor
final class AudioPreviewPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isPlaying = false
    /// 네트워크 미리듣기(스톡/공유 음성)가 음원을 받아오는 동안 true. 다운로드/생성이
    /// 진행되는 구간에 스피너를 띄우고, 실제 재생이 시작되거나 실패하면 false 로 내린다.
    /// Android `previewPreparing` (AlarmEditorScreen.kt:182) 미러.
    @Published private(set) var isPreparing = false

    var onFinish: (() -> Void)?

    private var player: AVAudioPlayer?
    /// stopAfterMs 윈도우를 위한 예약 정지 작업. AVAudioPlayer 는 종료 시각 지정을
    /// 지원하지 않으므로 Android `scheduleAutoStop` 처럼 타이머로 정지를 흉내낸다.
    /// stop()/재생 종료 시 반드시 취소해 다음 미리듣기를 끊지 않도록 한다.
    /// Swift 6 엄격 동시성: @Sendable DispatchWorkItem 에서 @MainActor stop() 을 직접
    /// 호출하면 데이터 레이스 오류가 나므로 @MainActor Task 로 정지를 예약한다.
    private var autoStopTask: Task<Void, Never>?

    /// 네트워크 미리듣기 호출자가 다운로드 시작 직전에 스피너를 켜고, 재생/실패 시 끄기
    /// 위해 노출한다. play(...) 가 호출되면 자동으로 false 로 내려간다.
    func setPreparing(_ preparing: Bool) {
        isPreparing = preparing
    }

    func play(url: URL) throws {
        try play(url: url, startMs: 0, stopAfterMs: nil)
    }

    /// 크롭 윈도우 미리듣기. `startMs` 로 시작 위치를 맞추고, `stopAfterMs` 가 주어지면
    /// 그 길이만큼 재생 후 자동 정지한다(알람 구간만 들려주기 위함).
    /// Android `startPreparedPreview(startMillis, stopAfterMillis)` 미러.
    func play(url: URL, startMs: Int, stopAfterMs: Int?) throws {
        stop()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        let player = try AVAudioPlayer(contentsOf: url)
        player.delegate = self
        player.prepareToPlay()
        if startMs > 0 {
            player.currentTime = Double(startMs) / 1000.0
        }
        player.play()
        self.player = player
        isPreparing = false
        isPlaying = true
        scheduleAutoStop(after: stopAfterMs)
    }

    func stop() {
        cancelAutoStop()
        player?.stop()
        player = nil
        isPlaying = false
        isPreparing = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func scheduleAutoStop(after stopAfterMs: Int?) {
        cancelAutoStop()
        guard let stopAfterMs, stopAfterMs > 0 else { return }
        autoStopTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(stopAfterMs) * 1_000_000)
            guard !Task.isCancelled else { return }
            self?.stop()
        }
    }

    private func cancelAutoStop() {
        autoStopTask?.cancel()
        autoStopTask = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.cancelAutoStop()
            self.isPlaying = false
            self.isPreparing = false
            self.player = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            self.onFinish?()
        }
    }
}
