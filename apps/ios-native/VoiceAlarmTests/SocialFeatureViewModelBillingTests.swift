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
}
