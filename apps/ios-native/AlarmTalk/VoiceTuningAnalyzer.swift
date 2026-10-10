import AVFoundation
import Foundation

/// 목소리 높이 **자동 추천값** — 기기 안에서 계산하는 순수 함수만 둔다(격리 없음).
///
/// 두 소리를 잰다: (a) 등록 녹음(올리는 동안 재고 숫자만 남긴다), (b) 서버가 준 미리듣기 클립.
/// 높이 = 두 소리의 중앙 기본주파수(F0) 차이를 반음으로 바꿔 **되돌리는** 값.
///   pitchSt = −round_to_0.5(12·log2(previewF0 / sourceF0)), |값| < 1.5 이면 0, 막대 범위(−10…+6, `VoiceTuning.pitchRange`)로 자른다.
/// 녹음을 재지 못했으면 추천은 0 이다. ⚠ F0 는 생체 정보라 로그에 남기지도 서버에 보내지도 않는다 — 서버가 받는
/// 것은 사용자가 고른 반음 하나다(스펙 §4-3).
///
/// 측정은 근사다: F0 는 YIN(문턱 0.2, 25ms 프레임, 50–500Hz, 앞에 ~1.2kHz 저역통과).
/// 라우드니스(BS.1770 K-가중 + 400ms 블록, 절대 게이트 −70 LUFS)는 추천에 쓰지 않고, 높이를
/// 바꾼 소리의 크기를 원래대로 되맞출 때(`VoicePitchShifter.matchLoudness`) 쓴다.
enum VoiceTuningAnalyzer {

    struct Measurement: Equatable, Sendable {
        var medianF0: Double?
    }

    static let pitchDeadZoneSt: Double = 1.5
    /// 이보다 유성 프레임이 적으면 못 잰 것이다(안드로이드 `VoiceTuningAnalysis.MIN_VOICED_FRAMES`).
    static let minVoicedFrames = 5
    /// 프레임 문턱 — 가장 큰 프레임 RMS 보다 이만큼(dB) 작으면 무성으로 본다(안드로이드 `FRAME_GATE_DB`).
    static let frameGateDb: Double = 30
    /// 등록 녹음을 재는 길이(초) — 안드로이드 `SourcePitchAnalysisMaxMillis`(45초)와 같다.
    static let sourceAnalysisMaxSeconds: Double = 45
    static let yinThreshold: Double = 0.2
    static let frameSeconds: Double = 0.025
    static let hopSeconds: Double = 0.010
    static let minF0: Double = 50
    static let maxF0: Double = 500
    static let lowpassHz: Double = 1_200
    static let absoluteGateLufs: Double = -70
    /// YIN 을 돌리기 전에 이 정도로 솎는다(저역통과 뒤라 안전하다). 계산량이 표본률에 비례한다.
    static let analysisRateHz: Double = 8_000

    // MARK: - 추천

    static func suggest(preview: Measurement?, source: Measurement?) -> VoiceTuning {
        VoiceTuning(
            pitchSt: suggestedPitch(previewF0: preview?.medianF0, sourceF0: source?.medianF0),
            source: .suggested
        ).normalized()
    }

    /// 미리듣기가 원래 목소리보다 높으면 내리고, 낮으면 올린다. 1.5반음 미만은 손대지 않는다.
    /// (데드존은 0.5 단위로 **반올림한 값**에 건다 — ±1 까지는 0, ±1.5 부터 적용.)
    static func suggestedPitch(previewF0: Double?, sourceF0: Double?) -> Double {
        guard let previewF0, let sourceF0, previewF0 > 0, sourceF0 > 0,
              previewF0.isFinite, sourceF0.isFinite else { return 0 }
        let semitones = -roundToHalf(12 * log2(previewF0 / sourceF0))
        guard abs(semitones) >= pitchDeadZoneSt else { return 0 }
        return clamp(semitones, VoiceTuning.pitchRange)
    }

    /// 0.5 단위 반올림(0.25 → 0.5, −0.25 → −0.5 — 절반은 0 에서 먼 쪽).
    static func roundToHalf(_ value: Double) -> Double {
        let rounded = (value * 2).rounded(.toNearestOrAwayFromZero) / 2
        return rounded == 0 ? 0 : rounded
    }

    private static func clamp(_ value: Double, _ range: ClosedRange<Double>) -> Double {
        let clamped = min(max(value, range.lowerBound), range.upperBound)
        return clamped == 0 ? 0 : clamped
    }

    // MARK: - 측정

