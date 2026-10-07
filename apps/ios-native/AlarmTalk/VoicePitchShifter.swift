import Accelerate
import AVFoundation
import Foundation

/// 목소리 **몸집은 그대로 두고 높이만** 바꾼다 — TD-PSOLA.
///
/// 원리: 성대 떨림 한 번마다 표시(pitch mark)를 찍고, 그 자리를 중심으로 두 주기 길이의 창을
/// 씌운 조각을 잘라 **간격만 1/배율로** 바꿔 다시 겹쳐 더한다. 조각 안의 파형(성도의 울림 =
/// 포먼트)은 그대로라 목소리 몸집이 유지되고, 떨림 간격(= 높이)만 바뀐다. 길이도 그대로다.
/// `AVAudioUnitTimePitch` 는 몸집까지 같이 움직여 변조된 목소리로 들렸다(2026-10-07 사용자 판단).
///
/// 안드로이드(`data/VoicePitchShifter.kt`)와 **같은 알고리즘·같은 숫자**다 — 2026-10-07 사용자가
/// 귀로 고른 소리를 두 앱에서 똑같이 내기 위해서다. 숫자를 바꾸면 양쪽을 같이 바꾼다(스펙 §4-3).
/// 무거운 두 곳(YIN 의 지연 상관, 표시 찾기의 정규화 상관)만 vDSP 로 계산한다 — Debug 빌드
/// (최적화 없음)에서 순수 Swift 루프로 돌면 몇 초씩 걸린다. 수식은 같다.
///
/// 한계: 크게 내리면(−5반음 이하) 조각 사이가 벌어져 거칠어질 수 있다. 무성음(ㅅ·ㅎ)은 그대로다.
enum VoicePitchShifter {

    /// 높이 추적에 쓰는 표본률.
    static let analysisRate: Double = 16_000
    /// 높이를 바꾼 뒤 봉우리 상한(−0.2 dBFS).
    static let peakCeiling: Float = 0.977

    struct Frame: Equatable, Sendable {
        var t: Double
        var f0: Double
        var rmsDb: Double
    }

    // MARK: - 전체 처리

    /// 높이를 `semitones` 만큼 바꾸고, 크기를 원래 소리와 같은 통합 라우드니스로 되맞춘다.
    /// 0 반음(눈금에 맞춘 뒤)이면 입력을 그대로 돌려준다. 결과 길이는 입력과 같다.
    static func render(samples: [Float], sampleRate: Double, semitones: Double) -> [Float] {
        let st = VoiceTuning(pitchSt: semitones, source: .user).normalized().pitchSt
        guard st != 0, !samples.isEmpty, sampleRate > 0 else { return samples }
        let analysis = resample(samples, from: sampleRate, to: analysisRate)
        var shifted = shift(samples, sampleRate: sampleRate, analysis: analysis, semitones: st)
        matchLoudness(
            &shifted,
            target: VoiceTuningAnalyzer.integratedLoudness(samples: samples, sampleRate: sampleRate),
            sampleRate: sampleRate
        )
        return shifted
    }

    /// 높이를 내리면 떨림 수가 줄어 소리가 작아진다 — 원래 크기(`target`, LUFS)로 되맞춘다.
    /// 봉우리는 [peakCeiling] 아래로 둔다(그 때문에 덜 맞을 수 있다). 잴 수 없으면 그대로 둔다.
    static func matchLoudness(_ samples: inout [Float], target: Double?, sampleRate: Double) {
        guard let target, target.isFinite, !samples.isEmpty,
              let current = VoiceTuningAnalyzer.integratedLoudness(samples: samples, sampleRate: sampleRate),
              current.isFinite else { return }
        var peak: Float = 0
        vDSP_maxmgv(samples, 1, &peak, vDSP_Length(samples.count))
        let wanted = Float(pow(10, (target - current) / 20))
        var gain = peak > 0 ? min(wanted, peakCeiling / peak) : wanted
        guard gain.isFinite, gain > 0 else { return }
        let count = vDSP_Length(samples.count)
        samples.withUnsafeMutableBufferPointer { p in
            guard let base = p.baseAddress else { return }
            vDSP_vsmul(base, 1, &gain, base, 1, count)
        }
    }

