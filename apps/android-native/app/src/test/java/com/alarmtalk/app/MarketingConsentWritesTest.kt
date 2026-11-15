package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **광고성 정보 수신 스위치는 서버가 가진 값으로 끝난다**(`docs/spec/consent.md` 「광고성 정보 수신 토글」).
 *
 * 2026-10-29 외부 제보: 끈 상태에서 켜고, 첫 저장이 끝나기 전에 다시 끄고, 이어 보낸 두 번째 저장이 실패하면 스위치는
 * 꺼져 있는데 서버는 켬으로 저장돼 있었다. 이어 보내는 쓰기가 **낙관적으로 바뀐 화면 값**을 되돌릴 값으로 잡았기 때문이다.
 * 관리자 콘솔의 광고 알림은 이 값으로 받는 사람을 고른다 — 끈 줄 아는 사람에게 광고가 간다.
 *
 * 쓰기 하나가 끝난 뒤의 판정은 [marketingConsentAfterWrite] 하나다. 여기서는 뷰모델이 하는 대로 판정을 이어 붙여
 * 순서 전체를 본다(`MainViewModel` 은 단위 테스트에서 세울 수 없다 — `EntryRefreshKeepsTokenTest` 와 같은 사정).
 * 뷰모델이 그 판정을 실제로 쓰는지는 아래 배선 테스트가 소스로 본다.
 */
class MarketingConsentWritesTest {

    /** 뷰모델의 순서 그대로 — 끝날 때마다 판정하고, [MarketingConsentNext.Send] 면 그 값으로 다음 쓰기를 보낸다. */
    private fun run(
        initial: Boolean,
        first: Boolean,
        queuedDuringFirst: Boolean?,
        outcomes: List<Boolean>,
    ): MarketingConsentNext.Settle {
        var sent = first
        var rollbackTo: Boolean? = initial
        var queued = queuedDuringFirst
        for (succeeded in outcomes) {
            when (val next = marketingConsentAfterWrite(sent, rollbackTo, succeeded, queued)) {
                is MarketingConsentNext.Settle -> return next
                is MarketingConsentNext.Send -> {
                    sent = next.agreed
                    rollbackTo = next.rollbackTo
                    queued = null
                }
            }
        }
        error("쓰기 결과가 모자라다 — 판정이 아직 이어 보내는 중이다")
    }

    @Test
    fun 켬이_저장된_뒤_이어_보낸_끔이_실패하면_스위치는_켬으로_돌아간다() {
        // 제보 그대로: 끔 → 켬(첫 저장 진행 중) → 끔(예약) → 첫 저장 성공(서버 켬) → 두 번째 저장 실패.
        val settled = run(initial = false, first = true, queuedDuringFirst = false, outcomes = listOf(true, false))

        assertEquals("서버는 켬이다 — 스위치도 켬이어야 한다", true, settled.shown)
        assertTrue("스위치가 되돌아간 이유를 알린다", settled.failed)
    }

    @Test
    fun 끔이_저장된_뒤_이어_보낸_켬이_실패하면_스위치는_끔으로_돌아간다() {
        val settled = run(initial = true, first = false, queuedDuringFirst = true, outcomes = listOf(true, false))

        assertEquals(false, settled.shown)
        assertTrue(settled.failed)
    }

    @Test
    fun 이어_보낸_쓰기가_성공하면_마지막에_누른_값이다() {
        val settled = run(initial = false, first = true, queuedDuringFirst = false, outcomes = listOf(true, true))

        assertEquals(false, settled.shown)
        assertFalse(settled.failed)
    }

    @Test
    fun 이어_보낼_때_되돌릴_값은_방금_저장된_값이다() {
        val next = marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = true, queued = false)

        assertEquals(MarketingConsentNext.Send(agreed = false, rollbackTo = true), next)
    }

    @Test
    fun 첫_쓰기가_실패했고_마지막_값이_서버_값과_같으면_보내지도_알리지도_않는다() {
        // 켬(실패) 사이에 다시 끔 — 서버는 처음부터 끔이라 사용자가 고른 대로다.
        val next = marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = false, queued = false)

        assertEquals(MarketingConsentNext.Settle(shown = false, failed = false), next)
    }

    @Test
    fun 첫_쓰기가_실패했고_마지막_값이_서버_값과_다르면_다시_보낸다() {
        // 켬(실패) 사이에 끔 → 켬 — 마지막 값(켬)이 서버(끔)에 없다.
        val next = marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = false, queued = true)

        assertEquals(MarketingConsentNext.Send(agreed = true, rollbackTo = false), next)
    }

    @Test
    fun 마지막_값이_방금_저장된_값과_같으면_더_보내지_않는다() {
        // 켬(성공) 사이에 끔 → 켬.
        val next = marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = true, queued = true)

        assertEquals(MarketingConsentNext.Settle(shown = true, failed = false), next)
    }

    @Test
    fun 혼자_보낸_쓰기는_성공하면_그_값_실패하면_보내기_전_값이다() {
        assertEquals(
            MarketingConsentNext.Settle(shown = true, failed = false),
            marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = true, queued = null),
        )
        assertEquals(
            MarketingConsentNext.Settle(shown = false, failed = true),
            marketingConsentAfterWrite(sent = true, rollbackTo = false, succeeded = false, queued = null),
        )
    }

    // ── 배선 — 뷰모델이 판정을 실제로 쓰는가 ────────────────────────────────

    private val authActions = withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt"))

    @Test
    fun 이어_보내는_쓰기는_판정이_준_되돌릴_값을_쓴다() {
        val send = functionBody(authActions, "private fun MainViewModel.sendMarketingConsent(")

        assertTrue("쓰기가 끝나면 판정을 묻는다", send.contains("marketingConsentAfterWrite("))
        assertTrue(
            "이어 보낼 때 되돌릴 값은 판정이 준 서버 값이다 — 화면 값(marketingConsentAgreed)을 다시 잡지 않는다",
            send.contains("sendMarketingConsent(next.agreed, next.rollbackTo)"),
        )
        assertFalse(
            "쓰기 안에서 토글 진입점을 다시 부르면 되돌릴 값이 화면 값으로 바뀐다",
            send.contains("updateMarketingConsent("),
        )
    }

    @Test
    fun 쓰는_동안에는_조회하지_않는다() {
        val load = functionBody(authActions, "internal fun MainViewModel.loadMarketingConsent(")

        assertTrue(load.contains("if (marketingConsentWriteInFlight) return"))
    }

    @Test
    fun 계정이_바뀌면_예약한_값을_버린다() {
        val viewModel = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        val clear = functionBody(viewModel, "fun clearUserScopedRemoteState(")

        assertTrue(
            "앞 계정에서 누른 값이 다음 계정의 첫 쓰기 뒤에 그 계정으로 나가면 안 된다",
            clear.contains("pendingMarketingConsent = null"),
        )
    }
}