    static func measure(samples: [Float], sampleRate: Double) -> Measurement {
        Measurement(medianF0: medianF0(samples: samples, sampleRate: sampleRate))
    }

    /// 파일을 열어 잰다. 열지 못하면 nil(추천은 그 갈래만 빠진다).
    static func measure(url: URL, maxSeconds: Double = 30) -> Measurement? {
        guard let decoded = try? decodeMono(url: url, maxSeconds: maxSeconds),
              !decoded.samples.isEmpty else { return nil }
        return measure(samples: decoded.samples, sampleRate: decoded.sampleRate)
    }

    /// `AVAudioFile` 로 디코드해 채널 평균(모노) float 로 돌려준다. 앞 `maxSeconds` 만.
    static func decodeMono(url: URL, maxSeconds: Double) throws -> (samples: [Float], sampleRate: Double) {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let maxFrames = AVAudioFramePosition(format.sampleRate * max(0, maxSeconds))
        let frames = AVAudioFrameCount(max(0, min(file.length, maxFrames)))
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
            return ([], format.sampleRate)
        }
        try file.read(into: buffer, frameCount: frames)
        guard let channels = buffer.floatChannelData else { return ([], format.sampleRate) }
        let count = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        var mono = [Float](repeating: 0, count: count)
        for channel in 0..<channelCount {
            let data = channels[channel]
            for index in 0..<count { mono[index] += data[index] }
        }
        if channelCount > 1 {
            let scale = 1 / Float(channelCount)
            for index in 0..<count { mono[index] *= scale }
        }
        return (mono, format.sampleRate)
    }

    // MARK: F0 (YIN)

    /// 유성 프레임 F0 의 중앙값(Hz). 유성 프레임이 모자라면 nil.
    ///
    /// ⚠ 안드로이드 `VoiceTuningAnalysis.medianF0` 와 **같은 식·같은 순서의 셈**이다(Codex #870) — 저역통과(RBJ 두 번,
    /// Direct Form I, 단마다 Float) → 정수 배 솎기(⌊n/배⌋ 개) → 프레임 RMS 문턱(가장 큰 프레임보다 30dB 아래, 하한 1e-4)
    /// → 프레임마다 YIN → 중앙값. 예전 iOS 는 문턱(에너지 비)·프레임 수·보간 자르기·하한이 조금씩 달라 같은 녹음의 추천이
    /// 두 앱에서 갈릴 수 있었다. 회귀 테스트가 두 앱에 **같은 기대값**을 둔다.
    static func medianF0(samples: [Float], sampleRate: Double) -> Double? {
        let sr = Int(sampleRate.rounded())
        guard sr > 0, !samples.isEmpty else { return nil }
        let filtered = lowpassTwice(samples, sampleRate: sr, cutoff: lowpassHz)
        let factor = max(1, sr / Int(analysisRateHz))
        let signal = factor <= 1 ? filtered : (0..<(filtered.count / factor)).map { filtered[$0 * factor] }
        let rate = sr / factor
        let window = VoicePitchShifter.jsRound(frameSeconds * Double(rate))
        let hop = max(1, VoicePitchShifter.jsRound(hopSeconds * Double(rate)))
        let tauMax = Int((Double(rate) / minF0).rounded(.up))
        let span = window + tauMax + 2
        guard window > 0, signal.count >= span else { return nil }

        var starts: [Int] = []
        var position = 0
        while position + span <= signal.count {
            starts.append(position)
            position += hop
        }
        let rms = starts.map { start -> Double in
            var sum = 0.0
            for i in start..<(start + window) {
                let value = Double(signal[i])
                sum += value * value
            }
            return (sum / Double(window)).squareRoot()
        }
        guard let loudest = rms.max(), loudest > 1e-6 else { return nil }
        let gate = max(1e-4, loudest * pow(10, -frameGateDb / 20))

        var voiced: [Double] = []
        for (index, start) in starts.enumerated() where rms[index] >= gate {
            if let f0 = yinFrequency(signal, start: start, window: window, sampleRate: rate) { voiced.append(f0) }
        }
        // 유성 프레임이 이보다 적으면 못 잰 것으로 본다 — 안드로이드 `VoiceTuningAnalysis.MIN_VOICED_FRAMES` 와 같은 수
        // (다르면 같은 녹음에서 한 앱만 추천을 낸다, Codex #870).
        guard voiced.count >= minVoicedFrames else { return nil }
        voiced.sort()
        let mid = voiced.count / 2
        return voiced.count % 2 == 1 ? voiced[mid] : (voiced[mid - 1] + voiced[mid]) / 2
    }

    /// 한 프레임의 YIN 추정(Hz) — 안드로이드 `VoiceTuningAnalysis.yinFrequency` 와 같다. 문턱 아래로 내려가는 첫 지연을
    /// 찾아 그 골짜기 바닥까지 따라가고, 포물선 보간으로 소수 지연을 구한다. 문턱 아래가 없으면 무성(nil).
    static func yinFrequency(_ signal: [Float], start: Int, window: Int, sampleRate: Int) -> Double? {
        let rate = Double(sampleRate)
        let tauMin = max(2, Int((rate / maxF0).rounded(.down)))
        let tauMax = Int((rate / minF0).rounded(.up))
        guard start >= 0, start + window + tauMax + 1 <= signal.count else { return nil }
        var difference = [Double](repeating: 0, count: tauMax + 2)
        // 셈의 순서는 안드로이드와 같다(같은 결과) — 범위 검사만 뺀다. 등록 녹음(45초)·미리듣기 굽기가 이걸로 훑는다.
        signal.withUnsafeBufferPointer { p in
            difference.withUnsafeMutableBufferPointer { d in
                for tau in 1...(tauMax + 1) {
                    var sum = 0.0
                    for j in 0..<window {
                        let delta = Double(p[start + j]) - Double(p[start + j + tau])
                        sum += delta * delta
                    }
                    d[tau] = sum
                }
            }
        }
        var normalized = [Double](repeating: 0, count: tauMax + 2)
        normalized[0] = 1
        var running = 0.0
        for tau in 1...(tauMax + 1) {
            running += difference[tau]
            normalized[tau] = running <= 0 ? 1 : difference[tau] * Double(tau) / running
        }
        var tau = tauMin
        var found = -1
        while tau <= tauMax {
            if normalized[tau] < yinThreshold {
                while tau + 1 <= tauMax, normalized[tau + 1] < normalized[tau] { tau += 1 }
                found = tau
                break
            }
            tau += 1
        }
        guard found >= 0 else { return nil }
        var refined = Double(found)
        if found >= 1, found < tauMax + 1 {
            let s0 = normalized[found - 1]
            let s1 = normalized[found]
            let s2 = normalized[found + 1]
            let denominator = s0 + s2 - 2 * s1
            if abs(denominator) > 1e-12 { refined = Double(found) + (s0 - s2) / (2 * denominator) }
        }
        guard refined > 0 else { return nil }
        return rate / refined
    }

    /// 안드로이드 `VoiceTuningAnalysis.lowpass` 와 같다 — 차단이 나이퀴스트의 95% 이상이면 그대로, 아니면 RBJ 저역통과를
    /// 두 번(Direct Form I, Double 로 누산해 단마다 Float 로).
    private static func lowpassTwice(_ samples: [Float], sampleRate: Int, cutoff: Double) -> [Float] {
        if cutoff >= Double(sampleRate) / 2 * 0.95 { return samples }
        let w0 = 2 * Double.pi * cutoff / Double(sampleRate)
        let alpha = sin(w0) / (2 * 0.7071067811865476)
        let cosW = cos(w0)
        let a0 = 1 + alpha
        let c = (b0: (1 - cosW) / 2 / a0, b1: (1 - cosW) / a0, b2: (1 - cosW) / 2 / a0, a1: -2 * cosW / a0, a2: (1 - alpha) / a0)
        func pass(_ input: [Float]) -> [Float] {
            var output = [Float](repeating: 0, count: input.count)
            var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
            for i in input.indices {
                let x0 = Double(input[i])
                let y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
                x2 = x1
                x1 = x0
                y2 = y1
                y1 = y0
                output[i] = Float(y0)
            }
            return output
        }
        return pass(pass(samples))
    }

    // MARK: 라우드니스 (BS.1770 근사)

    /// 통합 라우드니스(LUFS). 게이트를 넘는 블록이 없으면 nil.
    static func integratedLoudness(samples: [Float], sampleRate: Double) -> Double? {
        guard sampleRate > 0, !samples.isEmpty else { return nil }
        // 안드로이드 `VoiceTuningAnalysis.integratedLoudness` 와 같은 셈 — 블록 400ms·간격 100ms(반올림), 블록마다 직접 제곱합.
        let weighted = Biquad.apply(Biquad.kWeighting(sampleRate: sampleRate), to: samples)
        func meanSquare(_ start: Int, _ length: Int) -> Double {
            guard length > 0 else { return 0 }
            var sum = 0.0
            for index in start..<(start + length) {
                let value = Double(weighted[index])
                sum += value * value
            }
            return sum / Double(length)
        }
        let block = VoicePitchShifter.jsRound(0.4 * sampleRate)
        let step = max(1, VoicePitchShifter.jsRound(0.1 * sampleRate))  // 75% 겹침
        var energies: [Double] = []
        if weighted.count <= block {
            // 400ms 보다 짧으면 통째로 한 블록.
            energies.append(meanSquare(0, weighted.count))
        } else {
            var start = 0
            while start + block <= weighted.count {
                energies.append(meanSquare(start, block))
                start += step
            }
        }
        let gated = energies.filter { $0 > 0 && loudness(ofMeanSquare: $0) > absoluteGateLufs }
        guard !gated.isEmpty else { return nil }
        return loudness(ofMeanSquare: gated.reduce(0, +) / Double(gated.count))
    }

    private static func loudness(ofMeanSquare meanSquare: Double) -> Double {
        -0.691 + 10 * log10(meanSquare)
    }
}

