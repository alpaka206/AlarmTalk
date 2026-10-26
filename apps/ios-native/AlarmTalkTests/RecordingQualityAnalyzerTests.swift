import AVFoundation
import XCTest
@testable import AlarmTalk

/// 기본 신호 검사의 판정을 고정한다(스펙 voice-and-message §4-1 「녹음 품질 판정」). 안드로이드 짝은
/// `app/src/test/java/com/alarmtalk/app/data/RecordingQualityAnalyzerTest.kt` — 같은 합성 신호·같은 답이어야 한다.
final class RecordingQualityAnalyzerTests: XCTestCase {
    private let rate = RecordingQualityThresholds.analysisSampleRate
    private let minimum = 12_000

    /// 결정적인 잡음(시드 고정 LCG) 위에, 말하는 구간(1초 말하고 `pauseMillis` 쉰다)에 톤을 얹는다.
    private func recording(
        seconds: Int,
        speechDbfs: Double?,
        noiseDbfs: Double = -65,
        pauseMillis: Int = 250,
        clipEverySpeechSample: Bool = false
    ) -> [Float] {
        var state: UInt64 = 7
        func nextUniform() -> Double {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Double(state >> 11) / Double(1 << 53)
        }
        let noiseAmplitude = pow(10, noiseDbfs / 20) * 1.732
        let speechAmplitude = speechDbfs.map { pow(10, $0 / 20) * 1.4142 }
        let cycle = (1_000 + pauseMillis) * rate / 1000
        return (0..<(seconds * rate)).map { index in
            let noise = (nextUniform() * 2 - 1) * noiseAmplitude
            let inSpeech = speechAmplitude != nil && index % cycle < rate
            let tone = inSpeech ? speechAmplitude! * sin(2 * Double.pi * 220 * Double(index) / Double(rate)) : 0
            let value = inSpeech && clipEverySpeechSample ? min(max(tone, -0.99), 0.99) * 3 : tone + noise
            return Float(min(max(value, -1), 1))
        }
    }

    func test_normalSpeechPasses() throws {
        let verdict = RecordingQualityAnalyzer.analyze(samples: recording(seconds: 20, speechDbfs: -22), minDurationMillis: minimum)
        guard case .passed(let metrics) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertEqual(metrics.method, .basicSignal)
        XCTAssertTrue((15_000...16_500).contains(metrics.speechMillis), "\(metrics.speechMillis)")
    }

