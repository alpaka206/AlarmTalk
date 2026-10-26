import Foundation

/// 아침 소식 응답 → **무엇을 말할지**(`docs/spec/morning-briefing.md` §8 「상태별 표시」). 화면은 이 결과를 글자로 옮기기만
/// 한다. 안드로이드 짝은 `ui/briefing/BriefingPresentation.kt` — 판정이 갈라지면 같은 응답을 두 앱이 다르게 읽는다.
///
/// ⚠ **"없어요" 는 정말 확인했을 때만이다.** 기업 상태가 `ok` 이고 응답이 `complete` 일 때만 `.noDisclosures` 다.
enum BriefingCompanyState: Equatable { case ok, stale, unavailable }

enum BriefingCompanyNote: Equatable {
    /// 공시 목록만 보여 준다.
    case none
    /// `ok` + `complete` + 빈 목록 — 이 기간에 접수된 공시가 정말 없다.
    case noDisclosures
    /// `ok` 인데 `complete` 가 거짓 + 빈 목록 — 없다고 말할 수 없다.
    case notConclusive
    /// 이번에 확인하지 못해 그때 받아 둔 것을 보여 준다. 비었어도 "없었다" 고 단정하지 않는다.
    case stale
    /// 한 번도 확인하지 못했다.
    case unavailable
}

struct BriefingCompanySection: Equatable, Identifiable {
    var corpCode: String
    var corpName: String?
    var state: BriefingCompanyState
    /// 그 기업을 마지막으로 확인한 시각(ISO). `stale` 이면 '그때' 다.
    var fetchedAt: String?
    var disclosures: [BriefingDisclosure]
    var note: BriefingCompanyNote
    /// 이번에 확인하지 못한 이유(`errors[].code`).
    var errorCode: String?

    var id: String { corpCode }
}

enum BriefingNewsNote: Equatable { case none, noNews, stale, unavailable }

struct BriefingNewsSection: Equatable {
    var items: [BriefingPolicyNews]
    var note: BriefingNewsNote
    var errorCode: String?
}

struct BriefingScreenModel: Equatable {
    var window: BriefingWindow?
    var companies: [BriefingCompanySection]
    var news: BriefingNewsSection
    var fetchedAt: String?
    var complete: Bool
    var stale: Bool
    /// 다음 요청을 보내도 되는 때까지 남은 초(`errors[].retryAfterSeconds` 의 최댓값).
    var retryAfterSeconds: Int?
}

enum BriefingPresentation {
    static let sourceOpenDart = "opendart"
    static let sourcePolicyNews = "policy_news"

    /// 모르는 상태 값은 '확인하지 못했다' 로 읽는다 — '확인했다' 로 읽으면 없는 공시를 "없어요" 라고 말한다.
    static func companyState(_ raw: String?) -> BriefingCompanyState {
        switch raw {
        case "ok": return .ok
        case "stale": return .stale
        default: return .unavailable
        }
    }

    static func companyNote(state: BriefingCompanyState, complete: Bool, hasDisclosures: Bool) -> BriefingCompanyNote {
        switch state {
        case .stale: return .stale
        case .unavailable: return .unavailable
        case .ok:
            if hasDisclosures { return .none }
            return complete ? .noDisclosures : .notConclusive
        }
    }

    /// 그 기업의 오류 — 그 기업 `corpCode` 를 가진 항목, 없으면 기업을 가리지 않은 `opendart` 항목.
    static func companyErrorCode(_ errors: [BriefingSourceError], corpCode: String) -> String? {
        errors.first { $0.source == sourceOpenDart && $0.corpCode == corpCode }?.code
            ?? errors.first { $0.source == sourceOpenDart && $0.corpCode == nil }?.code
    }

    static func newsSection(items: [BriefingPolicyNews], errors: [BriefingSourceError]) -> BriefingNewsSection {
        let errorCode = errors.first { $0.source == sourcePolicyNews }?.code
        let note: BriefingNewsNote
        switch (errorCode == nil, items.isEmpty) {
        case (true, true): note = .noNews
        case (true, false): note = .none
        case (false, true): note = .unavailable
        case (false, false): note = .stale
        }
        return BriefingNewsSection(items: items, note: note, errorCode: errorCode)
    }

    static func retryAfterSeconds(_ errors: [BriefingSourceError]) -> Int? {
        errors.compactMap { $0.retryAfterSeconds }.filter { $0 > 0 }.max()
    }

