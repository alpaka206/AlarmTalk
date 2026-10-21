import XCTest
@testable import AlarmTalk

@MainActor
final class SocialFeatureViewModelBillingTests: XCTestCase {

    func test_normalizedCancellationMode_matchesAndroidBackendContract() {
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("at_period_end"), "at_period_end")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("immediate"), "immediate")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode("now"), "immediate")
        XCTAssertEqual(SocialFeatureViewModel.normalizedCancellationMode(""), "immediate")
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

    /// 선물하기는 2026-10-14 에 없앴다(App Store 지침 3.1.1 두 번째 반려). 서버가 더는 내지 않는
    /// `GIFT_PERSONAL_ONLY` 를 표에 남기면 없는 기능("선물하기는…")을 말하게 된다.
    func test_billingFailureMessage_hasNoGiftBranch() {
        XCTAssertEqual(
            SocialFeatureViewModel.billingFailureMessage(errorCode: "GIFT_PERSONAL_ONLY", fallback: "fallback"),
            "fallback"
        )
        let raw = #"{"error":"Gift is personal only","error_code":"GIFT_PERSONAL_ONLY"}"#
        let encoded = APIError.server(status: 400, message: raw, errorCode: nil)
        XCTAssertEqual(SocialFeatureViewModel.billingErrorMessage(encoded, fallback: "fallback"), "fallback")
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

    func test_billingErrorMessage_usesFallbackWhenCodeIsUnknown() {
        let error = APIError.server(status: 400, message: "이미 처리된 요청이에요", errorCode: "UNKNOWN")
        XCTAssertEqual(
            SocialFeatureViewModel.billingErrorMessage(error, fallback: "fallback"),
            "fallback"
        )
    }

    func test_userFacingErrorMessage_usesFallbackForEnglishServerMessageLikeAndroid() {
        let error = APIError.server(status: 400, message: "User not found", errorCode: nil)
        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "이용권 정보를 불러오지 못했어요"),
            "이용권 정보를 불러오지 못했어요"
        )
    }

    func test_userFacingErrorMessage_usesFallbackLikeAndroid() {
        let error = APIError.server(status: 400, message: "이미 처리된 요청이에요", errorCode: nil)
        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "fallback"),
            "fallback"
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
}
