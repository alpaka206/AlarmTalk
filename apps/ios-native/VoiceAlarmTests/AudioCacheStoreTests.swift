import XCTest
@testable import VoiceAlarm

@MainActor
final class AudioCacheStoreTests: XCTestCase {

    func test_computeCacheKey_isDeterministic() {
        let payload = Data("hello-voice-alarm".utf8)
        let key1 = AudioCacheStore.computeCacheKey(payload)
        let key2 = AudioCacheStore.computeCacheKey(payload)
        XCTAssertEqual(key1, key2)
        XCTAssertEqual(key1.count, 64) // SHA-256 hex 길이.
    }

    func test_computeCacheKey_differsForDifferentInputs() {
        let a = AudioCacheStore.computeCacheKey(Data("a".utf8))
        let b = AudioCacheStore.computeCacheKey(Data("b".utf8))
        XCTAssertNotEqual(a, b)
    }

    func test_safeCacheKey_sanitizesAndTruncates() {
        let raw = String(repeating: "Z!", count: 100) // 200 자
        let safe = AudioCacheStore.safeCacheKey(raw)
        // 96 자 한도.
        XCTAssertEqual(safe.count, 96)
        // 소문자 + [^a-z0-9_-] 는 "_" 로 치환.
        XCTAssertTrue(safe.allSatisfy { ch in
            ("a"..."z").contains(ch) || ("0"..."9").contains(ch) || ch == "_" || ch == "-"
        })
    }

    func test_splitName_separatesMetaSidecarCorrectly() {
        let (b1, e1) = AudioCacheStore.splitName("abc.meta.json")
        XCTAssertEqual(b1, "abc")
        XCTAssertEqual(e1, "meta.json")

        let (b2, e2) = AudioCacheStore.splitName("abc.mp3")
        XCTAssertEqual(b2, "abc")
        XCTAssertEqual(e2, "mp3")

        let (b3, e3) = AudioCacheStore.splitName("noext")
        XCTAssertEqual(b3, "noext")
        XCTAssertEqual(e3, "")
    }

    func test_legacyTtsCacheReturnsCacheKeyForAlarmScheduling() throws {
        let response = TtsGenerateResponse(
            messageId: "msg-cache-key",
            audioBase64: Data("fake-audio".utf8).base64EncodedString(),
            audioFormat: "mp3",
            audioUrl: "r2://tts/msg-cache-key.mp3",
            audioObjectKey: nil,
            text: "wake up",
            voiceProfileId: "voice-1",
            cacheKey: "server-cache-key",
            cacheHit: false,
            provider: "test"
        )

        let cached = try AudioCacheStore.cache(tts: response)

        XCTAssertEqual(cached.cacheKey, "server-cache-key")
        XCTAssertNotNil(AudioCacheStore.shared.cachedURL(for: cached.cacheKey))
    }

    func test_ttsRemoteAudioURI_fallsBackToR2ObjectKey() {
        let response = TtsGenerateResponse(
            messageId: "msg-r2-key",
            audioBase64: Data("fake-audio".utf8).base64EncodedString(),
            audioFormat: "mp3",
            audioUrl: nil,
            audioObjectKey: "tts/msg-r2-key.mp3",
            text: "wake up",
            voiceProfileId: "voice-1",
            cacheKey: nil,
            cacheHit: false,
            provider: "test"
        )

        XCTAssertEqual(response.remoteAudioURI, "r2://tts/msg-r2-key.mp3")
    }

    func test_cacheBytes_writesFileAndMetadata_andCascadeCleanupRespectsActiveKeys() throws {
        let store = AudioCacheStore()
        let payload = Data([0x49, 0x44, 0x33] + Array(repeating: UInt8(0x20), count: 64)) // ID3 흉내
        let key1 = AudioCacheStore.computeCacheKey(payload)

        // enforceMaxDuration=false 로 길이 검증 건너뜀 (CI 환경에서 AVAsset 측정 불가 가능).
        let url = try store.cacheBytes(
            payload,
            cacheKey: key1,
            mimeType: "audio/mpeg",
            source: "tts",
            messageId: "msg-1",
            rawAudioUri: nil,
            durationOverrideMs: 10_000,
            enforceMaxDuration: false
        )

        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        XCTAssertEqual(store.cachedURL(for: key1)?.lastPathComponent, url.lastPathComponent)

        let meta = store.readMetadata(cacheKey: key1)
        XCTAssertNotNil(meta)
        XCTAssertEqual(meta?.cacheKey, key1)
        XCTAssertEqual(meta?.source, "tts")
        XCTAssertEqual(meta?.mimeType, "audio/mpeg")
        XCTAssertEqual(meta?.durationMs, 10_000)
        XCTAssertEqual(meta?.messageId, "msg-1")

        // 다른 키 하나 더.
        let payload2 = Data("other".utf8)
        let key2 = AudioCacheStore.computeCacheKey(payload2)
        _ = try store.cacheBytes(
            payload2,
            cacheKey: key2,
            mimeType: "audio/mpeg",
            source: "tts",
            durationOverrideMs: 5_000,
            enforceMaxDuration: false
        )
        XCTAssertNotNil(store.cachedURL(for: key2))

        // key1 만 활성으로 cascade → key2 삭제.
        try store.cascadeCleanup(activeCacheKeys: [key1])
        XCTAssertNotNil(store.cachedURL(for: key1))
        XCTAssertNil(store.cachedURL(for: key2))
    }

    func test_cacheBytes_throwsWhenDurationExceedsLimit() {
        let store = AudioCacheStore()
        let payload = Data([0x49, 0x44, 0x33])
        let key = AudioCacheStore.computeCacheKey(payload)

        XCTAssertThrowsError(try store.cacheBytes(
            payload,
            cacheKey: key,
            mimeType: "audio/mpeg",
            source: "raw_audio",
            durationOverrideMs: AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis + 1,
            enforceMaxDuration: true
        )) { error in
            guard case AudioCacheError.durationExceedsLimit(let limit) = error else {
                return XCTFail("Expected durationExceedsLimit, got \(error)")
            }
            XCTAssertEqual(limit, AlarmAudioLimits.maxDurationMillis)
        }
    }

    func test_deleteCachedAudio_removesFileAndMetadata() throws {
        let store = AudioCacheStore()
        let payload = Data("delete-me".utf8)
        let key = AudioCacheStore.computeCacheKey(payload)
        _ = try store.cacheBytes(
            payload,
            cacheKey: key,
            mimeType: "audio/mpeg",
            durationOverrideMs: 1_000,
            enforceMaxDuration: false
        )
        XCTAssertNotNil(store.cachedURL(for: key))

        try store.deleteCachedAudio(cacheKey: key)
        XCTAssertNil(store.cachedURL(for: key))
        XCTAssertNil(store.readMetadata(cacheKey: key))
    }
}