    static func model(_ response: BriefingTodayResponse) -> BriefingScreenModel {
        let companies = response.companies.map { status -> BriefingCompanySection in
            let state = companyState(status.status)
            let own = response.disclosures.filter { $0.corpCode == status.corpCode }
            return BriefingCompanySection(
                corpCode: status.corpCode,
                corpName: status.corpName,
                state: state,
                fetchedAt: status.fetchedAt,
                disclosures: own,
                note: companyNote(state: state, complete: response.complete, hasDisclosures: !own.isEmpty),
                errorCode: state == .ok ? nil : companyErrorCode(response.errors, corpCode: status.corpCode)
            )
        }
        return BriefingScreenModel(
            window: response.window,
            companies: companies,
            news: newsSection(items: response.policyNews, errors: response.errors),
            fetchedAt: response.fetchedAt,
            complete: response.complete,
            stale: response.stale,
            retryAfterSeconds: retryAfterSeconds(response.errors)
        )
    }

    /// `errors[].code` → 문구(스펙 §8 「문구 표」). 키 오류는 우리 설정 문제라 일반 실패와 같은 말이다. 모르는 코드도 그렇다.
    static func sourceErrorMessage(_ code: String?) -> String {
        switch code {
        case "BRIEFING_SOURCE_NOT_CONFIGURED":
            return String(localized: "이 소식은 아직 준비 중이에요.")
        case "BRIEFING_SOURCE_RATE_LIMITED":
            return String(localized: "확인 요청이 많아 잠시 쉬고 있어요. 잠시 뒤에 다시 확인해 주세요.")
        case "BRIEFING_SOURCE_MAINTENANCE":
            return String(localized: "출처가 점검 중이라 확인하지 못했어요.")
        default:
            return String(localized: "출처에서 소식을 받지 못했어요. 잠시 뒤에 다시 확인해 주세요.")
        }
    }

    /// 503 `BRIEFING_CORP_CODES_NOT_READY` 뒤 기다리는 초 — 계약값(`routes/briefing.ts` 의 `Retry-After: 60`). iOS 의 API
    /// 오류는 응답 헤더를 들고 오지 않아 계약값을 쓴다(안드로이드는 헤더를 읽고, 없을 때 같은 값이다).
    static let corpCodesNotReadyRetrySeconds = 60
}

/// 관심 기업 목록 규칙 — 상한 3(`BRIEFING_MAX_INTERESTS`). 서버가 같은 상한으로 다시 막는다. 안드로이드 `BriefingInterestRules`.
enum BriefingInterestRules {
    static let maxInterests = 3

    static func canAdd(_ current: [String]) -> Bool { current.count < maxInterests }

    /// 더한 목록. 이미 있으면 그대로, 상한이면 nil(보내지 않는다 — 화면이 이유를 말한다).
    static func adding(_ current: [String], _ corpCode: String) -> [String]? {
        if current.contains(corpCode) { return current }
        guard canAdd(current) else { return nil }
        return current + [corpCode]
    }

    static func removing(_ current: [String], _ corpCode: String) -> [String] {
        current.filter { $0 != corpCode }
    }
}

/// 소식 음성에 고를 수 있는 목소리 — **직접 입력과 같은 권한 규칙**(`docs/spec/voice-and-message.md` §8): 기본 목소리 4종은
/// 누구나, 등록(클론) 목소리는 플러스일 때만. 이 화면이 클론을 무료로 쓰는 우회로가 되지 않는다. 안드로이드 `BriefingVoiceRules`.
enum BriefingVoiceRules {
    static func allowedVoices(_ profiles: [VoiceProfile], paidVoiceEntitled: Bool) -> [VoiceProfile] {
        profiles.filter { profile in
            let ready = profile.status == nil || profile.status == "ready"
            if isSystemVoiceId(profile.id) { return ready }
            return paidVoiceEntitled && ready && profile.isDraft != true
        }
    }

    /// 처음 고른 목소리 — 마지막에 쓴 목소리(쓸 수 있을 때), 아니면 미나, 아니면 첫 목소리.
    static func initialVoiceID(allowedIDs: [String], lastUsedVoiceID: String?) -> String? {
        if let lastUsedVoiceID, allowedIDs.contains(lastUsedVoiceID) { return lastUsedVoiceID }
        if allowedIDs.contains(substituteSystemVoiceID) { return substituteSystemVoiceID }
        return allowedIDs.first
    }
}

/// 직접 입력 '음성 만들기' 한 번의 id — 같은 입력(목소리·언어·문장)은 같은 id, 성공하면 잊는다. 안드로이드 `ManualRequestIds`,
/// 편집기 쪽은 `VoiceStudioViewModel.manualRequestIDFor` 다(규칙은 `docs/spec/voice-and-message.md` §8 「같은 요청」).
struct BriefingRequestIDs {
    private var key: String?
    private var id: String?

    mutating func idFor(profileID: String, language: String, text: String) -> String {
        let next = "\(profileID)\u{0}\(language)\u{0}\(text)"
        if let id, key == next { return id }
        let fresh = UUID().uuidString.lowercased()
        key = next
        id = fresh
        return fresh
    }

    mutating func completed() {
        key = nil
        id = nil
    }
}