// MARK: - Biquad

/// 2차 IIR(Direct Form II transposed, 계수는 a0 로 정규화).
struct Biquad: Equatable, Sendable {
    var b0: Double, b1: Double, b2: Double, a1: Double, a2: Double

    /// RBJ 쿡북 저역통과(Q = 1/√2).
    static func lowpass(cutoff: Double, sampleRate: Double, q: Double = 0.7071067811865476) -> Biquad {
        let w0 = 2 * Double.pi * min(cutoff, sampleRate * 0.45) / sampleRate
        let cosW = cos(w0)
        let alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        return Biquad(
            b0: (1 - cosW) / 2 / a0,
            b1: (1 - cosW) / a0,
            b2: (1 - cosW) / 2 / a0,
            a1: -2 * cosW / a0,
            a2: (1 - alpha) / a0
        )
    }

    /// RBJ 쿡북 고역통과(Q = 1/√2) — ffmpeg `highpass` 기본값과 같다.
    static func highpass(cutoff: Double, sampleRate: Double, q: Double = 0.7071067811865476) -> Biquad {
        let w0 = 2 * Double.pi * min(cutoff, sampleRate * 0.45) / sampleRate
        let cosW = cos(w0)
        let alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        return Biquad(
            b0: (1 + cosW) / 2 / a0,
            b1: -(1 + cosW) / a0,
            b2: (1 + cosW) / 2 / a0,
            a1: -2 * cosW / a0,
            a2: (1 - alpha) / a0
        )
    }

