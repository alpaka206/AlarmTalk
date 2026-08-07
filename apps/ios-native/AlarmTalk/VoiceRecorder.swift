import AVFoundation
import Foundation

@MainActor
final class VoiceRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var elapsedSeconds: TimeInterval = 0
    @Published private(set) var latestRecordingURL: URL?
    @Published private(set) var latestDurationMs: Int?
    // ⚠ **`recordingLevels`(18칸 파형)를 되살리지 말 것**(2026-08-07 삭제).
    // 발행만 하고 **읽는 화면이 하나도 없었다** — 0.25초마다 배열을 새로 만들어 발행하니
    // 녹음 중 편집기 전체가 그만큼 다시 그려졌다. 안드로이드도 2026-07-07 개편에서
    // 18칸 파형을 없앴다. 레벨 표시가 다시 필요해지면 **그 화면 안에서** 관측하게 만들 것 —
    // 편집기 전체가 관측하는 자리에 두면 같은 일이 반복된다.

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt: Date?

    func start() async throws {
        guard !isRecording else { return }
        let granted = await requestMicrophonePermission()
        guard granted else {
            throw VoiceRecorderError.microphoneDenied
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        let url = try nextRecordingURL()
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        // 계측(레벨 미터)은 쓰지 않는다 — 읽던 파형 발행자를 없앴다(위 주석).
        // 켜 두면 매 버퍼마다 파워를 계산해 두고 아무도 읽지 않는다.
        recorder.isMeteringEnabled = false
        recorder.record()

        self.recorder = recorder
        latestRecordingURL = url
        latestDurationMs = nil
        elapsedSeconds = 0
        startedAt = Date()
        isRecording = true
        startTimer()
    }

    func stop() {
        guard isRecording else { return }
        recorder?.stop()
        timer?.invalidate()
        timer = nil
        isRecording = false
        if let startedAt {
            latestDurationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
        }
        self.startedAt = nil
        // 디렉터리 상속과 별개로, 완성된 녹음 파일에 가장 강한 보호 등급을 명시 적용한다.
        if let url = latestRecordingURL {
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: url.path
            )
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    func clearLatest() {
        if isRecording {
            stop()
        }
        if let latestRecordingURL {
            try? FileManager.default.removeItem(at: latestRecordingURL)
        }
        latestRecordingURL = nil
        latestDurationMs = nil
        elapsedSeconds = 0
    }

    private func startTimer() {
        timer?.invalidate()
        // 250ms cadence matches Android's recording loop (delay(250)).
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let startedAt = self.startedAt else { return }
                // ⚠ **초가 바뀔 때만 발행한다.** 화면에 나오는 건 "0:05" 처럼 초 단위인데
                // 0.25초마다 발행하면 같은 글자를 그리려고 편집기가 네 배로 다시 그려진다.
                // (2분 상한 판정은 아래에서 실제 경과 시간으로 따로 본다.)
                let elapsed = Date().timeIntervalSince(startedAt)
                if Int(elapsed) != Int(self.elapsedSeconds) {
                    self.elapsedSeconds = elapsed
                }
                // Android `VoiceProfileManagementPanel.kt:599-601` 의 하드 캡 미러 —
                // 2분(MAX_DURATION) 도달 시 녹음을 자동 정지한다. 사용자가 멈추지 않아
                // 2분을 넘기면 업로드 단계에서 거부되던 문제를 사전 차단한다.
                if elapsed * 1000 >= Double(VoiceProfileLimits.maxDurationMs) {
                    self.stop()
                }
            }
        }
    }


    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func nextRecordingURL() throws -> URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("VoiceRecordings", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                // 디렉터리 단위로 가장 강한 보호 등급을 건다. AVAudioRecorder 가 만드는
                // 파일이 이 속성을 상속해, 기기가 잠긴 동안에는 디스크에서 복호화되지
                // 않는다. raw 음성 클론 SOURCE 녹음은 업로드 후 즉시 삭제되며, 잠금
                // 화면에서 재생될 필요가 없으므로 .complete 가 안전하다.
                attributes: [.protectionKey: FileProtectionType.complete]
            )
        }
        return directory.appendingPathComponent("voice-sample-\(UUID().uuidString).m4a")
    }
}

enum VoiceRecorderError: LocalizedError {
    case microphoneDenied

    var errorDescription: String? {
        switch self {
        case .microphoneDenied:
            return "녹음하려면 마이크 권한이 필요해요."
        }
    }
}
