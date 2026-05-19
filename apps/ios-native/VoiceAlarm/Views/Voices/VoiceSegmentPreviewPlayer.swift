import AVFoundation
import Combine
import SwiftUI

/// 단일 오디오 파일의 임의 구간 (startMs ~ endMs) 을 반복 재생하는 미니 플레이어.
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

    @StateObject private var controller = SegmentPlayerController()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    if controller.isPlaying {
                        controller.stop()
                    } else {
                        controller.play(url: audioURL, startMs: startMs, endMs: endMs)
                    }
                } label: {
                    Image(systemName: controller.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(VoiceAlarmTheme.primary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption).foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                }
                Spacer()
                Text(timeLabel)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            ProgressView(value: controller.progress)
                .tint(VoiceAlarmTheme.primary)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
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

/// 내부 컨트롤러 — 시작/종료 ms 기반으로 AVAudioPlayer 를 구동.
@MainActor
final class SegmentPlayerController: ObservableObject {
    @Published var isPlaying: Bool = false
    @Published var elapsedSec: Double = 0
    @Published var progress: Double = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var startedAt: Date?
    private var startMs: Int = 0
    private var endMs: Int = 0

    func play(url: URL, startMs: Int, endMs: Int) {
        stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            let p = try AVAudioPlayer(contentsOf: url)
            p.prepareToPlay()
            p.currentTime = Double(startMs) / 1000.0
            p.play()
            self.player = p
            self.startMs = startMs
            self.endMs = endMs
            self.startedAt = Date()
            self.isPlaying = true
            startTicker()
        } catch {
            stop()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player?.stop()
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
        let elapsed = Date().timeIntervalSince(startedAt)
        elapsedSec = elapsed
        let totalSec = Double(max(1, endMs - startMs)) / 1000.0
        progress = min(1.0, elapsed / totalSec)
        // 종료 시각에 도달하면 정지.
        if let player, player.currentTime >= Double(endMs) / 1000.0 {
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
