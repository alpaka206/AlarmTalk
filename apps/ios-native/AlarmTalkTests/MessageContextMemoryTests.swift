import XCTest
@testable import AlarmTalk

/// **테마(스톡) 알람이 문구 종류를 잃지 않는지** 고정한다.
///
/// 안드로이드에서 같은 규약이 네 번 깨졌고(CLAUDE.md 「직전 선택 유지」), iOS 는 아예
/// 깨진 채로 구현돼 있었다 — 저장 시 `voiceRandomContext = nil` 로 종류를 통째로 버렸다.
/// 증상은 둘로 갈라져 보이지만 원인은 하나다:
///  (1) 새 알람이 매번 '기본 인사말' 로 열리고
///  (2) 그 알람을 다시 열면 '직접 입력' 으로 보인다.
final class MessageContextMemoryTests: XCTestCase {

    // MARK: 종류 ↔ 테마 왕복

    /// 저장(`bucketCategory`)과 복원(`forBucket`)은 **한 쌍**이다. 한쪽만 고치면
    /// 옛 행 복구가 조용히 어긋난다.
    func testBucketCategoryRoundTripsBackToItsMessageContext() {
        for context in RandomPromptContext.alarmEditorCases {
            XCTAssertEqual(
                RandomPromptContext.forBucket(context.bucketCategory),
                context,
                "\(context.rawValue) → \(context.bucketCategory) → 되짚기 실패"
            )
        }
    }

    /// 안드로이드 `randomPromptContextForBucket` 과 **같은 표**여야 한다.
    /// 두 앱이 같은 서버 행을 읽으므로 어긋나면 한쪽에서만 종류가 틀리게 보인다.
    func testForBucketMatchesAndroidMapping() {
        XCTAssertEqual(RandomPromptContext.forBucket("greeting"), .preset)
        XCTAssertEqual(RandomPromptContext.forBucket("love"), .love)
        XCTAssertEqual(RandomPromptContext.forBucket("medication"), .medication)
        XCTAssertEqual(RandomPromptContext.forBucket("fortune"), .wakeFortune)
        XCTAssertEqual(RandomPromptContext.forBucket("weather"), .wakeWeather)
    }

    /// 테마가 아닌 값에는 **nil** 을 준다 — 기본값으로 접으면 '직접 입력' 알람이
    /// 생성 문구로 뒤집힌다.
    func testForBucketReturnsNilForNonBucketValues() {
        XCTAssertNil(RandomPromptContext.forBucket(nil))
        XCTAssertNil(RandomPromptContext.forBucket(""))
        XCTAssertNil(RandomPromptContext.forBucket("   "))
        XCTAssertNil(RandomPromptContext.forBucket("custom"))
    }

    func testForBucketIgnoresSurroundingWhitespace() {
        XCTAssertEqual(RandomPromptContext.forBucket("  weather  "), .wakeWeather)
    }

    // MARK: 복원 우선순위

    /// 저장된 종류가 있으면 **그걸 쓴다.** 테마 id 로 되짚는 건 종류가 없을 때뿐이다 —
    /// 순서가 뒤집히면 사용자가 바꾼 종류를 테마가 도로 덮는다.
    func testStoredContextWinsOverBucketFallback() {
        let restored = restoreContext(storedContext: RandomPromptContext.love.rawValue, bucketId: "weather")
        XCTAssertEqual(restored, .love)
    }

    /// 종류를 떨어뜨리던 시절에 저장된 행(= 종류 nil + 테마 있음)은 테마로 되짚는다.
    func testLegacyRowWithoutContextRecoversFromBucket() {
        XCTAssertEqual(restoreContext(storedContext: nil, bucketId: "medication"), .medication)
        XCTAssertEqual(restoreContext(storedContext: "", bucketId: "fortune"), .wakeFortune)
    }

    /// 둘 다 없으면 기본값.
    func testNoContextAndNoBucketFallsBackToDefault() {
        XCTAssertEqual(restoreContext(storedContext: nil, bucketId: nil), .defaultContext)
    }

    /// `AlarmEditorSheet.loadVoicePromptState` 의 복원식과 같은 순서.
    private func restoreContext(storedContext: String?, bucketId: String?) -> RandomPromptContext {
        storedContext.nilIfBlank.map(RandomPromptContext.normalized)
            ?? RandomPromptContext.forBucket(bucketId)
            ?? .defaultContext
    }
}
