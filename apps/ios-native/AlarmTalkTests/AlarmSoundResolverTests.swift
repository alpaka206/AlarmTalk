import AVFoundation
import XCTest
@testable import AlarmTalk

@MainActor
final class AlarmSoundResolverTests: XCTestCase {

    // MARK: - Test helpers

    /// 테스트용 record. playMode / audioCacheKey 만 지정해도 나머지 필드는 default.
    private func makeRecord(
        id: String = UUID().uuidString,
        playMode: AlarmPlayMode = .alarmOnly,
        audioCacheKey: String? = nil,
        alarmSoundUri: String? = nil
    ) -> LocalAlarmRecord {
        return LocalAlarmRecord(
            id: id,
            label: "test",
            hour: 7,
            minute: 0,
            fireAtMillis: Int64(Date().timeIntervalSince1970 * 1000) + 60_000,
            playMode: playMode.rawValue,
            audioCacheKey: audioCacheKey,
            alarmSoundUri: alarmSoundUri
        )
    }

    /// 캐시에 바이트를 강제로 적재하고 durationOverrideMs 까지 메타에 박는다.
    /// 본 테스트가 직접 디스크 IO 를 일으키지만 store 인스턴스는 새로 만든다.
    @discardableResult
    private func seedCache(
        store: AudioCacheStore,
        key: String,
        durationMs: Int64,
        mimeType: String = "audio/mpeg"
    ) throws -> URL {
        let payload = Data("voice-payload-\(key)".utf8)
        return try store.cacheBytes(
            payload,
            cacheKey: key,
            mimeType: mimeType,
            source: "tts",
            durationOverrideMs: durationMs,
            enforceMaxDuration: false
        )
    }

    /// 1초짜리 사인파 WAV. staging 의 파일 검증(크기·재생시간)을 통과하는 **진짜 오디오**다.
    private func makeSineWAV() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("resolver-tone-\(UUID().uuidString).wav")
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
        for i in 0..<Int(frames) {
            channel[i] = 0.5 * sinf(2 * .pi * 440 * Float(i) / 44_100)
        }
        try file.write(from: buffer)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    // MARK: - resolve(_:audioCache:)

    func test_resolve_alarmOnly_returnsSystemDefault() {
        let store = AudioCacheStore()
        let record = makeRecord(playMode: .alarmOnly)
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        XCTAssertEqual(r, .systemDefault)
    }

