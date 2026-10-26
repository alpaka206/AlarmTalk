import Foundation

/// 응원 테마의 선택 방식 — `alarms.cheer_mode`. 안드로이드 `data.CheerModes` 미러.
enum CheerMode: String {
    case vary
    case pinned

    /// 저장값 읽기 — 모르는 값·없음은 다양하게.
    static func normalize(_ raw: String?) -> CheerMode { raw == CheerMode.pinned.rawValue ? .pinned : .vary }
}

/// 고를 수 있는 응원 문구 하나. `cacheKey` 는 `stock_<messageId>`.
struct CheerCandidate: Equatable, Identifiable {
    var contentId: String
    var cacheKey: String
    var text: String
    var id: String { contentId }
}

/// 지금 회차의 선택. `occurrence` = 그 회차의 예정 발사 시각(회차 키). `voiceProfileId` = 고를 때 알람에 묶여 있던
/// 목소리 — 지금 목소리와 다르면 그 선택은 죽은 값이다(`CheerVariety.isSelection(_:for:)`). 안드로이드 `CheerSelection` 미러.
struct CheerSelection: Codable, Hashable {
    var occurrence: Int64
    var contentId: String
    var cacheKey: String
    var text: String
    var language: String
    var voiceProfileId: String?

    // 안드로이드 저장 모양과 같은 짧은 이름이다 — 바꾸면 옛 행을 못 읽는다.
    private enum CodingKeys: String, CodingKey {
        case occurrence = "o"
        case contentId = "id"
        case cacheKey = "key"
        case text
        case language = "lang"
        case voiceProfileId = "voice"
    }
}

/// 응원 테마의 **다양하게 / 이 문구로 고정** — 규칙의 단일 출처는 `docs/spec/voice-and-message.md` §5-4.
///
/// 안드로이드 `data/CheerVariety.kt` 와 **같은 셈**이다(특히 `seedIndex`) — 한쪽만 고치지 말 것.
///
/// iOS 가 다른 점은 **언제 고르는가** 하나다(스펙 §5-4 「플랫폼 차이」): AlarmKit 은 예약할 때 받은 소리만 울리므로,
/// 저장·관측된 해제(`LocalAlarmStore.markStopped`)·앱 복귀(`LocalAlarmStore.prepareCheerSelections`)에서 고르고, 고른 뒤
/// 소리 지문이 바뀌면 재조정이 다시 예약한다. 해제를 놓친 회차는 같은 문구로 다시 울 수 있다 — 그걸 숨기지 않는다.
enum CheerVariety {
    /// 응원 테마의 버킷 id.
    static let bucketID = "cheer"
    /// 다양하게 — 새로 고를 때 빼는 최근 이력 수(지시서 v1.3 12.1).
    static let recentExclusion = 7
    /// 이력 상한 — 오래된 것부터 버린다.
    static let historyLimit = 32

    /// 회차 키 → 자리. 32비트 곱셈 해시 — 안드로이드 `cheerSeedIndex` 와 같은 값을 낸다. 분 단위로 자른다.
    static func seedIndex(occurrence: Int64, count: Int) -> Int {
        guard count > 0 else { return 0 }
        let minutes = occurrence >= 0 ? occurrence / 60_000 : (occurrence - 59_999) / 60_000
        let hash = (UInt64(bitPattern: minutes) &* 2_654_435_761) & 0xFFFF_FFFF
        return Int(hash % UInt64(count))
    }

    /// **다양하게** — 최근 `recentExclusion` 개를 빼고 고른다. 후보가 없으면 nil.
    static func pick(candidates: [String], history: [String], occurrence: Int64) -> String? {
        guard !candidates.isEmpty else { return nil }
        let recent = Set(history.suffix(recentExclusion))
        let eligible = candidates.filter { !recent.contains($0) }
        if !eligible.isEmpty { return eligible[seedIndex(occurrence: occurrence, count: eligible.count)] }
        // 후보가 모자라다 — 가장 오래전에 고른 것부터 허용한다(고른 적 없는 것은 -1 이라 가장 오래됐다). 동률은 목록 순서.
        return candidates.min { (history.firstIndex(of: $0) ?? -1) < (history.firstIndex(of: $1) ?? -1) }
    }

