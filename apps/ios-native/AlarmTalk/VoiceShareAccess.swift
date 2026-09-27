import Foundation

/// 목소리 공유 토글을 보일지. 커플·가족 등급이거나 그룹에 다른 멤버가 있으면 보인다
/// (기간 한정 개인 플랜의 보류 규칙이 걸려 있으면 등급만 — `PlanTier.personalPromoHoldActive`).
///
/// ⚠ 등급은 **세션 사용자로** 본다(`PlanTier.bestKnown(user:)`). plan 문자열만 넘기면 기간 한정
/// 개인 플랜 동안 계산값 `plus` 가 보류 규칙을 풀어, 결제 보류 그룹의 남은 행이 커플·가족
/// 등급을 되살린다(2026-09-27 리뷰).
func canShareVoiceWithOthers(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
    storeTier: PlanTier = .free,
    now: Date = Date()
) -> Bool {
    let currentTier = PlanTier.bestKnown(
        serverSubscription: subscriptionResponse,
        storeTier: storeTier,
        user: authSession?.user,
        now: now
    )
    if currentTier.meetsOrExceeds(.couple) {
        return true
    }
    // ⚠ 기간 한정 개인 플랜 중에는 보류 규칙이 먼저다(스펙 D9) — 결제 보류로 남은 그룹의 멤버로는
    // 열지 않는다. 열면 서버가 원시값으로 막는 공유를 켜는 토글이 된다(안드로이드
    // `canShareVoiceWithOthers` 의 `promoHold` 갈래와 같은 답).
    if PlanTier.personalPromoHoldActive(user: authSession?.user, now: now) {
        return false
    }

    let currentUserID = authSession?.user.id
    let currentEmail = authSession?.user.email
    return familyGroup?.members.contains { member in
        member.userId != currentUserID && member.email != currentEmail
    } == true
}
