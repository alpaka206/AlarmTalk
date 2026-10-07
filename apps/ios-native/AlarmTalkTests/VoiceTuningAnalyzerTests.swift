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

    // MARK: - 값 정규화·꼬리표

    func test_tuning_normalizesToStepAndRange() {
        XCTAssertEqual(VoiceTuning(pitchSt: -1.26, source: .user).normalized().pitchSt, -1.5)
        XCTAssertEqual(VoiceTuning(pitchSt: 4.2, source: .user).normalized().pitchSt, 3)
        XCTAssertEqual(VoiceTuning(pitchSt: -9, source: .user).normalized().pitchSt, -6)
        XCTAssertEqual(VoiceTuning(pitchSt: .nan, source: .user).normalized().pitchSt, 0)
    }

    func test_tuning_soundTagIsNilForNeutralAndIgnoresSource() {
        XCTAssertNil(VoiceTuning.neutral.soundTag)
        let a = VoiceTuning(pitchSt: -1.5, source: .user)
        let b = VoiceTuning(pitchSt: -1.5, source: .suggested)
        XCTAssertEqual(a.soundTag, "s-15")
        XCTAssertTrue(a.soundsSame(as: b))
        XCTAssertFalse(a.soundTag?.contains(".") ?? true, "점이 들어가면 스테이징 파일 확장자 판정이 깨진다")
    }

    // MARK: - 저장소

    func test_store_roundTripsAndClearsNeutral() throws {
        let suite = "voice-tuning-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = VoiceTuningStore(defaults: defaults)

        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v1"))
        let tuned = VoiceTuning(pitchSt: -2, source: .user)
        XCTAssertTrue(store.save(tuned, userID: "u1", voiceProfileID: "v1"), "값이 생기면 '바뀜'")
        XCTAssertEqual(store.tuning(userID: "u1", voiceProfileID: "v1"), tuned)
        XCTAssertNil(store.tuning(userID: "u2", voiceProfileID: "v1"), "계정마다 따로다")
        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v2"), "목소리마다 따로다")

        var sameSound = tuned
        sameSound.source = .suggested
        XCTAssertFalse(store.save(sameSound, userID: "u1", voiceProfileID: "v1"), "출처만 바뀌면 소리는 같다")

        XCTAssertTrue(store.save(.neutral, userID: "u1", voiceProfileID: "v1"))
        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v1"), "중립은 지운다")
        XCTAssertFalse(store.save(.neutral, userID: nil, voiceProfileID: "v1"), "계정 없이는 저장하지 않는다")
    }

    // MARK: - 지우기 (스펙 voice-and-message §4-3 — 사본·값은 원본을 지우는 때 같이 사라진다)

    /// 목소리 삭제·민감 동의 철회 — 그 목소리 값만 모든 계정에서 사라진다.
    func test_store_removeVoice_dropsOnlyThatVoice() throws {
        let suite = "voice-tuning-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = VoiceTuningStore(defaults: defaults)
        store.save(VoiceTuning(pitchSt: -2, source: .user), userID: "u1", voiceProfileID: "v1")
        store.save(VoiceTuning(pitchSt: 1.5, source: .user), userID: "u1", voiceProfileID: "v2")

        store.remove(voiceProfileID: "v1")

        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v1"))
        XCTAssertEqual(store.tuning(userID: "u1", voiceProfileID: "v2")?.pitchSt, 1.5)
    }

    /// 명시적 로그아웃·탈퇴 — 그 계정 값만 모두 사라진다(접두가 겹치는 계정은 남는다).
    func test_store_clearUser_dropsOnlyThatAccount() throws {
        let suite = "voice-tuning-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = VoiceTuningStore(defaults: defaults)
        store.save(VoiceTuning(pitchSt: -2, source: .user), userID: "u1", voiceProfileID: "v1")
        store.save(VoiceTuning(pitchSt: -1, source: .user), userID: "u1", voiceProfileID: "v2")
        store.save(VoiceTuning(pitchSt: -4, source: .user), userID: "u12", voiceProfileID: "v3")

        store.clear(userID: "u1")

        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v1"))
        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v2"))
        XCTAssertEqual(store.tuning(userID: "u12", voiceProfileID: "v3")?.pitchSt, -4)
    }

    /// 다른 기기의 제자리 교체(새 세대)는 옛 녹음 기준 값을 지우고, 같은 세대로 고른 값은 남긴다(Codex #870).
    func test_store_forgetIfReplaced_keepsTheSameGeneration() throws {
        let suite = "voice-tuning-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = VoiceTuningStore(defaults: defaults)
        store.save(VoiceTuning(pitchSt: -2, source: .user, generation: "g1"), userID: "u1", voiceProfileID: "v1")

        store.forgetIfReplaced(userID: "u1", voiceProfileID: "v1", generation: "g1")
        XCTAssertEqual(store.tuning(userID: "u1", voiceProfileID: "v1")?.pitchSt, -2, "같은 세대 — 이 기기에서 교체하며 고른 값")

        store.forgetIfReplaced(userID: "u1", voiceProfileID: "v1", generation: "g2")
        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "v1"), "다른 기기에서 다시 교체했다")

        // 교체 표식이 새 세대를 반영할 때 함께 지운다(같은 저장 공간).
        store.save(VoiceTuning(pitchSt: -3, source: .user, generation: "2026-10-01 00:00:00"), userID: "u1", voiceProfileID: "vp1")
        _ = VoiceReplacementMarkerStore(defaults: defaults).applyIfNotApplied(
            userID: "u1", profileID: "vp1", invalidatedAt: "2026-10-07 00:00:00"
        ) { [] }.confirm()
        XCTAssertNil(store.tuning(userID: "u1", voiceProfileID: "vp1"))
    }

    /// 명시적 로그아웃 때 지우는 것은 **높이를 구워 넣은** 스테이징 파일뿐이다(Codex #870).
    func test_tunedStagedFileName_matchesOnlyTunedCopies() {
        XCTAssertTrue(AlarmSoundStaging.isTunedStagedFileName("voice-abc-ts-15.caf"))
        XCTAssertTrue(AlarmSoundStaging.isTunedStagedFileName("voice-abc-v80-ts20.caf"))
        XCTAssertFalse(AlarmSoundStaging.isTunedStagedFileName("voice-abc.caf"))
        XCTAssertFalse(AlarmSoundStaging.isTunedStagedFileName("voice-abc-v80.caf"))
        XCTAssertFalse(AlarmSoundStaging.isTunedStagedFileName("voice-abc.m4a"))
        XCTAssertFalse(AlarmSoundStaging.isTunedStagedFileName("ringtone-ts-15.caf"))
    }

    /// 로그아웃 정리 **뒤에** 끝난 미리 굽기는 제가 게시한 파일을 지운다(Codex #870).
    func test_prestagePublishedAfterCleanup_isDiscarded() throws {
        let sounds = try FileManager.default
            .url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Sounds", isDirectory: true)
        try FileManager.default.createDirectory(at: sounds, withIntermediateDirectories: true)
        let late = sounds.appendingPathComponent("voice-late-\(UUID().uuidString.lowercased())-ts-15.caf")
        defer { try? FileManager.default.removeItem(at: late) }

        let epoch = AlarmSoundStaging.tunedCleanupEpoch
        AlarmSoundStaging.clearTunedStagedSoundFiles()          // 굽는 사이 로그아웃 정리가 지나갔다
        try Data(count: 64).write(to: late)                      // 그 뒤에 굽기가 게시했다
        AlarmSoundStaging.discardIfCleanedSince(epoch, late)
        XCTAssertFalse(FileManager.default.fileExists(atPath: late.path))

        try Data(count: 64).write(to: late)
        AlarmSoundStaging.discardIfCleanedSince(AlarmSoundStaging.tunedCleanupEpoch, late)
        XCTAssertTrue(FileManager.default.fileExists(atPath: late.path), "정리가 없었으면 그대로 둔다")
    }

    func test_clearTunedStagedSoundFiles_keepsUntunedFiles() throws {
        let sounds = try FileManager.default
            .url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Sounds", isDirectory: true)
        try FileManager.default.createDirectory(at: sounds, withIntermediateDirectories: true)
        let key = "tuning-logout-\(UUID().uuidString.lowercased())"
        let tuned = sounds.appendingPathComponent("voice-\(key)-ts-15.caf")
        let untuned = sounds.appendingPathComponent("voice-\(key).caf")
        try Data(count: 64).write(to: tuned)
        try Data(count: 64).write(to: untuned)
        defer {
            try? FileManager.default.removeItem(at: tuned)
            try? FileManager.default.removeItem(at: untuned)
        }

        AlarmSoundStaging.clearTunedStagedSoundFiles()

        XCTAssertFalse(FileManager.default.fileExists(atPath: tuned.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: untuned.path))
    }

    /// 등록 미리듣기 사본은 통째로 지울 수 있다.
    func test_clearPreviewFiles_removesTheFolder() throws {
        let dir = VoiceTuningRenderer.previewDirectory
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("draft_preview_x-ts-15.caf")
        try Data(count: 64).write(to: file)

        VoiceTuningRenderer.clearPreviewFiles()

        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
    }
}
