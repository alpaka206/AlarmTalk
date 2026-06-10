import AVFoundation
import Combine
import SwiftUI

/// 단일 오디오/영상 파일의 임의 구간 (startMs ~ endMs) 을 재생하는 미니 플레이어.
///
/// Android `MainViewModelVoiceActions.playSpeakerPreview` + `VoiceProfileManagementPanel`
/// 의 `SpeakerCandidateRow` 가 결합돼 있던 기능을 SwiftUI 컴포넌트로 분리한 것.
/// SpeakerSeparationFlow / VoiceCloneUploadFlow 가 공통으로 사용한다.
struct VoiceSegmentPreviewPlayer: View {
    let title: String
    let subtitle: String?
    let audioURL: URL
    let startMs: Int
    let endMs: Int
    var onError: ((String) -> Void)? = nil

    @StateObject private var controller = SegmentPlayerController()
    @State private var localError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    if controller.isPlaying {
                        controller.stop()
                    } else {
                        let errorMessage = "미리듣기를 재생하지 못했어요."
                        if controller.play(url: audioURL, startMs: startMs, endMs: endMs) {
                            localError = nil
                        } else {
                            localError = errorMessage
                            onError?(errorMessage)
                        }
                    }
                } label: {
                    Image(systemName: controller.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(AlarmTalkTheme.primary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption).foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                }
                Spacer()
                Text(timeLabel)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            ProgressView(value: controller.progress)
                .tint(AlarmTalkTheme.primary)
            if let localError {
                Text(localError)
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.error)
            }
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onDisappear { controller.stop() }
    }

    private var timeLabel: String {
        let total = max(0, endMs - startMs) / 1000
        let played = Int(controller.elapsedSec)
        return String(format: "%d:%02d / %d:%02d",
                      played / 60, played % 60,
                      total / 60, total % 60)
    }
}

/// 내부 컨트롤러 — 시작/종료 ms 기반으로 AVPlayer 를 구동.
@MainActor
final class SegmentPlayerController: ObservableObject {
    @Published var isPlaying: Bool = false
    @Published var elapsedSec: Double = 0
    @Published var progress: Double = 0

    private var player: AVPlayer?
    private var timer: Timer?
    private var startedAt: Date?
    private var startMs: Int = 0
    private var endMs: Int = 0

    @discardableResult
    func play(url: URL, startMs: Int, endMs: Int) -> Bool {
        stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            let item = AVPlayerItem(url: url)
            let p = AVPlayer(playerItem: item)
            p.actionAtItemEnd = .pause
            p.seek(
                to: CMTime(value: CMTimeValue(max(0, startMs)), timescale: 1_000),
                toleranceBefore: .zero,
                toleranceAfter: .zero
            )
            p.play()
            self.player = p
            self.startMs = startMs
            self.endMs = endMs
            self.startedAt = Date()
            self.isPlaying = true
            startTicker()
            return true
        } catch {
            stop()
            return false
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        isPlaying = false
        elapsedSec = 0
        progress = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func startTicker() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard isPlaying, let startedAt else { return }
        let segmentStartSec = Double(startMs) / 1000.0
        let segmentEndSec = Double(endMs) / 1000.0
        let currentSeconds: Double? = {
            guard let player else { return nil }
            let value = CMTimeGetSeconds(player.currentTime())
            return value.isFinite ? value : nil
        }()
        let fallbackCurrent = segmentStartSec + Date().timeIntervalSince(startedAt)
        let elapsed = max(0, (currentSeconds ?? fallbackCurrent) - segmentStartSec)
        elapsedSec = elapsed
        let totalSec = Double(max(1, endMs - startMs)) / 1000.0
        progress = min(1.0, elapsed / totalSec)
        // 종료 시각에 도달하면 정지.
        if let currentSeconds, currentSeconds >= segmentEndSec {
            stop()
        }
        if progress >= 1.0 { stop() }
    }
}

#if DEBUG
#Preview("Segment player") {
    if let url = Bundle.main.url(forResource: "preview", withExtension: "m4a") {
        VoiceSegmentPreviewPlayer(
            title: "목소리 1",
            subtitle: "0:00 – 0:20 · 미리듣기",
            audioURL: url,
            startMs: 0,
            endMs: 20_000
        )
        .padding()
    } else {
        Text("Preview audio missing")
    }
}
#endif
