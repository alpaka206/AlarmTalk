import XCTest
@testable import VoiceAlarm

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

    func test_resolve_soundThenVoice_isHandledIdenticallyToVoiceOnly() throws {
        let store = AudioCacheStore()
        let key = AudioCacheStore.computeCacheKey(Data("soundThenVoice".utf8))
        _ = try seedCache(store: store, key: key, durationMs: 60_000)
        addTeardownBlock {
            try? store.deleteCachedAudio(cacheKey: key)
        }

        let record = makeRecord(playMode: .soundThenVoice, audioCacheKey: key)
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
