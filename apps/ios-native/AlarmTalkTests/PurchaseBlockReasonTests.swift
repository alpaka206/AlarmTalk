import XCTest
@testable import AlarmTalk

/// **다른 스토어가 갱신을 쥐고 있으면 애플 결제를 시작하지 않는다**(코덱스 #730·#733).
///
/// ⚠ 확정은 **우리 DB 의 옛 구독 행만** 취소할 뿐 Play 자동갱신은 못 끊는다. 두 스토어가
/// 동시에 청구하고, 서버는 새 애플 구독만 보여 주므로 Play 를 관리할 입구가 앱에서 사라진다.
final class PurchaseBlockReasonTests: XCTestCase {

    private func subscription(storeProvider: String?) -> BillingSubscription {
        BillingSubscription(
            id: "sub-1",
            planId: "plan-1",
            planGroupId: nil,
            status: "active",
            startsAt: "2026-09-01T00:00:00.000Z",
            expiresAt: "2026-10-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
            canceledAt: nil,
            nextPlanId: nil,
            storeProvider: storeProvider
        )
    }

    func test_무료는_막지_않는다() {
        // 갱신을 쥔 스토어가 애초에 없다. 구독을 못 읽었어도 마찬가지다.
        XCTAssertNil(BillingPanel.purchaseBlockReason(currentTier: .free, activeSubscription: nil))
        XCTAssertNil(
            BillingPanel.purchaseBlockReason(
                currentTier: .free,
                activeSubscription: subscription(storeProvider: "google")
            )
        )
    }

    func test_Play_가_갱신을_쥐고_있으면_막는다() {
        XCTAssertEqual(
            BillingPanel.purchaseBlockReason(
                currentTier: .personal,
                activeSubscription: subscription(storeProvider: "google")
            ),
            .playOwnsRenewal
        )
    }

    func test_애플이_갱신을_쥐고_있으면_통과한다() {
        // 같은 스토어 안의 등급 변경은 애플이 알아서 처리한다(구독 그룹).
        XCTAssertNil(
            BillingPanel.purchaseBlockReason(
                currentTier: .personal,
                activeSubscription: subscription(storeProvider: "apple")
            )
        )
    }

    func test_스토어_결제가_아니면_통과한다() {
        // 프로모·바우처 — 갱신을 쥔 스토어가 없다.
        XCTAssertNil(
            BillingPanel.purchaseBlockReason(
                currentTier: .family,
                activeSubscription: subscription(storeProvider: nil)
            )
        )
    }

    func test_유료인데_구독을_못_읽었으면_막는다() {
        // ⚠ **모르는 것은 '아니오' 로 친다**(코덱스 #733). 새 기기·새 로그인이거나
        //   `GET /billing/subscription` 이 아직 돌고 있거나 실패한 동안 nil 인데,
        //   StoreKit 제품은 이미 로드돼 있어 살 수 있다 — 그 틈이 이중 청구다.
        for tier in [PlanTier.personal, .family] {
            XCTAssertEqual(
                BillingPanel.purchaseBlockReason(currentTier: tier, activeSubscription: nil),
                .renewalOwnerUnknown,
                "\(tier) 에서 막지 않았다"
            )
        }
    }
}
