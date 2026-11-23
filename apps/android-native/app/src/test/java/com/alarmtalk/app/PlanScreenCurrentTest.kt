package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 이용권 화면의 **'현재 이용권' 카드**(`planScreenCurrentOf`) — 현재 카드는 산 이용권(구독 응답의 `plan.key`)이고, 결제 버튼은
 * 무료 카드와 산 현재 카드에는 없다. 플러스를 무료로 쓰는 길은 스토어 무료 체험 하나이고, 체험도 스토어 구독이라 구독 응답에 실린다.
 *
 * iOS `PlanScreenCurrent.resolve` 가 같은 표를 본다.
 */
class PlanScreenCurrentTest {

    @Test
    fun noSubscriptionMakesTheFreeCardCurrentAndOffersPlus() {
        val screen = planScreenCurrentOf(purchasedPlanKey = null)

        assertEquals("free", screen.currentKey)
        assertTrue(screen.isCurrent("free"))
        assertFalse(screen.isCurrent("personal"))
        assertTrue("플러스를 사지 않았으면 시작 버튼이 있다", screen.showsPurchase("personal"))
        assertFalse("무료 카드에는 결제 버튼이 없다", screen.showsPurchase("free"))
    }

    @Test
    fun explicitFreeKeyIsTheSameAsNoSubscription() {
        assertEquals(planScreenCurrentOf(purchasedPlanKey = null), planScreenCurrentOf(purchasedPlanKey = "free"))
    }

    @Test
    fun purchasedPlanIsCurrentWithoutAPurchaseButton() {
        val screen = planScreenCurrentOf(purchasedPlanKey = "personal")

        assertEquals("personal", screen.currentKey)
        assertTrue(screen.isCurrent("personal"))
        assertFalse("산 현재 카드에는 결제 버튼이 없다", screen.showsPurchase("personal"))
        assertFalse(screen.showsPurchase("free"))
    }
}
