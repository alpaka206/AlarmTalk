import XCTest
@testable import AlarmTalk

/// **캐시는 쓴 자리에서 읽혀야 한다.**
///
/// ⚠ 이 테스트가 생긴 이유: 2026-08-19 에 "목소리를 로그인마다 다시 받는다" 고 진단하고
/// **원인을 캐시 경로 불일치로 지목했는데 틀렸다.** 근거로 삼은 것은 `devicectl` 로
/// App Group 컨테이너를 복사한 결과가 비어 있던 것인데, 그건 **그 도구가 못 가져온 것**
/// 이었다. 기기에서 실제 API 를 돌려 보니 44개 클립이 그대로 있었고 조회도 됐다.
/// 밖에서 훑은 디렉터리 목록으로 캐시를 판단하지 말 것 — 앱 안에서 물어야 한다.
///
/// 쓰기(`cacheBytes`)와 읽기(`cachedURL`)가 다른 디렉터리를 보게 되면 프리페처가 영원히
/// 다시 받는다. 그 어긋남만 잡는다.
final class AudioCacheRoundTripTests: XCTestCase {

    func test_쓴_직후_같은_키로_찾을_수_있다() throws {
        print("PROBE appGroup=\(AppGroup.containerURL?.path ?? "nil")")

        let dir: URL
        do {
            dir = try AudioCacheStore.audioDirectory()
            print("PROBE audioDirectory=\(dir.path)")
        } catch {
            print("PROBE audioDirectory THREW: \(error)")
            throw error
        }

        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        print("PROBE audioDirectory 파일수=\(files.count)")
        print("PROBE 앞 5개=\(files.prefix(5).joined(separator: ", "))")

        // legacy 쪽도 같이 본다
        if let legacy = try? AudioCacheStore.legacyAudioDirectory() {
            let l = (try? FileManager.default.contentsOfDirectory(atPath: legacy.path)) ?? []
            print("PROBE legacyDirectory=\(legacy.path) 파일수=\(l.count)")
        }

        // 실제 쓰기 → 조회 왕복. 이게 실패하면 프리페처가 매번 다시 받는다.
        let key = "stock_probe-\(UUID().uuidString)"
        let store = AudioCacheStore()
        let payload = Data(repeating: 0x41, count: 128)
        do {
            let url = try store.cacheBytes(
                payload,
                cacheKey: key,
                mimeType: "audio/mpeg",
                source: "tts",
                messageId: "probe",
                rawAudioUri: nil,
                durationOverrideMs: 1000,
                enforceMaxDuration: false
            )
            print("PROBE 썼다=\(url.lastPathComponent)")
        } catch {
            print("PROBE cacheBytes THREW: \(error)")
            throw error
        }

        let found = store.cachedURL(for: key)
        print("PROBE cachedURL=\(found?.lastPathComponent ?? "nil")")
        XCTAssertNotNil(found, "쓴 직후에도 못 찾으면 프리페처가 영원히 다시 받는다")

        // 뒷정리
        try? store.deleteCachedAudio(cacheKey: key)
    }
}
