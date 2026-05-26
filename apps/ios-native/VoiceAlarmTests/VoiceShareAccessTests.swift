import XCTest
@testable import VoiceAlarm

final class VoiceShareAccessTests: XCTestCase {
    func test_coupleTierCanShareWithoutLoadedMembers() {
        XCTAssertTrue(
            canShareVoiceWithOthers(
                subscriptionResponse: nil,
                familyGroup: nil,
                authSession: session,
                storeTier: .couple,
                userPlan: nil
            )
        )
    }

    func test_groupWithAnotherMemberCanShareOnPersonalTier() {
        XCTAssertTrue(
            canShareVoiceWithOthers(
                subscriptionResponse: nil,
                familyGroup: group(members: [selfMember, otherMember]),
                authSession: session,
                storeTier: .personal,
                userPlan: nil
            )
        )
    }

    func test_personalTierWithOnlySelfCannotShare() {
        XCTAssertFalse(
            canShareVoiceWithOthers(
                subscriptionResponse: nil,
                familyGroup: group(members: [selfMember]),
                authSession: session,
                storeTier: .personal,
                userPlan: nil
            )
        )
    }

    func test_activeFamilyBackendPlanCanShare() {
        XCTAssertTrue(
            canShareVoiceWithOthers(
                subscriptionResponse: subscription(planKey: "family", planType: "family"),
                familyGroup: nil,
                authSession: session,
                storeTier: .free,
                userPlan: nil
            )
        )
    }

    private var session: AuthSession {
        AuthSession(
            token: "token",
            user: AuthUser(id: "user-1", email: "me@example.com", name: "Me", plan: "personal")
        )
    }

    private var selfMember: FamilyGroupMember {
        FamilyGroupMember(
            id: "member-1",
            userId: "user-1",
            role: "owner",
            joinedAt: "2026-01-01T00:00:00Z",
            email: "me@example.com",
            name: "Me"
        )
    }

    private var otherMember: FamilyGroupMember {
        FamilyGroupMember(
            id: "member-2",
            userId: "user-2",
            role: "member",
            joinedAt: "2026-01-01T00:00:00Z",
            email: "other@example.com",
            name: "Other"
        )
    }

    private func group(members: [FamilyGroupMember]) -> FamilyGroupCurrentResponse {
        FamilyGroupCurrentResponse(
            group: FamilyGroup(
                id: "group-1",
                ownerUserId: "user-1",
                planId: "plan-1",
                maxMembers: 2,
                createdAt: "2026-01-01T00:00:00Z"
            ),
            role: "owner",
            members: members
        )
    }

    private func subscription(planKey: String, planType: String) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: BillingSubscription(
                id: "subscription-1",
                planId: "plan-1",
                planGroupId: nil,
                status: "active",
                startsAt: "2026-01-01T00:00:00Z",
                expiresAt: "2026-02-01T00:00:00Z",
                cancelAtPeriodEnd: false,
                canceledAt: nil,
                nextPlanId: nil
            ),
            plan: BillingPlan(
                id: "plan-1",
                key: planKey,
                name: planKey,
                planType: planType,
                periodDays: 30,
                maxMembers: 6,
                priceKrw: 9_900
            ),
            nextPlan: nil
        )
    }
}
