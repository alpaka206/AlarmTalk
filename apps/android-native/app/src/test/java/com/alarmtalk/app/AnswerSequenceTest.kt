package com.alarmtalk.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **겹쳐 떠난 조회의 늦은 답이 새 상태를 덮지 않는다**(`AnswerSequence`, 2026-10-29). 결제 탭 진입 조회가 느린 사이 해지하면
 * 해지 뒤 재조회가 먼저 실리고, 늦게 온 진입 조회가 '이용 중'·해지 버튼으로 되돌렸다.
 */
class AnswerSequenceTest {
    @Test
    fun 나중에_떠난_답이_실린_뒤에는_앞서_떠난_답을_버린다() {
        val answers = AnswerSequence()
        val entry = answers.begin()
        val afterCancel = answers.begin()
        assertTrue(answers.isCurrent(afterCancel))
        answers.markApplied(afterCancel)
        assertFalse("해지 전에 떠난 조회가 '이용 중' 으로 되돌리면 안 된다", answers.isCurrent(entry))
    }

    @Test
    fun 나중_답이_실패해_안_실렸으면_앞서_떠난_답은_실린다() {
        val answers = AnswerSequence()
        val entry = answers.begin()
        answers.begin() // 실패했다 — 실리지 않는다
        assertTrue(answers.isCurrent(entry))
    }

    @Test
    fun 결제_화면은_답을_싣기_전에_순번을_본다() {
        val billing = withoutLineComments(readSource("ui/main/MainViewModelBillingActions.kt"))
        val apply = functionBody(billing, "private fun MainViewModel.applySubscriptionResponse(")
        val check = apply.indexOf("if (!billingAnswers.isCurrent(answerSeq)) return")
        val save = apply.indexOf("saveSubscriptionSnapshot(")
        assertTrue("스냅샷을 적기 전에 버린다", check in 0 until save)
        assertTrue(apply.contains("billingAnswers.markApplied(answerSeq)"))
        assertTrue(Regex("""val answerSeq = billingAnswers\.begin\(\)""").findAll(billing).count() == 2)
    }
}