    func test_quietVoiceIsAdvisedNotRejected() {
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: recording(seconds: 20, speechDbfs: -47, noiseDbfs: -72),
            minDurationMillis: minimum
        )
        guard case .advisory(let advisories, let metrics) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertEqual(advisories, [.quiet])
        XCTAssertGreaterThan(metrics.speechMillis, RecordingQualityThresholds.littleSpeechMillis)
    }

    func test_steadyNoiseWithoutSpeechIsLittleSpeechAdvisory() {
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: recording(seconds: 15, speechDbfs: nil, noiseDbfs: -35),
            minDurationMillis: minimum
        )
        guard case .advisory(let advisories, _) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertEqual(advisories, [.littleSpeech])
    }

    func test_longPausesAreMostlySilentAdvisory() {
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: recording(seconds: 30, speechDbfs: -22, pauseMillis: 2_500),
            minDurationMillis: minimum
        )
        guard case .advisory(let advisories, _) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertEqual(advisories, [.mostlySilent])
    }

    func test_clippedSpeechIsAdvised() {
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: recording(seconds: 20, speechDbfs: -6, clipEverySpeechSample: true),
            minDurationMillis: minimum
        )
        guard case .advisory(let advisories, _) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertTrue(advisories.contains(.clipping), "\(advisories)")
    }

    func test_definitiveRejections() {
        func reason(_ verdict: RecordingQualityVerdict) -> RecordingRejection? {
            if case .rejected(let reason, _) = verdict { return reason }
            return nil
        }
        XCTAssertEqual(reason(RecordingQualityAnalyzer.analyze(samples: nil, minDurationMillis: minimum)), .unreadable)
        XCTAssertEqual(reason(RecordingQualityAnalyzer.analyze(samples: [], minDurationMillis: minimum)), .unreadable)
        XCTAssertEqual(
            reason(RecordingQualityAnalyzer.analyze(samples: [Float](repeating: 0, count: 20 * rate), minDurationMillis: minimum)),
            .noInput
        )
        XCTAssertEqual(
            reason(RecordingQualityAnalyzer.analyze(samples: recording(seconds: 8, speechDbfs: -22), minDurationMillis: minimum)),
            .tooShort
        )
    }

    func test_decodedLengthJustUnderTheMinimumIsNotTooShort() {
        let samples = Array(recording(seconds: 12, speechDbfs: -22).prefix(12 * rate - rate / 5))
        if case .rejected = RecordingQualityAnalyzer.analyze(samples: samples, minDurationMillis: minimum) {
            XCTFail("AAC 여백만큼 짧은 12초 녹음을 '너무 짧음' 으로 읽었다")
        }
    }

    private struct FixedDetector: VoiceActivityDetecting {
        let millis: Int?
        func speechMillis(samples: [Float], sampleRate: Int) -> Int? { millis }
    }

    func test_aPluggedDetectorDecidesSpeechTimeAndIsNamed() {
        let samples = recording(seconds: 20, speechDbfs: -22)
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: samples, minDurationMillis: minimum, voiceActivityDetector: FixedDetector(millis: 1_000)
        )
        guard case .advisory(let advisories, let metrics) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertEqual(metrics.method, .vad)
        XCTAssertEqual(advisories, [.littleSpeech])
        // 검출기가 이 기기에서 돌지 못하면(nil) 기본 신호 검사다 — 'VAD' 로 꾸미지 않는다.
        let fallback = RecordingQualityAnalyzer.analyze(
            samples: samples, minDurationMillis: minimum, voiceActivityDetector: FixedDetector(millis: nil)
        )
        XCTAssertEqual(fallback.metrics?.method, .basicSignal)
    }

    func test_diagnosticsCarryOnlyNumbersAndCodes() {
        let verdict = RecordingQualityAnalyzer.analyze(
            samples: recording(seconds: 20, speechDbfs: -47, noiseDbfs: -72),
            minDurationMillis: minimum
        )
        let diagnostics = verdict.diagnostics
        XCTAssertEqual(
            Set(diagnostics.keys),
            ["verdict", "advisories", "method", "duration_ms", "speech_ms", "silence_pct", "peak_dbfs",
             "speech_rms_dbfs", "clipping_permille"]
        )
        XCTAssertEqual(diagnostics["verdict"] as? String, "advisory")
        XCTAssertEqual(diagnostics["advisories"] as? String, "quiet")
        XCTAssertEqual(diagnostics["method"] as? String, "basic_signal")
        for (key, value) in diagnostics where !["verdict", "advisories", "method"].contains(key) {
            XCTAssertTrue(value is Int, "\(key)=\(value)")
        }
    }

    func test_normalizerResamplesToTheAnalysisRate() {
        let source = (0..<44_100).map { Float(sin(2 * Double.pi * 220 * Double($0) / 44_100)) }
        let out = MonoPcmNormalizer.toAnalysisRate(source, sourceSampleRate: 44_100)
        XCTAssertTrue((15_999...16_001).contains(out.count), "\(out.count)")
        XCTAssertEqual(Double(out[4_000]), sin(2 * Double.pi * 220 * 4_000 / 16_000), accuracy: 0.01)
        XCTAssertEqual(MonoPcmNormalizer.toAnalysisRate([], sourceSampleRate: 44_100).count, 0)
        XCTAssertEqual(MonoPcmNormalizer.toAnalysisRate([Float](repeating: 0.5, count: 10), sourceSampleRate: 16_000).count, 10)
    }

    /// 실제 파일 경로 — 디코더(`VoiceTuningAnalyzer.decodeMono`)·정규화·판정이 이어진다. 읽을 수 없는 파일은 확정 거절이다.
    func test_fileVerdictDecodesAndRejectsGarbage() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }

        let garbage = folder.appendingPathComponent("broken.m4a")
        try Data([0x00, 0x01, 0x02, 0x03]).write(to: garbage)
        guard case .rejected(.unreadable, _) = RecordingQualityAnalyzer.verdict(
            forRecordingAt: garbage, minDurationMillis: minimum, maxSeconds: 130
        ) else { return XCTFail("깨진 파일을 읽었다") }

        // 44.1 kHz 스테레오 WAV — 채널 섞기와 샘플레이트 정규화를 함께 지난다.
        let wav = folder.appendingPathComponent("speech.wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2))
        let mono16k = recording(seconds: 20, speechDbfs: -22)
        let upsampled = MonoPcmNormalizer.toAnalysisRate(mono16k, sourceSampleRate: 16_000, targetSampleRate: 44_100)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(upsampled.count)))
        buffer.frameLength = AVAudioFrameCount(upsampled.count)
        for channel in 0..<2 {
            let data = try XCTUnwrap(buffer.floatChannelData?[channel])
            for (index, value) in upsampled.enumerated() { data[index] = value }
        }
        do {
            let file = try AVAudioFile(forWriting: wav, settings: format.settings)
            try file.write(from: buffer)
        }
        let verdict = RecordingQualityAnalyzer.verdict(forRecordingAt: wav, minDurationMillis: minimum, maxSeconds: 130)
        guard case .passed(let metrics) = verdict else { return XCTFail("\(verdict)") }
        XCTAssertTrue((19_900...20_100).contains(metrics.durationMillis), "\(metrics.durationMillis)")
    }
}