    func test_resolve_voiceOnly_withoutCache_returnsSystemDefault() {
        let store = AudioCacheStore()
        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: "missing-key")
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        XCTAssertEqual(r, .systemDefault)
    }

    func test_resolve_voiceOnly_withCacheKeyButNoFile_returnsSystemDefault() {
        let store = AudioCacheStore()
        // cacheKey 만 지정, 파일은 적재하지 않음.
        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: "ghost-cache-key")
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        XCTAssertEqual(r, .systemDefault)
    }

    func test_resolve_voiceOnly_withCachedAudioOver30s_returnsCachedAudio() throws {
        let store = AudioCacheStore()
        let key = AudioCacheStore.computeCacheKey(Data("over-limit".utf8))
        let url = try seedCache(store: store, key: key, durationMs: 45_000)
        // cleanup safety: 캐시 파일은 테스트 디렉터리에 남을 수 있지만 cascadeCleanup
        // 이 다음 실행에서 정리한다 (다른 키가 활성으로 들어와도 본 키는 비활성).
        addTeardownBlock {
            try? store.deleteCachedAudio(cacheKey: key)
        }

        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: key)
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        switch r {
        case .cachedAudio(let resolvedURL, let durationMs):
            XCTAssertEqual(resolvedURL.lastPathComponent, url.lastPathComponent)
            XCTAssertEqual(durationMs, 45_000)
        default:
            XCTFail("Expected .cachedAudio, got \(r.debugLabel)")
        }
    }

    func test_resolve_voiceOnly_withCachedAudioWithinLimit_attemptsStagingOrFallsBack() throws {
        // 30s 이하 캐시면 staging 을 시도한다. mp3 입력은 AVAssetExportSession
        // 트랜스코드가 시뮬레이터에서 실패할 수 있어 두 경로 모두 허용한다.
        let store = AudioCacheStore()
        let key = AudioCacheStore.computeCacheKey(Data("within-limit".utf8))
        _ = try seedCache(store: store, key: key, durationMs: 15_000)
        addTeardownBlock {
            try? store.deleteCachedAudio(cacheKey: key)
            AlarmSoundStaging.clearStagedSound(forKey: key)
        }

        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: key)
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        switch r {
        case .bundledNamed(let name):
            XCTAssertTrue(name.hasPrefix(AlarmSoundStaging.stagedNamePrefix))
        case .cachedAudio(_, let durationMs):
            XCTAssertEqual(durationMs, 15_000)
        case .systemDefault:
            XCTFail("Expected staging or cachedAudio fallback, got systemDefault")
        }
    }

    /// ⚠ **`.named(_)` 에 넘기는 이름에는 확장자가 있어야 한다.**
    ///
    /// 2026-08-18 실기기: 확장자 없는 base 이름(`voice-stock_…`)을 넘기면 AlarmKit 이
    /// 파일을 못 찾고 **말없이 기본 알람음으로 폴백**한다 — 목소리로 맞춘 알람이 톤으로
    /// 울리는데 우리 코드는 예약에 성공한 줄 안다. 이름을 `voice-stock_….caf` 로 바꾼
    /// 빌드에서 같은 알람이 목소리로 울렸다(사용자 확인).
    ///
    /// 이걸 되돌리면 증상이 "iOS 는 목소리 알람이 안 울린다" 로만 보인다 — 스테이징
    /// 파일도 멀쩡하고 resolve 결과도 `.bundledNamed` 라 코드만 봐서는 정상으로 읽힌다.
    func test_resolve_bundledName_carriesFileExtension() throws {
        let store = AudioCacheStore()
        // ⚠ **진짜 오디오로 심는다.** 가짜 바이트를 심으면 staging 이 실패하고(파일 검증에
        // 걸린다) 테스트가 조용히 넘어가 **아무것도 지키지 않는다**(2026-08-18 실제로 그랬다).
        // passthrough 포맷(wav)이라 트랜스코드 없이 복사로 끝나 시뮬레이터에서도 돈다.
        let wav = try Data(contentsOf: makeSineWAV())
        let key = AudioCacheStore.computeCacheKey(wav)
        _ = try store.cacheBytes(
            wav,
            cacheKey: key,
            mimeType: "audio/wav",
            source: "tts",
            durationOverrideMs: 1_000,
            enforceMaxDuration: false
        )
        addTeardownBlock {
            try? store.deleteCachedAudio(cacheKey: key)
            AlarmSoundStaging.clearStagedSound(forKey: key)
        }

        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: key)
        guard case .bundledNamed(let name) = AlarmSoundResolver.resolve(for: record, audioCache: store) else {
            return XCTFail("staging 이 성공해야 한다 — passthrough(wav) 경로는 복사뿐이다.")
        }

        XCTAssertFalse(
            (name as NSString).pathExtension.isEmpty,
            "`.named(\(name))` 에 확장자가 없다 — AlarmKit 이 기본 알람음으로 폴백한다."
        )
        // 그 이름의 파일이 실제로 Library/Sounds 에 있어야 한다.
        let soundsDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sounds", isDirectory: true)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: soundsDir.appendingPathComponent(name).path),
            "Library/Sounds 에 \(name) 이 없다."
        )
    }

    func test_resolve_voiceOnly_stagesVoiceClip() throws {
        let store = AudioCacheStore()
        let key = AudioCacheStore.computeCacheKey(Data("voiceOnly".utf8))
        _ = try seedCache(store: store, key: key, durationMs: 60_000)
        addTeardownBlock {
            try? store.deleteCachedAudio(cacheKey: key)
        }

        let record = makeRecord(playMode: .voiceOnly, audioCacheKey: key)
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        switch r {
        case .cachedAudio(_, let durationMs):
            XCTAssertEqual(durationMs, 60_000)
        default:
            XCTFail("Expected .cachedAudio for >30s, got \(r.debugLabel)")
        }
    }

    func test_resolve_alarmSoundUri_unreadable_returnsSystemDefault() {
        let store = AudioCacheStore()
        // 존재하지 않는 file URL — staging 실패 → systemDefault 폴백.
        let record = makeRecord(
            playMode: .alarmOnly,
            alarmSoundUri: "file:///tmp/voice-alarm-does-not-exist.wav"
        )
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        XCTAssertEqual(r, .systemDefault)
    }

    func test_resolve_alarmSoundUri_invalidURI_returnsSystemDefault() {
        let store = AudioCacheStore()
        let record = makeRecord(playMode: .alarmOnly, alarmSoundUri: "")
        let r = AlarmSoundResolver.resolve(for: record, audioCache: store)
        XCTAssertEqual(r, .systemDefault)
    }

    // MARK: - resolution metadata

    func test_resolution_requiresInAppFallback_onlyForCachedAudio() {
        let cached = AlarmSoundResolution.cachedAudio(URL(fileURLWithPath: "/tmp/x.m4a"), 45_000)
        XCTAssertTrue(cached.requiresInAppFallback)
        XCTAssertFalse(AlarmSoundResolution.systemDefault.requiresInAppFallback)
        XCTAssertFalse(AlarmSoundResolution.bundledNamed("voice-x").requiresInAppFallback)
    }
}
