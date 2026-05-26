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
}
