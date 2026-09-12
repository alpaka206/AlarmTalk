import XCTest
@testable import AlarmTalk

/// 준비도 계산 — 화면(준비 페이지)과 관문이 함께 쓰는 값이라 여기서 고정한다.
final class ClipReadinessTests: XCTestCase {

    private func clip(_ voice: String, _ category: String, _ variant: Int, language: String = "ko") -> StockClip {
        StockClip(
            messageId: "\(voice)-\(category)-\(variant)-\(language)",
            voiceProfileId: voice,
            voiceName: nil,
            category: category,
            language: language,
            text: "t",
            audioUrl: nil,
            variant: variant
        )
    }

    private let counts = ExpectedVariantCounts(
        system: ["weather": 9, "medication": 2],
        clone: ["weather": 9, "medication": 3, "love": 3, "fortune": 5, "greeting": 1]
    )

    /// ⚠ 기본 목소리와 등록 목소리의 개수가 다르다 — 합치면 한쪽이 반드시 틀린다.
    func test_expectedCountDiffersBetweenSystemAndClone() {
        XCTAssertEqual(counts.count(category: "medication", isSystemVoice: true), 2)
        XCTAssertEqual(counts.count(category: "medication", isSystemVoice: false), 3)
    }

    func test_systemVoiceIsReadyWithItsOwnSmallerSet() {
        // 기본 목소리의 medication 은 2개면 **완전하다.** 클론 기준(3)으로 재면
        // 영원히 '부족' 이라 오프라인 재생이 안 켜진다.
        let clips = [clip("sys", "medication", 0), clip("sys", "medication", 1)]
        let result = ClipReadiness.evaluate(
            voiceProfileIDs: ["sys"],
            clips: clips,
            expectedVariants: counts,
            isSystemVoice: { _ in true },
            categories: { _ in ["medication"] },
            renderState: { _ in (false, false) },
            isCached: { _ in true }
        )
        XCTAssertEqual(result.first?.expected, 2)
        XCTAssertEqual(result.first?.missing, 0)
        XCTAssertTrue(ClipReadiness.isReady(result))
    }

    func test_missingCountsOnlyWhatIsActuallyAbsent() {
        // 운영이 시드를 늘려 9 → 11 이 되면 **비는 2개만** 부족으로 잡혀야 한다.
        let grown = ExpectedVariantCounts(system: ["weather": 11], clone: [:])
        let cachedKeys = Set((0..<9).map { "sys-weather-\($0)-ko" })
        let clips = (0..<9).map { clip("sys", "weather", $0) }
        let result = ClipReadiness.evaluate(
            voiceProfileIDs: ["sys"],
            clips: clips,
            expectedVariants: grown,
            isSystemVoice: { _ in true },
            categories: { _ in ["weather"] },
            renderState: { _ in (false, false) },
            isCached: { cachedKeys.contains($0.messageId) }
        )
        XCTAssertEqual(result.first?.expected, 11)
        XCTAssertEqual(result.first?.cached, 9)
        XCTAssertEqual(result.first?.missing, 2)
        XCTAssertFalse(ClipReadiness.isReady(result))
    }

    func test_sameVariantInTwoLanguagesIsCountedOnce() {
        // 언어가 섞여 내려와도 **자리 수**로 센다. 안 그러면 절반만 받고 '다 됐다' 가 된다.
        let clips = [
            clip("sys", "medication", 0, language: "ko"),
            clip("sys", "medication", 0, language: "en"),
        ]
        let result = ClipReadiness.evaluate(
            voiceProfileIDs: ["sys"],
            clips: clips,
            expectedVariants: counts,
            isSystemVoice: { _ in true },
            categories: { _ in ["medication"] },
            renderState: { _ in (false, false) },
            isCached: { _ in true }
        )
        XCTAssertEqual(result.first?.cached, 1)
        XCTAssertEqual(result.first?.missing, 1)
    }

    func test_renderingVoiceCountsAsEntirelyPending() {
        // 서버가 아직 만드는 중이면 받을 것이 매니페스트에 없다 — 그 몫은 통째로 남은 것이다.
        let result = ClipReadiness.evaluate(
            voiceProfileIDs: ["clone"],
            clips: [],
            expectedVariants: counts,
            isSystemVoice: { _ in false },
            categories: { _ in ["love"] },
            renderState: { _ in (true, false) },
            isCached: { _ in true }
        )
        XCTAssertEqual(ClipReadiness.percent(result), 0)
        XCTAssertFalse(ClipReadiness.isReady(result))
    }

    func test_renderFailedIsNotReadyEvenWhenNothingIsMissing() {
        // 실패는 재시도 대상이다 — '받을 게 없다' 를 '준비됐다' 로 읽으면 안 된다.
        var progress = ClipReadiness.VoiceProgress(
            voiceProfileID: "clone", isRendering: false, renderFailed: true, expected: 3, cached: 3
        )
        XCTAssertFalse(progress.isReady)
        progress.renderFailed = false
        XCTAssertTrue(progress.isReady)
    }

    func test_percentNeverShows100UntilItIsActuallyDone() {
        // 99.6% 가 100% 로 보이면 사용자가 끝난 줄 알고 나간다.
        let almost = [ClipReadiness.VoiceProgress(
            voiceProfileID: "sys", isRendering: false, renderFailed: false, expected: 1000, cached: 999
        )]
        XCTAssertEqual(ClipReadiness.percent(almost), 99)

        let done = [ClipReadiness.VoiceProgress(
            voiceProfileID: "sys", isRendering: false, renderFailed: false, expected: 10, cached: 10
        )]
        XCTAssertEqual(ClipReadiness.percent(done), 100)
    }

    func test_emptyTargetIsNotReady() {
        // 대상이 없다는 것은 매니페스트를 아직 못 받았다는 뜻이다 — 준비됐다고 하면 안 된다.
        XCTAssertFalse(ClipReadiness.isReady([]))
    }
}
