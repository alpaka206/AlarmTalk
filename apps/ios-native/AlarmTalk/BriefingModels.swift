import Foundation

/// **아침 소식**(관심 기업 공시 + 정책브리핑 정책뉴스) 계약. 원본은 `packages/shared/src/schemas/briefing.ts` 이고 규칙은
/// `docs/spec/morning-briefing.md` 다. 안드로이드 짝은 `network/BriefingApi.kt`.
///
/// 응답 디코더가 스네이크 키를 카멜로 바꾼다(`AlarmTalkAPI.makeResponseDecoder`). 없을 수 있는 값은 옵셔널이다.
/// ⚠ 이 화면은 **열 때만** 부른다. 알람 울림 경로에서 부르지 않는다(`docs/spec/morning-briefing.md` §8).
struct BriefingCompany: Decodable, Equatable, Identifiable {
    var corpCode: String
    var corpName: String
    var stockCode: String?

    var id: String { corpCode }
}

struct BriefingCompanySearchResponse: Decodable {
    var companies: [BriefingCompany]
}

struct BriefingInterest: Decodable, Equatable, Identifiable {
    var corpCode: String
    /// 기업 캐시에서 빠진 기업(상장 폐지 등)이면 nil — 고른 기록은 남는다.
    var corpName: String?
    var stockCode: String?

    var id: String { corpCode }
}

struct BriefingInterestsResponse: Decodable {
    var interests: [BriefingInterest]
}

struct BriefingInterestsPutRequest: Encodable {
    var corpCodes: [String]
}

struct BriefingDisclosureFlags: Decodable, Equatable {
    var amendedReport: Bool = false
    var correctedLater: Bool = false
    var withdrawn: Bool = false

    init(amendedReport: Bool = false, correctedLater: Bool = false, withdrawn: Bool = false) {
        self.amendedReport = amendedReport
        self.correctedLater = correctedLater
        self.withdrawn = withdrawn
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        amendedReport = try values.decodeIfPresent(Bool.self, forKey: .amendedReport) ?? false
        correctedLater = try values.decodeIfPresent(Bool.self, forKey: .correctedLater) ?? false
        withdrawn = try values.decodeIfPresent(Bool.self, forKey: .withdrawn) ?? false
    }

    private enum CodingKeys: String, CodingKey { case amendedReport, correctedLater, withdrawn }
}

struct BriefingDisclosure: Decodable, Equatable, Identifiable {
    var id: String
    var corpCode: String
    var corpName: String
    var reportName: String
    /// 접수 **날짜**(`YYYY-MM-DD`). 시각은 원천이 주지 않는다 — 지어 붙이지 않는다.
    var receiptDate: String
    var flags: BriefingDisclosureFlags
    var url: String
    /// 이 내용으로 처음 받아 둔 시각(ISO). 낭독 문단의 '확인한 날' 이 이 값이다.
    var fetchedAt: String
}

struct BriefingPolicyNews: Decodable, Equatable, Identifiable {
    var id: String
    var title: String
    var summary: String
    var organization: String?
    var publishedDate: String
    var url: String
    var fetchedAt: String
}

struct BriefingCompanyStatus: Decodable, Equatable {
    var corpCode: String
    var corpName: String?
    /// `ok` · `stale` · `unavailable`. 모르는 값은 `unavailable` 로 읽는다(`BriefingPresentation`).
    var status: String?
    var fetchedAt: String?
}

struct BriefingSourceError: Decodable, Equatable {
    /// `opendart` · `policy_news`.
    var source: String
    var code: String
    var corpCode: String?
    var retryAfterSeconds: Int?
}

struct BriefingWindow: Decodable, Equatable {
    var from: String
    var to: String
}

struct BriefingTodayResponse: Decodable, Equatable {
    var window: BriefingWindow?
    var companies: [BriefingCompanyStatus]
    var disclosures: [BriefingDisclosure]
    var policyNews: [BriefingPolicyNews]
    var fetchedAt: String?
    var stale: Bool
    var complete: Bool
    var errors: [BriefingSourceError]
}
