import XCTest
@testable import AlarmTalk

/// Phase 4-D1: StoreKit2 IAP 매핑 로직의 단위 테스트.
///
/// 실제 `Product.products(for:)` / `product.purchase()` / `Transaction.updates`
/// 는 Xcode 시뮬레이터의 StoreKit Configuration 위에서만 동작하므로 본 테스트는
/// 다루지 않는다. 본 파일은 다음만 검증한다.
///
///   - SubscriptionProduct 는 월간 구독 3개뿐이다(선물 상품 없음). 번들의 StoreKit 설정도 같은 셋이다.
///   - 각 productID 가 백엔드 plan key 와 1:1 매핑된다.
///   - PlanTier ↔ SubscriptionProduct round-trip 이 안전하다.
///   - `SubscriptionProduct.make(tier:)` 가 free 에 대해 nil 을 돌려준다.
///   - `PlanTier.tierOrder` 가 단조 증가한다.
final class SubscriptionManagerTests: XCTestCase {

    // MARK: - Product enum

    /// **파는 것은 월간 자동 갱신 구독 셋뿐이다.**
    ///
    /// ⚠ **선물(소모성) 상품을 되살리지 말 것**(2026-10-14, App Store 지침 3.1.1 두 번째 반려).
    /// 사서 받은 `GIFT-` 코드를 쳐서 유료 기능을 여는 길이 반려 사유였다. 할인·무료 이용은
    /// 스토어 오퍼 코드로 준다. 상품이 하나라도 늘면 이 테스트가 먼저 깨져야 한다.
    func testSellsOnlyTheThreeMonthlySubscriptions() {
        XCTAssertEqual(SubscriptionProduct.allCases, [.personalMonthly, .coupleMonthly, .familyMonthly])
        XCTAssertEqual(
            Set(SubscriptionProduct.allCases.map(\.rawValue)),
            [
                "com.alarmtalk.app.personal_monthly",
                "com.alarmtalk.app.couple_monthly",
                "com.alarmtalk.app.family_monthly",
            ]
        )
        XCTAssertNil(
            SubscriptionProduct(rawValue: "com.alarmtalk.app.personal_gift_1m"),
            "선물 상품은 없앴다 — 남은 옛 트랜잭션은 모르는 상품으로 끝낸다"
        )
    }

    /// 시뮬레이터용 StoreKit 설정(앱 번들에 실린다)도 **같은 셋**만 판다.
    /// 소모성 상품이 남으면 로컬 결제 시험에서 없앤 선물을 그대로 살 수 있다.
    func testStoreKitConfigurationSellsOnlyTheSameSubscriptions() throws {
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: "StoreKitConfiguration", withExtension: "storekit"),
            "앱 번들에 StoreKit 설정이 없다(project.yml 의 resources)"
        )
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let products = try XCTUnwrap(root["products"] as? [Any])
        XCTAssertTrue(products.isEmpty, "구독 그룹 밖 상품(소모성·비소모성)이 남아 있다: \(products)")
        let groups = try XCTUnwrap(root["subscriptionGroups"] as? [[String: Any]])
        let subscriptionIDs = groups
            .flatMap { ($0["subscriptions"] as? [[String: Any]]) ?? [] }
            .compactMap { $0["productID"] as? String }
        XCTAssertEqual(Set(subscriptionIDs), Set(SubscriptionProduct.allCases.map(\.rawValue)))
        XCTAssertEqual(subscriptionIDs.count, SubscriptionProduct.allCases.count)
    }

    func testAllProductIDsAreUnique() {
        let ids = SubscriptionProduct.allCases.map(\.rawValue)
        XCTAssertEqual(Set(ids).count, ids.count, "productID 중복 발견 — 같은 SKU 가 두 번 등록되면 App Store Connect 에서 등록 거부됨")
    }

    func testProductIDPrefixMatchesBundle() {
        let prefix = "com.alarmtalk.app."
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
        XCTAssertNil(SubscriptionProduct(rawValue: "com.alarmtalk.app.premium"))
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
