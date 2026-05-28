import XCTest
@testable import VoiceAlarm

final class AccessSnapshotStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: AccessSnapshotStore!

    override func setUp() {
        super.setUp()
        suiteName = "AccessSnapshotStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        store = AccessSnapshotStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        store = nil
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func test_snapshotIsScopedByUserID() {
        store.updateSubscription(userID: "user-1", response: subscription(planKey: "family"))
        store.updateFamilyGroup(userID: "user-1", response: familyGroup(memberCount: 2))

        let first = store.read(userID: "user-1")
        let second = store.read(userID: "user-2")

        XCTAssertEqual(first.subscriptionResponse?.plan?.key, "family")
        XCTAssertEqual(first.familyGroup?.members.count, 2)
        XCTAssertNil(second.subscriptionResponse)
        XCTAssertNil(second.familyGroup)
    }

    func test_updatePreservesOtherSnapshotSection() {
        store.updateFamilyGroup(userID: "user-1", response: familyGroup(memberCount: 1))
        store.updateSubscription(userID: "user-1", response: subscription(planKey: "couple"))

        let snapshot = store.read(userID: "user-1")

        XCTAssertEqual(snapshot.familyGroup?.members.count, 1)
        XCTAssertEqual(snapshot.subscriptionResponse?.plan?.key, "couple")
    }

    func test_clearRemovesOnlyThatUser() {
        store.updateSubscription(userID: "user-1", response: subscription(planKey: "family"))
        store.updateSubscription(userID: "user-2", response: subscription(planKey: "personal"))

        store.clear(userID: "user-1")

        XCTAssertNil(store.read(userID: "user-1").subscriptionResponse)
        XCTAssertEqual(store.read(userID: "user-2").subscriptionResponse?.plan?.key, "personal")
    }

    private func familyGroup(memberCount: Int) -> FamilyGroupCurrentResponse {
        FamilyGroupCurrentResponse(
            group: FamilyGroup(
                id: "group-1",
                ownerUserId: "user-1",
                planId: "plan-1",
                maxMembers: 4,
                createdAt: "2026-01-01T00:00:00Z"
            ),
            role: "owner",
            members: (0..<memberCount).map { index in
                FamilyGroupMember(
                    id: "member-\(index)",
                    userId: "user-\(index + 1)",
                    role: index == 0 ? "owner" : "member",
                    joinedAt: "2026-01-0\(index + 1)T00:00:00Z",
                    email: "user\(index + 1)@example.com",
                    name: "User \(index + 1)"
                )
            }
        )
    }

    private func subscription(planKey: String) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: BillingSubscription(
                id: "subscription-\(planKey)",
                planId: "plan-\(planKey)",
                planGroupId: nil,
                status: "active",
                startsAt: "2026-01-01T00:00:00Z",
                expiresAt: "2026-02-01T00:00:00Z",
                cancelAtPeriodEnd: false,
                canceledAt: nil,
                nextPlanId: nil
            ),
            plan: BillingPlan(
                id: "plan-\(planKey)",
                key: planKey,
                name: planKey,
                planType: planKey,
                periodDays: 30,
                maxMembers: planKey == "family" ? 4 : 2,
                priceKrw: 9_900
            ),
            nextPlan: nil
        )
    }
}
