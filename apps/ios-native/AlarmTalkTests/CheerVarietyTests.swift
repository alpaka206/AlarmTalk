import XCTest
@testable import AlarmTalk

/// 응원 다양하게 / 이 문구로 고정 — 스펙 `docs/spec/voice-and-message.md` §5-4.
/// 안드로이드 짝은 `CheerVarietyTest.kt` — 같은 입력에 같은 답이어야 한다(특히 `seedIndex`).
final class CheerVarietyTests: XCTestCase {
    private let ids = (1...14).map { String(format: "cheer_v2_%02d", $0) }
    private let occurrence: Int64 = 1_800_000_000_000
    private let day: Int64 = 86_400_000
    private let voice = "70000000-0000-4000-9000-000000000102"
    private let otherVoice = "70000000-0000-4000-9000-000000000103"
    private let defaultVoice = "70000000-0000-4000-9000-000000000001"

    private func candidates(_ list: [String]? = nil) -> [CheerCandidate] {
        (list ?? ids).map { CheerCandidate(contentId: $0, cacheKey: "stock_\($0)", text: "문구 \($0)") }
    }

    private func cheerAlarm(mode: String? = nil, pinned: String? = nil) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "",
            hour: 7,
            minute: 0,
            fireAtMillis: occurrence,
            repeatDaysMask: 0b1111111,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceProfileId: voice,
            voiceLanguage: "ko",
            createdAtMillis: 1,
            updatedAtMillis: 1
        )
        record.bucketId = CheerVariety.bucketID
        record.cheerMode = mode
        record.cheerPinnedContentId = pinned
        return record
    }

    func test_seedIndexIsTheSharedHash() {
        // 안드로이드 `CheerVarietyTest.seedIndexIsTheSharedHash` 와 같은 표.
        XCTAssertEqual(CheerVariety.seedIndex(occurrence: 1_800_000_000_000, count: 7), 3)
        XCTAssertEqual(CheerVariety.seedIndex(occurrence: 1_800_000_000_000, count: 14), 10)
        XCTAssertEqual(CheerVariety.seedIndex(occurrence: 1_800_086_400_000, count: 3), 2)
        XCTAssertEqual(CheerVariety.seedIndex(occurrence: 1_761_868_800_000, count: 14), 2)
        XCTAssertEqual(
            CheerVariety.seedIndex(occurrence: 1_800_000_000_000, count: 14),
            CheerVariety.seedIndex(occurrence: 1_800_000_059_999, count: 14)
        )
    }

    func test_varyExcludesTheLastSevenPreparedLines() {
        let history = Array(ids.prefix(9))
        let picked = CheerVariety.pick(candidates: ids, history: history, occurrence: occurrence)!
        XCTAssertFalse(ids[2..<9].contains(picked))
        XCTAssertEqual(picked, CheerVariety.pick(candidates: ids, history: history, occurrence: occurrence))
    }

    func test_whenTooFewCandidatesTheOldestPreparedLineIsAllowed() {
        let legacy = ["cheer_v1_01", "cheer_v1_02", "cheer_v1_03"]
        XCTAssertEqual(
            CheerVariety.pick(candidates: legacy, history: ["cheer_v1_02", "cheer_v1_03", "cheer_v1_01"], occurrence: 1),
            "cheer_v1_02"
        )
        XCTAssertEqual(CheerVariety.pick(candidates: legacy, history: ["cheer_v1_01", "cheer_v1_02"], occurrence: 1), "cheer_v1_03")
        XCTAssertNil(CheerVariety.pick(candidates: [], history: legacy, occurrence: 1))
    }

    func test_historyMovesRepeatsToTheEndAndIsCapped() {
        XCTAssertEqual(CheerVariety.appendHistory(["a", "b"], "a"), ["b", "a"])
        let long = (1...40).reduce([String]()) { CheerVariety.appendHistory($0, "id\($1)") }
        XCTAssertEqual(long.count, CheerVariety.historyLimit)
        XCTAssertEqual(long.last, "id40")
    }

    func test_sameOccurrenceReusesTheSelectionWithoutAddingHistory() {
        let first = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        let selection = first.cheerSelection!
        XCTAssertEqual(selection.occurrence, occurrence)
        XCTAssertEqual(first.cheerHistory, [selection.contentId])
        // 앱 복귀·재시도·설정을 안 바꾼 저장 — 같은 회차는 같은 문구, 이력 그대로.
        let again = CheerVariety.prepared(first, occurrence: occurrence, candidates: candidates(), explicitChange: false)
        XCTAssertEqual(again.cheerSelection, first.cheerSelection)
        XCTAssertEqual(again.cheerHistory, first.cheerHistory)
    }

    func test_aNewOccurrencePicksAgainAndNothingRepeatsForEightOccurrences() {
        var alarm = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        var seen = [alarm.cheerSelection!.contentId]
        for n in 1...7 {
            alarm = CheerVariety.prepared(alarm, occurrence: occurrence + Int64(n) * day, candidates: candidates(), explicitChange: false)
            seen.append(alarm.cheerSelection!.contentId)
        }
        XCTAssertEqual(Set(seen).count, seen.count)
        XCTAssertEqual(alarm.cheerHistory, seen)
    }

    func test_pinnedUsesTheChosenLineAndFallsBackWithoutClearingIt() {
        let pinned = cheerAlarm(mode: CheerMode.pinned.rawValue, pinned: "cheer_v2_05")
        XCTAssertEqual(
            CheerVariety.prepared(pinned, occurrence: occurrence, candidates: candidates(), explicitChange: true).cheerSelection?.contentId,
            "cheer_v2_05"
        )
        let missing = CheerVariety.prepared(
            pinned,
            occurrence: occurrence,
            candidates: candidates(ids.filter { $0 != "cheer_v2_05" }),
            explicitChange: true
        )
        XCTAssertNotEqual(missing.cheerSelection?.contentId, "cheer_v2_05")
        XCTAssertEqual(missing.cheerPinnedContentId, "cheer_v2_05")
    }

    func test_withoutCandidatesNothingIsChosenAndTheBoundRotationPlays() {
        let first = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        let none = CheerVariety.prepared(first, occurrence: occurrence + day, candidates: [], explicitChange: false)
        XCTAssertNil(none.cheerSelection)
        XCTAssertEqual(none.cheerHistory, first.cheerHistory)
    }

    func test_selectionPlaysOnlyForTheLanguageItWasPreparedIn() {
        var prepared = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        XCTAssertNotNil(CheerVariety.activeSelection(prepared))
        prepared.voiceLanguage = "en"
        XCTAssertNil(CheerVariety.activeSelection(prepared))
    }

    func test_downgradedAlarmDoesNotPlayTheOldVoiceSelection() {
        // 클론으로 고른 회차 — 구독 만료로 기본 목소리로 강등된다. 강등은 선택 칸을 그대로 두고 목소리만 바꾼다.
        let prepared = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        let locked = DefaultVoiceSubstitute.locked(prepared, voiceID: defaultVoice, binding: nil, nowMillis: 5_000)
        XCTAssertEqual(locked.cheerSelection, prepared.cheerSelection)
        // 예약할 때 옛 클론 클립을 쓰지 않는다 — 묶어 둔 회전(기본 목소리)이 운다. 앱 복귀 준비가 다시 고른다.
        XCTAssertNil(CheerVariety.activeSelection(locked))
        XCTAssertTrue(CheerVariety.needsPreparation(locked))

        let defaultCandidates = ids.map { CheerCandidate(contentId: $0, cacheKey: "stock_default_\($0)", text: "문구 \($0)") }
        let rebound = CheerVariety.prepared(locked, occurrence: occurrence, candidates: defaultCandidates, explicitChange: false)
        let selection = CheerVariety.activeSelection(rebound)
        XCTAssertEqual(selection?.voiceProfileId, defaultVoice)
        XCTAssertTrue(selection?.cacheKey.hasPrefix("stock_default_") == true)
        XCTAssertFalse(CheerVariety.needsPreparation(rebound))
    }

    func test_editingTheVoiceForTheSameOccurrencePicksTheNewVoiceClip() {
        var edited = CheerVariety.prepared(cheerAlarm(), occurrence: occurrence, candidates: candidates(), explicitChange: true)
        // 문구 ID 는 목소리끼리 같다(cheer_v2_05) — ID 만 보면 옛 목소리 클립이 남는다.
        edited.voiceProfileId = otherVoice
        let otherCandidates = ids.map { CheerCandidate(contentId: $0, cacheKey: "stock_other_\($0)", text: "문구 \($0)") }
        let next = CheerVariety.prepared(edited, occurrence: occurrence, candidates: otherCandidates, explicitChange: false)
        let selection = CheerVariety.activeSelection(next)
        XCTAssertEqual(selection?.voiceProfileId, otherVoice)
        XCTAssertTrue(selection?.cacheKey.hasPrefix("stock_other_") == true)
    }

    func test_aSelectionWithoutVoiceIsNotUsed() throws {
        let json = #"{"o":1800000000000,"id":"cheer_v2_05","key":"stock_x","text":"t","lang":"ko"}"#
        var record = cheerAlarm()
        record.cheerSelection = try JSONDecoder().decode(CheerSelection.self, from: Data(json.utf8))
        XCTAssertNil(CheerVariety.activeSelection(record))
    }

    func test_candidatesComeFromTheManifestThemeAndOnlySelectableCachedLines() {
        func clip(_ id: String, _ category: String, _ variant: Int, language: String = "ko", voice: String? = nil,
                  theme: String? = "cheer", contentId: String? = nil, selectable: Bool? = true) -> StockClip {
            StockClip(
                messageId: id, voiceProfileId: voice ?? self.voice, voiceName: nil, category: category, language: language,
                text: "\(category) \(variant)", audioUrl: "r2://x/\(id).mp3", variant: variant, renderedForCurrentVoice: nil,
                theme: theme, contentId: contentId, selectable: selectable
            )
        }
        let clips = [
            clip("m-legacy", "cheer", 0, contentId: "cheer_v1_01", selectable: false),
            clip("m-01", "cheer_v2", 0, contentId: "cheer_v2_01"),
            clip("m-02", "cheer_v2", 1, contentId: "cheer_v2_02"),
            clip("m-en", "cheer_v2", 0, language: "en", contentId: "cheer_v2_01"),
            clip("m-other", "cheer_v2", 0, voice: "other", contentId: "cheer_v2_01"),
            clip("m-weather", "weather", 0, theme: "weather"),
            clip("m-old", "cheer", 1, theme: nil, contentId: nil, selectable: nil),
        ]
        let cached: Set<String> = ["stock_m-01", "stock_m-legacy", "stock_m-old"]
        let result = CheerVariety.candidates(clips: clips, voiceID: voice, language: "ko") { cached.contains($0) }
        XCTAssertEqual(result.map(\.contentId), ["cheer_v2_01"])
        XCTAssertEqual(CheerVariety.phrases(clips: clips, voiceID: voice, language: "ko").map(\.candidate.contentId),
                       ["cheer_v2_01", "cheer_v2_02"])
    }

    func test_cheerFieldsRoundTripThroughDisk() throws {
        var record = CheerVariety.prepared(
            cheerAlarm(mode: CheerMode.pinned.rawValue, pinned: "cheer_v2_02"),
            occurrence: occurrence,
            candidates: candidates(),
            explicitChange: true
        )
        record.ttsMessageId = "m-1"
        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: JSONEncoder().encode(record))
        XCTAssertEqual(decoded.cheerMode, "pinned")
        XCTAssertEqual(decoded.cheerPinnedContentId, "cheer_v2_02")
        XCTAssertEqual(decoded.cheerSelection, record.cheerSelection)
        XCTAssertEqual(decoded.cheerHistory, record.cheerHistory)

        // 서버로 올리는 본문은 없다(2026-10-29 서버 알람 사본 삭제) — 디스크 왕복만 본다.
    }

    func test_wakeIsAStockOnlyThemeThatMapsBothWays() {
        XCTAssertEqual(RandomPromptContext.wake.bucketCategory, "wake")
        XCTAssertEqual(RandomPromptContext.forBucket("wake"), .wake)
        XCTAssertEqual(RandomPromptContext.normalized("wake"), .wake)
        XCTAssertEqual(FreeBucket.order.map(\.rawValue), ["wake", "weather", "fortune", "cheer", "medication"])
    }
}
