import AVFoundation
import XCTest
@testable import AlarmTalk

/// **다듬기가 AlarmKit 이 받는 파일에 실제로 구워지는가** — 파일을 재서 답한다.
///
/// AlarmKit 은 파일 이름만 받는다. 다듬기를 실을 자리는 `AlarmSoundStaging` 이 쓰는 그
/// 파일의 샘플값뿐이다(음량 슬라이더와 같은 사정 — `AlarmSoundVolumeTests`).
@MainActor
final class VoiceTuningStagingTests: XCTestCase {

    private func makeSineWAV(hz: Double, seconds: Double, amplitude: Float, sampleRate: Double = 44_100) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tuning-\(UUID().uuidString).wav")
        let format = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false
        ))
        let file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ]
        )
        let frames = AVAudioFrameCount(seconds * sampleRate)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames))
        buffer.frameLength = frames
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])
        for index in 0..<Int(frames) {
            samples[index] = amplitude * Float(sin(2 * Double.pi * hz * Double(index) / sampleRate))
        }
        try file.write(from: buffer)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func stagedURL(named baseName: String) throws -> URL {
        let dir = try XCTUnwrap(FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first)
            .appendingPathComponent("Sounds", isDirectory: true)
        let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        let match = try XCTUnwrap(
            entries.first { ($0 as NSString).deletingPathExtension == baseName },
            "스테이징 산출물이 없다 (\(baseName))"
        )
        return dir.appendingPathComponent(match)
    }

    private func rms(_ url: URL) throws -> Double {
        let decoded = try VoiceTuningAnalyzer.decodeMono(url: url, maxSeconds: 60)
        guard !decoded.samples.isEmpty else { return 0 }
        let sum = decoded.samples.reduce(0.0) { $0 + Double($1) * Double($1) }
        return sqrt(sum / Double(decoded.samples.count))
    }

    private func uniqueKey(_ name: String) -> String {
        let key = "tuning-\(name)-\(UUID().uuidString)"
        addTeardownBlock { AlarmSoundStaging.clearStagedSoundFiles(forKey: key) }
        return key
    }

    // MARK: -

    /// 로그아웃 때 취소에 실패한 예약이 남아 못 지운 파일은 '미뤄 둔 정리' 로 적었다가, 남은 취소가 끝나면 지운다.
    /// 같은 계정이 다시 로그인해 그 파일로 예약을 걸면 — 예약하는 동안은 지우지 않고, **성공한 뒤에만** 목록에서 뺀다.
    /// 실패하면 표시가 남아 나중에 지워진다(Codex #870).
    func test_deferredTunedCleanup_keepsTheMarkerUntilAReservationSucceeds() throws {
        AlarmSoundStaging.finishDeferredTunedCleanup()
        let source = try makeSineWAV(hz: 140, seconds: 1, amplitude: 0.3)
        let key = uniqueKey("deferred")
        let tuning = VoiceTuning(pitchSt: -2, source: .user)
        let reused = try stagedURL(named: try AlarmSoundStaging.stage(url: source, key: key, tuning: tuning))
        let name = reused.lastPathComponent
        XCTAssertEqual(AlarmSoundStaging.tunedStagedFileName(key: key, volumePercent: 100, tuning: tuning), name)
        let sounds = reused.deletingLastPathComponent()
        let orphan = sounds.appendingPathComponent("voice-deferred-orphan-\(UUID().uuidString.lowercased())-ts-15.caf")
        try Data(count: 64).write(to: orphan)
        addTeardownBlock { try? FileManager.default.removeItem(at: orphan) }
        AlarmSoundStaging.deferTunedStagedSoundFiles()
        XCTAssertTrue(AlarmSoundStaging.deferredTunedCleanupNames.contains(orphan.lastPathComponent))

        // 다시 로그인해 같은 파일로 예약을 건다 — 예약하는 동안 남은 취소가 끝나도 그 파일은 지우지 않는다.
        AlarmSoundStaging.beginTunedReservation(name)
        AlarmSoundStaging.finishDeferredTunedCleanup()
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path), "쓰지 않는 파일은 지운다")
        XCTAssertTrue(FileManager.default.fileExists(atPath: reused.path))
        XCTAssertTrue(AlarmSoundStaging.deferredTunedCleanupNames.contains(name))

        // 예약이 실패했다 — 표시가 남아 다음 정리에서 지워진다.
        AlarmSoundStaging.endTunedReservation(name, succeeded: false)
        XCTAssertTrue(AlarmSoundStaging.deferredTunedCleanupNames.contains(name))

        // 다시 걸어 성공했다 — 이제 그 예약이 쓰는 파일이다.
        AlarmSoundStaging.beginTunedReservation(name)
        AlarmSoundStaging.endTunedReservation(name, succeeded: true)
        XCTAssertFalse(AlarmSoundStaging.deferredTunedCleanupNames.contains(name))
        AlarmSoundStaging.finishDeferredTunedCleanup()
        XCTAssertTrue(FileManager.default.fileExists(atPath: reused.path), "예약이 쓰는 파일은 지우지 않는다")
    }

    /// 늦은 미리듣기 굽기는 제 임시 파일만 버린다 — 그 사이 같은 이름으로 게시된 새 굽기의 사본은 그대로(Codex #870).
    func test_latePreviewRender_doesNotDeleteTheNewerCopy() throws {
        let dir = VoiceTuningRenderer.previewDirectory
        let stale = VoiceTuningRenderer.currentPreviewEpoch
        VoiceTuningRenderer.clearPreviewFiles()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("late-\(UUID().uuidString)-ts-15.caf")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }

        let fresh = dir.appendingPathComponent("\(UUID().uuidString).caf")
        try Data([1, 2, 3]).write(to: fresh)
        XCTAssertTrue(try VoiceTuningRenderer.publishPreview(fresh, to: url, ifEpoch: VoiceTuningRenderer.currentPreviewEpoch))
        let staleTmp = dir.appendingPathComponent("\(UUID().uuidString).caf")
        try Data([9]).write(to: staleTmp)
        XCTAssertFalse(try VoiceTuningRenderer.publishPreview(staleTmp, to: url, ifEpoch: stale))

        XCTAssertFalse(FileManager.default.fileExists(atPath: staleTmp.path), "늦은 굽기의 임시 파일은 버린다")
        XCTAssertEqual(try Data(contentsOf: url), Data([1, 2, 3]), "새 굽기의 사본은 그대로")
    }

    /// 캐시가 같은 이름으로 원본을 제자리에서 갈아끼우면 미리듣기 사본 이름도 바뀐다 — 옛 바이트로 구운 사본을 다시
    /// 쓰지 않게(Codex #870).
    func test_previewFileName_changesWhenTheSourceIsReplacedInPlace() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("preview-src-\(UUID().uuidString).mp3")
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        try Data(count: 128).write(to: source, options: .atomic)
        let before = VoiceTuningRenderer.previewFileURL(for: source, tag: "s-15")
        XCTAssertEqual(before, VoiceTuningRenderer.previewFileURL(for: source, tag: "s-15"), "같은 원본이면 같은 사본")

        try Data(count: 128).write(to: source, options: .atomic)   // 같은 이름·같은 크기로 갈아끼웠다
        XCTAssertNotEqual(before, VoiceTuningRenderer.previewFileURL(for: source, tag: "s-15"))
    }

    /// 값에는 단위를 붙인다 — 안드로이드 `voices_tuning_pitch_value` 와 같은 글자(빼기는 U+2212, Codex #870).
    func test_tuningValueText_carriesTheSemitoneUnit() {
        XCTAssertEqual(VoicePreviewConfirmView.tuningValueText(-1.5), "\u{2212}1.5 반음")
        XCTAssertEqual(VoicePreviewConfirmView.tuningValueText(3), "+3.0 반음")
        XCTAssertEqual(VoicePreviewConfirmView.tuningValueText(0), "0 반음")
    }

    /// 높이를 굽지 못해도 원래 목소리는 OS 에 싣는다 — 시스템 톤으로 떨어지지 않게. 지문에는 폴백 표시가 붙어 다음
    /// 회차가 다시 굽는다(Codex #870).
    func test_tunedStagingFailure_stillStagesTheOriginalVoice() throws {
        let source = try makeSineWAV(hz: 180, seconds: 1, amplitude: 0.3)
        AlarmSoundStaging.failTunedRenderingForTesting = true
        addTeardownBlock { AlarmSoundStaging.failTunedRenderingForTesting = false }
        let key = uniqueKey("tuned-fallback")
        let tuning = VoiceTuning(pitchSt: -2, source: .user)
        let plan = AlarmSoundPlan.voiceClip(
            cacheKey: key, url: source, durationMs: 1_000, volumePercent: 100, revision: nil, tuning: tuning
        )

        let resolution = AlarmSoundResolver.resolve(plan: plan)
        guard case .bundledNamed(let name) = resolution else {
            return XCTFail("원래 목소리라도 실려야 한다 — got \(resolution)")
        }
        XCTAssertNotEqual(name, AlarmSoundStaging.tunedStagedFileName(for: plan))
        XCTAssertTrue(
            AlarmScheduleReconciler.scheduledFingerprint(plan: plan, resolution: resolution).hasSuffix("!fallback"),
            "다음 회차가 다시 굽도록 폴백으로 적는다"
        )
    }

    func test_neutralTuning_keepsTheLegacyName() throws {
        let source = try makeSineWAV(hz: 220, seconds: 1, amplitude: 0.3)
        let key = uniqueKey("neutral")
        let plain = try AlarmSoundStaging.stage(url: source, key: key)
        let neutral = try AlarmSoundStaging.stage(url: source, key: key, tuning: .neutral)
        XCTAssertEqual(plain, neutral, "다듬지 않은 목소리는 예전에 구워 둔 파일을 그대로 써야 한다")
    }

    func test_tunedStage_producesPlayableMonoCafWithItsOwnName() throws {
        let source = try makeSineWAV(hz: 220, seconds: 1, amplitude: 0.3)
        let key = uniqueKey("caf")
        let plain = try AlarmSoundStaging.stage(url: source, key: key)
        let tunedA = try AlarmSoundStaging.stage(url: source, key: key, tuning: VoiceTuning(pitchSt: -2, source: .user))
        let tunedB = try AlarmSoundStaging.stage(url: source, key: key, tuning: VoiceTuning(pitchSt: -1.5, source: .user))
        XCTAssertNotEqual(plain, tunedA, "다듬기 값이 이름에 없으면 옛 파일이 재사용된다")
        XCTAssertNotEqual(tunedA, tunedB)

        let url = try stagedURL(named: tunedA)
        XCTAssertEqual(url.pathExtension, "caf")
        let player = try AVAudioPlayer(contentsOf: url)
        XCTAssertEqual(player.duration, 1, accuracy: 0.05, "PSOLA 는 길이를 바꾸지 않는다")
        let file = try AVAudioFile(forReading: url)
        XCTAssertEqual(file.fileFormat.channelCount, 1)
        XCTAssertEqual(file.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int, 16)
    }

    /// 높이를 구워 넣을 파일은 예약 직전에 **메인 밖에서** 미리 만들고, `stage` 는 그 파일을 그대로 쓴다(Codex #870).
    func test_prestageTuned_makesTheFileStageReuses() async throws {
        let source = try makeSineWAV(hz: 150, seconds: 1.5, amplitude: 0.3)
        let key = uniqueKey("prestage")
        let tuning = VoiceTuning(pitchSt: -2, source: .user)
        await AlarmSoundStaging.prestageTuned(url: source, key: key, volumePercent: 80, tuning: tuning)
        let expected = "voice-\(AudioCacheStore.safeCacheKey(key))-v80-t\(try XCTUnwrap(tuning.soundTag))"
        let prestaged = try stagedURL(named: expected)
        let before = try FileManager.default.attributesOfItem(atPath: prestaged.path)[.modificationDate] as? Date

        let staged = try AlarmSoundStaging.stage(url: source, key: key, volumePercent: 80, tuning: tuning)

        XCTAssertEqual(staged, expected, "미리 만든 이름과 예약 이름이 같아야 다시 굽지 않는다")
        let after = try FileManager.default.attributesOfItem(atPath: prestaged.path)[.modificationDate] as? Date
        XCTAssertEqual(before, after, "stage 가 다시 구우면 메인에서 PSOLA 가 돈다")
    }

    func test_pitch_isBakedIntoTheFile() throws {
        let source = try makeSineWAV(hz: 220, seconds: 1.5, amplitude: 0.3, sampleRate: 24_000)
        let staged = try AlarmSoundStaging.stage(
            url: source, key: uniqueKey("pitch"),
            tuning: VoiceTuning(pitchSt: -6, source: .user)
        )
        let decoded = try VoiceTuningAnalyzer.decodeMono(url: stagedURL(named: staged), maxSeconds: 60)
        let f0 = try XCTUnwrap(VoiceTuningAnalyzer.medianF0(samples: decoded.samples, sampleRate: decoded.sampleRate))
        let expected = 220 * pow(2, -6.0 / 12)  // ≈ 155.6Hz
        XCTAssertEqual(f0, expected, accuracy: expected * 0.03, "−6반음인데 \(f0)Hz")
    }

    /// 높이를 내려도 **크기는 원래 소리와 같다**(떨림 수가 줄어 작아지는 것을 되맞춘다).
    func test_loudness_staysWithHalfALUOfTheSource() throws {
        let source = try makeSineWAV(hz: 180, seconds: 1.5, amplitude: 0.2)
        let staged = try AlarmSoundStaging.stage(
            url: source, key: uniqueKey("loud"),
            tuning: VoiceTuning(pitchSt: -4, source: .user)
        )
        let before = try VoiceTuningAnalyzer.decodeMono(url: source, maxSeconds: 60)
        let after = try VoiceTuningAnalyzer.decodeMono(url: stagedURL(named: staged), maxSeconds: 60)
        let a = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: before.samples, sampleRate: before.sampleRate))
        let b = try XCTUnwrap(VoiceTuningAnalyzer.integratedLoudness(samples: after.samples, sampleRate: after.sampleRate))
        XCTAssertEqual(b, a, accuracy: 0.5, "원래 \(a) LUFS, 구운 뒤 \(b) LUFS")
        XCTAssertLessThanOrEqual(after.samples.map { abs($0) }.max() ?? 0, 1)
        XCTAssertFalse(after.samples.contains { !$0.isFinite })
    }

    func test_volumePercent_stillAppliesOnTopOfTuning() throws {
        let source = try makeSineWAV(hz: 440, seconds: 1, amplitude: 0.2)
        let tuning = VoiceTuning(pitchSt: -2, source: .user)
        let full = try AlarmSoundStaging.stage(url: source, key: uniqueKey("vol100"), volumePercent: 100, tuning: tuning)
        let half = try AlarmSoundStaging.stage(url: source, key: uniqueKey("vol50"), volumePercent: 50, tuning: tuning)
        let ratio = try rms(stagedURL(named: half)) / rms(stagedURL(named: full))
        XCTAssertEqual(ratio, 0.5, accuracy: 0.05)
    }

    func test_tunedStage_respectsThirtySecondLimit() throws {
        let source = try makeSineWAV(hz: 200, seconds: 31, amplitude: 0.3, sampleRate: 22_050)
        let staged = try AlarmSoundStaging.stage(
            url: source, key: uniqueKey("long"),
            tuning: VoiceTuning(pitchSt: 2, source: .user)
        )
        let player = try AVAudioPlayer(contentsOf: stagedURL(named: staged))
        XCTAssertLessThanOrEqual(player.duration, Double(AlarmAudioLimits.maxDurationMillis) / 1000 + 0.01)
        XCTAssertGreaterThan(player.duration, 29)
    }
}
