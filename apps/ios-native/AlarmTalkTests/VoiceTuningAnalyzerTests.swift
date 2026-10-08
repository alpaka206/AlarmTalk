import XCTest
@testable import AlarmTalk

/// 다듬기 **자동 추천** 계산을 고정한다 — F0(YIN)·라우드니스(BS.1770 근사, 크기 되맞춤에 쓴다)·반올림·자르기.
final class VoiceTuningAnalyzerTests: XCTestCase {

    // MARK: - 합성 신호

    private func sine(hz: Double, seconds: Double, sampleRate: Double, amplitude: Float = 0.5) -> [Float] {
        let count = Int(seconds * sampleRate)
        return (0..<count).map { amplitude * Float(sin(2 * Double.pi * hz * Double($0) / sampleRate)) }
    }

    // MARK: - F0

    /// 높이 측정은 **두 앱이 같은 값**을 낸다 — 기대값은 안드로이드 `VoiceTuningAnalysisTest` 와 같은 숫자다(같은 식을
    /// 파이썬으로 따로 셈한 값, Codex #870). 앞 0.2초 무음 + 떨림(160±15 Hz) 있는 배음 소리.
    func test_medianF0_matchesAndroid() throws {
        let sr = 44_100
        var phase = 0.0
        let x: [Float] = (0..<sr).map { i in
            let t = Double(i) / Double(sr)
            if t < 0.2 { return 0 }
            let f = 160 + 15 * sin(2 * .pi * 1.3 * t)
            phase += 2 * .pi * f / Double(sr)
            return Float(0.4 * (sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase)))
        }
        let f0 = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: x, sampleRate: Double(sr)))
        XCTAssertEqual(f0, 160.19798146036143, accuracy: 1e-4)
    }

    /// 유성 프레임 하한은 두 앱이 같다 — 안드로이드 `VoiceTuningAnalysis.MIN_VOICED_FRAMES`(Codex #870).
    func test_minVoicedFrames_matchesAndroid() {
        XCTAssertEqual(VoiceTuningAnalyzer.minVoicedFrames, 5)
    }

    func test_medianF0_findsSinePitchWithinOnePercent() throws {
        for sampleRate in [44_100.0, 24_000.0, 16_000.0] {
            for hz in [90.0, 120.0, 220.0, 330.0, 450.0] {
                let estimate = try XCTUnwrap(
                    VoiceTuningAnalyzer.medianF0(
                        samples: sine(hz: hz, seconds: 0.6, sampleRate: sampleRate),
                        sampleRate: sampleRate
                    ),
                    "\(hz)Hz @ \(sampleRate) 에서 F0 를 못 찾았다"
                )
                XCTAssertEqual(estimate, hz, accuracy: hz * 0.01, "\(hz)Hz @ \(sampleRate)")
            }
        }
    }

    func test_medianF0_ignoresSilenceAroundSpeech() throws {
        let rate = 24_000.0
        let silence = [Float](repeating: 0, count: Int(rate * 0.5))
        let samples = silence + sine(hz: 180, seconds: 0.5, sampleRate: rate) + silence
        let estimate = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: samples, sampleRate: rate))
        XCTAssertEqual(estimate, 180, accuracy: 1.8)
    }

    func test_medianF0_isNilForSilenceAndTooShortInput() {
        XCTAssertNil(VoiceTuningAnalyzer.medianF0(samples: [Float](repeating: 0, count: 24_000), sampleRate: 24_000))
        XCTAssertNil(VoiceTuningAnalyzer.medianF0(samples: sine(hz: 200, seconds: 0.01, sampleRate: 24_000), sampleRate: 24_000))
        XCTAssertNil(VoiceTuningAnalyzer.medianF0(samples: [], sampleRate: 24_000))
    }

    // MARK: - 라우드니스

    /// BS.1770 의 기준점: 1kHz, 0dBFS 사인 한 채널은 −3.01 LUFS.
    func test_loudness_fullScale1kSineReadsMinus3LUFS() throws {
        for rate in [48_000.0, 44_100.0] {
            let lufs = try XCTUnwrap(
                VoiceTuningAnalyzer.integratedLoudness(samples: sine(hz: 1_000, seconds: 2, sampleRate: rate, amplitude: 1), sampleRate: rate)
            )
            XCTAssertEqual(lufs, -3.01, accuracy: 0.1, "@\(rate)")
        }
    }

    func test_loudness_halvingAmplitudeDropsSixDB() throws {
        let rate = 44_100.0
        let loud = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: sine(hz: 1_000, seconds: 1, sampleRate: rate, amplitude: 0.5), sampleRate: rate))
        let quiet = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: sine(hz: 1_000, seconds: 1, sampleRate: rate, amplitude: 0.25), sampleRate: rate))
        XCTAssertEqual(loud - quiet, 6.02, accuracy: 0.1)
    }

    func test_loudness_absoluteGateDropsNearSilence() {
        let rate = 44_100.0
        // −90 dBFS 근처 — 절대 게이트(−70 LUFS) 아래라 잴 것이 없다.
        XCTAssertNil(VoiceTuningAnalyzer.integratedLoudness(samples: sine(hz: 1_000, seconds: 1, sampleRate: rate, amplitude: 0.00003), sampleRate: rate))
        XCTAssertNil(VoiceTuningAnalyzer.integratedLoudness(samples: [Float](repeating: 0, count: 44_100), sampleRate: rate))
    }

    // MARK: - 반올림·자르기

    func test_roundToHalf() {
        XCTAssertEqual(VoiceTuningAnalyzer.roundToHalf(1.24), 1.0)
        XCTAssertEqual(VoiceTuningAnalyzer.roundToHalf(1.25), 1.5)
        XCTAssertEqual(VoiceTuningAnalyzer.roundToHalf(-1.25), -1.5)
        XCTAssertEqual(VoiceTuningAnalyzer.roundToHalf(-0.2), 0)
        XCTAssertEqual(VoiceTuningAnalyzer.roundToHalf(-0.2).sign, .plus, "−0 이 표시에 새지 않게")
    }

    func test_suggestedPitch_undoesTheShiftAndRoundsToHalf() {
        // 미리듣기가 2반음 높다 → −2 로 되돌린다.
        let higher = 200 * pow(2, 2.0 / 12)
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: higher, sourceF0: 200), -2)
        // 1.8 반음 낮다 → +2.0(0.5 단위 반올림).
        let lower = 200 * pow(2, -1.8 / 12)
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: lower, sourceF0: 200), 2)
    }

    func test_suggestedPitch_deadZoneBelowOneAndAHalf() {
        let oneSemitone = 200 * pow(2, 1.0 / 12)
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: oneSemitone, sourceF0: 200), 0)
        // 1.4 반음 → 반올림하면 1.5 — 데드존은 반올림한 값에 건다.
        let almost = 200 * pow(2, -1.4 / 12)
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: almost, sourceF0: 200), 1.5)
    }

    func test_suggestedPitch_clampsToRange() {
        // 미리듣기가 한 옥타브 높다 → −12 → −6 으로 자른다.
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: 400, sourceF0: 200), -6)
        // 한 옥타브 낮다 → +12 → +3 으로 자른다.
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: 100, sourceF0: 200), 3)
    }

    func test_suggestedPitch_isZeroWithoutTheRecording() {
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: 220, sourceF0: nil), 0)
        XCTAssertEqual(VoiceTuningAnalyzer.suggestedPitch(previewF0: nil, sourceF0: 220), 0)
    }

    func test_suggest_isNeutralWhenTheRecordingIsMissing() {
        let preview = VoiceTuningAnalyzer.Measurement(medianF0: 260)
        let suggestion = VoiceTuningAnalyzer.suggest(preview: preview, source: nil)
        XCTAssertEqual(suggestion.pitchSt, 0)
        XCTAssertTrue(suggestion.isNeutral)
        XCTAssertEqual(suggestion.source, .suggested)
    }

    func test_suggest_fromSyntheticSignals() {
        // 원래 녹음 150Hz, 미리듣기 200Hz(+4.98반음) → −5.0.
        let rate = 24_000.0
        let source = VoiceTuningAnalyzer.measure(samples: sine(hz: 150, seconds: 0.6, sampleRate: rate), sampleRate: rate)
        let preview = VoiceTuningAnalyzer.measure(samples: sine(hz: 200, seconds: 0.6, sampleRate: rate, amplitude: 0.1), sampleRate: rate)
        let suggestion = VoiceTuningAnalyzer.suggest(preview: preview, source: source)
        XCTAssertEqual(suggestion.pitchSt, -5)
    }

    // MARK: - 값 정규화·비교

    func test_tuning_normalizesToStepAndRange() {
        XCTAssertEqual(VoiceTuning(pitchSt: -1.26, source: .user).normalized().pitchSt, -1.5)
        XCTAssertEqual(VoiceTuning(pitchSt: 4.2, source: .user).normalized().pitchSt, 3)
        XCTAssertEqual(VoiceTuning(pitchSt: -9, source: .user).normalized().pitchSt, -6)
        XCTAssertEqual(VoiceTuning(pitchSt: .nan, source: .user).normalized().pitchSt, 0)
    }

    /// 들리는 소리는 높이 하나로 가른다 — 출처(추천·사용자)는 보지 않는다. 눈금 아래 값은 원래 소리(0)다.
    func test_tuning_comparesBySoundAndIgnoresSource() {
        XCTAssertTrue(VoiceTuning.neutral.isNeutral)
        XCTAssertTrue(VoiceTuning(pitchSt: 0.2, source: .user).isNeutral)
        let a = VoiceTuning(pitchSt: -1.5, source: .user)
        let b = VoiceTuning(pitchSt: -1.5, source: .suggested)
        XCTAssertFalse(a.isNeutral)
        XCTAssertTrue(a.soundsSame(as: b))
        XCTAssertTrue(a.soundsSame(as: VoiceTuning(pitchSt: -1.4, source: .user)), "눈금에 맞춘 뒤 비교한다")
        XCTAssertFalse(a.soundsSame(as: VoiceTuning(pitchSt: -2, source: .user)))
    }
}
