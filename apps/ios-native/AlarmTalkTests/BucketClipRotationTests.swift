import XCTest
@testable import AlarmTalk

/// 무료 테마 클립 **회전**. 안드로이드 `AlarmRepository.advancedBucketRotationIndex` 미러.
///
/// 왜 필요한가: iOS 는 2026-08-08 전까지 회전이 **아예 없었다** — `clips.first` 하나만
/// 묶어 무료 사용자가 매일 같은 문구를 들었다. 주석 두 곳은 "울릴 때마다 순차 회전한다"
/// 고 적어 두어, 코드가 아니라 주석이 기능을 광고하고 있었다.
@MainActor
final class BucketClipRotationTests: XCTestCase {

    private func record(
        bucketId: String?,
        keys: [String]?,
        index: Int?
    ) -> LocalAlarmRecord {
        var r = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0)
        r.bucketId = bucketId
        r.bucketClipKeys = keys
        r.bucketRotationIndex = index
        return r
    }

    func test_advancesThroughClipsAndWrapsAround() {
        let keys = ["a", "b", "c"]
        var index: Int? = 0
        for expected in [1, 2, 0, 1] {
            index = LocalAlarmStore.advancedBucketRotationIndex(
                record(bucketId: "medication", keys: keys, index: index)
            )
            XCTAssertEqual(index, expected)
        }
    }

    /// ⚠ 날씨·운세는 **조건**으로 클립을 고른다 — 돌리면 비 오는 날 맑음 문구가 나온다.
    func test_matchingBucketsDoNotAdvance() {
        for bucket in ["weather", "fortune"] {
            let r = record(bucketId: bucket, keys: ["a", "b", "c"], index: 1)
            XCTAssertEqual(LocalAlarmStore.advancedBucketRotationIndex(r), 1, bucket)
        }
    }

    func test_noRotationWhenNotBucketOrSingleClip() {
        XCTAssertNil(LocalAlarmStore.advancedBucketRotationIndex(
            record(bucketId: nil, keys: ["a", "b"], index: nil)
        ))
        XCTAssertEqual(LocalAlarmStore.advancedBucketRotationIndex(
            record(bucketId: "medication", keys: ["only"], index: 0)
        ), 0)
    }

    /// 회전한 자리의 클립이 아직 안 받아졌으면 받아진 것으로 대체한다 —
    /// 소리가 없는 것보다 순서가 어긋나는 편이 낫다.
    func test_resolverFallsBackToACachedClip() throws {
        let store = AudioCacheStore()
        let cached = "rotation-cached"
        _ = try store.cacheBytes(
            Data("clip".utf8), cacheKey: cached, mimeType: "audio/mpeg",
            durationOverrideMs: 1_000, enforceMaxDuration: false
        )
        defer { try? store.deleteCachedAudio(cacheKey: cached) }

        var r = record(bucketId: "medication", keys: ["missing", cached], index: 0)
        r.playMode = AlarmPlayMode.voiceOnly.rawValue
        XCTAssertEqual(
            AlarmSoundResolver.rotatedBucketClipKey(for: r, audioCache: store),
            cached
        )
    }
}
