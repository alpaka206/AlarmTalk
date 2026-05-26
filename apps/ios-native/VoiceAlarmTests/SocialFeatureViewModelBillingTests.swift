import XCTest
@testable import VoiceAlarm

@MainActor
final class SocialFeatureViewModelBillingTests: XCTestCase {

    func test_normalizedCancellationMode_matchesAndroidBackendContract() {
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("at_period_end"), "at_period_end")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("immediate"), "immediate")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("now"), "immediate")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode(""), "immediate")
    }

    func test_shareCodePlanLabel_matchesAndroidCopy() {
        XCTAssertEqual(SocialFeatureViewModel.shareCodePlanLabel(nil), "공유")
        XCTAssertEqual(SocialFeatureViewModel.shareCodePlanLabel(response(planKey: "couple", planType: "couple")), "커플")
        XCTAssertEqual(SocialFeatureViewModel.shareCodePlanLabel(response(planKey: "family", planType: "family")), "가족")
        XCTAssertEqual(SocialFeatureViewModel.shareCodePlanLabel(response(planKey: "legacy", planType: "couple")), "커플")
    }

    func test_upsertingVoucher_replacesSameIdAndMovesToFrontLikeAndroid() {
        let stale = voucher(id: "share", code: "INV-OLD", useCount: 0)
        let other = voucher(id: "other", code: "GIFT-1", useCount: 0)
        let fresh = voucher(id: "share", code: "INV-NEW", useCount: 1)

        let result = SocialFeatureViewModel.upsertingVoucher(fresh, into: [other, stale])

        XCTAssertEqual(result.map(\.id), ["share", "other"])
        XCTAssertEqual(result.first?.code, "INV-NEW")
        XCTAssertEqual(result.first?.useCount, 1)
    }

    private func response(planKey: String, planType: String) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: nil,
            plan: BillingPlan(
                id: "plan-\(planKey)",
                key: planKey,
                name: planKey,
                planType: planType,
                periodDays: 30,
                maxMembers: 2,
                priceKrw: 0
            ),
            nextPlan: nil
        )
    }

    private func voucher(id: String, code: String, useCount: Int) -> VoucherItem {
        VoucherItem(
            id: id,
            code: code,
            planKey: "family",
            planName: "가족",
            planType: "family",
            status: "issued",
            issuedAt: nil,
            expiresAt: "2026-12-31T00:00:00Z",
            maxUses: 6,
            useCount: useCount
        )
    }
}
