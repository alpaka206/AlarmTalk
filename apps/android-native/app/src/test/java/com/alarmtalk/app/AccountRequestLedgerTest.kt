package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 계정 요청의 **순번 장부**(`AccountRequestLedger`) — `MainViewModel` 이 그대로 위임하는 상태 규칙. 배선(쓰기보다 먼저
 * 잡는가)은 `EntryRefreshKeepsTokenTest` 가 소스로 본다. 여기서는 **상태를 거쳐야만 드러나는 것**을 본다:
 *
 * - 늦게 도착한 옛 `/auth/me` 가 더 새 plan 답을 되돌리지 않는다(순번).
 * - 밀린 답은 '이번 실행의 plan 답' 으로 세지 않는다.
 * - 계정이 바뀌면 떠 있던 요청의 답이 새 계정의 plan 에 새지 않는다(순번 앞지르기).
 */
class AccountRequestLedgerTest {

    @Test
    fun aLateEntryRefreshDoesNotOverwriteANewerPlanAnswer() {
        val ledger = AccountRequestLedger()
        // 진입 갱신이 떠 있는 동안 결제 뒤의 갱신이 나갔다.
        val entryRefresh = ledger.beginAccountRequest()
        val afterPurchase = ledger.beginAccountRequest()
        // 결제 뒤의 갱신이 먼저 돌아와 plan 을 썼다(유료).
        assertTrue(ledger.claimPlanAnswer(afterPurchase))
        ledger.recordPlanApplied(afterPurchase)
        assertTrue(ledger.planAnsweredThisRun)
        // 진입 갱신의 옛 `free` 가 뒤에 왔다 — 세션·스냅샷에 쓰지 않는다. 쓰면 방금 산 사람을 무료로 그린다.
        assertFalse(ledger.claimPlanAnswer(entryRefresh))
    }

    @Test
    fun aSupersededPlanAnswerNeverCountsAsThisRunsPlan() {
        val ledger = AccountRequestLedger()
        val older = ledger.beginAccountRequest()
        val newer = ledger.beginAccountRequest()
        // 새 답이 plan 을 차지했지만 스냅샷 쓰기가 문에서 거절돼 plan 반영 표시가 서지 않았다.
        assertTrue(ledger.claimPlanAnswer(newer))
        // 옛 답이 그 자리를 대신 채우면 옛 plan 으로 받았던 알람의 승격이 풀린다.
        assertFalse(ledger.claimPlanAnswer(older))
        ledger.recordPlanApplied(older)
        assertFalse(ledger.planAnsweredThisRun)
    }

    @Test
    fun anAnswerInTheSameOrderStillClaims() {
        val ledger = AccountRequestLedger()
        val first = ledger.beginAccountRequest()
        assertTrue(ledger.claimPlanAnswer(first))
        // 같은 순번은 밀린 답이 아니다 — 계정 전환의 앞지르기가 '같은 순번은 통과' 에 기댄다.
        assertTrue(ledger.claimPlanAnswer(first))
        val second = ledger.beginAccountRequest()
        assertTrue(ledger.claimPlanAnswer(second))
        assertEquals(second.seq, ledger.latestRequestSeq())
    }

    @Test
    fun anAccountSwitchBumpsThePlanSequenceAndForgetsThisRunsAnswer() {
        val ledger = AccountRequestLedger()
        val fromA = ledger.beginAccountRequest()
        assertTrue(ledger.claimPlanAnswer(fromA))
        ledger.recordPlanApplied(fromA)
        assertTrue(ledger.planAnsweredThisRun)

        val stillFlyingFromA = ledger.beginAccountRequest()
        ledger.resetForAccountSwitch()
        assertFalse("새 계정은 아직 서버 답을 받지 않았다", ledger.planAnsweredThisRun)
        // A 의 응답이 B 로 바뀐 뒤에 도착했다 — B 의 plan 에 쓰면 안 된다.
        assertFalse(ledger.claimPlanAnswer(stillFlyingFromA))
        // 전환 뒤에 뜬 B 의 요청은 통과한다(앞지른 순번과 같은 순번을 받는다).
        val fromB = ledger.beginAccountRequest()
        assertTrue(ledger.claimPlanAnswer(fromB))
        ledger.recordPlanApplied(fromB)
        assertTrue(ledger.planAnsweredThisRun)
    }

    @Test
    fun theFenceReadsTheLastTicketWithoutIssuingOne() {
        val ledger = AccountRequestLedger()
        assertEquals(0L, ledger.latestRequestSeq())
        val request = ledger.beginAccountRequest()
        assertEquals(request.seq, ledger.latestRequestSeq())
        // 울타리를 읽는 것만으로는 새 표가 뜨지 않는다 — 다음 요청은 바로 다음 순번이다.
        assertEquals(request.seq + 1, ledger.beginAccountRequest().seq)
    }
}
