import AVFoundation
import Foundation

@MainActor
final class VoiceRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var elapsedSeconds: TimeInterval = 0
    @Published private(set) var latestRecordingURL: URL?
    @Published private(set) var latestDurationMs: Int?
    /// Live waveform levels for the recording UI. Matches Android: 18 bars, idle baseline 0.08.
    @Published private(set) var recordingLevels: [Float] = VoiceRecorder.idleLevels

    /// Bar count + idle level mirror Android's recording waveform (List(18) { 0.08f }).
    private static let barCount = 18
    private static let idleLevel: Float = 0.08
    /// Live levels clamp to the same floor as Android (coerceIn(0.06f, 1f)).
    private static let minLevel: Float = 0.06
    private static let idleLevels = [Float](repeating: idleLevel, count: barCount)

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
        recorder.isMeteringEnabled = true
        recorder.record()

        self.recorder = recorder
        latestRecordingURL = url
        latestDurationMs = nil
        elapsedSeconds = 0
        recordingLevels = VoiceRecorder.idleLevels
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
        recordingLevels = VoiceRecorder.idleLevels
        if let startedAt {
            latestDurationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
        }
        self.startedAt = nil
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
        recordingLevels = VoiceRecorder.idleLevels
    }

    private func startTimer() {
        timer?.invalidate()
        // 250ms cadence matches Android's recording loop (delay(250)).
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let startedAt = self.startedAt else { return }
                self.elapsedSeconds = Date().timeIntervalSince(startedAt)
                self.sampleLevel()
            }
        }
    }

    /// Polls the recorder's metering and appends a normalized level to the sliding
    /// 18-bar window, mirroring Android (recordingLevels.drop(1) + level, clamped 0.06...1).
    private func sampleLevel() {
        guard let recorder else { return }
        recorder.updateMeters()
        // averagePower is in dBFS (~ -160 silence ... 0 max). Map to a 0...1 linear level.
        let power = recorder.averagePower(forChannel: 0)
        let normalized = pow(10, power / 20)
        let level = min(max(normalized, VoiceRecorder.minLevel), 1)
        var next = recordingLevels
        next.removeFirst()
        next.append(level)
        recordingLevels = next
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
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
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