    // MARK: - TD-PSOLA

    /// - Parameters:
    ///   - x: 원래 소리(모노, `sampleRate`).
    ///   - analysis: 같은 소리를 [analysisRate] 로 바꾼 것(높이 추적용).
    static func shift(_ x: [Float], sampleRate sr: Double, analysis x16: [Float], semitones: Double) -> [Float] {
        guard !x.isEmpty, sr > 0 else { return x }
        let factor = pow(2, semitones / 12)
        let xl = Biquad.apply([Biquad.lowpass(cutoff: 900, sampleRate: sr)], to: x)
        let xa = Biquad.apply(
            [Biquad.highpass(cutoff: 40, sampleRate: analysisRate), Biquad.lowpass(cutoff: 1_200, sampleRate: analysisRate)],
            to: x16
        )
        let frames = yinTrack(xa, sampleRate: analysisRate, threshold: 0.2, winMs: 25)
        guard let firstT = frames.first?.t else { return x }

        // 5프레임 중앙값으로 매끈하게 + 30ms 이하 무성 틈 메우기.
        let f0 = frames.map(\.f0)
        var sm = f0.indices.map { i -> Double in
            guard f0[i] > 0 else { return 0 }
            let w = f0[max(0, i - 2)..<min(f0.count, i + 3)].filter { $0 > 0 }.sorted()
            return w[w.count / 2]
        }
        var i = 1
        while i < sm.count - 1 {
            if sm[i] != 0 { i += 1; continue }
            var j = i
            while j < sm.count, sm[j] == 0 { j += 1 }
            if j - i <= 3, sm[i - 1] != 0, j < sm.count {
                for k in i..<j { sm[k] = sm[i - 1] + (sm[j] - sm[i - 1]) * Double(k - i + 1) / Double(j - i + 1) }
            }
            i = j + 1
        }
        func f0At(_ n: Int) -> Double {
            let idx = jsRound((Double(n) / sr - firstT) / 0.01)
            return idx < 0 || idx >= sm.count ? 0 : sm[idx]
        }

        // 분석 표시
        let count = x.count
        let unvoicedHop = jsRound(sr * 0.005)
        var squares = [Double](repeating: 0, count: count + 1)
        for k in 0..<count { squares[k + 1] = squares[k] + Double(xl[k]) * Double(xl[k]) }
        var marks: [(n: Int, period: Int, voiced: Bool)] = []
        var template: [Float] = []
        var correlation: [Float] = []
        var n = 0
        var prevVoiced = false
        while n < count {
            let f = f0At(n)
            guard f > 0 else {
                marks.append((n, unvoicedHop, false))
                n += unvoicedHop
                prevVoiced = false
                continue
            }
            let period = jsRound(sr / f)
            var best = n
            if !prevVoiced {
                // 유성 첫 표시는 한 주기 안의 가장 큰 봉우리.
                var bestValue = -Float.infinity
                for k in n...min(count - 1, n + period) where xl[k] > bestValue {
                    bestValue = xl[k]
                    best = k
                }
            } else if let previous = marks.last?.n {
                // 직전 표시 주변 한 주기 파형과 가장 닮은 자리(정규화 상호상관)를 다음 표시로.
                let h = jsRound(Double(period) / 2)
                let lo = max(h, n - jsRound(0.15 * Double(period)))
                let hi = min(count - 1 - h, n + jsRound(0.15 * Double(period)))
                if lo <= hi, h > 0 {
                    template = (0..<(2 * h)).map { j in
                        let index = previous - h + j
                        return index >= 0 && index < count ? xl[index] : 0
                    }
                    var templateEnergy: Float = 0
                    vDSP_svesq(template, 1, &templateEnergy, vDSP_Length(template.count))
                    let candidates = hi - lo + 1
                    if correlation.count < candidates { correlation = [Float](repeating: 0, count: candidates) }
                    xl.withUnsafeBufferPointer { signal in
                        correlation.withUnsafeMutableBufferPointer { out in
                            vDSP_conv(
                                signal.baseAddress! + (lo - h), 1,
                                template, 1,
                                out.baseAddress!, 1,
                                vDSP_Length(candidates), vDSP_Length(2 * h)
                            )
                        }
                    }
                    var bestScore = -Double.infinity
                    for offset in 0..<candidates {
                        let k = lo + offset
                        let windowEnergy = squares[k + h] - squares[k - h]
                        let score = Double(correlation[offset]) / sqrt(Double(templateEnergy) * windowEnergy + 1e-12)
                        if score > bestScore {
                            bestScore = score
                            best = k
                        }
                    }
                }
            }
            if let last = marks.last?.n, best <= last { best = last + jsRound(0.5 * Double(period)) }
            marks.append((best, period, true))
            n = best + period
            prevVoiced = true
        }

        // 합성 — 표시 간격만 1/배율로 바꿔 다시 겹쳐 더한다.
        var y = [Float](repeating: 0, count: count)
        y.withUnsafeMutableBufferPointer { out in
            x.withUnsafeBufferPointer { src in
                var k = 0
                var ts = Double(marks[0].n)
                while ts < Double(count) {
                    while k + 1 < marks.count, abs(Double(marks[k + 1].n) - ts) <= abs(Double(marks[k].n) - ts) { k += 1 }
                    let mark = marks[k]
                    let p = Double(mark.period)
                    let left = jsRound(k > 0 ? min(max(Double(mark.n - marks[k - 1].n), 0.5 * p), 1.5 * p) : p)
                    let right = jsRound(k + 1 < marks.count ? min(max(Double(marks[k + 1].n - mark.n), 0.5 * p), 1.5 * p) : p)
                    let t0 = jsRound(ts)
                    for j in -left...right {
                        let s = mark.n + j, d = t0 + j
                        guard s >= 0, s < count, d >= 0, d < count else { continue }
                        let w = j < 0
                            ? 0.5 * (1 + cos(Double.pi * Double(j) / Double(left)))
                            : 0.5 * (1 + cos(Double.pi * Double(j) / Double(right)))
                        out[d] += src[s] * Float(w)
                    }
                    ts += mark.voiced ? p / factor : Double(unvoicedHop)
                }
            }
        }
        return y
    }

