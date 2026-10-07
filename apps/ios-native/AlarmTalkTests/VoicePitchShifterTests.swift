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

    func test_yinTrack_findsTheFundamental() {
        let rate = VoicePitchShifter.analysisRate
        let frames = VoicePitchShifter.yinTrack(harmonicTone(hz: 200, seconds: 0.6, sampleRate: rate), sampleRate: rate)
        let voiced = frames.map(\.f0).filter { $0 > 0 }.sorted()
        XCTAssertGreaterThan(voiced.count, 20)
        XCTAssertEqual(voiced[voiced.count / 2], 200, accuracy: 2)
    }

    func test_resampleKeepsDurationAndPitch() throws {
        let tone = harmonicTone(hz: 180, seconds: 1, sampleRate: 44_100)
        let down = VoicePitchShifter.resample(tone, from: 44_100, to: 16_000)
        XCTAssertEqual(Double(down.count), 16_000, accuracy: 200)
        let f0 = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: down, sampleRate: 16_000))
        XCTAssertEqual(f0, 180, accuracy: 2)
    }
}
