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

    private func response(
        storeProvider: String? = nil,
        renewalProviders: [String]? = nil,
        hasSubscription: Bool = true
    ) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: hasSubscription ? subscription(storeProvider: storeProvider) : nil,
            plan: nil,
            nextPlan: nil,
            storeRenewalProviders: renewalProviders
        )
    }

    private func reason(
        _ tier: PlanTier,
        _ response: BillingSubscriptionResponse?
    ) -> BillingPanel.PurchaseBlockReason? {
        BillingPanel.purchaseBlockReason(currentTier: tier, response: response)
    }

    // MARK: - 갱신 주인 신호가 있을 때 (현행 서버)

    func test_Play_가_갱신을_쥐고_있으면_막는다() {
        XCTAssertEqual(reason(.personal, response(renewalProviders: ["google"])), .playOwnsRenewal)
    }

    func test_애플만_갱신을_쥐면_통과한다() {
        // 같은 스토어 안의 등급 변경은 애플이 알아서 처리한다(구독 그룹).
        XCTAssertNil(reason(.personal, response(renewalProviders: ["apple"])))
    }

    func test_스토어_결제가_없으면_통과한다() {
        // 프로모·바우처 — 갱신을 쥔 스토어가 없다.
        XCTAssertNil(reason(.family, response(renewalProviders: [])))
    }

    func test_애플과_구글이_함께_살아_있으면_막는다() {
        // ⚠ `store_provider` 는 해지 판정이라 애플로 **접힌다.** 그 값을 재사용하면
        //   "애플뿐" 으로 읽혀 Play 가 갱신 중인데 애플 결제를 또 열어 준다(코덱스 #733 3차).
        XCTAssertEqual(
            reason(.personal, response(storeProvider: "apple", renewalProviders: ["apple", "google"])),
            .playOwnsRenewal
        )
    }

    func test_Play_보류라_무료로_보여도_막는다() {
        // ⚠ Play `ON_HOLD`/`PAUSED` 는 구독 행을 살려 두고 `users.plan` 만 회수한다.
        //   그 행은 `expires_at` 이 지나 응답의 `subscription` 에서 빠지고 등급도 free 다 —
        //   등급이나 subscription 으로 거르면 **보류 중인 Play 구독이 안 보인다.**
        //   결제가 복구되면 Play 는 다시 청구한다.
        XCTAssertEqual(
            reason(.free, response(renewalProviders: ["google"], hasSubscription: false)),
            .playOwnsRenewal
        )
    }

    // MARK: - 구버전 서버 (신호 없음)

    func test_구버전_서버는_옛_신호로_판단한다() {
        XCTAssertEqual(reason(.personal, response(storeProvider: "google")), .playOwnsRenewal)
        XCTAssertNil(reason(.personal, response(storeProvider: "apple")))
        XCTAssertNil(reason(.personal, response(storeProvider: nil)))
    }

    func test_구버전_서버에서_유료인데_구독이_없으면_막는다() {
        XCTAssertEqual(
            reason(.personal, response(hasSubscription: false)),
            .renewalOwnerUnknown
        )
    }

    func test_구버전_서버에서_무료면_막지_않는다() {
        XCTAssertNil(reason(.free, response(hasSubscription: false)))
    }

    // MARK: - 아직 못 읽었을 때

    func test_응답_전이면_유료만_막는다() {
        // ⚠ **모르는 것은 '아니오' 로 친다.** 새 기기·새 로그인이거나 조회가 아직 돌고 있는
        //   동안에도 StoreKit 제품은 이미 로드돼 살 수 있다 — 그 틈이 이중 청구다.
        XCTAssertEqual(reason(.personal, nil), .renewalOwnerUnknown)
        XCTAssertEqual(reason(.family, nil), .renewalOwnerUnknown)
        // 무료는 갱신을 쥔 스토어가 애초에 없다.
        XCTAssertNil(reason(.free, nil))
    }
}
