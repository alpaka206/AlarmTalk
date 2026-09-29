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
        XCTAssertEqual(RandomPromptContext.forBucket("cheer"), .cheer)
        // ⚠ **옛 이름 `love` 도 영원히 받는다**(2026-09-02 개명). 이미 저장된 알람 행과
        //   구버전 앱이 그 값을 들고 있고, 접지 않으면 `preset` 으로 떨어져 응원을
        //   골랐는데 기본 인사말이 울린다.
        XCTAssertEqual(RandomPromptContext.forBucket("love"), .cheer)
        XCTAssertEqual(RandomPromptContext.normalized("love"), .cheer)
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
        let restored = restoreContext(storedContext: RandomPromptContext.cheer.rawValue, bucketId: "weather")
        XCTAssertEqual(restored, .cheer)
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

    // MARK: 문구가 없던 알람을 목소리로 — 빈 '직접 입력' 이 아니다

    /// **알람 전용으로 저장된 행에는 문구가 하나도 없다** — 그 모양이 곧 '직접 입력' 판정식이다.
    ///
    /// 2026-09-29 실기기 보고: "알람 소리였던 거 목소리로 바꾸면 직접 입력으로 되어 있는데 …
    /// 직접 입력 등록 안 돼 있으면 생성도 안 되고". `toRecord` 가 알람 전용일 때 문구 필드를
    /// 비우므로, 그 행을 편집기로 열면(`loadVoicePromptState`) 랜덤 꺼짐·테마 없음·문구 없음이다.
    /// 그래서 목소리로 옮기는 순간 `adoptLastMessageChoiceIfUnset` 이 직전 선택을 잇는다.
    func testAlarmOnlyRecordHasNoMessageChoice() {
        var draft = AlarmEditDraft.newDefault(defaultPlayMode: .alarmOnly)
        draft.voiceRandomPrompt = true
        let record = draft.toRecord(existing: nil, fireAtMillis: 0, nowMillis: 0)

        XCTAssertEqual(record.voiceSourceEnum, .localAudio)
        XCTAssertFalse(record.voiceRandomPrompt)
        XCTAssertNil(record.voiceRandomContext)
        XCTAssertNil(record.voiceText)
        // 편집기가 여는 식 그대로(`loadVoicePromptState`).
        XCTAssertTrue(AlarmEditDraft.hasNoMessageChoice(
            randomPrompt: record.voiceRandomPrompt,
            selectedBucket: FreeBucket.stored(record.bucketId),
            ttsText: record.voiceText ?? ""
        ))
    }

    /// 무엇이든 골라져 있으면 **문구가 있는 것**이다 — 그때는 절대 덮지 않는다.
    func testAnyExistingChoiceCountsAsAMessage() {
        XCTAssertFalse(AlarmEditDraft.hasNoMessageChoice(randomPrompt: true, selectedBucket: nil, ttsText: ""))
        XCTAssertFalse(AlarmEditDraft.hasNoMessageChoice(randomPrompt: false, selectedBucket: .medication, ttsText: ""))
        XCTAssertFalse(AlarmEditDraft.hasNoMessageChoice(randomPrompt: false, selectedBucket: nil, ttsText: "내가 친 문구"))
        // 공백만 있는 문구는 없는 것이다 — 그대로 두면 다시 빈 직접 입력이다.
        XCTAssertTrue(AlarmEditDraft.hasNoMessageChoice(randomPrompt: false, selectedBucket: nil, ttsText: "   "))
    }

    /// 마지막 문구 종류가 있으면 그걸 잇는다.
    func testLastMessageKindIsAdopted() {
        XCTAssertEqual(
            AlarmEditDraft.lastMessageChoice(lastMessageContext: "medication", lastManualText: nil),
            .generated(RandomPromptContext.medication.rawValue)
        )
        // 옛 이름도 접어서 잇는다(`love` → 응원).
        XCTAssertEqual(
            AlarmEditDraft.lastMessageChoice(lastMessageContext: "love", lastManualText: nil),
            .generated(RandomPromptContext.cheer.rawValue)
        )
    }

    /// 한 번도 고른 적 없으면 **기본 인사말**(preset) — 빈 직접 입력이 아니다.
    func testNoHistoryFallsBackToPresetGreeting() {
        XCTAssertEqual(
            AlarmEditDraft.lastMessageChoice(lastMessageContext: nil, lastManualText: nil),
            .generated(RandomPromptContext.preset.rawValue)
        )
        XCTAssertEqual(
            AlarmEditDraft.lastMessageChoice(lastMessageContext: "  ", lastManualText: "  "),
            .generated(RandomPromptContext.preset.rawValue)
        )
    }

    /// 마지막이 직접 입력이었으면 **문구까지** 잇는다(새 알람과 같은 규칙) — 글자가 같아
    /// 기기에 있는 음성을 재사용하므로 서버 호출도 한도 차감도 없다. 마지막 선택은 하나다.
    func testLastManualTextWinsWhenThatWasTheLastChoice() {
        XCTAssertEqual(
            AlarmEditDraft.lastMessageChoice(lastMessageContext: "cheer", lastManualText: "회의 자료 챙겨"),
            .manual("회의 자료 챙겨")
        )
    }

    /// **빈 직접 입력은 서버를 부르기 전에 막는다** — `saveFlow` 첫머리가 보는 판정 그대로
    /// (`AlarmEditorSheet.manualTextMissing` → `AlarmEditDraft.manualTextMissing`).
    /// 안드로이드 `emptyMessageBlockReason` 짝.
    func testEmptyManualTextIsCaughtBeforeTheServer() {
        func missing(
            playMode: AlarmPlayMode = .voiceOnly,
            source: VoiceSource = .ttsProfile,
            stock: Bool = false,
            random: Bool = false,
            bucket: FreeBucket? = nil,
            text: String = ""
        ) -> Bool {
            AlarmEditDraft.manualTextMissing(
                playMode: playMode,
                voiceSource: source,
                usesStockClips: stock,
                randomPrompt: random,
                selectedBucket: bucket,
                ttsText: text
            )
        }
        // 등록(클론) 목소리 + 빈 직접 입력 → 막는다(공백만 있어도 빈 것이다).
        XCTAssertTrue(missing())
        XCTAssertTrue(missing(text: "   "))
        // 문구가 하나라도 있으면 막지 않는다.
        XCTAssertFalse(missing(text: "일어나"))
        XCTAssertFalse(missing(random: true))
        XCTAssertFalse(missing(bucket: .medication))
        // 알람 전용·직접 녹음은 문구가 필요 없다.
        XCTAssertFalse(missing(playMode: .alarmOnly))
        XCTAssertFalse(missing(source: .localAudio))
        // 스톡 클립 목소리의 빈 문구는 테마가 붙기 전 과도기다 — '직접 입력' 이 아니다.
        XCTAssertFalse(missing(stock: true))
    }

    /// **쓸 수 없는 목소리는 버튼을 죽이지 않고 누를 때 알럿으로 막는다**(2026-09-29 —
    /// 편집기의 '삭제된 목소리' 배너를 걷어낸 뒤로 이 알럿이 유일한 설명이다).
    /// `saveFlow` 첫머리와 `editorSaveBlocked` 가 같은 판정을 본다.
    /// 안드로이드 `SaveBlockReason.VOICE_UNAVAILABLE` 짝.
    func testUnusableVoiceIsExplainedOnSaveInsteadOfADeadButton() {
        var audioChecked = false
        func unusable(
            playMode: AlarmPlayMode = .voiceOnly,
            source: VoiceSource = .ttsProfile,
            profileID: String? = "clone-1",
            settling: Bool = false,
            locked: Bool = false,
            theme: Bool = false,
            ready: Bool = false,
            audio: Bool = false
        ) -> Bool {
            AlarmEditDraft.selectedVoiceUnusable(
                playMode: playMode,
                voiceSource: source,
                profileID: profileID,
                settling: settling,
                lockedByPlan: locked,
                themeSelected: theme,
                profileReady: ready,
                hasUsableAudio: { audioChecked = true; return audio }()
            )
        }
        // 목록에서 사라진(삭제·공유 해제·미준비) 목소리 + 쓸 음원 없음 → 막는다.
        XCTAssertTrue(unusable())
        // 무료 플랜에서 잠긴 목소리 → 막는다(준비돼 있어도).
        XCTAssertTrue(unusable(locked: true, ready: true))
        // ⚠ 잠금은 기존 음원 재사용으로도 풀리지 않는다 — 서버 `PATCH /alarm` 이 저장된 값
        // 그대로의 유료 목소리도 403 으로 거절하고, 안드로이드도 `voiceAlarmAllowed` 가 막는다.
        XCTAssertTrue(unusable(locked: true, audio: true))
        // ⚠ 테마로도 풀리지 않는다 — 클론에 붙은 테마 클립은 그 유료 목소리의 클립이다(Codex #826).
        XCTAssertTrue(unusable(locked: true, theme: true))
        // 준비된 목소리, 또는 기존 알람 음원을 그대로 쓸 수 있으면 막지 않는다.
        XCTAssertFalse(unusable(ready: true))
        XCTAssertFalse(unusable(audio: true))
        // 테마(스톡 클립)를 골랐으면 클립이 울린다 — 막지 않는다.
        XCTAssertFalse(unusable(theme: true))
        // 정리 중인 교체 목소리는 "아직 준비 중" 으로 따로 말한다.
        XCTAssertFalse(unusable(settling: true))
        XCTAssertFalse(unusable(settling: true, locked: true))
        // 목소리 미선택·알람 전용·직접 녹음은 이 갈래가 아니다.
        XCTAssertFalse(unusable(profileID: nil))
        XCTAssertFalse(unusable(profileID: "  "))
        XCTAssertFalse(unusable(playMode: .alarmOnly))
        XCTAssertFalse(unusable(source: .localAudio))
        // 음원 재사용 판정(발화 시각 계산)은 준비된 목소리에서는 부르지 않는다.
        audioChecked = false
        _ = unusable(ready: true)
        XCTAssertFalse(audioChecked)
    }

    /// **직접 녹음 → 목소리 관문은 이을 값으로 본다**(2026-09-29 리뷰). 관문은 소스를 바꾸고
    /// 직전 선택을 잇기 **전에** 돌므로(`AlarmEditorSheet.recordingExitNeedsClipPreparation`),
    /// 지금 값(랜덤 꺼짐)이 아니라 잇기가 켤 종류를 알아야 한다. 안드로이드
    /// `AlarmEditorState.randomContextAdoptedByTtsPick` 짝.
    func testTtsPickFromRecordingReportsTheKindItWillAdopt() {
        func adopted(
            random: Bool = false,
            bucket: FreeBucket? = nil,
            text: String = "",
            lastContext: String? = nil,
            lastManual: String? = nil
        ) -> String? {
            AlarmEditDraft.randomContextAdoptedByTtsPick(
                randomPrompt: random,
                selectedBucket: bucket,
                ttsText: text,
                lastMessageContext: lastContext,
                lastManualText: lastManual
            )
        }
        // 문구가 없는 녹음 알람 → 이을 종류(없으면 기본 인사말).
        XCTAssertEqual(adopted(lastContext: "wake_fortune"), RandomPromptContext.wakeFortune.rawValue)
        XCTAssertEqual(adopted(), RandomPromptContext.preset.rawValue)
        // 직접 입력을 이으면 랜덤이 켜지지 않는다 — 클립이 필요 없다.
        XCTAssertNil(adopted(lastContext: "fortune", lastManual: "회의 자료 챙겨"))
        // 문구가 이미 있으면 잇지 않는다 — 관문은 지금 값 그대로 본다.
        XCTAssertNil(adopted(random: true, lastContext: "fortune"))
        XCTAssertNil(adopted(bucket: .medication, lastContext: "fortune"))
        XCTAssertNil(adopted(text: "내가 친 문구", lastContext: "fortune"))
    }

    /// **유료 직접 입력은 기본 목소리의 강제가 건드리지 않는다**(2026-09-29 리뷰). 직전 선택으로
    /// 직접 입력 문구를 이은 뒤 옛 테마가 붙으면(`applyPendingFreeBucketIfNeeded`) 이은 문구가
    /// 말없이 사라진다. 4-값 고정(`coerceFreeVoiceTierConstraints`)과 같은 판정 하나.
    func testPaidTypedManualTextIsLeftAloneByStockClipCoercion() {
        func keeps(
            free: Bool = false,
            random: Bool = false,
            bucket: FreeBucket? = nil,
            text: String = "회의 자료 챙겨"
        ) -> Bool {
            AlarmEditDraft.keepsPaidTypedManualText(
                freeVoiceTier: free,
                randomPrompt: random,
                selectedBucket: bucket,
                ttsText: text
            )
        }
        XCTAssertTrue(keeps())
        // 잠긴 등급(무료)에서는 예전 그대로 테마·기본 인사말로 강제한다.
        XCTAssertFalse(keeps(free: true))
        // 직접 입력이 아니면(생성형·테마·빈 문구) 강제가 돈다.
        XCTAssertFalse(keeps(random: true))
        XCTAssertFalse(keeps(bucket: .medication))
        XCTAssertFalse(keeps(text: "   "))
    }

    /// `AlarmEditorSheet.loadVoicePromptState` 의 복원식과 같은 순서.
    private func restoreContext(storedContext: String?, bucketId: String?) -> RandomPromptContext {
        storedContext.nilIfBlank.map(RandomPromptContext.normalized)
            ?? RandomPromptContext.forBucket(bucketId)
            ?? .defaultContext
    }
}
