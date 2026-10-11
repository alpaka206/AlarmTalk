package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 이용권 화면의 **'현재 이용권' 카드**와 기간 한정 개인 플랜 문구의 자리(`planScreenCurrentOf`) —
 * 스펙 `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」 D4 「이용권 화면의 프로모 문구」 표.
 *
 * 고정하는 것:
 * - 프로모만 쓰는 계정은 **개인 카드가 현재**이고, 문구는 그 카드에만 있다(카드 위 한 줄 없음).
 * - 그 개인 카드의 **결제 버튼은 남는다** — '현재' 와 '결제 버튼 숨김' 은 다른 질문이다.
 * - 산 이용권·공유 멤버·보류 행·프로모 없음/끝남은 **예전 그대로**다.
 *
 * iOS `PersonalPromoTests` 의 `PlanScreenCurrent` 갈래가 같은 표를 본다.
 */
class PlanScreenCurrentTest {

    private val keys = listOf("free", "personal", "couple", "family")

    private fun resolve(
        purchased: String? = null,
        member: Boolean = false,
        promo: Boolean = true,
        held: Boolean = false,
    ) = planScreenCurrentOf(
        purchasedPlanKey = purchased,
        isSharedMember = member,
        promoActive = promo,
        hasHeldSubscriptionRow = held,
    )

    /** 이 변경 전의 규칙 — 현재 카드는 산 이용권, 결제 버튼은 현재가 아닌 유료 카드, 공유는 현재 카드. */
    private data class Legacy(val current: String, val purchase: Set<String>, val share: Set<String>)

    private fun legacy(purchased: String?): Legacy {
        val current = purchased ?: "free"
        return Legacy(
            current = current,
            purchase = keys.filter { it != "free" && it != current }.toSet(),
            share = setOf(current),
        )
    }

    private fun PlanScreenCurrent.asLegacy() = Legacy(
        current = currentKey,
        purchase = keys.filter { showsPurchase(it) }.toSet(),
        share = keys.filter { sharesVouchers(it) }.toSet(),
    )

    @Test
    fun promoOnlyAccountShowsPersonalCardAsCurrent() {
        val screen = resolve()

        assertEquals("personal", screen.currentKey)
        assertTrue(screen.isCurrent("personal"))
        assertFalse("무료 카드는 현재가 아니다", screen.isCurrent("free"))
        assertTrue(screen.promoOnPersonalCard)
        assertFalse("같은 말을 카드 위에 또 하지 않는다", screen.promoLineAboveList)
    }

    @Test
    fun promoPersonalCardKeepsPurchaseButton() {
        val screen = resolve()

        assertTrue("끝난 뒤 이어 쓰려면 사야 한다 — 개인 카드의 결제 버튼이 남는다", screen.showsPurchase("personal"))
        assertTrue(screen.showsPurchase("couple"))
        assertTrue(screen.showsPurchase("family"))
        assertFalse(screen.showsPurchase("free"))
    }

    @Test
    fun promoPersonalCardIsNotAPurchasedPlan() {
        // 코드 공유는 산 현재 카드에서만 — 프로모 카드는 산 것이 아니다. 무료 카드도 현재가 아니므로
        // 어느 카드에도 공유 버튼이 없다(예전과 같다 — 예전엔 무료 카드가 현재였고 무료 코드는 없다).
        val screen = resolve()
        keys.forEach { assertFalse(it, screen.sharesVouchers(it)) }
    }

    @Test
    fun explicitFreeKeyIsTheSameAsNoSubscription() {
        assertEquals(resolve(purchased = null), resolve(purchased = "free"))
    }

    @Test
    fun purchasedPlanStaysCurrentAndPromoLineStaysAbove() {
        // 산 이용권이 있는데 프로모가 보이는 경우(두 응답이 잠깐 어긋날 때) — 예전 그대로.
        val screen = resolve(purchased = "couple")

        assertEquals("couple", screen.currentKey)
        assertFalse(screen.promoOnPersonalCard)
        assertTrue(screen.promoLineAboveList)
        assertFalse("산 현재 카드에는 결제 버튼이 없다", screen.showsPurchase("couple"))
        assertTrue(screen.sharesVouchers("couple"))
        assertEquals(legacy("couple"), screen.asLegacy())
    }

    @Test
    fun sharedMemberKeepsTodaysLayout() {
        // 결제 보류 그룹의 멤버 — 원시 free 라 프로모가 있지만 구독 응답에는 행이 없다.
        val screen = resolve(purchased = null, member = true)

        assertEquals("free", screen.currentKey)
        assertFalse(screen.promoOnPersonalCard)
        assertTrue(screen.promoLineAboveList)
        assertEquals(legacy(null), screen.asLegacy())
    }

    @Test
    fun heldSubscriptionRowKeepsTodaysLayout() {
        // `deletes_voices_at_end = false` — 원시 free 인데 active 행이 남은 결제 보류 계정.
        val screen = resolve(purchased = null, held = true)

        assertEquals("free", screen.currentKey)
        assertFalse(screen.promoOnPersonalCard)
        assertTrue(screen.promoLineAboveList)
        assertEquals(legacy(null), screen.asLegacy())
    }

    @Test
    fun noPromoOrEndedPromoKeepsTodaysLayout() {
        // 끝난 프로모는 `planScreenPersonalPromoOf` 가 이미 걸러 promoActive = false 로 온다.
        listOf(null, "personal", "couple", "family").forEach { purchased ->
            listOf(false, true).forEach { member ->
                val screen = resolve(purchased = purchased, member = member, promo = false)
                assertFalse(screen.promoOnPersonalCard)
                assertFalse("프로모가 없으면 한 줄도 없다", screen.promoLineAboveList)
                assertEquals("$purchased/$member", legacy(purchased), screen.asLegacy())
            }
        }
    }

    @Test
    fun onlyThePromoOnlyAccountDiffersFromTodaysLayout() {
        // 모든 입력 조합에서: 개인 카드에 앉는 갈래만 예전과 다르고, 나머지는 예전 규칙과 한 치도 다르지 않다.
        // 두 자리(개인 카드·카드 위 한 줄)는 동시에 참이 되지 않고, 프로모가 있으면 둘 중 하나에는 반드시 보인다.
        listOf(null, "free", "personal", "couple", "family").forEach { purchased ->
            listOf(false, true).forEach { member ->
                listOf(false, true).forEach { promo ->
                    listOf(false, true).forEach { held ->
                        val screen = resolve(purchased, member, promo, held)
                        val label = "$purchased/$member/$promo/$held"
                        val promoOnly = promo && (purchased ?: "free") == "free" && !member && !held
                        assertEquals(label, promoOnly, screen.promoOnPersonalCard)
                        assertFalse(label, screen.promoOnPersonalCard && screen.promoLineAboveList)
                        assertEquals(label, promo, screen.promoOnPersonalCard || screen.promoLineAboveList)
                        if (!promoOnly) assertEquals(label, legacy(purchased), screen.asLegacy())
                    }
                }
            }
        }
    }
}
