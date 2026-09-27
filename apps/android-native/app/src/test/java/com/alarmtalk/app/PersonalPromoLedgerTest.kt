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
 * - 늦게 도착한 옛 계정 응답이 새 응답을 덮지 않는다(순번).
 * - 계정이 바뀌면 떠 있던 요청의 응답이 새 계정에 새지 않는다(순번 앞지르기).
 * - 다른 창에 밀려 걷힌 안내는 **같은 진입 안에서** 다시 뜬다.
 * - 전경 무료 잠금의 오프라인 차단 갈래는 이 진입의 plan 반영을 기다린다.
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
        assertEquals(0L, h.ledger.accountAnsweredEntry)
        // 전환 뒤에 뜬 B 의 요청은 통과한다(앞지른 순번과 같은 순번을 받는다).
        val fromB = h.ledger.beginAccountRequest()
        assertTrue(h.ledger.recordAccountAnswer(fromB, promo = promo, nowMillis = inNoticeWindow))
        assertEquals(promo, h.ledger.latestAccountPromo)
        assertEquals(1L, h.ledger.accountAnsweredEntry)
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
        assertEquals(0L, h.ledger.accountAnsweredEntry)
        h.ledger.maybeShowEndNotice(entry = 3, optedOutEndsAt = null, nowMillis = inNoticeWindow)
        assertNull(h.ledger.shownEndNotice)
    }

    // ── 종료 안내 ─────────────────────────────────────────────────────────────────

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
        assertEquals(1L, h.ledger.accountAnsweredEntry)
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
        // 그 뒤 구독 응답을 새로 받았다 — 그 사이 결제가 반영돼 promo 가 없다.
        h.ledger.recordBillingAnswer()
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