    // MARK: - YIN 높이 추적

    /// 10ms 간격 프레임마다 F0(Hz, 무성이면 0). 안드로이드 `VoicePitchShifter.pitchTrack` 과 같은 규칙:
    /// 문턱 아래 첫 골 → 포물선 보간, 가장 큰 프레임(95분위)보다 35dB 작으면 무성,
    /// 앞뒤 5프레임 중앙값에서 7반음 넘게 튄 프레임(옥타브 오류)은 버린다.
    static func yinTrack(
        _ x: [Float],
        sampleRate sr: Double,
        fmin: Double = 50,
        fmax: Double = 500,
        hopMs: Double = 10,
        threshold: Double = 0.2,
        winMs: Double = 25
    ) -> [Frame] {
        let hop = max(1, jsRound(sr * hopMs / 1_000))
        let window = jsRound(sr * winMs / 1_000)
        let tauMin = Int(floor(sr / fmax))
        let tauMax = Int(ceil(sr / fmin))
        guard window > 0, x.count > window + tauMax else { return [] }

        var squares = [Double](repeating: 0, count: x.count + 1)
        for k in 0..<x.count { squares[k + 1] = squares[k] + Double(x[k]) * Double(x[k]) }
        var lagged = [Float](repeating: 0, count: tauMax + 1)
        var cmnd = [Double](repeating: 1, count: tauMax + 2)
        var frames: [Frame] = []

        x.withUnsafeBufferPointer { p in
            var start = 0
            while start + window + tauMax < x.count {
                let head = squares[start + window] - squares[start]
                let rmsDb = 20 * log10(sqrt(max(0, head) / Double(window)) + 1e-12)
                // Σ_j x[s+j]·x[s+j+τ] (τ = 0…τmax) 를 한 번에.
                lagged.withUnsafeMutableBufferPointer { out in
                    vDSP_conv(p.baseAddress! + start, 1, p.baseAddress! + start, 1, out.baseAddress!, 1,
                              vDSP_Length(tauMax + 1), vDSP_Length(window))
                }
                // d(τ) = Σ(x_j − x_{j+τ})² = Σx_j² + Σx_{j+τ}² − 2Σx_j·x_{j+τ}, 누적 평균 정규화.
                var running = 0.0
                cmnd[0] = 1
                for tau in 1...tauMax {
                    let tail = squares[start + tau + window] - squares[start + tau]
                    let d = max(0, head + tail - 2 * Double(lagged[tau]))
                    running += d
                    cmnd[tau] = running > 0 ? d * Double(tau) / running : 1
                }
                var best = -1
                var tau = tauMin
                while tau <= tauMax {
                    if cmnd[tau] < threshold {
                        while tau + 1 <= tauMax, cmnd[tau + 1] < cmnd[tau] { tau += 1 }
                        best = tau
                        break
                    }
                    tau += 1
                }
                var f0 = 0.0
                if best > 0 {
                    var t = Double(best)
                    if best > 1, best < tauMax {
                        let a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1]
                        let den = a - 2 * b + c
                        if abs(den) > 1e-12 { t = Double(best) + 0.5 * (a - c) / den }
                    }
                    f0 = sr / t
                }
                frames.append(Frame(t: (Double(start) + Double(window) / 2) / sr, f0: f0, rmsDb: rmsDb))
                start += hop
            }
        }

