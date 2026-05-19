import XCTest
@testable import VoiceAlarm

/// Phase 4-D1: StoreKit2 IAP 매핑 로직의 단위 테스트.
///
/// 실제 `Product.products(for:)` / `product.purchase()` / `Transaction.updates`
/// 는 Xcode 시뮬레이터의 StoreKit Configuration 위에서만 동작하므로 본 테스트는
/// 다루지 않는다. 본 파일은 다음만 검증한다.
///
///   - 6개 SubscriptionProduct enum case 가 모두 등록되어 있다.
///   - 각 productID 가 백엔드 plan key 와 1:1 매핑된다.
///   - period 매핑 (monthly / yearly) 이 정확하다.
///   - PlanTier ↔ SubscriptionProduct round-trip 이 안전하다.
///   - `SubscriptionProduct.make(tier:period:)` 가 free 에 대해 nil 을 돌려준다.
///   - `PlanTier.tierOrder` 가 단조 증가한다.
final class SubscriptionManagerTests: XCTestCase {

    // MARK: - Product enum

    func testHasExactlySixProducts() {
        XCTAssertEqual(SubscriptionProduct.allCases.count, 6)
    }

    func testAllProductIDsAreUnique() {
        let ids = SubscriptionProduct.allCases.map(\.rawValue)
        XCTAssertEqual(Set(ids).count, ids.count, "productID 중복 발견 — 같은 SKU 가 두 번 등록되면 App Store Connect 에서 등록 거부됨")
    }

    func testProductIDPrefixMatchesBundle() {
        let prefix = "com.voicealarm.nativeapp.ios."
        for product in SubscriptionProduct.allCases {
            XCTAssertTrue(
                product.rawValue.hasPrefix(prefix),
                "\(product.rawValue) 는 \(prefix) 로 시작해야 함"
            )
        }
    }

    // MARK: - planTier mapping

    func testPlanTierMappingIsCorrect() {
        let expectations: [(SubscriptionProduct, PlanTier)] = [
            (.personalMonthly, .personal),
            (.personalYearly,  .personal),
            (.coupleMonthly,   .couple),
            (.coupleYearly,    .couple),
            (.familyMonthly,   .family),
            (.familyYearly,    .family),
        ]
        for (product, expectedTier) in expectations {
            XCTAssertEqual(product.planTier, expectedTier, "\(product) 의 PlanTier 매핑이 잘못됨")
        }
    }

    func testPlanTierNeverMapsToFree() {
        for product in SubscriptionProduct.allCases {
            XCTAssertNotEqual(product.planTier, .free, "유료 SKU 가 free 로 매핑되면 안 됨: \(product)")
        }
    }

    // MARK: - period mapping

    func testMonthlyPeriodMapping() {
        XCTAssertEqual(SubscriptionProduct.personalMonthly.period, .monthly)
        XCTAssertEqual(SubscriptionProduct.coupleMonthly.period, .monthly)
        XCTAssertEqual(SubscriptionProduct.familyMonthly.period, .monthly)
    }

    func testYearlyPeriodMapping() {
        XCTAssertEqual(SubscriptionProduct.personalYearly.period, .yearly)
        XCTAssertEqual(SubscriptionProduct.coupleYearly.period, .yearly)
        XCTAssertEqual(SubscriptionProduct.familyYearly.period, .yearly)
    }

    // MARK: - Round-trip

    func testFromProductIDRoundTrip() {
        for product in SubscriptionProduct.allCases {
            XCTAssertEqual(
                SubscriptionProduct.from(productID: product.rawValue),
                product,
                "round-trip 실패: \(product.rawValue)"
            )
        }
    }

    func testFromProductIDReturnsNilForUnknown() {
        XCTAssertNil(SubscriptionProduct.from(productID: "com.unknown.product"))
        XCTAssertNil(SubscriptionProduct.from(productID: ""))
        XCTAssertNil(SubscriptionProduct.from(productID: "com.voicealarm.nativeapp.ios.premium"))
    }

    // MARK: - make(tier:period:) factory

    func testMakeReturnsCorrectProduct() {
        XCTAssertEqual(SubscriptionProduct.make(tier: .personal, period: .monthly), .personalMonthly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .personal, period: .yearly),  .personalYearly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .couple,   period: .monthly), .coupleMonthly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .couple,   period: .yearly),  .coupleYearly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .family,   period: .monthly), .familyMonthly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .family,   period: .yearly),  .familyYearly)
    }

    func testMakeReturnsNilForFreeTier() {
        XCTAssertNil(SubscriptionProduct.make(tier: .free, period: .monthly))
        XCTAssertNil(SubscriptionProduct.make(tier: .free, period: .yearly))
    }

    // MARK: - PlanTier ordering

    func testPlanTierOrderingIsMonotonic() {
        XCTAssertLessThan(PlanTier.free.tierOrder, PlanTier.personal.tierOrder)
        XCTAssertLessThan(PlanTier.personal.tierOrder, PlanTier.couple.tierOrder)
        XCTAssertLessThan(PlanTier.couple.tierOrder, PlanTier.family.tierOrder)
    }

    func testPlanTierOrderingIsStable() {
        XCTAssertEqual(PlanTier.free.tierOrder,     0)
        XCTAssertEqual(PlanTier.personal.tierOrder, 1)
        XCTAssertEqual(PlanTier.couple.tierOrder,   2)
        XCTAssertEqual(PlanTier.family.tierOrder,   3)
    }

    // MARK: - PurchaseResult

    func testPurchaseResultIsSuccessFlag() {
        XCTAssertTrue(PurchaseResult.success(productID: "x").isSuccess)
        XCTAssertFalse(PurchaseResult.userCancelled.isSuccess)
        XCTAssertFalse(PurchaseResult.pending.isSuccess)
        XCTAssertFalse(PurchaseResult.failure(reason: "test").isSuccess)
    }

    func testPurchaseResultUserMessageNotEmpty() {
        let cases: [PurchaseResult] = [
            .success(productID: "com.example"),
            .userCancelled,
            .pending,
            .failure(reason: "network down"),
        ]
        for result in cases {
            XCTAssertFalse(result.userMessage.isEmpty, "user message must not be empty: \(result)")
        }
    }

    // MARK: - SubscriptionPeriod

    func testSubscriptionPeriodDisplayLabel() {
        XCTAssertEqual(SubscriptionPeriod.monthly.displayLabel, "월간")
        XCTAssertEqual(SubscriptionPeriod.yearly.displayLabel, "연간")
    }
}
