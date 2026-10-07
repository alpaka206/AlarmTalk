import AVFoundation
import Foundation

/// 다듬기 **자동 추천값** — 기기 안에서 계산하는 순수 함수만 둔다(격리 없음).
///
/// 두 소리를 잰다: (a) 등록 녹음(기기에 남아 있으면), (b) 미리듣기 클립.
/// 높이 = 두 소리의 중앙 기본주파수(F0) 차이를 반음으로 바꿔 **되돌리는** 값.
///   pitchSt = −round_to_0.5(12·log2(previewF0 / sourceF0)), |값| < 1.5 이면 0, −6…+3 로 자른다.
/// 녹음이 없으면 추천은 0 이다.
///
/// 측정은 근사다: F0 는 YIN(문턱 0.2, 25ms 프레임, 50–500Hz, 앞에 ~1.2kHz 저역통과).
/// 라우드니스(BS.1770 K-가중 + 400ms 블록, 절대 게이트 −70 LUFS)는 추천에 쓰지 않고, 높이를
/// 바꾼 소리의 크기를 원래대로 되맞출 때(`VoicePitchShifter.matchLoudness`) 쓴다.
enum VoiceTuningAnalyzer {

    struct Measurement: Equatable, Sendable {
        var medianF0: Double?
    }

    static let pitchDeadZoneSt: Double = 1.5
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

    /// 유성 프레임 F0 의 중앙값(Hz). 유성 프레임이 셋 미만이면 nil.
    static func medianF0(samples: [Float], sampleRate: Double) -> Double? {
        guard sampleRate > 0, !samples.isEmpty else { return nil }
        let lowpass = Biquad.lowpass(cutoff: lowpassHz, sampleRate: sampleRate)
        let filtered = Biquad.apply([lowpass, lowpass], to: samples)

        let factor = max(1, Int(sampleRate / analysisRateHz))
        let rate = sampleRate / Double(factor)
        let x: [Double] = stride(from: 0, to: filtered.count, by: factor).map { Double(filtered[$0]) }

        let window = max(1, Int((frameSeconds * rate).rounded()))
        let hop = max(1, Int((hopSeconds * rate).rounded()))
        let tauMin = max(2, Int(rate / maxF0))
        let tauMax = Int((rate / minF0).rounded(.up))
        let span = window + tauMax + 1
        guard x.count >= span else { return nil }

        // 무음·잡음 프레임은 YIN 이 아무 주기나 집는다 — 가장 큰 프레임보다 30dB 아래는 버린다.
        var starts: [Int] = []
        var energies: [Double] = []
        var start = 0
        x.withUnsafeBufferPointer { p in
            while start + span <= p.count {
                var energy = 0.0
                for j in 0..<window { energy += p[start + j] * p[start + j] }
                starts.append(start)
                energies.append(energy / Double(window))
                start += hop
            }
        }
        guard let maxEnergy = energies.max(), maxEnergy > 1e-12 else { return nil }
        let energyGate = maxEnergy * 1e-3  // −30 dB

        var diff = [Double](repeating: 0, count: tauMax + 2)
        var cmnd = [Double](repeating: 1, count: tauMax + 2)
        var f0s: [Double] = []
        x.withUnsafeBufferPointer { p in
            for (frame, begin) in starts.enumerated() where energies[frame] >= energyGate {
                // 차이 함수 d(τ) = Σ (x_j − x_{j+τ})²
                for tau in 1...(tauMax + 1) {
                    var sum = 0.0
                    for j in 0..<window {
                        let delta = p[begin + j] - p[begin + j + tau]
                        sum += delta * delta
                    }
                    diff[tau] = sum
                }
                // 누적 평균 정규화 d'(τ)
                var running = 0.0
                cmnd[0] = 1
                for tau in 1...(tauMax + 1) {
                    running += diff[tau]
                    cmnd[tau] = running > 0 ? diff[tau] * Double(tau) / running : 1
                }
                // 문턱 아래로 처음 내려간 골의 바닥
                var estimate = -1
                var tau = tauMin
                while tau <= tauMax {
                    if cmnd[tau] < yinThreshold {
                        while tau + 1 <= tauMax, cmnd[tau + 1] < cmnd[tau] { tau += 1 }
                        estimate = tau
                        break
                    }
                    tau += 1
                }
                guard estimate > 0 else { continue }
                // 포물선 보간으로 τ 를 소수점까지
                let s0 = cmnd[estimate - 1], s1 = cmnd[estimate], s2 = cmnd[estimate + 1]
                let denominator = s0 + s2 - 2 * s1
                let shift = denominator != 0 ? 0.5 * (s0 - s2) / denominator : 0
                let refined = Double(estimate) + min(max(shift, -1), 1)
                let f0 = rate / refined
                if f0 >= minF0, f0 <= maxF0 { f0s.append(f0) }
            }
        }
        guard f0s.count >= 3 else { return nil }
        let sorted = f0s.sorted()
        let mid = sorted.count / 2
        return sorted.count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    // MARK: 라우드니스 (BS.1770 근사)

    /// 통합 라우드니스(LUFS). 게이트를 넘는 블록이 없으면 nil.
    static func integratedLoudness(samples: [Float], sampleRate: Double) -> Double? {
        guard sampleRate > 0, !samples.isEmpty else { return nil }
        let weighted = Biquad.apply(Biquad.kWeighting(sampleRate: sampleRate), to: samples)
        // 누적 제곱합 — 블록 에너지를 O(1) 로 꺼낸다.
        var prefix = [Double](repeating: 0, count: weighted.count + 1)
        for index in 0..<weighted.count {
            let value = Double(weighted[index])
            prefix[index + 1] = prefix[index] + value * value
        }
        let block = Int(0.4 * sampleRate)
        let step = max(1, Int(0.1 * sampleRate))  // 75% 겹침
        var energies: [Double] = []
        if weighted.count < block {
            // 400ms 보다 짧으면 통째로 한 블록.
            energies.append(prefix[weighted.count] / Double(weighted.count))
        } else {
            var start = 0
            while start + block <= weighted.count {
                energies.append((prefix[start + block] - prefix[start]) / Double(block))
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

    static func apply(_ sections: [Biquad], to input: [Float]) -> [Float] {
        var signal = input
        for section in sections {
            var z1 = 0.0, z2 = 0.0
            signal.withUnsafeMutableBufferPointer { p in
                for index in 0..<p.count {
                    let x = Double(p[index])
                    let y = section.b0 * x + z1
                    z1 = section.b1 * x - section.a1 * y + z2
                    z2 = section.b2 * x - section.a2 * y
                    p[index] = Float(y)
                }
            }
        }
        return signal
    }
}
