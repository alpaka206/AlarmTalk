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
        let key = "stock_probe-\(UUID().uuidString)"
        let store = AudioCacheStore()
        let payload = Data(repeating: 0x41, count: 128)

        _ = try store.cacheBytes(
            payload,
            cacheKey: key,
            mimeType: "audio/mpeg",
            source: "tts",
            messageId: "probe",
            rawAudioUri: nil,
            durationOverrideMs: 1000,
            enforceMaxDuration: false
        )

        XCTAssertNotNil(
            store.cachedURL(for: key),
            "쓴 직후에도 못 찾으면 프리페처가 영원히 다시 받는다"
        )

        try? store.deleteCachedAudio(cacheKey: key)
    }
}

/// **테스트가 기기의 진짜 사용자 상태를 건드리면 안 된다.**
///
/// 2026-08-19 에 실제로 건드리고 있었다 — 기기에서 테스트를 한 번 돌릴 때마다 **로그인이
/// 풀리고, 받아 둔 스톡 클립이 사라지고, 알람 파일이 열렸다.** 유닛 테스트가 호스트 앱
/// 프로세스에서 돌기 때문에 기본 저장 위치가 **사용자가 쓰는 바로 그 위치**였다.
///
/// 그 세 갈래를 `TestIsolation` 한 곳으로 갈랐고, 이 테스트가 그 갈림을 고정한다.
/// 여기가 깨지면 **다음 테스트 실행이 개발자 기기의 로그인·목소리·알람을 지운다.**
final class TestIsolationTests: XCTestCase {

    func test_유닛테스트로_인식된다() {
        XCTAssertTrue(
            TestIsolation.isRunningUnitTests,
            "XCTest 안인데 격리가 꺼져 있다 — 아래 단언들이 통째로 무의미해진다"
        )
        XCTAssertFalse(TestIsolation.storageSuffix.isEmpty)
    }

    func test_음원캐시는_사용자_디렉터리를_쓰지_않는다() throws {
        let dir = try AudioCacheStore.audioDirectory()
        XCTAssertTrue(
            dir.lastPathComponent.hasSuffix(TestIsolation.storageSuffix),
            "테스트가 사용자의 음원 캐시(\(dir.lastPathComponent))를 그대로 쓴다 — 스톡 클립이 지워진다"
        )
    }

    func test_옛_음원_디렉터리도_갈린다() throws {
        // `cache(tts:)` 가 쓰는 경로다 — 안 가르면 테스트가 사용자의 실제 음원을 덮어쓴다.
        let legacy = try AudioCacheStore.legacyAudioDirectory()
        XCTAssertTrue(
            legacy.lastPathComponent.hasSuffix(TestIsolation.storageSuffix),
            "테스트가 사용자의 옛 음원 디렉터리(\(legacy.lastPathComponent))를 그대로 쓴다"
        )
    }

    func test_키체인은_사용자_세션을_쓰지_않는다() throws {
        // 실제로 쓰고 지워 본다. 서비스 이름이 갈리지 않았다면 이 왕복이 **기기의 진짜
        // 세션을 덮어쓰고 지운다** — 그래서 값 비교가 아니라 격리 자체를 단언한다.
        XCTAssertTrue(
            KeychainStore.isIsolatedForTests,
            "키체인 서비스가 사용자와 같다 — 테스트가 끝나면 로그인이 풀린다"
        )
    }

    func test_알람파일은_사용자_알람을_쓰지_않는다() {
        let url = LocalAlarmStore.defaultStorageURL()
        XCTAssertTrue(
            url.lastPathComponent.contains(TestIsolation.storageSuffix),
            "테스트가 사용자의 알람 파일(\(url.lastPathComponent))을 그대로 쓴다"
        )
    }
}
