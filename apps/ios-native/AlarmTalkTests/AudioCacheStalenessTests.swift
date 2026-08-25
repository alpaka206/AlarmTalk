import XCTest
@testable import AlarmTalk

/// **오디오 캐시는 write-once 가 아니다** — 회귀 방지.
///
/// 캐시 키(`stock_<messageId>`)에는 버전이 없다. 그래서 서버가 같은 message_id 의 오디오
/// 실체를 바꾸면(목소리 교체) 기기는 옛 소리를 영영 쓴다 — 예전 `cacheBytes` 는 파일이
/// 있으면 바이트를 아예 안 썼기 때문이다. 판별은 **`audio_url` 이 달라졌는가** 하나이고,
/// 그 값은 원래부터 메타에 `rawAudioUri` 로 저장되고 있었는데 **아무도 비교하지 않았다.**
///
/// ⚠ **모르면 stale 이 아니다.** 옛 메타에는 값이 없고 서버가 안 주는 경로도 있다.
/// 그때 stale 로 보면 알람마다 다시 받고 오프라인에서는 아예 못 쓴다.
final class AudioCacheStalenessTests: XCTestCase {

    private let mime = "audio/mpeg"

    private func key(_ suffix: String) -> String { "stock_test-\(suffix)-\(UUID().uuidString)" }

