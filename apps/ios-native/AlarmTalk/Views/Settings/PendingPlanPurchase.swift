import Foundation

/// 결제 확인 알럿이 들고 있는 대상 — 어떤 상품을, 어느 등급으로 사는가.
///
/// 등급(`tier`)을 따로 들고 다니는 이유: 상품 id 만으로는 **전환인지 신규인지**,
/// **정원이 줄어드는지**를 알 수 없다. 그 판단이 알럿 문구를 통째로 바꾼다.
struct PendingPlanPurchase: Identifiable, Equatable {
    let product: SubscriptionProduct
    let tier: PlanTier

    var id: String { product.rawValue }
}
