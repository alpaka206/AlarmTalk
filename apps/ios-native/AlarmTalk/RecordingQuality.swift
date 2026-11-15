import AVFoundation
import Foundation

/// 녹음 품질 판정의 임계값 — **유일 출처**다. 스펙 `docs/spec/voice-and-message.md` §4-1 「녹음 품질 판정」 표와
/// 안드로이드 `data/RecordingQuality.kt` 의 `RecordingQualityThresholds` 가 같은 숫자를 쓴다. 한쪽만 고치지 말 것.
///
/// ⚠ **작은 목소리를 거절하지 않는다.** 확정 거절은 '너무 짧음·읽을 수 없음·입력 없음(디지털 무음)' 셋뿐이고, 크기·
/// 무음·클리핑은 전부 권장 안내다(그래도 쓰기 / 다시 녹음). 이 수치는 기본 신호 검사이지 화자 확인·본인 확인·음성 복제
/// 적합성의 증명이 아니다.
enum RecordingQualityThresholds {
    /// 판정은 이 샘플레이트의 모노로 한다 — 정규화는 `MonoPcmNormalizer` 한 곳이다.
    static let analysisSampleRate = 16_000
    static let frameMillis = 20
    /// 디코딩한 길이가 기준보다 이만큼 짧아도 '너무 짧음' 으로 읽지 않는다(AAC 앞뒤 여백·반올림).
    static let decodedDurationToleranceMillis = 500
    /// 피크가 이보다 작으면 마이크에서 아무것도 들어오지 않은 것이다(확정 거절).
    static let noInputPeakDbfs: Double = -80
    /// 말소리 프레임의 절대 하한.
    static let activeFrameFloorDbfs: Double = -60
    /// 잡음 바닥(프레임 에너지의 하위 `noiseFloorPercentile`)보다 이만큼 크면 말소리 프레임이다.
    static let activeFrameMarginDb: Double = 10
    static let noiseFloorPercentile: Double = 0.10
    static let littleSpeechMillis = 3_000
    static let mostlySilentRatio: Double = 0.60
    static let quietSpeechRmsDbfs: Double = -40
    static let clippedSampleLevel: Float = 0.98
    static let clippingRatio: Double = 0.002
}

/// 확정 거절 — 다시 녹음하는 길만 준다.
enum RecordingRejection: String, Equatable, Sendable {
    case tooShort = "too_short"
    case unreadable
    case noInput = "no_input"

    var message: String {
        switch self {
        case .tooShort: return String(localized: "12초 이상 녹음해 주세요")
        case .unreadable: return String(localized: "녹음 파일을 읽지 못했어요. 다시 녹음해 주세요.")
        case .noInput:
            return String(localized: "마이크에서 소리가 들어오지 않았어요. 다른 앱이 마이크를 쓰고 있지 않은지 확인한 뒤 다시 녹음해 주세요.")
        }
    }
}

/// 권장 안내 — '그래도 쓰기' 와 '다시 녹음' 을 둘 다 준다. 화면에 그리는 순서다.
enum RecordingAdvisory: String, Equatable, Sendable {
    case littleSpeech = "little_speech"
    case mostlySilent = "mostly_silent"
    case quiet
    case clipping

    var message: String {
        switch self {
        case .littleSpeech: return String(localized: "말소리가 거의 들리지 않아요.")
        case .mostlySilent: return String(localized: "말하지 않은 시간이 길어요.")
        case .quiet: return String(localized: "목소리가 작게 녹음됐어요.")
        case .clipping: return String(localized: "소리가 너무 커서 일부가 찌그러졌어요.")
        }
    }
}

/// 말한 시간을 무엇으로 셌는가. ⚠ VAD 가 꽂히지 않은 환경은 언제나 `basicSignal` 이다 — 화면·진단 어디에도
/// 'VAD 통과' 라고 말하지 않는다.
enum SpeechDetectionMethod: String, Equatable, Sendable {
    case basicSignal = "basic_signal"
    case vad
}

/// 말소리 구간 검출기(Silero VAD 등)를 꽂는 자리. 지금은 번들한 구현이 **없다**(스펙 「녹음 품질 판정」 — 출처·
/// 라이선스 기록). 돌지 못하면 nil 을 돌려주고, 그러면 판정은 기본 신호 검사로 센다.
protocol VoiceActivityDetecting: Sendable {
    /// `samples` 는 `RecordingQualityThresholds.analysisSampleRate` 의 모노(-1...1)다. 말한 시간(ms) 또는 nil.
    func speechMillis(samples: [Float], sampleRate: Int) -> Int?
}

