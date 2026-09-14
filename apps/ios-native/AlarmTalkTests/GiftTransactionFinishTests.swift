import XCTest
@testable import AlarmTalk

/// **소모성 선물을 서버 확정 전에 `finish()` 하면 돈만 나간다.**
///
/// 애플은 소모성 상품을 `Transaction.currentEntitlements` 에 남기지 않는다. 그래서
/// finish 한 뒤에는 `resyncEntitlements`·`refreshPurchasedProducts` 가 절대 못 찾고,
/// 바우처를 못 받은 구매자를 되살릴 경로가 사라진다(2026-08-18 Codex #697 P1).
///
/// 자동갱신 구독은 반대다 — `currentEntitlements` 에 남으므로 finish 해도 다음 동기화가
/// 따라잡는다. 오히려 안 끝내면 스토어가 계속 되돌려 준다.
final class GiftTransactionFinishTests: XCTestCase {

    private let gift = SubscriptionProduct.personalGift.rawValue

    func test_선물은_서버가_확정해야_끝낸다() {
        XCTAssertFalse(
            SubscriptionManager.mayFinish(productID: gift, serverConfirmed: false),
            "확정 못 했는데 끝내면 바우처를 영영 못 받는다"
        )
        XCTAssertTrue(SubscriptionManager.mayFinish(productID: gift, serverConfirmed: true))
    }

    func test_구독은_확정과_무관하게_끝낸다() {
        for plan in SubscriptionProduct.allCases where plan.isSubscription {
            XCTAssertTrue(
                SubscriptionManager.mayFinish(productID: plan.rawValue, serverConfirmed: false),
                "\(plan.rawValue): 구독은 currentEntitlements 로 회복되므로 끝내도 된다"
            )
        }
    }

    /// 모르는 상품을 안 끝내면 영영 다시 배달된다 — 재시도해도 결과가 같다.
    func test_모르는_상품은_끝낸다() {
        XCTAssertTrue(
            SubscriptionManager.mayFinish(productID: "com.example.unknown", serverConfirmed: false)
        )
    }

    /// ⚠ 이 테스트가 지키는 전제: 선물은 **구독이 아니다.** 여기가 뒤집히면 위 규칙이
    /// 통째로 무의미해지므로 함께 고정한다.
    func test_선물은_구독이_아니다() {
        XCTAssertFalse(SubscriptionProduct.personalGift.isSubscription)
    }
}
