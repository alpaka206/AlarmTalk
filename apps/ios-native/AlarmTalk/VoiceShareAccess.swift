import Foundation

func canShareVoiceWithOthers(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
    storeTier: PlanTier = .free,
    userPlan: String? = nil
) -> Bool {
    let currentTier = PlanTier.bestKnown(
        serverSubscription: subscriptionResponse,
        storeTier: storeTier,
        userPlan: userPlan
    )
    if currentTier.meetsOrExceeds(.couple) {
        return true
    }

    let currentUserID = authSession?.user.id
    let currentEmail = authSession?.user.email
    return familyGroup?.members.contains { member in
        member.userId != currentUserID && member.email != currentEmail
    } == true
}
