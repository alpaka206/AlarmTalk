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
            status: "active",
            expiresAt: "2026-10-01T00:00:00.000Z",
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
        // 같은 스토어 안의 일은 애플이 알아서 처리한다(구독 그룹).
        XCTAssertNil(reason(.personal, response(renewalProviders: ["apple"])))
    }

    func test_스토어_결제가_없으면_통과한다() {
        // 스토어 밖에서 준 이용권(예전의 기간 한정 개인 플랜 같은) — 갱신을 쥔 스토어가 없다.
        XCTAssertNil(reason(.personal, response(renewalProviders: [])))
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
        // 무료는 갱신을 쥔 스토어가 애초에 없다.
        XCTAssertNil(reason(.free, nil))
    }
}

/// 플러스 카드의 상태 한 줄 — 안드로이드 `SubscriptionPanel` 의 `currentStatusText` 와 같은 판정이다(2026-11-22 두 앱 통일).
/// 해지 예약(다음 플랜 / 종료) → 기한 → '사용 중' 순으로 고른다.
final class BillingStatusTextTests: XCTestCase {
    /// 정오(UTC)라 어느 시간대에서 돌려도 같은 날이다.
    private let expiresAt = "2026-10-01T12:00:00.000Z"

    private func subscription(expiresAt: String, cancelAtPeriodEnd: Bool?) -> BillingSubscription {
        BillingSubscription(
            id: "sub-1",
            planId: "plan-1",
            status: "active",
            expiresAt: expiresAt,
            storeProvider: "google",
            cancelAtPeriodEnd: cancelAtPeriodEnd
        )
    }

    func test_해지_예약이_없으면_기한까지_쓸_수_있다고_말한다() {
        let text = BillingPanel.subscriptionStatusText(
            subscription: subscription(expiresAt: expiresAt, cancelAtPeriodEnd: false),
            nextPlan: nil
        )
        XCTAssertEqual(text, String(localized: "\(String("2026.10.01"))까지 사용할 수 있어요."))
    }

    func test_옛_스냅샷처럼_해지_예약을_모르면_예약_없음으로_읽는다() {
        let text = BillingPanel.subscriptionStatusText(
            subscription: subscription(expiresAt: expiresAt, cancelAtPeriodEnd: nil),
            nextPlan: nil
        )
        XCTAssertEqual(text, String(localized: "\(String("2026.10.01"))까지 사용할 수 있어요."))
    }

    func test_해지_예약이면_기한_뒤_종료된다고_말한다() {
        let text = BillingPanel.subscriptionStatusText(
            subscription: subscription(expiresAt: expiresAt, cancelAtPeriodEnd: true),
            nextPlan: nil
        )
        XCTAssertEqual(text, String(localized: "\(String("2026.10.01"))까지 사용 후 종료돼요."))
    }

    func test_해지_예약에_다음_플랜이_있으면_그_플랜으로_바뀐다고_말한다() {
        let next = BillingPlan(id: "plan-free", key: "free", name: "Free", planType: "free")
        let text = BillingPanel.subscriptionStatusText(
            subscription: subscription(expiresAt: expiresAt, cancelAtPeriodEnd: true),
            nextPlan: next
        )
        let nextName = PlanTier.free.displayLabel
        XCTAssertEqual(text, String(localized: "\(String("2026.10.01")) 이후 \(nextName) 이용권으로 변경돼요."))
    }

    func test_날짜를_못_읽으면_날짜_없는_문장을_쓴다() {
        XCTAssertEqual(
            BillingPanel.subscriptionStatusText(subscription: subscription(expiresAt: "", cancelAtPeriodEnd: false), nextPlan: nil),
            String(localized: "사용 중인 이용권이에요.")
        )
        XCTAssertEqual(
            BillingPanel.subscriptionStatusText(subscription: subscription(expiresAt: "", cancelAtPeriodEnd: true), nextPlan: nil),
            String(localized: "현재 이용권이 종료 예정이에요.")
        )
    }
}
