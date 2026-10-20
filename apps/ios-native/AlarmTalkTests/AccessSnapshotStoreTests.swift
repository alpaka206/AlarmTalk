import XCTest
@testable import AlarmTalk

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
        store.patchWithoutOwnershipCheck("user-1") { $0.subscriptionResponse = subscription(planKey: "personal") }
        store.patchWithoutOwnershipCheck("user-1") { $0.userPlan = "plus" }

        let first = store.read(userID: "user-1")
        let second = store.read(userID: "user-2")

        XCTAssertEqual(first.subscriptionResponse?.plan?.key, "personal")
        XCTAssertEqual(first.userPlan, "plus")
        XCTAssertNil(second.subscriptionResponse)
        XCTAssertNil(second.userPlan)
    }

    func test_updatePreservesOtherSnapshotSection() {
        store.patchWithoutOwnershipCheck("user-1") { $0.userPlan = "plus" }
        store.patchWithoutOwnershipCheck("user-1") { $0.subscriptionResponse = subscription(planKey: "personal") }

        let snapshot = store.read(userID: "user-1")

        XCTAssertEqual(snapshot.userPlan, "plus")
        XCTAssertEqual(snapshot.subscriptionResponse?.plan?.key, "personal")
    }

    func test_clearRemovesOnlyThatUser() {
        store.patchWithoutOwnershipCheck("user-1") { $0.subscriptionResponse = subscription(planKey: "personal") }
        store.patchWithoutOwnershipCheck("user-2") { $0.subscriptionResponse = subscription(planKey: "personal") }

        store.clear(userID: "user-1")

        XCTAssertNil(store.read(userID: "user-1").subscriptionResponse)
        XCTAssertEqual(store.read(userID: "user-2").subscriptionResponse?.plan?.key, "personal")
    }

    /// 커플·가족 이용권 전에 저장한 스냅샷 — 그룹 칸(`familyGroup`)과 플랜 정원(`maxMembers`)이 남아 있다.
    /// 읽지 못하면 `.empty`(모름)로 떨어져 저장해 둔 무료·유료 판정을 통째로 잃는다 — 모르는 칸은 버리고 읽는다.
    func test_legacySnapshotWithGroupFieldsStillDecodes() throws {
        let legacy = """
        {
          "subscriptionResponse": {
            "subscription": {"id": "sub-1", "planId": "plan-family", "status": "active", "expiresAt": "2099-01-01T00:00:00Z"},
            "plan": {"id": "plan-family", "key": "family", "name": "가족", "planType": "family", "maxMembers": 4}
          },
          "familyGroup": {
            "group": {"id": "group-1", "ownerUserId": "user-1", "planId": "plan-family", "maxMembers": 4,
                      "createdAt": "2026-01-01T00:00:00Z"},
            "role": "owner",
            "members": [{"id": "m-1", "userId": "user-1", "role": "owner", "joinedAt": "2026-01-01T00:00:00Z"}]
          },
          "storePlanKey": "personal",
          "storeEntitlementUntilMillis": 4102444800000,
          "userPlan": "free"
        }
        """
        defaults.set(Data(legacy.utf8), forKey: "access_snapshot_user-1")

        let snapshot = store.read(userID: "user-1")

        XCTAssertEqual(snapshot.subscriptionResponse?.plan?.key, "family")
        XCTAssertEqual(snapshot.storePlanKey, "personal")
        XCTAssertEqual(snapshot.storeEntitlementUntilMillis, 4_102_444_800_000)
        XCTAssertEqual(snapshot.userPlan, "free")
        XCTAssertNotEqual(snapshot, .empty)
    }

    private func subscription(planKey: String) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: BillingSubscription(
                id: "subscription-\(planKey)",
                planId: "plan-\(planKey)",
                status: "active",
                expiresAt: "2026-02-01T00:00:00Z"
            ),
            plan: BillingPlan(
                id: "plan-\(planKey)",
                key: planKey,
                name: planKey,
                planType: planKey
            )
        )
    }
}
