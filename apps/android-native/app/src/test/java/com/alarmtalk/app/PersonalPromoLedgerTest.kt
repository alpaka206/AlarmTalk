package com.alarmtalk.app

import com.alarmtalk.app.network.PersonalPromo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * 기간 한정 개인 플랜의 **진입별 장부**(`PersonalPromoLedger`) — `MainViewModel` 이 그대로 위임하는
 * 상태 규칙들. 순수 판정(`decidePersonalPromoEndNotice` 등)은 `PersonalPromoNoticeTest` 가 보고,
 * 여기서는 **상태를 거쳐야만 드러나는 것**을 본다:
 *
 * - 늦게 도착한 옛 계정 응답이 새 응답을 덮지 않는다(순번) — 종료 안내와 plan 쓰기 둘 다.
 * - 계정이 바뀌면 떠 있던 요청의 응답·실패가 새 계정에 새지 않는다(순번 앞지르기).
 * - 이 진입의 **첫 결과**가 판정을 끝낸다 — 실패가 먼저면 같은 진입의 뒤 성공으로 띄우지 않는다(D11).
 * - 다른 창에 밀려 걷힌 안내는 **같은 진입 안에서** 다시 뜬다(이펙트의 갈래 `evaluateEndNotice`).
 * - 전경 무료 잠금의 오프라인 차단 갈래는 이 진입의 plan 반영을 기다린다(이펙트의 갈래
 *   `foregroundPlanLockAction`·`deferredPromoLapseLockDue`).
 * - 이용권 화면 한 줄은 **나중에 받은 답**을 따른다.
 *
 * 날짜는 전부 테스트 픽스처다 — 앱 코드에는 없다.
 */
class PersonalPromoLedgerTest {

    private val endsAt = "2026-10-31T15:00:00Z"
    private val noticeFrom = "2026-10-24T15:00:00Z"
    private val promo = PersonalPromo(endsAt = endsAt, noticeFrom = noticeFrom)
    private val inNoticeWindow = Instant.parse(noticeFrom).toEpochMilli() + 60_000L
    private val beforeNoticeWindow = Instant.parse(noticeFrom).toEpochMilli() - 60_000L

    /** 진입 번호를 손으로 움직이는 장부. */
    private class Harness {
        var entry = 1L
        val ledger = PersonalPromoLedger(currentEntry = { entry })
    }

    private fun answered(entry: Long) = AccountEntryAnswer(entry, AccountEntryAnswer.Outcome.Answered)

    private fun failed(entry: Long) = AccountEntryAnswer(entry, AccountEntryAnswer.Outcome.Failed)

    // ── 계정 응답의 순번 ──────────────────────────────────────────────────────────

