import AVFoundation
import Combine
import SwiftUI

/// 단일 오디오/영상 파일의 임의 구간 (startMs ~ endMs) 을 재생하는 **폭을 채운 외곽선 버튼**.
///
/// 안드로이드 `ui/components/VoiceInputControls.kt` 의 `AudioCropRangeSelector` 맨 아래 `OutlinedButton` 과 같은 모양이다 —
/// 재생·정지 글리프 + '미리듣기'/'정지', 모서리 18, 카드 테두리색, 글자 onSurface. 예전에는 큰 재생 아이콘·제목·시간·진행
/// 막대를 가진 미니 플레이어였다(2026-11-22 두 앱 통일). 구간 시각은 자르기 막대 위·아래 글자가 이미 말한다.
/// VoiceCloneUploadFlow 가 사용한다.
struct VoiceSegmentPreviewPlayer: View {
    let audioURL: URL
    let startMs: Int
    let endMs: Int
    var onError: ((String) -> Void)? = nil

    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @StateObject private var controller = SegmentPlayerController()
    @State private var localError: String?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        // 고른 구간이 없으면 누를 수 없다(안드로이드 `enabled = selectedDuration > 0`). 잠겨도 글자는 한 단계만 낮춘다.
        let enabled = isEnabled && endMs > startMs
        VStack(alignment: .leading, spacing: 6) {
            Button {
                if controller.isPlaying {
                    controller.stop()
                } else {
                    let errorMessage = String(localized: "미리듣기를 재생하지 못했어요.")
                    if controller.play(url: audioURL, startMs: startMs, endMs: endMs) {
                        localError = nil
                    } else {
                        localError = errorMessage
                        onError?(errorMessage)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    // ⚠ **정지(stop)에 일시정지(pause) 아이콘·글자를 쓰지 말 것.** 이 버튼은 누르면 `controller.stop()` 이라
                    // 다시 누르면 **처음부터** 재생된다 — ⏸·'일시정지' 는 '이어 듣기' 를 약속하는 셈이다.
                    Image(systemName: controller.isPlaying ? "stop.fill" : "play.fill")
                    Text(controller.isPlaying ? String(localized: "정지") : String(localized: "미리듣기"))
                }
                .font(theme.typography.labelLarge)
                .foregroundStyle(enabled ? theme.palette.onSurface : theme.palette.onSurfaceVariant)
                .padding(.horizontal, 24)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 40)
                .overlay(shape.stroke(theme.palette.cardBorder, lineWidth: 1))
                .contentShape(shape)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            // 실패는 부르는 쪽이 자기 자리에 그린다(`onError`). 받을 곳이 없을 때만 여기 둔다.
            if onError == nil, let localError {
                Text(localError)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
            }
        }
        .onDisappear { controller.stop() }
    }
}

/// 내부 컨트롤러 — 시작/종료 ms 기반으로 AVPlayer 를 구동.
@MainActor
final class SegmentPlayerController: ObservableObject {
    @Published var isPlaying: Bool = false
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
        let totalSec = Double(max(1, endMs - startMs)) / 1000.0
        progress = min(1.0, elapsed / totalSec)
        // 종료 시각에 도달하면 정지.
        if let currentSeconds, currentSeconds >= segmentEndSec {
            stop()
        }
        if progress >= 1.0 { stop() }
    }
}
