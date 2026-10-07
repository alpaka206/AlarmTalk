import XCTest
@testable import AlarmTalk

/// TD-PSOLA(`VoicePitchShifter`) — 높이는 바뀌고, 길이·크기는 그대로인가.
final class VoicePitchShifterTests: XCTestCase {

    /// 말소리 비슷한 배음 신호 — 기본음 + 배음 넷(뒤로 갈수록 작게).
    private func harmonicTone(hz: Double, seconds: Double, sampleRate: Double, amplitude: Float = 0.3) -> [Float] {
        let count = Int(seconds * sampleRate)
        let weights: [Double] = [1, 0.6, 0.4, 0.25, 0.15]
        let norm = weights.reduce(0, +)
        return (0..<count).map { index in
            let t = Double(index) / sampleRate
            var value = 0.0
            for (k, w) in weights.enumerated() { value += w * sin(2 * Double.pi * hz * Double(k + 1) * t) }
            return amplitude * Float(value / norm)
        }
    }

    private func semitones(_ measured: Double, from reference: Double) -> Double {
        12 * log2(measured / reference)
    }

    func test_shiftsPitchAndKeepsLength() throws {
        let rate = 44_100.0
        let input = harmonicTone(hz: 120, seconds: 1.5, sampleRate: rate)
        for st in [-3.0, -6.0, 2.0] {
            let output = VoicePitchShifter.render(samples: input, sampleRate: rate, semitones: st)
            XCTAssertEqual(output.count, input.count, "길이가 바뀌었다(\(st)반음)")
            let f0 = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: output, sampleRate: rate), "\(st)반음 결과에서 높이를 못 쟀다")
            XCTAssertEqual(semitones(f0, from: 120), st, accuracy: 0.5, "\(st)반음인데 \(f0)Hz")
        }
    }

    func test_zeroSemitonesReturnsTheInputUnchanged() {
        let rate = 24_000.0
        let input = harmonicTone(hz: 150, seconds: 0.5, sampleRate: rate)
        XCTAssertEqual(VoicePitchShifter.render(samples: input, sampleRate: rate, semitones: 0), input)
        // 눈금(0.5) 아래 값도 0 으로 맞춰져 그대로다.
        XCTAssertEqual(VoicePitchShifter.render(samples: input, sampleRate: rate, semitones: 0.2), input)
    }

    func test_loudnessIsMatchedToTheInput() throws {
        let rate = 44_100.0
        let input = harmonicTone(hz: 130, seconds: 1.5, sampleRate: rate, amplitude: 0.25)
        let before = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: input, sampleRate: rate))
        for st in [-5.0, 3.0] {
            let output = VoicePitchShifter.render(samples: input, sampleRate: rate, semitones: st)
            let after = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: output, sampleRate: rate))
            XCTAssertEqual(after, before, accuracy: 0.5, "\(st)반음: \(before) → \(after) LUFS")
            XCTAssertLessThanOrEqual(output.map { abs($0) }.max() ?? 0, VoicePitchShifter.peakCeiling + 1e-4)
        }
    }

    func test_silenceAndUnvoicedInputPassThroughSafely() {
        let rate = 16_000.0
        let silence = [Float](repeating: 0, count: Int(rate))
        let output = VoicePitchShifter.render(samples: silence, sampleRate: rate, semitones: -3)
        XCTAssertEqual(output.count, silence.count)
        XCTAssertFalse(output.contains { !$0.isFinite })
        XCTAssertEqual(VoicePitchShifter.render(samples: [], sampleRate: rate, semitones: -3), [])
    }

    /// 높이 추적과 변환 결과는 **두 앱이 같다** — 기대값은 안드로이드 `VoicePitchShifterTest` 와 같은 숫자다(같은 입력을
    /// 두 앱에서 돌려 맞춘 값, Codex #870). 앞 0.2초 무음 + 떨림(160±15 Hz) 있는 배음 소리를 −2 반음.
    func test_pitchTrackAndShift_matchAndroid() {
        let sr = 44_100
        var phase = 0.0
        let x: [Float] = (0..<sr).map { i in
            let t = Double(i) / Double(sr)
            if t < 0.2 { return 0 }
            let f = 160 + 15 * sin(2 * .pi * 1.3 * t)
            phase += 2 * .pi * f / Double(sr)
            return Float(0.4 * (sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase)))
        }
        let analysis = VoicePitchShifter.resample(x, from: 44_100, to: 16_000)
        let filtered = Biquad.apply(
            [Biquad.highpass(cutoff: 40, sampleRate: 16_000), Biquad.lowpass(cutoff: 1_200, sampleRate: 16_000)],
            to: analysis
        )
        let frames = VoicePitchShifter.yinTrack(filtered, sampleRate: 16_000)
        XCTAssertEqual(frames.count, 96)
        XCTAssertEqual(frames.filter { $0.f0 > 0 }.count, 77)
        XCTAssertEqual(frames.reduce(0.0) { $0 + $1.f0 }, 12322.340158236248, accuracy: 1e-6)

        let y = VoicePitchShifter.render(samples: x, sampleRate: 44_100, semitones: -2)
        XCTAssertEqual(y.count, 44_100)
        XCTAssertEqual(y.reduce(0.0) { $0 + Double(abs($1)) }, 9739.548, accuracy: 1e-3)
        XCTAssertEqual(y[30_000], 0.32448906, accuracy: 1e-6)
        XCTAssertEqual(y[40_000], 0.546782, accuracy: 1e-6)
    }

    func test_yinTrack_findsTheFundamental() {
        let rate = VoicePitchShifter.analysisRate
        let frames = VoicePitchShifter.yinTrack(harmonicTone(hz: 200, seconds: 0.6, sampleRate: rate), sampleRate: rate)
        let voiced = frames.map(\.f0).filter { $0 > 0 }.sorted()
        XCTAssertGreaterThan(voiced.count, 20)
        XCTAssertEqual(voiced[voiced.count / 2], 200, accuracy: 2)
    }

    /// 표본률 바꾸기는 **두 앱이 같은 값**을 낸다 — 기대값은 안드로이드 `VoicePitchShifterTest` 와 같은 숫자다
    /// (같은 식을 파이썬으로 따로 셈한 값, Codex #870). 9 kHz 성분은 새 나이퀴스트(8 kHz) 위라 걸러져야 한다.
    func test_resample_matchesTheAndroidImplementation() {
        let sr = 44_100.0
        let x: [Float] = (0..<4_410).map { i in
            let t = Double(i) / sr
            return Float(0.5 * sin(2 * .pi * 220 * t) + 0.25 * sin(2 * .pi * 3_100 * t) + 0.1 * sin(2 * .pi * 9_000 * t))
        }
        let y = VoicePitchShifter.resample(x, from: 44_100, to: 16_000)
        XCTAssertEqual(y.count, 1_600)
        XCTAssertEqual(y[1], 0.08122162520885468, accuracy: 1e-5)
        XCTAssertEqual(y[100], 0.5854929089546204, accuracy: 1e-5)
        XCTAssertEqual(y[777], -0.24569550156593323, accuracy: 1e-5)
        XCTAssertEqual(y[1_599], -0.26356241106987, accuracy: 1e-5)
        XCTAssertEqual(y.reduce(0.0) { $0 + Double(abs($1)) }, 539.0014692312106, accuracy: 1e-2)
    }

    func test_resampleKeepsDurationAndPitch() throws {
        let tone = harmonicTone(hz: 180, seconds: 1, sampleRate: 44_100)
        let down = VoicePitchShifter.resample(tone, from: 44_100, to: 16_000)
        XCTAssertEqual(Double(down.count), 16_000, accuracy: 200)
        let f0 = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: down, sampleRate: 16_000))
        XCTAssertEqual(f0, 180, accuracy: 2)
    }
}