    @Test
    fun aLateAnswerToAnOlderRequestIsDropped() {
        val h = Harness()
        val older = h.ledger.beginAccountRequest()
        val newer = h.ledger.beginAccountRequest()
        // 새 요청이 먼저 돌아왔다 — 방금 쿠폰을 등록해 promo 가 없다.
        assertTrue(h.ledger.recordAccountAnswer(newer, promo = null, nowMillis = inNoticeWindow))
        // 옛 요청(쿠폰 등록 전)의 응답이 늦게 도착했다 — 버린다. 적으면 결제한 사람에게 "곧 끝나요" 가 뜬다.
        assertFalse(h.ledger.recordAccountAnswer(older, promo = promo, nowMillis = inNoticeWindow))
        assertNull(h.ledger.latestAccountPromo)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    @Test
    fun anAccountSwitchBumpsTheSequenceSoInFlightAnswersAreDropped() {
        val h = Harness()
        // 계정 A 의 `/auth/me` 가 떠 있다.
        val fromA = h.ledger.beginAccountRequest()
        h.ledger.resetForAccountSwitch()
        // A 의 응답이 B 로 바뀐 뒤에 도착했다 — B 의 장부에 적으면 안 된다.
        assertFalse(h.ledger.recordAccountAnswer(fromA, promo = promo, nowMillis = inNoticeWindow))
        assertNull(h.ledger.latestAccountPromo)
        assertNull(h.ledger.accountEntryAnswer)
        // 전환 뒤에 뜬 B 의 요청은 통과한다(앞지른 순번과 같은 순번을 받는다).
        val fromB = h.ledger.beginAccountRequest()
        assertTrue(h.ledger.recordAccountAnswer(fromB, promo = promo, nowMillis = inNoticeWindow))
        assertEquals(promo, h.ledger.latestAccountPromo)
        assertEquals(answered(1), h.ledger.accountEntryAnswer)
    }

    @Test
    fun anAccountSwitchClearsTheShownNoticeAndThePlanAnswer() {
        val h = Harness()
        val request = h.ledger.beginAccountRequest()
        h.ledger.recordAccountAnswer(request, promo, inNoticeWindow)
        h.ledger.recordPlanApplied(request)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)

        h.ledger.resetForAccountSwitch()
        assertNull(h.ledger.shownEndNotice)
        assertEquals(0L, h.ledger.planAnsweredEntry)
        // 새 계정은 이번 진입에서 자기 기준으로 한 번 판정받는다 — 응답이 오면 뜬다.
        val next = h.ledger.beginAccountRequest()
        h.ledger.recordAccountAnswer(next, promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun anAnswerSentInAnEarlierEntryIsNotThisEntrysAnswer() {
        val h = Harness()
        h.entry = 2
        val sentBeforeBackground = h.ledger.beginAccountRequest()
        // 백그라운드를 건너 다음 진입(3)에 도착했다 — 그 사이 다른 기기에서 결제했을 수 있다.
        h.entry = 3
        h.ledger.recordAccountAnswer(sentBeforeBackground, promo, inNoticeWindow)
        assertEquals(promo, h.ledger.latestAccountPromo)
        assertNull(h.ledger.accountEntryAnswer)
        h.ledger.maybeShowEndNotice(entry = 3, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    // ── 이 진입의 첫 결과 — 실패도 이 진입의 판정을 끝낸다(D11) ─────────────────────────────

    @Test
    fun aFailedFirstAnswerKeepsTheEntryQuietEvenAfterALaterSuccess() {
        val h = Harness()
        h.entry = 3
        // 진입 갱신이 실패했다(오프라인). 그때는 아직 동의 확인 중이라 게이트가 닫혀 있었다.
        assertTrue(h.ledger.recordAccountFailure(h.ledger.beginAccountRequest()))
        h.ledger.evaluateEndNotice(gatesReady = false, entry = 3, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        // 같은 진입에서 쿠폰·`plan_changed` 뒤의 갱신이 성공했다 — 값은 받지만 첫 결과는 그대로 실패다.
        assertTrue(h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow))
        assertEquals(promo, h.ledger.latestAccountPromo)
        assertEquals("첫 결과만 적는다", failed(3), h.ledger.accountEntryAnswer)
        // 게이트가 열렸다 — 세션 한가운데서 안내를 띄우지 않는다.
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 3, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        // 다음 진입은 다시 판정한다.
        h.entry = 4
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        assertEquals(answered(4), h.ledger.accountEntryAnswer)
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 4, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun aLaterFailureDoesNotUndoTheEntrysFirstAnswer() {
        val h = Harness()
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        // 같은 진입의 다음 갱신(결제 신호 뒤)이 실패했다 — 이 진입의 첫 결과는 이미 성공이다.
        assertTrue(h.ledger.recordAccountFailure(h.ledger.beginAccountRequest()))
        assertEquals(answered(1), h.ledger.accountEntryAnswer)
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun aFailureOfTheDepartingAccountsRequestDoesNotEndTheNewAccountsEntry() {
        val h = Harness()
        val fromA = h.ledger.beginAccountRequest()
        h.ledger.resetForAccountSwitch()
        // A 의 요청이 B 로 바뀐 뒤에 실패했다 — B 의 진입을 끝내면 안 된다.
        assertFalse(h.ledger.recordAccountFailure(fromA))
        assertNull(h.ledger.accountEntryAnswer)
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun aFailureOfARequestSentInAnEarlierEntryIsNotThisEntrysResult() {
        val h = Harness()
        h.entry = 2
        val sentBeforeBackground = h.ledger.beginAccountRequest()
        // 백그라운드를 건너 다음 진입(3)에 실패가 도착했다 — 이 진입의 결과가 아니다.
        h.entry = 3
        h.ledger.recordAccountFailure(sentBeforeBackground)
        assertNull(h.ledger.accountEntryAnswer)
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 3, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    // ── plan 쓰기 — 늦게 온 옛 `/auth/me` 가 새 plan 을 되돌리지 않는다 ─────────────────────

    @Test
    fun aLateEntryRefreshDoesNotOverwriteANewerPlanAnswer() {
        val h = Harness()
        // 진입 갱신이 떠 있는 동안 쿠폰 뒤의 갱신이 나갔다.
        val entryRefresh = h.ledger.beginAccountRequest()
        val afterCoupon = h.ledger.beginAccountRequest()
        // 쿠폰 뒤의 갱신이 먼저 돌아와 plan 을 썼다(가족 · 프로모 없음).
        assertTrue(h.ledger.claimPlanAnswer(afterCoupon))
        h.ledger.recordPlanApplied(afterCoupon)
        assertEquals(1L, h.ledger.planAnsweredEntry)
        // 진입 갱신의 옛 `plus` · 프로모가 뒤에 왔다 — 세션·스냅샷에 쓰지 않는다. 쓰면 프로모 표지가
        // 되살아나 보류 규칙(D9)이 방금 가족이 된 사람의 가족 기능을 닫는다.
        assertFalse(h.ledger.claimPlanAnswer(entryRefresh))
    }

    @Test
    fun aSupersededPlanAnswerNeverMarksTheEntrysPlan() {
        val h = Harness()
        val older = h.ledger.beginAccountRequest()
        val newer = h.ledger.beginAccountRequest()
        // 새 답이 plan 을 차지했지만 스냅샷 쓰기가 문에서 거절돼 이 진입의 plan 표시가 서지 않았다.
        assertTrue(h.ledger.claimPlanAnswer(newer))
        // 옛 답이 그 자리를 대신 채우면 옛 plan 으로 전경 잠금 대기가 풀린다.
        assertFalse(h.ledger.claimPlanAnswer(older))
        h.ledger.recordPlanApplied(older)
        assertEquals(0L, h.ledger.planAnsweredEntry)
    }

    @Test
    fun aNewerAccountStatusAnswerDoesNotBlockTheRefreshsPlanWrite() {
        val h = Harness()
        val refresh = h.ledger.beginAccountRequest() // `refreshAppSessionNow` — plan 을 쓴다
        val status = h.ledger.beginAccountRequest() // `checkAccountStatus` — plan 을 쓰지 않는다
        assertTrue(h.ledger.recordAccountAnswer(status, promo, inNoticeWindow))
        // 진입 갱신은 종료 안내에는 옛 답이지만, plan 에는 여전히 가장 새 답이다 — 버리면 세션에
        // 지난 실행의 plan 이 남고, 이 진입의 plan 표시도 영영 서지 않는다.
        assertTrue(h.ledger.claimPlanAnswer(refresh))
        assertFalse(h.ledger.recordAccountAnswer(refresh, promo = null, nowMillis = inNoticeWindow))
        assertEquals(promo, h.ledger.latestAccountPromo)
        h.ledger.recordPlanApplied(refresh)
        assertEquals(1L, h.ledger.planAnsweredEntry)
    }

    @Test
    fun anAccountSwitchAlsoBumpsThePlanSequence() {
        val h = Harness()
        val fromA = h.ledger.beginAccountRequest()
        h.ledger.resetForAccountSwitch()
        assertFalse(h.ledger.claimPlanAnswer(fromA))
        assertTrue(h.ledger.claimPlanAnswer(h.ledger.beginAccountRequest()))
    }

    // ── 종료 안내 ─────────────────────────────────────────────────────────────────

    @Test
    fun theNoticeWaitsBehindAnotherWindowAndReturnsWhenItCloses() {
        val h = Harness()
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        // 목소리 등록 창이 열려 있다 — 판정하지 않는다(진입을 끝내지도 않는다).
        h.ledger.evaluateEndNotice(gatesReady = false, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        // 닫혔다 — 뜬다.
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
        // 떠 있는 위로 시스템 권한 창이 올라왔다 — 걷는다.
        h.ledger.evaluateEndNotice(gatesReady = false, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        // 권한 창이 닫혔다 — 같은 진입에서 다시 뜬다.
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
        // '확인' 으로 닫았다 — 이 진입에서는 다시 뜨지 않는다.
        h.ledger.dismissEndNotice()
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    @Test
    fun aClosedGateDoesNotEndTheEntry() {
        val h = Harness()
        // 게이트가 닫힌 채 여러 번 돌아도 판정을 소진하지 않는다 — 응답·게이트가 갖춰지면 뜬다.
        h.ledger.evaluateEndNotice(gatesReady = false, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.evaluateEndNotice(gatesReady = false, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        h.ledger.evaluateEndNotice(gatesReady = true, entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun aNoticeDeferredForAnotherWindowShowsAgainInTheSameEntry() {
        val h = Harness()
        h.entry = 4
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 4, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)

        // 목소리 등록 창·권한 창이 위로 올라왔다 — 안내를 걷고 기다린다.
        h.ledger.deferEndNotice()
        assertNull(h.ledger.shownEndNotice)
        // 그 창이 닫혔다 — 같은 진입(4)인데 다시 뜬다. 걷은 안내를 '띄운 것' 으로 세면 이 진입에 영영 안 뜬다.
        h.ledger.maybeShowEndNotice(entry = 4, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun aConfirmedNoticeDoesNotReturnInTheSameEntryButDoesInTheNext() {
        val h = Harness()
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.dismissEndNotice())
        assertNull(h.ledger.shownEndNotice)
        // 화면을 옮겨 다니며 효과가 다시 돌아도 같은 진입에서는 한 번뿐이다.
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        // 백그라운드에서 돌아왔다 — 새 진입의 새 응답이 오면 다시 뜬다.
        h.entry = 2
        h.ledger.maybeShowEndNotice(entry = 2, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull("새 응답 전에는 판정하지 않는다", h.ledger.shownEndNotice)
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 2, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
    }

    @Test
    fun anEntryWithNothingToShowStaysQuietForTheRestOfTheEntry() {
        val h = Harness()
        // 이 진입의 답이 왔는데 안내 기간 전이다 — 이 진입의 판정은 끝났다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, beforeNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = beforeNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
        // 같은 진입에서 앱을 켜 둔 채 안내 기간에 들어섰다 — 진입이 아닌 순간에 튀어나오지 않는다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    @Test
    fun aShownNoticeClosesWhenTheNextAnswerDropsThePromo() {
        val h = Harness()
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo, inNoticeWindow)
        h.ledger.maybeShowEndNotice(entry = 1, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.shownEndNotice)
        // 안내가 떠 있는 동안 쿠폰을 등록했다 → 결제 뒤 갱신에 promo 가 없다 → 닫는다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    // ── 전경 무료 잠금 — 오프라인 차단 갈래는 이 진입의 plan 을 기다린다 ────────────────────

    @Test
    fun planAnswerCountsOnlyForTheEntryItWasSentAndAppliedIn() {
        val h = Harness()
        h.entry = 5
        val stale = h.ledger.beginAccountRequest()
        h.entry = 6
        h.ledger.recordPlanApplied(stale)
        assertEquals(0L, h.ledger.planAnsweredEntry)
        val fresh = h.ledger.beginAccountRequest()
        h.ledger.recordPlanApplied(fresh)
        assertEquals(6L, h.ledger.planAnsweredEntry)
    }

    @Test
    fun theAccountStatusCheckAloneDoesNotReleaseThePromoLapseLock() {
        val h = Harness()
        // `checkAccountStatus` 는 계정 응답을 적지만 plan 은 건드리지 않는다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = null, nowMillis = inNoticeWindow)
        assertEquals(answered(1), h.ledger.accountEntryAnswer)
        assertFalse(
            freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = h.ledger.planAnsweredEntry, entry = 1),
        )
        // plan 까지 반영된 뒤에만 건다.
        h.ledger.recordPlanApplied(h.ledger.beginAccountRequest())
        assertTrue(
            freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = h.ledger.planAnsweredEntry, entry = 1),
        )
    }

    @Test
    fun onlyThePromoLapseBranchWaits() {
        // 서버가 무료라고 한 무료·구독 만료는 예전 그대로 곧바로 잠근다.
        assertTrue(freePlanLockMayApply(freeOnlyByPromoLapse = false, planAnsweredEntry = 0, entry = 3))
        // 오프라인 차단 때문만인 무료는 이 진입의 plan 반영 전에는 잠그지 않는다.
        assertFalse(freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = 0, entry = 3))
        assertFalse(freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = 2, entry = 3))
        assertTrue(freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = 3, entry = 3))
        // 진입 전(0)은 어느 진입의 답도 아니다.
        assertFalse(freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = 0, entry = 0))
    }

    @Test
    fun theForegroundLockEffectFollowsTheBranchOrder() {
        fun action(
            signedIn: Boolean = true,
            definitelyFree: Boolean = false,
            subscriptionRowAlive: Boolean = false,
            freeOnlyByPromoLapse: Boolean = false,
            planAnsweredEntry: Long = 0L,
            entry: Long = 2L,
            paidEntitled: Boolean = false,
            billingNotEntitled: Boolean = false,
        ) = foregroundPlanLockAction(
            signedIn = signedIn,
            definitelyFree = definitelyFree,
            subscriptionRowAlive = subscriptionRowAlive,
            freeOnlyByPromoLapse = freeOnlyByPromoLapse,
            planAnsweredEntry = planAnsweredEntry,
            entry = entry,
            paidEntitled = paidEntitled,
            billingNotEntitled = billingNotEntitled,
        )
        // 서버가 무료라고 한 무료는 곧바로 잠근다.
        assertEquals(ForegroundPlanLockAction.Lock, action(definitelyFree = true))
        // 살아 있는 구독 행(결제 보류)이 있으면 되돌릴 수 없는 잠금을 걸지 않는다.
        assertEquals(ForegroundPlanLockAction.None, action(definitelyFree = true, subscriptionRowAlive = true))
        // 무료의 근거가 낡은 프로모 하나면 이 진입의 plan 반영까지 기다린다 — 그동안 plan 재조회
        // (토큰을 굴린다)도 타지 않는다.
        assertEquals(
            ForegroundPlanLockAction.WaitForEntryPlan,
            action(definitelyFree = true, freeOnlyByPromoLapse = true, planAnsweredEntry = 1L, billingNotEntitled = true),
        )
        assertEquals(
            ForegroundPlanLockAction.Lock,
            action(definitelyFree = true, freeOnlyByPromoLapse = true, planAnsweredEntry = 2L),
        )
        // 유료 확정이면 잠근 것을 되돌린다.
        assertEquals(ForegroundPlanLockAction.Restore, action(paidEntitled = true))
        // 구독 응답은 무권한인데 plan 이 아직 유료일 수 있다 — plan 을 다시 받는다.
        assertEquals(ForegroundPlanLockAction.RefreshPlan, action(billingNotEntitled = true))
        // 로그인 전이면 아무것도 하지 않는다.
        assertEquals(ForegroundPlanLockAction.None, action(signedIn = false, definitelyFree = true, paidEntitled = true))
        assertEquals(ForegroundPlanLockAction.None, action())
    }

    @Test
    fun theDeferredLockAppliesOnlyOnceThisEntrysPlanIsIn() {
        fun due(
            signedIn: Boolean = true,
            planAnsweredEntry: Long = 2L,
            entry: Long = 2L,
            freeOnlyByPromoLapse: Boolean = true,
            definitelyFree: Boolean = true,
            subscriptionRowAlive: Boolean = false,
        ) = deferredPromoLapseLockDue(
            signedIn = signedIn,
            planAnsweredEntry = planAnsweredEntry,
            entry = entry,
            freeOnlyByPromoLapse = freeOnlyByPromoLapse,
            definitelyFree = definitelyFree,
            subscriptionRowAlive = subscriptionRowAlive,
        )
        // 이 진입의 답이 plan 에 들어왔는데 여전히 낡은 프로모 하나로 무료다 — 이제 건다.
        assertTrue(due())
        // 답이 plan 을 유료로 되돌렸다(다른 기기에서 쿠폰·결제·가족 합류).
        assertFalse(due(definitelyFree = false))
        // 무료의 근거가 서버의 `free` 로 바뀌었다 — 위 이펙트가 이미 곧바로 처리한다.
        assertFalse(due(freeOnlyByPromoLapse = false))
        // 앞 진입의 답이다.
        assertFalse(due(planAnsweredEntry = 1L))
        // 진입 전(0 = 0)은 어느 진입의 답도 아니다.
        assertFalse(due(planAnsweredEntry = 0L, entry = 0L))
        // 살아 있는 구독 행(결제 보류) · 로그인 전.
        assertFalse(due(subscriptionRowAlive = true))
        assertFalse(due(signedIn = false))
    }

    // ── 이용권 화면 한 줄 — 나중에 받은 답이 이긴다 ───────────────────────────────────────

    @Test
    fun aFreshAccountAnswerWithoutPromoHidesAStaleBillingPromo() {
        val h = Harness()
        // 저장본만 있다(이번 실행에서 아직 아무것도 못 받았다) — 예전처럼 살아 있는 쪽을 보인다.
        assertEquals(promo, h.ledger.planScreenPromo(sessionPromo = promo, billingPromo = promo, nowMillis = inNoticeWindow))
        // 방금 쿠폰을 등록했다 → 새 계정 응답에 promo 가 없다. 구독 응답은 결제 전 캐시 그대로다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.planScreenPromo(sessionPromo = promo, billingPromo = promo, nowMillis = inNoticeWindow))
    }

    @Test
    fun aFresherBillingAnswerWins() {
        val h = Harness()
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = promo, nowMillis = inNoticeWindow)
        // 문이 거절한 구독 응답(그 사이 계정 전환)은 화면에 없다 — 순서에 넣지 않는다.
        h.ledger.recordBillingAnswer(EntitlementWrite.Superseded)
        assertEquals(promo, h.ledger.planScreenPromo(sessionPromo = null, billingPromo = null, nowMillis = inNoticeWindow))
        // 그 뒤 구독 응답을 새로 받았다 — 그 사이 결제가 반영돼 promo 가 없다.
        h.ledger.recordBillingAnswer(EntitlementWrite.Applied)
        assertNull(h.ledger.planScreenPromo(sessionPromo = promo, billingPromo = null, nowMillis = inNoticeWindow))
        // 다시 계정 응답이 더 새로우면 그쪽이다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = promo, nowMillis = inNoticeWindow)
        assertEquals(promo, h.ledger.planScreenPromo(sessionPromo = null, billingPromo = null, nowMillis = inNoticeWindow))
    }

    @Test
    fun theLatestAccountAnswerIsUsedNotTheStoredSession() {
        val h = Harness()
        // 계정 응답을 받았으면 저장된 세션의 promo(지난 실행)는 보지 않는다.
        h.ledger.recordAccountAnswer(h.ledger.beginAccountRequest(), promo = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.planScreenPromo(sessionPromo = promo, billingPromo = null, nowMillis = inNoticeWindow))
        // 계정이 바뀌면 순서를 잊는다 — 새 계정의 저장본부터 다시 본다.
        h.ledger.resetForAccountSwitch()
        assertEquals(promo, h.ledger.planScreenPromo(sessionPromo = promo, billingPromo = null, nowMillis = inNoticeWindow))
    }

    @Test
    fun planScreenLineIgnoresEndedPromos() {
        val end = Instant.parse(endsAt).toEpochMilli()
        assertNull(planScreenPersonalPromoOf(promo, 2, promo, 1, end))
        assertNull(planScreenPersonalPromoOf(promo, 0, promo, 0, end))
        assertEquals(promo, planScreenPersonalPromoOf(null, 1, promo, 2, end - 1))
        assertNull(planScreenPersonalPromoOf(null, 2, promo, 1, end - 1))
    }
}