        let sorted = frames.map(\.rmsDb).sorted()
        let loud = sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(floor(Double(sorted.count) * 0.95)))]
        for index in frames.indices where frames[index].rmsDb < loud - 35 { frames[index].f0 = 0 }
        for index in frames.indices where frames[index].f0 > 0 {
            var neighbours: [Double] = []
            for k in max(0, index - 5)...min(frames.count - 1, index + 5) where frames[k].f0 > 0 {
                neighbours.append(frames[k].f0)
            }
            guard neighbours.count >= 3 else { frames[index].f0 = 0; continue }
            neighbours.sort()
            if abs(12 * log2(frames[index].f0 / neighbours[neighbours.count / 2])) > 7 { frames[index].f0 = 0 }
        }
        return frames
    }

    // MARK: - 도우미

    /// `.5` 를 +∞ 쪽으로 올리는 반올림 — 안드로이드 `Math.round` 와 같은 표시 자리를 고른다.
    static func jsRound(_ value: Double) -> Int { Int(floor(value + 0.5)) }

    /// 표본률 바꾸기 — 안드로이드 `VoicePitchShifter.resample` 과 **같은 식**이다. 예전에는 시스템 표본률 변환기를 써서
    /// 분석(YIN·표시)에 들어가는 표본이 두 앱에서 달랐다 — 같은 목소리·같은 값이 두 앱에서 다르게 구워질 수 있었다
    /// (Codex #870). 내릴 때는 먼저 새 나이퀴스트 아래(0.45 × 목표)로 RBJ 저역통과(Q 1/√2)를 두 번 거르고(Direct
    /// Form I, Double 로 누산해 단마다 Float 로), `i × 원본/목표` 자리를 선형 보간한다. 길이는 `⌊n × 목표 / 원본⌋`.
    static func resample(_ x: [Float], from source: Double, to target: Double) -> [Float] {
        guard source != target, !x.isEmpty, source > 0, target > 0 else { return x }
        let src: [Float]
        if target < source {
            let filter = Biquad.lowpass(cutoff: 0.45 * target, sampleRate: source)
            src = directFormI(directFormI(x, filter), filter)
        } else {
            src = x
        }
        let count = max(1, Int(Int64(x.count) * Int64(target.rounded()) / Int64(source.rounded())))
        let step = source / target
        return (0..<count).map { index in
            let position = Double(index) * step
            let i0 = min(src.count - 1, Int(position))
            let i1 = min(src.count - 1, i0 + 1)
            let fraction = Float(position - Double(i0))
            return src[i0] + (src[i1] - src[i0]) * fraction
        }
    }

    /// 안드로이드 `VoicePitchShifter.biquad` 와 같은 순서의 셈 — 결과를 맞추려고 따로 둔다.
    private static func directFormI(_ x: [Float], _ c: Biquad) -> [Float] {
        var y = [Float](repeating: 0, count: x.count)
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in x.indices {
            let x0 = Double(x[i])
            let v = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = v
            y[i] = Float(v)
        }
        return y
    }
}
