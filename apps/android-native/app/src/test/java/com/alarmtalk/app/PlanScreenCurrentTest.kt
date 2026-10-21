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
 * - 산 이용권·보류 행·프로모 없음/끝남은 **예전 그대로**다.
 *
 * iOS `PersonalPromoTests` 의 `PlanScreenCurrent` 갈래가 같은 표를 본다.
 */
class PlanScreenCurrentTest {

    /** 이용권 화면의 카드 — 무료와 개인 둘이다. */
    private val keys = listOf("free", "personal")

    private fun resolve(
        purchased: String? = null,
        promo: Boolean = true,
        held: Boolean = false,
    ) = planScreenCurrentOf(
        purchasedPlanKey = purchased,
        promoActive = promo,
        hasHeldSubscriptionRow = held,
    )

    /** 이 변경 전의 규칙 — 현재 카드는 산 이용권, 결제 버튼은 현재가 아닌 유료 카드. */
    private data class Legacy(val current: String, val purchase: Set<String>)

    private fun legacy(purchased: String?): Legacy {
        val current = purchased ?: "free"
        return Legacy(
            current = current,
            purchase = keys.filter { it != "free" && it != current }.toSet(),
        )
    }

    private fun PlanScreenCurrent.asLegacy() = Legacy(
        current = currentKey,
        purchase = keys.filter { showsPurchase(it) }.toSet(),
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
        assertFalse(screen.showsPurchase("free"))
    }

    @Test
    fun explicitFreeKeyIsTheSameAsNoSubscription() {
        assertEquals(resolve(purchased = null), resolve(purchased = "free"))
    }

    @Test
    fun purchasedPlanStaysCurrentAndPromoLineStaysAbove() {
        // 산 이용권이 있는데 프로모가 보이는 경우(두 응답이 잠깐 어긋날 때) — 예전 그대로.
        val screen = resolve(purchased = "personal")

        assertEquals("personal", screen.currentKey)
        assertFalse(screen.promoOnPersonalCard)
        assertTrue(screen.promoLineAboveList)
        assertFalse("산 현재 카드에는 결제 버튼이 없다", screen.showsPurchase("personal"))
        assertEquals(legacy("personal"), screen.asLegacy())
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
        listOf(null, "personal").forEach { purchased ->
            val screen = resolve(purchased = purchased, promo = false)
            assertFalse(screen.promoOnPersonalCard)
            assertFalse("프로모가 없으면 한 줄도 없다", screen.promoLineAboveList)
            assertEquals("$purchased", legacy(purchased), screen.asLegacy())
        }
    }

    @Test
    fun onlyThePromoOnlyAccountDiffersFromTodaysLayout() {
        // 모든 입력 조합에서: 개인 카드에 앉는 갈래만 예전과 다르고, 나머지는 예전 규칙과 한 치도 다르지 않다.
        // 두 자리(개인 카드·카드 위 한 줄)는 동시에 참이 되지 않고, 프로모가 있으면 둘 중 하나에는 반드시 보인다.
        listOf(null, "free", "personal").forEach { purchased ->
            listOf(false, true).forEach { promo ->
                listOf(false, true).forEach { held ->
                    val screen = resolve(purchased, promo, held)
                    val label = "$purchased/$promo/$held"
                    val promoOnly = promo && (purchased ?: "free") == "free" && !held
                    assertEquals(label, promoOnly, screen.promoOnPersonalCard)
                    assertFalse(label, screen.promoOnPersonalCard && screen.promoLineAboveList)
                    assertEquals(label, promo, screen.promoOnPersonalCard || screen.promoLineAboveList)
                    if (!promoOnly) assertEquals(label, legacy(purchased), screen.asLegacy())
                }
            }
        }
    }
}