/// 판단에 필요한 수치만 — 오디오·받아쓰기 원문은 싣지 않는다.
struct RecordingQualityMetrics: Equatable, Sendable {
    var durationMillis: Int
    var speechMillis: Int
    var silenceRatio: Double
    var peakDbfs: Double
    /// 말소리 프레임의 평균 크기. 말소리 프레임이 없으면 nil.
    var speechRmsDbfs: Double?
    var clippingRatio: Double
    var method: SpeechDetectionMethod
}

enum RecordingQualityVerdict: Equatable, Sendable {
    case rejected(RecordingRejection, RecordingQualityMetrics?)
    case advisory([RecordingAdvisory], RecordingQualityMetrics)
    case passed(RecordingQualityMetrics)

    var metrics: RecordingQualityMetrics? {
        switch self {
        case .rejected(_, let metrics): return metrics
        case .advisory(_, let metrics), .passed(let metrics): return metrics
        }
    }

    /// 진단(브레드크럼)에 싣는 값 — 숫자와 판정 코드뿐이다. 안드로이드 `RecordingQualityVerdict.diagnostics()` 와 같은 키.
    var diagnostics: [String: Any] {
        var data: [String: Any] = [:]
        switch self {
        case .rejected(let reason, _):
            data["verdict"] = "rejected"
            data["reason"] = reason.rawValue
        case .advisory(let advisories, _):
            data["verdict"] = "advisory"
            data["advisories"] = advisories.map(\.rawValue).joined(separator: ",")
        case .passed:
            data["verdict"] = "passed"
        }
        if let metrics {
            data["method"] = metrics.method.rawValue
            data["duration_ms"] = metrics.durationMillis
            data["speech_ms"] = metrics.speechMillis
            data["silence_pct"] = Int((metrics.silenceRatio * 100).rounded())
            data["peak_dbfs"] = Int(metrics.peakDbfs.rounded())
            if let rms = metrics.speechRmsDbfs { data["speech_rms_dbfs"] = Int(rms.rounded()) }
            data["clipping_permille"] = Int((metrics.clippingRatio * 1000).rounded())
        }
        return data
    }
}

/// 판정 입력의 샘플레이트 정규화 — **한 곳**이다. 채널은 디코더(`VoiceTuningAnalyzer.decodeMono`)가 이미 평균으로 섞어
/// 모노로 준다. 여기서는 그 모노를 `RecordingQualityThresholds.analysisSampleRate` 로 선형 보간한다. 안드로이드
/// `MonoPcmNormalizer.toAnalysisRate` 와 같은 식이다.
enum MonoPcmNormalizer {
    static func toAnalysisRate(
        _ samples: [Float],
        sourceSampleRate: Int,
        targetSampleRate: Int = RecordingQualityThresholds.analysisSampleRate
    ) -> [Float] {
        guard !samples.isEmpty, sourceSampleRate > 0, targetSampleRate > 0 else { return [] }
        if sourceSampleRate == targetSampleRate { return samples }
        let step = Double(sourceSampleRate) / Double(targetSampleRate)
        let outputSize = Int(Double(samples.count - 1) / step) + 1
        var output = [Float](repeating: 0, count: outputSize)
        for index in 0..<outputSize {
            let position = Double(index) * step
            let left = min(Int(position), samples.count - 1)
            let right = min(left + 1, samples.count - 1)
            let t = Float(position - Double(left))
            output[index] = samples[left] + (samples[right] - samples[left]) * t
        }
        return output
    }
}

