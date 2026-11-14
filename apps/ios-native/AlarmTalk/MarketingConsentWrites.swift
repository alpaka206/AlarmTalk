import Foundation

/// 마케팅(광고성 정보 수신) 쓰기 하나가 끝난 뒤 할 일 — 안드로이드 `ui/main/MarketingConsentWrites.kt` 짝.
///
/// 쓰는 동안에도 스위치를 누를 수 있다(2026-10-29 두 앱 비교 — 예전 iOS 는 쓰는 동안 스위치를 잠갔다). 그 사이 마지막으로 누른
/// 값(`queued`)이 서버 값과 다르면 이어서 보내고, 같으면 멈춘다. 실패해 되돌아간 것은 그 뒤에 누른 값이 없을 때만 알린다.
enum MarketingConsentNext: Equatable {
    /// 마지막으로 누른 값이 서버 값과 다르다 — 이어서 보낸다. 실패하면 `rollbackTo`(지금 서버 값)로 돌아간다.
    case send(agreed: Bool, rollbackTo: Bool?)
    /// 더 보낼 것이 없다. 스위치는 `shown`(서버 값)을 그리고, `failed` 면 스위치가 되돌아간 이유를 알린다.
    case settle(shown: Bool?, failed: Bool)

    /// - Parameters:
    ///   - sent: 방금 보낸 값. - rollbackTo: 보내기 전에 서버가 가진 값. - succeeded: 서버가 받았는가.
    ///   - queued: 쓰는 동안 마지막으로 누른 값. 없으면 nil.
    static func after(sent: Bool, rollbackTo: Bool?, succeeded: Bool, queued: Bool?) -> MarketingConsentNext {
        let serverValue = succeeded ? sent : rollbackTo
        if let queued, queued != serverValue { return .send(agreed: queued, rollbackTo: serverValue) }
        // 마지막으로 누른 값이 이미 서버에 있으면 이 쓰기가 실패했어도 알릴 것이 없다 — 사용자가 고른 대로다.
        return .settle(shown: serverValue, failed: !succeeded && queued == nil)
    }
}

/// 마케팅 동의의 '직전 서버 확인값' 을 계정별로 기억한다 — 동의 내역 화면에 들어오는 순간 조회 답을 기다리지 않고 스위치를 그린다.
/// 모르면(없음·다른 계정) nil 이라 '꺼짐' 으로 잘못 그리지 않는다. 안드로이드 `data/MarketingConsentCache.kt` 짝.
struct MarketingConsentCache {
    private let defaults: UserDefaults
    private static let userKey = "marketing_consent_cache.user_id"
    private static let agreedKey = "marketing_consent_cache.agreed"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func read(userID: String) -> Bool? {
        guard defaults.string(forKey: Self.userKey) == userID, defaults.object(forKey: Self.agreedKey) != nil else { return nil }
        return defaults.bool(forKey: Self.agreedKey)
    }

    func write(userID: String, agreed: Bool) {
        defaults.set(userID, forKey: Self.userKey)
        defaults.set(agreed, forKey: Self.agreedKey)
    }
}