/// 녹음을 멈춘 뒤의 갈래 — 멈춘 사정과 판정을 합친 결과, 알럿 본문, 블루투스 전환 판정, 제공자 장애 문구.
final class RecordingReviewTests: XCTestCase {
    private let metrics = RecordingQualityMetrics(
        durationMillis: 20_400,
        speechMillis: 8_900,
        silenceRatio: 0.56,
        peakDbfs: -9,
        speechRmsDbfs: -44,
        clippingRatio: 0,
        method: .basicSignal
    )

    func test_verdictAndStopReasonCombine() {
        XCTAssertEqual(RecordingReview.decide(verdict: .passed(metrics), stopReason: .finished), .accept)
        XCTAssertEqual(
            RecordingReview.decide(verdict: .rejected(.noInput, metrics), stopReason: .failed),
            .reject(.noInput)
        )
        XCTAssertEqual(
            RecordingReview.decide(verdict: .advisory([.quiet], metrics), stopReason: .finished),
            .ask(advisories: [.quiet], recovered: false, interrupted: false, metrics: metrics)
        )
        // 품질이 괜찮아도 제대로 끝나지 않은 녹음은 묻는다 — 정상 완료본처럼 넘기지 않는다.
        XCTAssertEqual(
            RecordingReview.decide(verdict: .passed(metrics), stopReason: .failed),
            .ask(advisories: [], recovered: true, interrupted: false, metrics: metrics)
        )
        for reason in [RecordingStopReason.interrupted, .routeChanged, .backgrounded] {
            XCTAssertEqual(
                RecordingReview.decide(verdict: .passed(metrics), stopReason: reason),
                .ask(advisories: [], recovered: false, interrupted: true, metrics: metrics),
                "\(reason)"
            )
        }
    }

    func test_alertMessageSaysWhatWasMeasured() throws {
        let message = try XCTUnwrap(
            RecordingReview.ask(advisories: [.quiet], recovered: false, interrupted: true, metrics: metrics).alertMessage
        )
        XCTAssertEqual(
            message.components(separatedBy: "\n"),
            [
                "전화나 다른 앱 때문에 녹음이 멈췄어요. 멈춘 곳까지 남겨 두었어요.",
                "목소리가 작게 녹음됐어요.",
                "말소리로 들린 시간 약 8초 · 전체 20초",
                "그대로 써도 돼요. 다시 녹음하면 목소리가 더 또렷하게 만들어질 수 있어요.",
            ]
        )
        XCTAssertFalse(message.contains("VAD"))
        XCTAssertNil(RecordingReview.accept.alertMessage)
    }

    func test_onlyRealInputDeviceChangesEndTheRecording() {
        XCTAssertTrue(VoiceRecorder.routeChangeEndsRecording(rawReason: AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue))
        XCTAssertTrue(VoiceRecorder.routeChangeEndsRecording(rawReason: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue))
        // 녹음을 시작하며 범주를 바꿀 때 오는 변경은 녹음을 끝내지 않는다.
        XCTAssertFalse(VoiceRecorder.routeChangeEndsRecording(rawReason: AVAudioSession.RouteChangeReason.categoryChange.rawValue))
        XCTAssertFalse(VoiceRecorder.routeChangeEndsRecording(rawReason: AVAudioSession.RouteChangeReason.override.rawValue))
        XCTAssertFalse(VoiceRecorder.routeChangeEndsRecording(rawReason: 9_999))
    }

    func test_cloningFailureDoesNotBlameTheRecording() throws {
        // 500 VOICE_CLONING_FAILED 는 제공자 장애·서버 오류다 — '다시 녹음' 으로 안내하지 않는다.
        let message = try XCTUnwrap(APIErrorMessages.message(for: "VOICE_CLONING_FAILED"))
        XCTAssertFalse(message.contains("녹음"), message)
    }
}
