import Foundation

/// Apple App Store Connect 에 등록될 StoreKit2 인앱 구독 상품 ID.
///
/// 백엔드 plan key (`personal` / `couple` / `family`) 와 1:1 매핑되며,
/// 각 플랜은 월간/연간 두 가격대로 노출된다. `free` 플랜은 IAP 가 없다.
///
/// App Store Connect 등록 가이드:
///   1. 구독 그룹 1개 ("AlarmTalk Subscriptions") 를 만들고 6개 SKU 를 동일 그룹에 둔다.
///      → 같은 그룹 안에서 사용자가 자유롭게 업/다운그레이드 할 수 있다.
///   2. 6개 productID 를 정확히 아래 rawValue 와 동일하게 등록.
///   3. 가격은 App Store 의 region 별 tier 로 설정 — 본 enum 은 가격에 관여하지 않는다.
///   4. Phase 3-C3 의 `PlanTier` 와의 매핑은 `planTier` 에 캡슐화.
///
/// 본 enum 은 순수 데이터 매핑이며 StoreKit 의 `Product` 인스턴스를 직접 들지
/// 않는다. 실제 `Product` 는 `SubscriptionManager.products` 에 lazy-cache 된다.
enum SubscriptionProduct: String, CaseIterable {
    case personalMonthly = "com.voicealarm.nativeapp.ios.personal_monthly"
    case personalYearly  = "com.voicealarm.nativeapp.ios.personal_yearly"
    case coupleMonthly   = "com.voicealarm.nativeapp.ios.couple_monthly"
    case coupleYearly    = "com.voicealarm.nativeapp.ios.couple_yearly"
    case familyMonthly   = "com.voicealarm.nativeapp.ios.family_monthly"
    case familyYearly    = "com.voicealarm.nativeapp.ios.family_yearly"

    /// 백엔드 PlanTier 매핑.
    var planTier: PlanTier {
        switch self {
        case .personalMonthly, .personalYearly: return .personal
        case .coupleMonthly, .coupleYearly:     return .couple
        case .familyMonthly, .familyYearly:     return .family
        }
    }

    /// 구독 기간.
    var period: SubscriptionPeriod {
        rawValue.contains("yearly") ? .yearly : .monthly
    }

    /// productID 문자열에서 SubscriptionProduct 매핑. 알 수 없는 값은 nil.
    /// `SubscriptionManager.refreshPurchasedProducts()` 가 사용한다.
    static func from(productID: String) -> SubscriptionProduct? {
        SubscriptionProduct(rawValue: productID)
    }

    /// `PlanTier` + period 조합으로 productID 를 찾는다.
    /// BillingPanel UI 가 카드를 그릴 때 사용.
    static func make(tier: PlanTier, period: SubscriptionPeriod) -> SubscriptionProduct? {
        switch (tier, period) {
        case (.personal, .monthly): return .personalMonthly
        case (.personal, .yearly):  return .personalYearly
        case (.couple, .monthly):   return .coupleMonthly
        case (.couple, .yearly):    return .coupleYearly
        case (.family, .monthly):   return .familyMonthly
        case (.family, .yearly):    return .familyYearly
        case (.free, _):            return nil
        }
    }
}

/// 월간 / 연간 구분.
enum SubscriptionPeriod: String, CaseIterable, Equatable {
    case monthly
    case yearly

    var displayLabel: String {
        switch self {
        case .monthly: return "월간"
        case .yearly:  return "연간"
        }
    }
}

// MARK: - PlanTier tier ordering bridge
//
// PlanGateDialog.swift 의 `PlanTier` 는 `meetsOrExceeds(_:)` 비교용 private
// `tierOrder` 만 가지고 있다. SubscriptionManager 는 "구매된 productID 중 가장
// 높은 티어" 를 계산해야 하므로 동일한 순서 매핑이 필요해 public 한 `tierOrder`
// 를 extension 으로 노출한다. private 상수는 그대로 두어 캡슐화를 유지.

extension PlanTier {
    /// free=0, personal=1, couple=2, family=3. 큰 값이 더 높은 권한.
    var tierOrder: Int {
        switch self {
        case .free:     return 0
        case .personal: return 1
        case .couple:   return 2
        case .family:   return 3
        }
    }
}