    private func cleanup(_ cacheKey: String) {
        try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: cacheKey)
    }

    func test_audio_url이_바뀌면_바이트를_다시_쓴다() throws {
        let k = key("changed")
        defer { cleanup(k) }

        let first = Data(repeating: 0xAA, count: 2048)
        let url = try AudioCacheStore.shared.cacheBytes(
            first, cacheKey: k, mimeType: mime,
            rawAudioUri: "r2://old-object", enforceMaxDuration: false
        )
        XCTAssertEqual(try Data(contentsOf: url), first)

        let second = Data(repeating: 0xBB, count: 4096)
        let url2 = try AudioCacheStore.shared.cacheBytes(
            second, cacheKey: k, mimeType: mime,
            rawAudioUri: "r2://new-object", enforceMaxDuration: false
        )
        XCTAssertEqual(
            try Data(contentsOf: url2), second,
            "audio_url 이 바뀌었는데 옛 바이트가 남았다 — 교체해도 기기가 옛 목소리로 운다"
        )
    }

    func test_audio_url이_같으면_다시_쓰지_않는다() throws {
        let k = key("same")
        defer { cleanup(k) }

        let first = Data(repeating: 0xAA, count: 2048)
        _ = try AudioCacheStore.shared.cacheBytes(
            first, cacheKey: k, mimeType: mime,
            rawAudioUri: "r2://same-object", enforceMaxDuration: false
        )
        // 같은 URI 로 다른 바이트가 와도 캐시를 흔들지 않는다(네트워크 낭비 방지).
        let url = try AudioCacheStore.shared.cacheBytes(
            Data(repeating: 0xBB, count: 4096), cacheKey: k, mimeType: mime,
            rawAudioUri: "r2://same-object", enforceMaxDuration: false
        )
        XCTAssertEqual(try Data(contentsOf: url), first)
    }

    func test_audio_url을_모르면_stale이_아니다() throws {
        let k = key("unknown")
        defer { cleanup(k) }

        let first = Data(repeating: 0xAA, count: 2048)
        _ = try AudioCacheStore.shared.cacheBytes(
            first, cacheKey: k, mimeType: mime,
            rawAudioUri: nil, enforceMaxDuration: false
        )
        XCTAssertFalse(
            AudioCacheStore.shared.isStale(cacheKey: k, remoteAudioUri: nil),
            "값을 모를 때 stale 로 보면 알람마다 다시 받는다"
        )
        XCTAssertFalse(
            AudioCacheStore.shared.isStale(cacheKey: k, remoteAudioUri: "r2://something"),
            "저장된 값이 없으면(옛 메타) 판단하지 않는다"
        )
    }

    /// ⚠ **확장자가 바뀌는 교체를 놓치지 말 것.** 새 형식(m4a)으로 오면 `<key>.mp3` 자리에는
    /// 파일이 없어 '낡지 않았다' 로 읽히고, 옛 파일을 둔 채 새 파일을 하나 더 쓰면
    /// `cachedURL(for:)` 이 **둘 중 아무거나** 돌려준다 — 옛 파일이 뽑히면 메타는 이미 새
    /// 주소라 낡음 판정도 지문도 통과해 지운 목소리가 계속 울린다.
    func test_형식이_바뀌어도_한_키에는_음원이_하나뿐이다() throws {
        let k = key("format-change")
        defer { cleanup(k) }

        _ = try AudioCacheStore.shared.cacheBytes(
            Data(repeating: 0xAA, count: 2048), cacheKey: k, mimeType: "audio/mpeg",
            rawAudioUri: "r2://old-object", enforceMaxDuration: false
        )
        let replaced = Data(repeating: 0xBB, count: 4096)
        let newURL = try AudioCacheStore.shared.cacheBytes(
            replaced, cacheKey: k, mimeType: "audio/aac",
            rawAudioUri: "r2://new-object", enforceMaxDuration: false
        )

        XCTAssertEqual(newURL.pathExtension, "m4a")
        let directory = try AudioCacheStore.audioDirectory()
        let safeKey = AudioCacheStore.safeCacheKey(k)
        let bodies = (try FileManager.default.contentsOfDirectory(atPath: directory.path))
            .filter { name in
                let (base, ext) = AudioCacheStore.splitName(name)
                return base == safeKey && ext != "meta.json" && ext != "json"
            }
        XCTAssertEqual(bodies.count, 1, "옛 확장자 사본이 남아 cachedURL 이 옛 바이트를 뽑을 수 있다")
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(AudioCacheStore.shared.cachedURL(for: k))), replaced)
    }

    /// ⚠ **정본(cacheKey) 쓰기 실패를 삼키면 안 된다.** 호출자는 "갱신됐다" 로 읽고 구워 둔
    /// 알람 사운드를 버리는데, 메타의 세대는 옛 값이라 지문이 같아 **재예약이 오지 않는다.**
    func test_정본_쓰기가_실패하면_던지고_키는_낡은_채로_남는다() throws {
        let k = "stock_test-throw-\(UUID().uuidString)"
        let messageId = "msg-\(UUID().uuidString)"
        defer { cleanup(k) }

        _ = try AudioCacheStore.shared.cacheBytes(
            Data(repeating: 0xAA, count: 2048), cacheKey: k, mimeType: mime,
            messageId: messageId, rawAudioUri: "r2://old-object", enforceMaxDuration: false
        )
        // 새 바이트가 앉을 자리를 **디렉터리로** 막아 원자적 쓰기를 실패시킨다.
        let directory = try AudioCacheStore.audioDirectory()
        let blocked = directory.appendingPathComponent("\(AudioCacheStore.safeCacheKey(k)).mp3")
        try? FileManager.default.removeItem(at: blocked)
        try FileManager.default.createDirectory(at: blocked, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: blocked) }

        let response = TtsMessageAudioResponse(
            messageId: messageId,
            audioBase64: Data(repeating: 0xBB, count: 4096).base64EncodedString(),
            audioFormat: "mp3",
            audioUrl: "r2://new-object"
        )
        XCTAssertThrowsError(
            try AudioCacheStore.cacheStockClip(audio: response, messageId: messageId, cacheKey: k),
            "정본 쓰기가 실패했는데 성공으로 돌려주면 그 키는 영영 다시 받아지지 않는다"
        )
        XCTAssertEqual(
            AudioCacheStore.shared.readMetadata(cacheKey: k)?.rawAudioUri, "r2://old-object",
            "세대가 새 값으로 남으면 다음 회차가 stale 로 집지 못한다"
        )
        XCTAssertTrue(AudioCacheStore.shared.isStale(cacheKey: k, remoteAudioUri: "r2://new-object"))
    }

    func test_isStale은_바뀐_경우에만_참이다() throws {
        let k = key("flag")
        defer { cleanup(k) }

        _ = try AudioCacheStore.shared.cacheBytes(
            Data(repeating: 0xAA, count: 2048), cacheKey: k, mimeType: mime,
            rawAudioUri: "r2://a", enforceMaxDuration: false
        )
        XCTAssertFalse(AudioCacheStore.shared.isStale(cacheKey: k, remoteAudioUri: "r2://a"))
        XCTAssertTrue(AudioCacheStore.shared.isStale(cacheKey: k, remoteAudioUri: "r2://b"))
    }
}
