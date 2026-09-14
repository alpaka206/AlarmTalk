import AVFoundation
import XCTest
@testable import AlarmTalk

/// **행이 바뀌면 예약도 바뀌어야 한다** — 그 판정의 근거인 소리 지문을 고정한다.
///
/// 이 표가 지키는 것: 소리를 바꾸는 필드를 고쳤는데 지문이 그대로면
/// `AlarmScheduleReconciler` 가 어긋난 예약을 못 알아채고, **행에는 새 소리가 적혀 있는데
/// OS 는 옛 파일을 그대로 운다.** 2026-08-18 이전에는 그 상태가 다섯 경로에 있었다.
@MainActor
final class AlarmSoundPlanTests: XCTestCase {

    // MARK: - 지문이 움직여야 하는 변경

    func test_fingerprint_movesWhenTheChosenClipChanges() throws {
        let (store, keys) = try seedBucket(clipCount: 3)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)

        record.bucketRotationIndex = 0
        let first = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.bucketRotationIndex = 1
        let second = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(first, second, "회전이 전진하면 다른 클립이므로 지문도 달라야 한다.")
    }

    func test_fingerprint_movesWhenTheWeatherConditionChanges() throws {
        let (store, keys) = try seedBucket(clipCount: 9)
        var record = makeBucketRecord(bucketId: "weather", keys: keys)

        record.contextVariantIndex = 0   // 맑음
        let sunny = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.contextVariantIndex = 1   // 비
        let rain = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(sunny, rain)
    }

    /// ⚠ **손으로 만든 '소리 필드 목록' 이었다면 빠졌을 항목.**
    /// `fireAtMillis` 는 시각 필드처럼 보이지만 운세 테마의 **씨앗**이라 클립을 바꾼다.
    /// 지문을 `AlarmSoundResolver.plan` 의 출력으로 잡은 이유가 이것이다.
    func test_fingerprint_movesWhenTheFortuneDayChanges() throws {
        let (store, keys) = try seedBucket(clipCount: 9)
        var record = makeBucketRecord(bucketId: "fortune", keys: keys)

        let today = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.fireAtMillis += 24 * 60 * 60 * 1000
        let tomorrow = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(today, tomorrow, "운세는 날짜가 클립을 정한다 — 지문이 따라와야 한다.")
    }

    func test_fingerprint_movesWhenVolumeChanges() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)

        record.voiceVolumePercent = 100
        let loud = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.voiceVolumePercent = 40
        let quiet = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        // 음량은 파일에 구워 넣으므로(AlarmSoundStaging) 다른 파일이 된다.
        XCTAssertNotEqual(loud, quiet)
    }

    func test_fingerprint_movesWhenDowngradedToAlarmOnly() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)

        let withVoice = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.playMode = AlarmPlayMode.alarmOnly.rawValue
        let toneOnly = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(withVoice, toneOnly, "목소리 삭제·무료 강등이 지문에 보여야 한다.")
        XCTAssertEqual(toneOnly, "default")
    }

    func test_fingerprint_movesWhenTheVoiceClipIsReplaced() throws {
        // 동적 문구 갱신(매일 새 문장)이 이 모양이다 — audioCacheKey 만 갈린다.
        let (store, keys) = try seedBucket(clipCount: 2)
        var record = makeBucketRecord(bucketId: nil, keys: nil)

        record.audioCacheKey = keys[0]
        let yesterday = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.audioCacheKey = keys[1]
        let today = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(yesterday, today)
    }

    func test_fingerprint_movesWhenBytesChangeUnderTheSameCacheKey() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: nil, keys: nil)
        let key = keys[0]
        record.audioCacheKey = key
        let bytes = try Data(contentsOf: XCTUnwrap(store.cachedURL(for: key)))

        _ = try store.cacheBytes(
            bytes, cacheKey: key, mimeType: "audio/wav", rawAudioUri: "r2://old",
            durationOverrideMs: 1_000, enforceMaxDuration: false
        )
        let old = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        _ = try store.cacheBytes(
            bytes, cacheKey: key, mimeType: "audio/wav", rawAudioUri: "r2://new",
            durationOverrideMs: 1_000, enforceMaxDuration: false
        )
        let new = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertNotEqual(old, new, "같은 message ID의 새 바이트도 AlarmKit 재예약을 깨워야 한다.")
    }

    // MARK: - 지문이 움직이면 안 되는 변경

    func test_fingerprint_ignoresChangesThatDoNotAffectSound() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)

        let before = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint
        record.label = "다른 이름"
        record.snoozeMinutes = 9
        record.vibrationPattern = VibrationPattern.default.rawValue
        record.updatedAtMillis += 5_000
        let after = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertEqual(before, after, "소리와 무관한 변경으로 재예약이 돌면 배터리만 쓴다.")
    }

    // MARK: - 리컨사일러 판정

    func test_needsReschedule_isFalseWhenTheScheduleMatches() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)
        record.alarmKitID = UUID().uuidString
        record.scheduledSoundFingerprint = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        XCTAssertFalse(
            AlarmScheduleReconciler.needsReschedule(record, alarmKit: AlarmKitViewModel(), audioCache: store)
        )
    }

    func test_needsReschedule_isTrueWhenTheRowMovedOn() throws {
        let (store, keys) = try seedBucket(clipCount: 3)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)
        record.alarmKitID = UUID().uuidString
        record.scheduledSoundFingerprint = AlarmSoundResolver.plan(for: record, audioCache: store).fingerprint

        record.bucketRotationIndex = 1  // 울린 뒤 회전이 전진했다

        XCTAssertTrue(
            AlarmScheduleReconciler.needsReschedule(record, alarmKit: AlarmKitViewModel(), audioCache: store)
        )
    }

    func test_needsReschedule_isFalseForRowsThatWereNeverScheduled() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)
        record.alarmKitID = nil
        record.scheduledSoundFingerprint = nil

        // 예약 자체가 없으면 리컨사일러의 일이 아니다(recoverScheduledAlarms 의 몫).
        XCTAssertFalse(
            AlarmScheduleReconciler.needsReschedule(record, alarmKit: AlarmKitViewModel(), audioCache: store)
        )
    }

    func test_needsReschedule_isFalseForLegacyRowsWithoutAFingerprint() throws {
        // 이 기능 이전에 예약된 행 — 앱을 올리자마자 전부 재예약하지는 않는다.
        let (store, keys) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: "medication", keys: keys)
        record.alarmKitID = UUID().uuidString
        record.scheduledSoundFingerprint = nil

        XCTAssertFalse(
            AlarmScheduleReconciler.needsReschedule(record, alarmKit: AlarmKitViewModel(), audioCache: store)
        )
    }

    // MARK: - 스테이징이 실패한 예약은 '성공' 으로 새기지 않는다

    /// ⚠ 예약에 실린 것은 톤인데 행에 목소리 지문을 새기면, 다음 비교가 **영원히 일치**해
    /// 리컨사일러가 눈이 먼다 — 일시적 쓰기 실패 한 번으로 목소리 알람이 잠금화면에서
    /// 영구히 톤으로 울린다(자는 동안 인앱 폴백은 돌지 않는다).
    func test_scheduledFingerprint_marksStagingFallbackSoItRetries() throws {
        let (store, keys) = try seedBucket(clipCount: 1)
        let record = makeBucketRecord(bucketId: "medication", keys: keys)
        let plan = AlarmSoundResolver.plan(for: record, audioCache: store)

        // 스테이징 성공 — 의도한 소리가 그대로 실렸다.
        let ok = AlarmScheduleReconciler.scheduledFingerprint(
            plan: plan, resolution: .bundledNamed("voice-x.caf")
        )
        XCTAssertEqual(ok, plan.fingerprint)

        // 스테이징 실패 — OS 에는 톤이 실렸다. 지문이 달라야 다음 회차가 다시 시도한다.
        let fellBack = AlarmScheduleReconciler.scheduledFingerprint(
            plan: plan, resolution: .cachedAudio(URL(fileURLWithPath: "/tmp/x.wav"), 1_000)
        )
        XCTAssertNotEqual(fellBack, plan.fingerprint)

        var scheduledWithFallback = record
        scheduledWithFallback.alarmKitID = UUID().uuidString
        scheduledWithFallback.scheduledSoundFingerprint = fellBack
        XCTAssertTrue(
            AlarmScheduleReconciler.needsReschedule(
                scheduledWithFallback, alarmKit: AlarmKitViewModel(), audioCache: store
            ),
            "폴백으로 예약된 행은 다시 시도 대상이어야 한다."
        )
    }

    func test_scheduledFingerprint_systemDefaultIsNotAFallback() throws {
        // 애초에 톤을 의도한 알람은 톤이 실린 게 정상이다 — 재시도 대상이 아니다.
        let (store, _) = try seedBucket(clipCount: 1)
        var record = makeBucketRecord(bucketId: nil, keys: nil)
        record.playMode = AlarmPlayMode.alarmOnly.rawValue
        let plan = AlarmSoundResolver.plan(for: record, audioCache: store)
        XCTAssertEqual(plan, .systemDefault)

        let fingerprint = AlarmScheduleReconciler.scheduledFingerprint(plan: plan, resolution: .systemDefault)
        XCTAssertEqual(fingerprint, plan.fingerprint)

        var scheduled = record
        scheduled.alarmKitID = UUID().uuidString
        scheduled.scheduledSoundFingerprint = fingerprint
        XCTAssertFalse(
            AlarmScheduleReconciler.needsReschedule(scheduled, alarmKit: AlarmKitViewModel(), audioCache: store)
        )
    }

    func test_isInFlight_coversRingingAndSnoozed() {
        var record = makeBucketRecord(bucketId: nil, keys: nil)
        record.state = AlarmRuntimeState.ringing.rawValue
        XCTAssertTrue(AlarmScheduleReconciler.isInFlight(record))
        record.state = AlarmRuntimeState.snoozed.rawValue
        XCTAssertTrue(AlarmScheduleReconciler.isInFlight(record))
        record.state = AlarmRuntimeState.armed.rawValue
        XCTAssertFalse(AlarmScheduleReconciler.isInFlight(record))
    }

    // MARK: - Helpers

    /// 진짜 오디오로 캐시를 채운다 — 가짜 바이트는 캐시 조회를 통과하지 못해
    /// plan 이 `.systemDefault` 로 떨어지고 테스트가 아무것도 안 지킨다.
    private func seedBucket(clipCount: Int) throws -> (AudioCacheStore, [String]) {
        let store = AudioCacheStore()
        var keys: [String] = []
        for index in 0..<max(clipCount, 1) {
            let wav = try Data(contentsOf: makeSineWAV(seed: index))
            let key = AudioCacheStore.computeCacheKey(wav)
            _ = try store.cacheBytes(
                wav,
                cacheKey: key,
                mimeType: "audio/wav",
                source: "tts",
                durationOverrideMs: 1_000,
                enforceMaxDuration: false
            )
            keys.append(key)
            addTeardownBlock {
                try? store.deleteCachedAudio(cacheKey: key)
                AlarmSoundStaging.clearStagedSound(forKey: key)
            }
        }
        return (store, keys)
    }

    private func makeSineWAV(seed: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("plan-tone-\(seed)-\(UUID().uuidString).wav")
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false
        )!
        let file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ]
        )
        let frames = AVAudioFrameCount(44_100)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let channel = buffer.floatChannelData![0]
        // 클립마다 다른 주파수 — 캐시 키가 갈려야 서로 다른 클립이 된다.
        let hz = Float(220 + seed * 55)
        for i in 0..<Int(frames) {
            channel[i] = 0.5 * sinf(2 * .pi * hz * Float(i) / 44_100)
        }
        try file.write(from: buffer)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func makeBucketRecord(bucketId: String?, keys: [String]?) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "테마 알람",
            hour: 7,
            minute: 0,
            fireAtMillis: 1_700_000_000_000
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.bucketId = bucketId
        record.bucketClipKeys = keys
        record.audioCacheKey = keys?.first
        record.bucketRotationIndex = 0
        record.voiceVolumePercent = 100
        record.voiceFortuneGender = "여자"
        record.voiceFortuneBirthDate = "1994-03-02"
        record.voiceFortuneBirthTime = "05:30"
        record.enabled = true
        record.state = AlarmRuntimeState.armed.rawValue
        return record
    }
}
