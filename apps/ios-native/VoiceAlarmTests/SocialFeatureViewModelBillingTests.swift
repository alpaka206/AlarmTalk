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

    func test_codeRegistrationDestination_opensSharedPassForInviteResponseLikeAndroid() {
        let result = SocialFeatureViewModel.codeRegistrationDestination(
            responseType: "invite",
            code: "GIFT-1234"
        )

        XCTAssertEqual(result, .sharedPass)
    }

    func test_codeRegistrationDestination_opensSharedPassForInvitePrefixLikeAndroid() {
        let result = SocialFeatureViewModel.codeRegistrationDestination(
            responseType: nil,
            code: "inv-abcd-1234"
        )

        XCTAssertEqual(result, .sharedPass)
    }

    func test_codeRegistrationDestination_opensHomeForVoucherLikeAndroid() {
        let result = SocialFeatureViewModel.codeRegistrationDestination(
            responseType: "voucher",
            code: "GIFT-ABCD-1234"
        )

        XCTAssertEqual(result, .home)
    }

    func test_billingFailureMessage_matchesAndroidErrorCodeCopy() {
        XCTAssertEqual(
            SocialFeatureViewModel.billingFailureMessage(errorCode: "SAME_PLAN", fallback: "fallback"),
            "이미 사용 중인 이용권이에요"
        )
        XCTAssertEqual(
            SocialFeatureViewModel.billingFailureMessage(errorCode: "PLAN_NOT_FOUND", fallback: "fallback"),
            "이용권 정보를 찾지 못했어요"
        )
        XCTAssertEqual(
            SocialFeatureViewModel.billingFailureMessage(errorCode: nil, fallback: "fallback"),
            "fallback"
        )
    }

    func test_billingErrorMessage_readsApiErrorCodeAndJsonFallback() {
        let direct = APIError.server(status: 400, message: "Already on this plan", errorCode: "SAME_PLAN")
        XCTAssertEqual(
            SocialFeatureViewModel.billingErrorMessage(direct, fallback: "fallback"),
            "이미 사용 중인 이용권이에요"
        )

        let raw = #"{"error":"Plan not found","error_code":"PLAN_NOT_FOUND"}"#
        let encoded = APIError.server(status: 404, message: raw, errorCode: nil)
        XCTAssertEqual(
            SocialFeatureViewModel.billingErrorMessage(encoded, fallback: "fallback"),
            "이용권 정보를 찾지 못했어요"
        )
    }

    func test_billingErrorMessage_keepsKoreanServerMessageWhenCodeIsUnknown() {
        let error = APIError.server(status: 400, message: "이미 사용된 코드예요", errorCode: "UNKNOWN")
        XCTAssertEqual(
            SocialFeatureViewModel.billingErrorMessage(error, fallback: "fallback"),
            "이미 사용된 코드예요"
        )
    }

    func test_userFacingErrorMessage_usesFallbackForEnglishServerMessageLikeAndroid() {
        let error = APIError.server(status: 400, message: "User not found", errorCode: nil)
        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "이용권에서 나가지 못했어요"),
            "이용권에서 나가지 못했어요"
        )
    }

    func test_userFacingErrorMessage_keepsKoreanServerMessageLikeAndroid() {
        let error = APIError.server(status: 400, message: "이미 처리된 요청이에요", errorCode: nil)
        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "fallback"),
            "이미 처리된 요청이에요"
        )
    }

    func test_scopedRefreshErrorMessage_hidesEnglishServerMessageLikeAndroid() {
        let error = APIError.server(status: 500, message: "Internal Server Error", errorCode: nil)

        XCTAssertEqual(
            SocialFeatureViewModel.scopedRefreshErrorMessage(
                label: "메시지",
                error: error,
                fallback: "음성 메시지를 불러오지 못했어요"
            ),
            "메시지: 음성 메시지를 불러오지 못했어요"
        )
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
