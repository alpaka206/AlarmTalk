import XCTest
@testable import AlarmTalk

/// Phase 4-D1: StoreKit2 IAP 매핑 로직의 단위 테스트.
///
/// 실제 `Product.products(for:)` / `product.purchase()` / `Transaction.updates`
/// 는 Xcode 시뮬레이터의 StoreKit Configuration 위에서만 동작하므로 본 테스트는
/// 다루지 않는다. 본 파일은 다음만 검증한다.
///
///   - 3개 SubscriptionProduct enum case (월간만) 가 모두 등록되어 있다.
///   - 각 productID 가 백엔드 plan key 와 1:1 매핑된다.
///   - PlanTier ↔ SubscriptionProduct round-trip 이 안전하다.
///   - `SubscriptionProduct.make(tier:)` 가 free 에 대해 nil 을 돌려준다.
///   - `PlanTier.tierOrder` 가 단조 증가한다.
final class SubscriptionManagerTests: XCTestCase {

    // MARK: - Product enum

    /// 구독 3종 + 선물 1종.
    /// ⚠ 선물은 **소모성**이라 구독이 아니다 — `isSubscription` 이 그걸 가른다.
    func testHasThreeSubscriptionsAndOneGift() {
        XCTAssertEqual(SubscriptionProduct.allCases.count, 4)
        XCTAssertEqual(SubscriptionProduct.allCases.filter(\.isSubscription).count, 3)
        XCTAssertEqual(SubscriptionProduct.allCases.filter { !$0.isSubscription }, [.personalGift])
    }

    /// 선물 구매가 **구매자의 등급을 올리면 안 된다.** 사서 남에게 주는 코드다.
    func testGiftIsNotASubscription() {
        XCTAssertFalse(SubscriptionProduct.personalGift.isSubscription)
        // planTier 는 '무엇을 선물하는가' 를 뜻할 뿐, 구매자 권한이 아니다.
        XCTAssertEqual(SubscriptionProduct.personalGift.planTier, .personal)
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
            (.coupleMonthly,   .couple),
            (.familyMonthly,   .family),
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

    // MARK: - Round-trip

    func testFromProductIDRoundTrip() {
        for product in SubscriptionProduct.allCases {
            XCTAssertEqual(
                SubscriptionProduct(rawValue: product.rawValue),
                product,
                "round-trip 실패: \(product.rawValue)"
            )
        }
    }

    func testFromProductIDReturnsNilForUnknown() {
        XCTAssertNil(SubscriptionProduct(rawValue: "com.unknown.product"))
        XCTAssertNil(SubscriptionProduct(rawValue: ""))
        XCTAssertNil(SubscriptionProduct(rawValue: "com.voicealarm.nativeapp.ios.premium"))
    }

    // MARK: - make(tier:) factory

    func testMakeReturnsCorrectProduct() {
        XCTAssertEqual(SubscriptionProduct.make(tier: .personal), .personalMonthly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .couple),   .coupleMonthly)
        XCTAssertEqual(SubscriptionProduct.make(tier: .family),   .familyMonthly)
    }

    func testMakeReturnsNilForFreeTier() {
        XCTAssertNil(SubscriptionProduct.make(tier: .free))
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

}
