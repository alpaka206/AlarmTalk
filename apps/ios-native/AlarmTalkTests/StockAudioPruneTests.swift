import XCTest
@testable import AlarmTalk

/// **교체가 끝난 뒤 옛 스톡 클립 파일을 지운다**(2026-09-03 지시) — 파일을 실제로 **지우는**
/// 코드라 남기는 조건을 못 박는다. 안드로이드 짝은 `StockAudioPruneTest.kt`.
@MainActor
final class StockAudioPruneTests: XCTestCase {

    private var directory: URL!
    private var legacyDirectory: URL!

    override func setUpWithError() throws {
        directory = try AudioCacheStore.audioDirectory()
        legacyDirectory = try AudioCacheStore.legacyAudioDirectory()
        for dir in [directory!, legacyDirectory!] {
            for name in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
            }
        }
    }

    private func put(_ name: String, in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try Data("x".utf8).write(to: url)
        return url
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func test_참조도_안_되고_매니페스트에도_없는_옛_클립만_지운다() throws {
        let stale = try put("stock_old.mp3", in: directory)
        let bound = try put("stock_bound.mp3", in: directory)
        let live = try put("stock_new.mp3", in: directory)

        let deleted = AudioCacheStore.shared.pruneReplacedStockAudio(
            referencedKeys: ["stock_bound"],
            liveKeys: ["stock_new"]
        )

        XCTAssertEqual(deleted, 1)
        XCTAssertFalse(exists(stale), "옛 클립은 지운다")
        // ⚠ **여러 알람이 같은 클립을 공유한다** — 하나라도 물고 있으면 남긴다.
        XCTAssertTrue(exists(bound), "알람이 물고 있는 클립은 남긴다")
        // ⚠ 알람이 아직 안 물었어도 편집기에서 골라야 하므로 남긴다.
        XCTAssertTrue(exists(live), "매니페스트에 있는 클립은 남긴다")
    }

    /// ⚠ **매니페스트를 못 받았으면 아무것도 지우지 않는다.** 빈 집합을 '살아 있는 클립이
    /// 없다' 로 읽으면 네트워크가 한 번 죽은 것만으로 받아 둔 클립을 전부 날린다.
    func test_매니페스트를_못_받으면_아무것도_안_지운다() throws {
        let a = try put("stock_a.mp3", in: directory)
        XCTAssertEqual(
            AudioCacheStore.shared.pruneReplacedStockAudio(referencedKeys: [], liveKeys: []),
            0
        )
        XCTAssertTrue(exists(a))
    }

    func test_스톡이_아닌_파일은_건드리지_않는다() throws {
        let generated = try put("abc123hash.mp3", in: directory)
        _ = AudioCacheStore.shared.pruneReplacedStockAudio(
            referencedKeys: [], liveKeys: ["stock_new"]
        )
        XCTAssertTrue(exists(generated))
    }

    /// **옛 별칭 디렉터리도 함께 치운다** — `cacheStockClip` 이 오디오를 두 벌 쓴다.
    /// 별칭은 캐시 키가 아니라 `<messageId>.<ext>` 라 **파일 이름**으로 가른다.
    func test_옛_별칭_사본도_지우되_참조된_것은_남긴다() throws {
        let staleId = "11111111-1111-4111-8111-111111111111"
        let liveId = "22222222-2222-4222-8222-222222222222"
        let boundId = "33333333-3333-4333-8333-333333333333"
        let stale = try put("\(staleId).mp3", in: legacyDirectory)
        let live = try put("\(liveId).mp3", in: legacyDirectory)
        let bound = try put("\(boundId).mp3", in: legacyDirectory)
        // 직접 입력·녹음 사본은 message id 모양이 아니다 — 건드리면 안 된다.
        let recording = try put("recording-1.m4a", in: legacyDirectory)

        _ = AudioCacheStore.shared.pruneReplacedStockAudio(
            referencedKeys: [],
            liveKeys: ["stock_\(liveId)"],
            referencedFileNames: ["\(boundId).mp3"]
        )

        XCTAssertFalse(exists(stale), "은퇴한 별칭 사본은 지운다")
        XCTAssertTrue(exists(live), "매니페스트에 있는 별칭은 남긴다")
        XCTAssertTrue(exists(bound), "알람이 가리키는 별칭은 남긴다")
        XCTAssertTrue(exists(recording), "스톡이 아닌 사본은 건드리지 않는다")
    }
}