/// 기본 신호 검사 — 순수 함수다. 안드로이드 `RecordingQualityAnalyzer.analyze` 와 같은 규칙·같은 순서의 셈이다.
enum RecordingQualityAnalyzer {
    static func analyze(
        samples: [Float]?,
        minDurationMillis: Int,
        sampleRate: Int = RecordingQualityThresholds.analysisSampleRate,
        voiceActivityDetector: (any VoiceActivityDetecting)? = nil
    ) -> RecordingQualityVerdict {
        guard let samples, !samples.isEmpty, sampleRate > 0 else {
            return .rejected(.unreadable, nil)
        }
        let durationMillis = samples.count * 1000 / sampleRate

        var peak: Float = 0
        var clipped = 0
        for sample in samples {
            let level = abs(sample)
            if level > peak { peak = level }
            if level >= RecordingQualityThresholds.clippedSampleLevel { clipped += 1 }
        }
        let peakDbfs = toDb(Double(peak) * Double(peak))
        let clippingRatio = Double(clipped) / Double(samples.count)

        let frameLength = max(1, sampleRate * RecordingQualityThresholds.frameMillis / 1000)
        let frameCount = samples.count / frameLength
        var frameEnergy = [Double](repeating: 0, count: frameCount)
        for frame in 0..<frameCount {
            var sum = 0.0
            let start = frame * frameLength
            for index in start..<(start + frameLength) {
                sum += Double(samples[index]) * Double(samples[index])
            }
            frameEnergy[frame] = sum / Double(frameLength)
        }
        let frameDb = frameEnergy.map(toDb)
        let noiseFloorDb: Double
        if frameCount == 0 {
            noiseFloorDb = peakDbfs
        } else {
            let sorted = frameDb.sorted()
            noiseFloorDb = sorted[Int(Double(frameCount - 1) * RecordingQualityThresholds.noiseFloorPercentile)]
        }
        let activeThresholdDb = max(
            noiseFloorDb + RecordingQualityThresholds.activeFrameMarginDb,
            RecordingQualityThresholds.activeFrameFloorDbfs
        )
        var activeFrames = 0
        var activeEnergy = 0.0
        for frame in 0..<frameCount where frameDb[frame] >= activeThresholdDb {
            activeFrames += 1
            activeEnergy += frameEnergy[frame]
        }
        let basicSpeechMillis = activeFrames * RecordingQualityThresholds.frameMillis
        let vadSpeechMillis = voiceActivityDetector?.speechMillis(samples: samples, sampleRate: sampleRate)
        let method: SpeechDetectionMethod = vadSpeechMillis != nil ? .vad : .basicSignal
        let speechMillis = min(max(vadSpeechMillis ?? basicSpeechMillis, 0), durationMillis)
        let silenceRatio = durationMillis == 0 ? 1.0 : 1.0 - Double(speechMillis) / Double(durationMillis)
        let speechRmsDbfs = activeFrames > 0 ? toDb(activeEnergy / Double(activeFrames)) : nil

        let metrics = RecordingQualityMetrics(
            durationMillis: durationMillis,
            speechMillis: speechMillis,
            silenceRatio: min(max(silenceRatio, 0), 1),
            peakDbfs: peakDbfs,
            speechRmsDbfs: speechRmsDbfs,
            clippingRatio: clippingRatio,
            method: method
        )

        if durationMillis + RecordingQualityThresholds.decodedDurationToleranceMillis < minDurationMillis {
            return .rejected(.tooShort, metrics)
        }
        if peakDbfs < RecordingQualityThresholds.noInputPeakDbfs {
            return .rejected(.noInput, metrics)
        }

        var advisories: [RecordingAdvisory] = []
        let littleSpeech = speechMillis < RecordingQualityThresholds.littleSpeechMillis
        if littleSpeech {
            advisories.append(.littleSpeech)
        } else if metrics.silenceRatio >= RecordingQualityThresholds.mostlySilentRatio {
            advisories.append(.mostlySilent)
        }
        if !littleSpeech, let speechRmsDbfs, speechRmsDbfs < RecordingQualityThresholds.quietSpeechRmsDbfs {
            advisories.append(.quiet)
        }
        if clippingRatio >= RecordingQualityThresholds.clippingRatio { advisories.append(.clipping) }
        return advisories.isEmpty ? .passed(metrics) : .advisory(advisories, metrics)
    }

