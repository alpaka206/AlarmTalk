import XCTest
@testable import AlarmTalk

final class OnboardingCompletionStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: OnboardingCompletionStore!

    override func setUp() {
        super.setUp()
        suiteName = "OnboardingCompletionStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        store = OnboardingCompletionStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        store = nil
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func test_completionIsUserScoped() {
        store.markCompleted(userID: "user-1")

        XCTAssertTrue(store.hasCompleted(userID: "user-1"))
        XCTAssertFalse(store.hasCompleted(userID: "user-2"))
    }

    func test_blankUserIDIsNotCompleted() {
        store.markCompleted(userID: "   ")

        XCTAssertFalse(store.hasCompleted(userID: "   "))
    }

    func test_legacyGlobalCompletionMigratesOnlyFirstUser() {
        defaults.set(true, forKey: "onboarding_completed_v1")

        XCTAssertTrue(store.hasCompleted(userID: "user-1"))
        XCTAssertFalse(store.hasCompleted(userID: "user-2"))
    }
}
