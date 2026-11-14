import AVFoundation
import Foundation
import UIKit

@MainActor
final class VoiceRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var elapsedSeconds: TimeInterval = 0
    @Published private(set) var latestRecordingURL: URL?
    @Published private(set) var latestDurationMs: Int?
    /// 마지막 녹음이 어떻게 끝났는가 — 끼어들어 멈춘 녹음도 **남기고**(녹음 복구) 이 값으로 알린다. 등록 창이 품질 판정과
    /// 함께 읽는다(`RecordingReview.decide`, 스펙 voice-and-message §4-1 「녹음 품질 판정」). 녹음 중·녹음 전에는 nil.
    @Published private(set) var lastStopReason: RecordingStopReason?
    // ⚠ **`recordingLevels`(18칸 파형)를 되살리지 말 것**(2026-08-07 삭제).
    // 발행만 하고 **읽는 화면이 하나도 없었다** — 0.25초마다 배열을 새로 만들어 발행하니
    // 녹음 중 편집기 전체가 그만큼 다시 그려졌다. 안드로이드도 2026-07-07 개편에서
    // 18칸 파형을 없앴다. 레벨 표시가 다시 필요해지면 **그 화면 안에서** 관측하게 만들 것 —
    // 편집기 전체가 관측하는 자리에 두면 같은 일이 반복된다.

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt: Date?
    /// 녹음 동안만 거는 관찰자(중단·입력 장치 변경·백그라운드·미디어 서비스 재시작).
    private var sessionObservers: [NSObjectProtocol] = []
    /// 녹음기가 실패를 알렸다(인코딩 오류 — 대리자). 멈출 때 `.failed` 로 읽는다.
    private var recorderReportedFailure = false

    func start() async throws {
        guard !isRecording else { return }
        let granted = await requestMicrophonePermission()
        guard granted else {
            throw VoiceRecorderError.microphoneDenied
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
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
        lastStopReason = nil
        recorderReportedFailure = false
        elapsedSeconds = 0
        startedAt = Date()
        isRecording = true
        startTimer()
        observeSession()
    }

    /// 사용자가 멈추거나 상한에 닿았다.
    func stop() {
        stop(reason: .finished)
    }

    /// 녹음을 끝낸다 — 그때까지의 파일은 남긴다. 사정은 `lastStopReason` 으로 알린다.
    private func stop(reason: RecordingStopReason) {
        guard isRecording else { return }
        recorder?.stop()
        removeSessionObservers()
        timer?.invalidate()
        timer = nil
        lastStopReason = recorderReportedFailure ? .failed : reason
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
        lastStopReason = nil
        elapsedSeconds = 0
    }

    // MARK: - 녹음 중 끼어드는 것들

    /// 전화·Siri·다른 앱의 오디오 세션, 블루투스 이어폰을 끼고 빼는 것, 백그라운드 진입, 미디어 서비스 재시작에서
    /// 녹음을 **안전하게 끝낸다**(파일을 닫아 그때까지를 남긴다). 그대로 두면 끊긴 채 이어 붙거나(중단 뒤 재개), 녹음
    /// 도중 마이크가 바뀌어 한 녹음 안에서 음색이 갈린다(블루투스 HFP 는 8~16 kHz 다). 이 앱은 백그라운드 오디오 모드가
    /// 있어 백그라운드에서도 마이크가 계속 열려 있었다.
    ///
    /// ⚠ 관찰 클로저는 `@Sendable` 이고 알림 객체는 넘기지 않는다 — 필요한 값만 꺼내 `Task { @MainActor in }` 로 넘긴다
    /// (CLAUDE.md 「시스템이 큐를 정하는 콜백에 메인 액터 클로저를 넘기지 않는다」).
    private func observeSession() {
        removeSessionObservers()
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        sessionObservers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main
        ) { @Sendable [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor in self?.stop(reason: .interrupted) }
        })
        sessionObservers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
        ) { @Sendable [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard let raw, Self.routeChangeEndsRecording(rawReason: raw) else { return }
            Task { @MainActor in self?.stop(reason: .routeChanged) }
        })
        sessionObservers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { @Sendable [weak self] _ in
            Task { @MainActor in self?.stop(reason: .backgrounded) }
        })
        sessionObservers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main
        ) { @Sendable [weak self] _ in
            Task { @MainActor in self?.stop(reason: .failed) }
        })
    }

    private func removeSessionObservers() {
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        sessionObservers.removeAll()
    }

    /// 입력 장치가 실제로 바뀐 경우만 녹음을 끝낸다 — 블루투스·유선 이어폰을 꼈거나(`newDeviceAvailable`) 뺐다
    /// (`oldDeviceUnavailable`). 녹음을 시작하며 범주를 바꿀 때 오는 변경(`categoryChange`·`override`)은 끝내지 않는다.
    nonisolated static func routeChangeEndsRecording(rawReason: UInt) -> Bool {
        guard let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason) else { return false }
        return reason == .newDeviceAvailable || reason == .oldDeviceUnavailable
    }

    // MARK: - AVAudioRecorderDelegate

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in self.markRecorderFailure() }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        guard !flag else { return }
        Task { @MainActor in self.markRecorderFailure() }
    }

    /// 실패 알림은 멈춘 **뒤에** 올 수도 있다(`stop()` 이 파일을 닫으며 알린다) — 그때는 이미 적은 사정을 고친다.
    private func markRecorderFailure() {
        recorderReportedFailure = true
        if !isRecording, lastStopReason != nil { lastStopReason = .failed }
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
                // Android `VoiceProfileManagementPanel` 의 녹음 루프(`LaunchedEffect(isRecording)`) 하드 캡 미러 —
                // 2분(MAX_DURATION) 도달 시 녹음을 자동 정지한다. 사용자가 멈추지 않아
                // 2분을 넘기면 업로드 단계에서 거부되던 문제를 사전 차단한다.
                if elapsed * 1000 >= Double(VoiceProfileLimits.maxDurationMs) {
                    self.stop()
                }
            }
        }
    }


    /// 마이크 권한.
    ///
    /// ⚠ **`AVAudioSession.requestRecordPermission` 로 되돌리지 말 것.** iOS 17 에서
    /// 폐기됐고 이 앱의 최소 버전은 26 이다 — 대체는 `AVAudioApplication` 이다.
    /// (2026-08-16 "허용했더니 앱이 꺼졌다" 를 조사하며 정리했다. 시뮬레이터에서는
    /// 재현되지 않아 이것이 원인이라고 단정하지는 못한다 — 다만 크래시 경로에서 폐기된
    /// API 를 걷어내고, 실패하면 조용히 죽지 않고 오류로 올라오게 두는 쪽이 맞다.)
    private func requestMicrophonePermission() async -> Bool {
        if AVAudioApplication.shared.recordPermission == .granted { return true }
        return await AVAudioApplication.requestRecordPermission()
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
            return String(localized: "녹음하려면 마이크 권한이 필요해요.")
        }
    }
}
