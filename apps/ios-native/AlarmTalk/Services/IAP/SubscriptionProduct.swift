import Foundation

/// Apple App Store Connect 에 등록될 StoreKit2 인앱 구독 상품 ID.
///
/// 백엔드 plan key (`personal` / `couple` / `family`) 와 1:1 매핑되며,
/// 각 플랜은 월간 가격 하나로만 노출된다 (연간 SKU 는 제거됨).
/// `free` 플랜은 IAP 가 없다.
///
/// App Store Connect 등록 가이드:
///   1. 구독 그룹 1개 ("AlarmTalk Subscriptions") 를 만들고 3개 SKU 를 동일 그룹에 둔다.
///      → 같은 그룹 안에서 사용자가 자유롭게 업/다운그레이드 할 수 있다.
///   2. 3개 productID 를 정확히 아래 rawValue 와 동일하게 등록.
///   3. 가격은 App Store 의 region 별 tier 로 설정 — 본 enum 은 가격에 관여하지 않는다.
///   4. Phase 3-C3 의 `PlanTier` 와의 매핑은 `planTier` 에 캡슐화.
///
/// 본 enum 은 순수 데이터 매핑이며 StoreKit 의 `Product` 인스턴스를 직접 들지
/// 않는다. 실제 `Product` 는 `SubscriptionManager.products` 에 lazy-cache 된다.
enum SubscriptionProduct: String, CaseIterable {
    case personalMonthly = "com.voicealarm.nativeapp.ios.personal_monthly"
    case coupleMonthly   = "com.voicealarm.nativeapp.ios.couple_monthly"
    case familyMonthly   = "com.voicealarm.nativeapp.ios.family_monthly"

    /// 선물용 **1회성(소모성)** 상품.
    ///
    /// ⚠ **자동 갱신 구독은 남에게 줄 수 없다** — 스토어가 구매자 계정에 묶는다.
    /// 그래서 선물은 소모성 상품을 팔고, 서버가 그 결제로 **바우처 코드**를 만든다
    /// (`billing-apple.ts` 의 `isAppleGiftProductId` 갈래).
    case personalGift    = "com.voicealarm.nativeapp.ios.personal_gift_1m"

    /// 이 상품이 **본인 구독**인가. 선물은 아니다 — 사서 남에게 주는 코드다.
    var isSubscription: Bool { self != .personalGift }

    /// 백엔드 PlanTier 매핑.
    var planTier: PlanTier {
        switch self {
        case .personalMonthly, .personalGift: return .personal
        case .coupleMonthly:   return .couple
        case .familyMonthly:   return .family
        }
    }

    /// `PlanTier` 로 productID 를 찾는다. BillingPanel UI 가 카드를 그릴 때 사용.
    static func make(tier: PlanTier) -> SubscriptionProduct? {
        switch tier {
        case .personal: return .personalMonthly
        case .couple:   return .coupleMonthly
        case .family:   return .familyMonthly
        case .free:     return nil
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