    /// 이력에 더한다 — 같은 ID 는 끝으로 옮기고, 상한을 넘으면 오래된 것부터 버린다.
    static func appendHistory(_ history: [String], _ contentId: String) -> [String] {
        Array((history.filter { $0 != contentId } + [contentId]).suffix(historyLimit))
    }

    /// 고정 목록에 보일 문구 — 이 목소리·언어로 매니페스트에 있는 새 응원(목록 순서 = 카테고리·자리 순).
    /// 옛 응원(`selectable = false`)과 표지가 없는 클립(옛 서버)은 뺀다.
    static func phrases(clips: [StockClip], voiceID: String, language: String) -> [(clip: StockClip, candidate: CheerCandidate)] {
        var seen = Set<String>()
        return clips
            .filter { clip in
                clip.voiceProfileId == voiceID
                    && (clip.language ?? "ko") == language
                    && clip.bucketTheme == bucketID
                    && clip.selectable != false
                    && !(clip.contentId ?? "").isEmpty
            }
            .sorted { lhs, rhs in
                let l = (lhs.category ?? "", lhs.variant ?? 0)
                let r = (rhs.category ?? "", rhs.variant ?? 0)
                return l < r
            }
            .compactMap { clip -> (clip: StockClip, candidate: CheerCandidate)? in
                guard let contentId = clip.contentId, seen.insert(contentId).inserted else { return nil }
                return (clip, CheerCandidate(
                    contentId: contentId,
                    cacheKey: AudioCacheStore.stockCacheKey(messageId: clip.messageId),
                    text: clip.text
                ))
            }
    }

    /// 실제 후보 — 위 목록 중 **폰에 받아 둔 것**만.
    static func candidates(
        clips: [StockClip],
        voiceID: String,
        language: String,
        isCached: (String) -> Bool
    ) -> [CheerCandidate] {
        phrases(clips: clips, voiceID: voiceID, language: language)
            .map(\.candidate)
            .filter { isCached($0.cacheKey) }
    }

    /// 디스크(마지막 공개 매니페스트 + 캐시)에서 이 알람의 후보를 읽는다. 네트워크는 타지 않는다.
    @MainActor
    static func candidates(for record: LocalAlarmRecord, audioCache: AudioCacheStore) -> [CheerCandidate] {
        guard record.bucketId == bucketID, let voiceID = record.voiceProfileId.nilIfBlank,
              let clips = StockClipManifestStore.load()?.clips else { return [] }
        return candidates(clips: clips, voiceID: voiceID, language: record.voiceLanguage ?? "ko") {
            audioCache.cachedURL(for: $0) != nil
        }
    }

    /// **다음 회차의 응원을 준비한다**(스펙 §5-4). 예약할 때(재예약·복구)는 부르지 않는다.
    ///
    /// - Parameters:
    ///   - occurrence: 이번에 확정된 회차 키(그 회차의 예정 발사 시각).
    ///   - explicitChange: 사용자가 모드·고정 문구를 바꿔 저장했는가 — 그때는 같은 회차라도 새로 고른다.
    static func prepared(
        _ record: LocalAlarmRecord,
        occurrence: Int64,
        candidates: [CheerCandidate],
        explicitChange: Bool
    ) -> LocalAlarmRecord {
        var next = record
        guard record.bucketId == bucketID, !candidates.isEmpty else {
            // 응원이 아니거나 후보가 없다 — 고르지 않는다(묶어 둔 회전이 운다). 이력은 건드리지 않는다.
            next.cheerSelection = nil
            return next
        }
        let ids = candidates.map(\.contentId)
        if !explicitChange, let current = record.cheerSelection,
           current.occurrence == occurrence, ids.contains(current.contentId), isSelection(current, for: record) {
            return record
        }
        let history = record.cheerHistory ?? []
        let pinned = CheerMode.normalize(record.cheerMode) == .pinned
            ? record.cheerPinnedContentId.flatMap { ids.contains($0) ? $0 : nil }
            : nil
        guard let chosenID = pinned ?? pick(candidates: ids, history: history, occurrence: occurrence),
              let chosen = candidates.first(where: { $0.contentId == chosenID }) else { return record }
        next.cheerSelection = CheerSelection(
            occurrence: occurrence,
            contentId: chosen.contentId,
            cacheKey: chosen.cacheKey,
            text: chosen.text,
            language: record.voiceLanguage ?? "ko",
            voiceProfileId: record.voiceProfileId.nilIfBlank
        )
        next.cheerHistory = appendHistory(history, chosen.contentId)
        return next
    }