    /// BS.1770 K-가중(고역 셸프 + 고역통과) — 임의 표본률용 계수(libebur128 과 같은 식).
    static func kWeighting(sampleRate: Double) -> [Biquad] {
        // 1단: 고역 셸프 +4dB @ ~1.68kHz
        var f0 = 1681.974450955533
        let gain = 3.999843853973347
        var q = 0.7071752369554196
        var k = tan(Double.pi * f0 / sampleRate)
        let vh = pow(10, gain / 20)
        let vb = pow(vh, 0.4996667741545416)
        var a0 = 1 + k / q + k * k
        let shelf = Biquad(
            b0: (vh + vb * k / q + k * k) / a0,
            b1: 2 * (k * k - vh) / a0,
            b2: (vh - vb * k / q + k * k) / a0,
            a1: 2 * (k * k - 1) / a0,
            a2: (1 - k / q + k * k) / a0
        )
        // 2단: 고역통과 ~38Hz
        f0 = 38.13547087602444
        q = 0.5003270373238773
        k = tan(Double.pi * f0 / sampleRate)
        a0 = 1 + k / q + k * k
        let highpass = Biquad(
            b0: 1,
            b1: -2,
            b2: 1,
            a1: 2 * (k * k - 1) / a0,
            a2: (1 - k / q + k * k) / a0
        )
        return [shelf, highpass]
    }

    /// 단을 차례로 건다 — 안드로이드 `Biquad.process` 와 **같은 셈**(Direct Form I, Double 로 누산해 단마다 Float 로).
    /// 예전에는 Direct Form II(전치)여서 두 앱의 결과가 마지막 자리에서 갈렸다(Codex #870).
    static func apply(_ sections: [Biquad], to input: [Float]) -> [Float] {
        var signal = input
        for c in sections {
            var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
            signal.withUnsafeMutableBufferPointer { p in
                for index in 0..<p.count {
                    let x0 = Double(p[index])
                    let y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
                    x2 = x1
                    x1 = x0
                    y2 = y1
                    y1 = y0
                    p[index] = Float(y0)
                }
            }
        }
        return signal
    }
}