    /// 녹음 파일을 기기에서 판정한다 — 디코딩(`VoiceTuningAnalyzer.decodeMono`, 채널을 섞는다) → 정규화 → 기본 신호 검사.
    /// 파일은 기기 밖으로 나가지 않는다. 메인 액터가 아닌 곳에서 부른다(디코딩이 길면 1초 남짓이다).
    static func verdict(forRecordingAt url: URL, minDurationMillis: Int, maxSeconds: Double) -> RecordingQualityVerdict {
        guard let decoded = try? VoiceTuningAnalyzer.decodeMono(url: url, maxSeconds: maxSeconds),
              !decoded.samples.isEmpty else {
            return .rejected(.unreadable, nil)
        }
        let samples = MonoPcmNormalizer.toAnalysisRate(decoded.samples, sourceSampleRate: Int(decoded.sampleRate.rounded()))
        return analyze(samples: samples, minDurationMillis: minDurationMillis)
    }

    /// 평균 제곱(에너지)을 dBFS 로. 0 은 아주 작은 값으로 막는다.
    private static func toDb(_ meanSquare: Double) -> Double {
        10 * log10(max(meanSquare, 1e-12))
    }
}

/// 녹음이 어떻게 끝났는가(`VoiceRecorder.lastStopReason`). 끼어들어 멈춘 녹음은 **남긴다**(녹음 복구) — 판정으로 보내고
/// 들어 보고 정하게 한다.
enum RecordingStopReason: String, Equatable, Sendable {
    /// 사용자가 멈췄거나 상한(2분)에 닿았다.
    case finished
    /// 전화·Siri·다른 앱의 오디오 세션이 가져갔다(`AVAudioSession.interruptionNotification`).
    case interrupted
    /// 입력 장치가 바뀌었다 — 블루투스 이어폰을 끼거나 뺐다(`routeChangeNotification`).
    case routeChanged = "route_changed"
    /// 앱이 백그라운드로 갔다.
    case backgrounded
    /// 녹음기가 실패를 알렸다(인코딩 오류·미디어 서비스 재시작) — 파일을 믿을 수 없다.
    case failed
}

/// 녹음을 멈춘 뒤 등록 창이 할 일 — 품질 판정과 멈춘 사정을 합친다. 안드로이드 `ui/voices/RecordingReview.kt` 의
/// `reviewRecording` 과 같은 갈래다.
enum RecordingReview: Equatable, Sendable {
    case accept
    case reject(RecordingRejection)
    case ask(advisories: [RecordingAdvisory], recovered: Bool, interrupted: Bool, metrics: RecordingQualityMetrics)

    static func decide(verdict: RecordingQualityVerdict, stopReason: RecordingStopReason) -> RecordingReview {
        let recovered = stopReason == .failed
        let interrupted = stopReason == .interrupted || stopReason == .routeChanged || stopReason == .backgrounded
        switch verdict {
        case .rejected(let reason, _):
            return .reject(reason)
        case .advisory(let advisories, let metrics):
            return .ask(advisories: advisories, recovered: recovered, interrupted: interrupted, metrics: metrics)
        case .passed(let metrics):
            // 품질은 괜찮아도 제대로 끝나지 않은 녹음은 들어 보고 정하게 한다 — 정상 완료본처럼 조용히 넘기지 않는다.
            guard recovered || interrupted else { return .accept }
            return .ask(advisories: [], recovered: recovered, interrupted: interrupted, metrics: metrics)
        }
    }

    /// 알럿 본문 — 멈춘 사정, 안내, 잰 수치, 맺음말 순이다. 한 줄에 하나씩. `.ask` 가 아니면 nil.
    var alertMessage: String? {
        guard case .ask(let advisories, let recovered, let interrupted, let metrics) = self else { return nil }
        var lines: [String] = []
        if recovered {
            lines.append(String(localized: "녹음이 제대로 끝나지 않았어요. 들어 보고 쓸지 정해 주세요."))
        } else if interrupted {
            lines.append(String(localized: "전화나 다른 앱 때문에 녹음이 멈췄어요. 멈춘 곳까지 남겨 두었어요."))
        }
        lines.append(contentsOf: advisories.map(\.message))
        let speechSeconds = metrics.speechMillis / 1000
        let totalSeconds = metrics.durationMillis / 1000
        lines.append(String(localized: "말소리로 들린 시간 약 \(Int(speechSeconds))초 · 전체 \(Int(totalSeconds))초"))
        if !advisories.isEmpty {
            lines.append(String(localized: "그대로 써도 돼요. 다시 녹음하면 목소리가 더 또렷하게 만들어질 수 있어요."))
        }
        return lines.joined(separator: "\n")
    }
}
