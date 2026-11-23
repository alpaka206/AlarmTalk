package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 전경 잠금 이펙트(`AlarmTalkApp`)의 갈래(`foregroundPlanLockAction`) — 순서가 규칙이다: 확실한 무료가 먼저(살아 있는
 * 구독 행이 있으면 보류라 잠그지 않는다), 그다음 유료 확정이면 복원, 그다음 구독 응답과 plan 이 어긋나면 plan 재조회.
 */
class ForegroundPlanLockTest {

    private fun action(
        signedIn: Boolean = true,
        definitelyFree: Boolean = false,
        subscriptionRowAlive: Boolean = false,
        paidEntitled: Boolean = false,
        billingNotEntitled: Boolean = false,
    ) = foregroundPlanLockAction(
        signedIn = signedIn,
        definitelyFree = definitelyFree,
        subscriptionRowAlive = subscriptionRowAlive,
        paidEntitled = paidEntitled,
        billingNotEntitled = billingNotEntitled,
    )

    @Test
    fun theForegroundLockEffectFollowsTheBranchOrder() {
        // 서버가 무료라고 한 무료는 곧바로 잠근다 — 구독 응답이 무권한이어도 잠금이 먼저다.
        assertEquals(ForegroundPlanLockAction.Lock, action(definitelyFree = true))
        assertEquals(ForegroundPlanLockAction.Lock, action(definitelyFree = true, billingNotEntitled = true))
        // 살아 있는 구독 행(결제 보류)이 있으면 되돌릴 수 없는 잠금을 걸지 않는다.
        assertEquals(ForegroundPlanLockAction.None, action(definitelyFree = true, subscriptionRowAlive = true))
        // 유료 확정이면 잠근 것을 되돌린다.
        assertEquals(ForegroundPlanLockAction.Restore, action(paidEntitled = true))
        // 구독 응답은 무권한인데 plan 이 아직 유료일 수 있다 — plan 을 다시 받는다.
        assertEquals(ForegroundPlanLockAction.RefreshPlan, action(billingNotEntitled = true))
        // 로그인 전이면 잠그지도 되돌리지도 않는다.
        assertEquals(ForegroundPlanLockAction.None, action(signedIn = false, definitelyFree = true, paidEntitled = true))
        assertEquals(ForegroundPlanLockAction.None, action())
    }
}