    /// 이 선택이 **지금 이 알람의 목소리·언어로 고른 것**인가. 목소리 칸이 없는 선택(옛 모양)은 어느 목소리로 골랐는지
    /// 모르니 아니다로 읽는다 — 묶어 둔 회전이 대신 운다. 안드로이드 `isCheerSelectionFor` 미러.
    static func isSelection(_ selection: CheerSelection, for record: LocalAlarmRecord) -> Bool {
        guard let voice = record.voiceProfileId.nilIfBlank else { return false }
        return selection.voiceProfileId == voice && selection.language == (record.voiceLanguage ?? "ko")
    }

    /// 예약할 때 쓸 선택 — 응원 알람이고 **지금 묶인 목소리·언어로 고른 것**일 때만. 목소리나 언어가 바뀌어 다시
    /// 묶였으면 nil(묶어 둔 회전). 무료 강등(`DefaultVoiceSubstitute.locked`)은 선택 칸을 그대로 두고 목소리만 바꾸므로,
    /// 여기서 거르지 않으면 강등된 알람이 옛 클론 클립으로 운다.
    static func activeSelection(_ record: LocalAlarmRecord) -> CheerSelection? {
        guard record.bucketId == bucketID, let selection = record.cheerSelection else { return nil }
        return isSelection(selection, for: record) ? selection : nil
    }

    /// 앱 복귀 준비가 이 알람을 다시 골라야 하는가 — 이번 회차의 선택이 없거나, 있어도 지금 목소리·언어의 것이 아니다.
    static func needsPreparation(_ record: LocalAlarmRecord) -> Bool {
        guard let selection = record.cheerSelection else { return true }
        return selection.occurrence != record.fireAtMillis || !isSelection(selection, for: record)
    }

    /// 응원 설정을 바꿨는가 — 바꿨으면 같은 회차라도 새로 고른다. 안드로이드 `cheerSettingsChanged` 미러.
    static func settingsChanged(before: LocalAlarmRecord?, afterMode: String?, afterPinned: String?) -> Bool {
        guard let before else { return true }
        let beforeMode = CheerMode.normalize(before.cheerMode)
        let nextMode = CheerMode.normalize(afterMode)
        return beforeMode != nextMode || (nextMode == .pinned && before.cheerPinnedContentId != afterPinned)
    }
}

// MARK: - 사용 기록(`content_selected`)

extension CheerVariety {
    /// 응원의 '다양하게 / 이 문구로 고정' 을 사용 기록 칸으로(`docs/spec/usage-events.md` §7.1). **저장에 성공한** 알람의
    /// 선택이다 — 부르는 자리는 `AlarmEditorSheet.finishScheduling` 의 성공 끝(「직전 선택 유지」와 같은 시점) 한 곳뿐이다.
    /// 안드로이드 `contentSelectionProps`(`data/UsageSignals.kt`) 짝.
    ///
    /// 응원 알람이 아니면 nil — 테마가 다르거나, 알람 전용(iOS 는 테마만 남긴다 — 안드로이드는 이때 모드를 저장하지 않는다)
    /// 이거나, 모드 저장값이 없다.
    /// ⚠ 고정한 문구 ID(`cheer_v2_05`)는 싣지 않는다 — 그 ID 를 담을 정해진 칸이 없고(`pack_id` 는 팩·테마·목소리 키다),
    ///   칸을 새로 만들려면 서버를 먼저 올려야 한다(§7.2). 모드만 남긴다.
    static func contentSelectionProps(for record: LocalAlarmRecord) -> UsageEventProps? {
        guard record.bucketId == bucketID,
              record.playModeEnum != .alarmOnly,
              let mode = record.cheerMode else { return nil }
        return UsageEventProps(contentMode: CheerMode.normalize(mode) == .pinned ? .fixed : .varied)
    }
}
