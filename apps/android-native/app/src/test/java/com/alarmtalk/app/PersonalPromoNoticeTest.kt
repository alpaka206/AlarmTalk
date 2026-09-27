package com.alarmtalk.app

import com.alarmtalk.app.network.AuthMeResponse
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.PersonalPromo
import com.google.gson.Gson
import com.google.gson.stream.JsonToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.StringReader
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 기간 한정 개인 플랜 **종료 안내**의 판정 — 기간·'다시 보지 않기'·진입당 한 번·이 진입의
 * 새 응답·준비 신호·문구 갈래·관대한 파싱.
 *
 * 날짜는 전부 서버 값이다. 여기 쓴 시각은 테스트 픽스처일 뿐 앱 코드에는 없다.
 */
class PersonalPromoNoticeTest {

    private val endsAt = "2026-10-31T15:00:00Z"
    private val noticeFrom = "2026-10-24T15:00:00Z"
    private val promo = PersonalPromo(endsAt = endsAt, noticeFrom = noticeFrom)
    private val end = Instant.parse(endsAt).toEpochMilli()
    private val from = Instant.parse(noticeFrom).toEpochMilli()

    @Test
    fun noticeWindowIsNoticeFromInclusiveToEndExclusive() {
        assertFalse(isPersonalPromoEndNoticeDue(promo, from - 1, optedOutEndsAt = null))
        assertTrue(isPersonalPromoEndNoticeDue(promo, from, optedOutEndsAt = null))
        assertTrue(isPersonalPromoEndNoticeDue(promo, end - 1, optedOutEndsAt = null))
        // 종료 순간부터는 안내할 '곧' 이 없다 — 이미 끝났다.
        assertFalse(isPersonalPromoEndNoticeDue(promo, end, optedOutEndsAt = null))
    }

    @Test
    fun dontShowAgainIsBoundToThatEnd() {
        assertFalse(isPersonalPromoEndNoticeDue(promo, from, optedOutEndsAt = endsAt))
        // 서버가 기간을 늘리면 종료 시각이 바뀐다 — 새 종료는 한 번 더 알린다.
        assertTrue(isPersonalPromoEndNoticeDue(promo, from, optedOutEndsAt = "2026-10-15T15:00:00Z"))
    }

    @Test
    fun missingOrUnreadableDatesNeverShowTheNotice() {
        // 안내 기간(7일)을 앱이 지어내지 않는다 — notice_from 이 없으면 띄우지 않는다.
        assertFalse(isPersonalPromoEndNoticeDue(PersonalPromo(endsAt = endsAt), from, null))
        assertFalse(isPersonalPromoEndNoticeDue(PersonalPromo(endsAt = "soon", noticeFrom = noticeFrom), from, null))
        assertFalse(isPersonalPromoEndNoticeDue(null, from, null))
    }

    @Test
    fun lastDayIsTheDayBeforeTheExclusiveEndAndNextDayFollowsIt() {
        // 2026-11-01 00:00 KST(배타) → "10월 31일까지", "11월 1일부터".
        val seoul = ZoneId.of("Asia/Seoul")
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoLastDay(promo, seoul))
        assertEquals(LocalDate.of(2026, 11, 1), personalPromoFreeFromDay(promo, seoul))
        // 한국 밖 기기: `ends_at` 을 그대로 날짜로 바꾸면 두 날짜가 같은 날이 된다(UTC 10/31 15:00).
        // "…부터" 는 언제나 마지막 날의 **다음 날**이다.
        val utc = ZoneId.of("UTC")
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoLastDay(promo, utc))
        assertEquals(LocalDate.of(2026, 11, 1), personalPromoFreeFromDay(promo, utc))
        val losAngeles = ZoneId.of("America/Los_Angeles")
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoLastDay(promo, losAngeles))
        assertEquals(LocalDate.of(2026, 11, 1), personalPromoFreeFromDay(promo, losAngeles))
        assertNull(personalPromoLastDay(PersonalPromo(endsAt = "nope"), seoul))
        assertNull(personalPromoFreeFromDay(PersonalPromo(endsAt = "nope"), seoul))
    }

    @Test
    fun serverInstantsParseWithOrWithoutOffset() {
        assertEquals(end, parseServerInstantMillis(endsAt))
        assertEquals(end, parseServerInstantMillis("2026-10-31T15:00:00.000Z"))
        assertEquals(end, parseServerInstantMillis("2026-11-01T00:00:00+09:00"))
        assertNull(parseServerInstantMillis(""))
        assertNull(parseServerInstantMillis("2026-10-31"))
    }

    @Test
    fun activePromoPrefersTheSessionAndDropsEndedOnes() {
        val later = PersonalPromo(endsAt = "2026-11-30T15:00:00Z", noticeFrom = "2026-11-23T15:00:00Z")
        assertEquals(promo, activePersonalPromoOf(promo, later, from))
        // 세션 쪽이 끝났으면(앱을 켜 둔 채 종료) 구독 응답 쪽을 본다.
        assertEquals(later, activePersonalPromoOf(promo, later, end))
        assertNull(activePersonalPromoOf(promo, null, end))
        assertNull(activePersonalPromoOf(null, null, from))
    }

    @Test
    fun oneNoticePerAppEntry() {
        // 0 = 아직 진입 전(첫 ON_START 가 오면 1 이 된다) — 여기서 띄우면 같은 콜드 스타트에 두 번 뜬다.
        assertFalse(personalPromoNoticePendingForEntry(entry = 0, handledEntry = 0))
        assertTrue(personalPromoNoticePendingForEntry(entry = 1, handledEntry = 0))
        // 같은 진입에서 화면을 옮겨 다니며 효과가 다시 돌아도 한 번뿐이다.
        assertFalse(personalPromoNoticePendingForEntry(entry = 1, handledEntry = 1))
        // 백그라운드에서 돌아오면 새 진입이다.
        assertTrue(personalPromoNoticePendingForEntry(entry = 2, handledEntry = 1))
    }

    // ── 이 진입의 새 계정 응답 ─────────────────────────────────────────────────────

    @Test
    fun anAnswerCountsOnlyForTheEntryItWasRequestedAndReceivedIn() {
        assertEquals(3L, accountAnswerEntryFor(requestEntry = 3, currentEntry = 3))
        // 앞 진입에 보낸 요청이 백그라운드를 건너 늦게 도착했다 — 이번 진입의 새 응답이 아니다.
        assertNull(accountAnswerEntryFor(requestEntry = 2, currentEntry = 3))
        // 진입 전(콜드 스타트 ON_START 전)에 보낸 요청은 어느 진입의 몫도 아니다.
        assertNull(accountAnswerEntryFor(requestEntry = 0, currentEntry = 0))
        assertNull(accountAnswerEntryFor(requestEntry = 0, currentEntry = 1))
    }

    @Test
    fun decisionWaitsForThisEntrysFreshAnswer() {
        // 지난 진입(1)의 응답만 있다 — 이번 진입(2)은 새 응답을 기다린다. 판정을 소진하지 않는다.
        assertEquals(
            PersonalPromoNoticeDecision.NotNow,
            decidePersonalPromoEndNotice(
                entry = 2, handledEntry = 1, answeredEntry = 1,
                latestPromo = promo, nowMillis = from, optedOutEndsAt = null,
            ),
        )
        // 응답이 오면 뜬다.
        assertEquals(
            PersonalPromoNoticeDecision.Show(promo),
            decidePersonalPromoEndNotice(
                entry = 2, handledEntry = 1, answeredEntry = 2,
                latestPromo = promo, nowMillis = from, optedOutEndsAt = null,
            ),
        )
        // 같은 진입에서 이미 판정했으면 다시 띄우지 않는다.
        assertEquals(
            PersonalPromoNoticeDecision.NotNow,
            decidePersonalPromoEndNotice(
                entry = 2, handledEntry = 2, answeredEntry = 2,
                latestPromo = promo, nowMillis = from, optedOutEndsAt = null,
            ),
        )
    }

    @Test
    fun theFreshAnswerDecidesNotTheCachedSession() {
        // 그 사이 다른 기기에서 결제·쿠폰 → 새 응답에는 personal_promo 가 없다. 저장된 세션의
        // 옛 promo 로 띄우면 이미 결제한 사람에게 "곧 끝나요" 가 뜬다.
        assertEquals(
            PersonalPromoNoticeDecision.NothingToShow,
            decidePersonalPromoEndNotice(
                entry = 1, handledEntry = 0, answeredEntry = 1,
                latestPromo = null, nowMillis = from, optedOutEndsAt = null,
            ),
        )
        // 안내 기간 전이거나 '다시 보지 않기' 를 눌렀으면 이 진입은 띄울 것이 없다.
        assertEquals(
            PersonalPromoNoticeDecision.NothingToShow,
            decidePersonalPromoEndNotice(
                entry = 1, handledEntry = 0, answeredEntry = 1,
                latestPromo = promo, nowMillis = from - 1, optedOutEndsAt = null,
            ),
        )
        assertEquals(
            PersonalPromoNoticeDecision.NothingToShow,
            decidePersonalPromoEndNotice(
                entry = 1, handledEntry = 0, answeredEntry = 1,
                latestPromo = promo, nowMillis = from, optedOutEndsAt = endsAt,
            ),
        )
    }

    @Test
    fun aShownNoticeFollowsTheLatestAnswer() {
        // 떠 있는 동안 쿠폰을 등록해 원시 유료가 됐다 → 새 응답에 promo 없음 → 닫는다.
        assertNull(reconcileShownPersonalPromoNotice(showing = promo, latestPromo = null, nowMillis = from))
        // 종료 시각이 바뀌었다(연장) → 옛 날짜의 안내는 닫는다(다음 진입이 새 날짜로 판정).
        assertNull(
            reconcileShownPersonalPromoNotice(
                showing = promo,
                latestPromo = PersonalPromo(endsAt = "2026-11-30T15:00:00Z", noticeFrom = "2026-11-23T15:00:00Z"),
                nowMillis = from,
            ),
        )
        // 같은 종료면 새 값(문구 갈래가 바뀌었을 수 있다)으로 갈아 끼운다.
        val keepVoices = promo.copy(deletesVoicesAtEnd = false)
        assertEquals(keepVoices, reconcileShownPersonalPromoNotice(showing = promo, latestPromo = keepVoices, nowMillis = from))
        assertNull(reconcileShownPersonalPromoNotice(showing = null, latestPromo = promo, nowMillis = from))
    }

    // ── 준비 신호·차단 ────────────────────────────────────────────────────────────

    private val allClear = PersonalPromoNoticeGates(
        signedIn = true,
        versionChecked = true,
        updateRequired = false,
        consentUnsupported = false,
        accountStatusChecked = true,
        pendingDeletion = false,
        consentStatusChecked = true,
        showConsentScreen = false,
        stockReplacementChecked = true,
        stockReplacementPending = false,
        permissionGateOpen = false,
        showVoiceSetup = false,
        otherModalOpen = false,
        systemPermissionPromptOpen = false,
        activityResumed = true,
    )

    @Test
    fun noticeWaitsForEveryReadinessSignalAndBlockingGate() {
        assertTrue(allClear.ready())
        // 응답 전 기본값 false 는 '아니오' 가 아니다(`docs/spec/gates-and-overlays.md`).
        val blocked = listOf(
            "로그인 전" to allClear.copy(signedIn = false),
            "버전 응답 전" to allClear.copy(versionChecked = false),
            "강제 업데이트" to allClear.copy(updateRequired = true),
            "동의 미지원" to allClear.copy(consentUnsupported = true),
            "/auth/me 응답 전" to allClear.copy(accountStatusChecked = false),
            "탈퇴 유예" to allClear.copy(pendingDeletion = true),
            "동의 응답 전" to allClear.copy(consentStatusChecked = false),
            "동의 화면" to allClear.copy(showConsentScreen = true),
            "교체 판정 전" to allClear.copy(stockReplacementChecked = false),
            "교체 미완료" to allClear.copy(stockReplacementPending = true),
            "권한 게이트" to allClear.copy(permissionGateOpen = true),
            "목소리 받기 화면" to allClear.copy(showVoiceSetup = true),
            // 목소리 등록 창·시트·다른 알럿 — 문서 선택기에서 돌아온 진입에도 열려 있다.
            "다른 모달" to allClear.copy(otherModalOpen = true),
            // 우리가 띄운 시스템 권한 창(요청 ~ 결과) — 같은 프레임의 첫 권한 요청과 겹치지 않는다.
            "시스템 권한 창" to allClear.copy(systemPermissionPromptOpen = true),
            // 시스템 창·다른 앱의 창이 위에 있어 화면이 멈췄다.
            "화면이 RESUMED 아님" to allClear.copy(activityResumed = false),
        )
        blocked.forEach { (label, gates) -> assertFalse(label, gates.ready()) }
    }

    // ── 문구 갈래 ───────────────────────────────────────────────────────────────

    @Test
    fun voiceDeletionSentenceFollowsTheServerFlag() {
        // 종료 전환 대상이면(또는 이 키를 주지 않던 서버면) 삭제를 말한다.
        assertTrue(personalPromoDeletesVoicesAtEnd(promo))
        assertTrue(personalPromoDeletesVoicesAtEnd(promo.copy(deletesVoicesAtEnd = true)))
        // 대상이 아니면(결제 보류로 활성 구독 행이 남은 계정 등) 삭제를 말하지 않는다.
        assertFalse(personalPromoDeletesVoicesAtEnd(promo.copy(deletesVoicesAtEnd = false)))
    }

    // ── 파싱 — 표시용 필드 하나가 로그인을 깨면 안 된다 ────────────────────────────

    private val gson = Gson()

    /** Retrofit `GsonResponseBodyConverter` 와 같은 방식 — 끝까지 다 읽었는지도 본다. */
    private fun <T> parseLikeRetrofit(json: String, type: Class<T>): T {
        val reader = gson.newJsonReader(StringReader(json))
        val value = gson.getAdapter(type).read(reader)
        assertEquals(JsonToken.END_DOCUMENT, reader.peek())
        return value
    }

    @Test
    fun unknownPersonalPromoKeysAndAbsentFieldsParse() {
        // 구버전 서버(필드 없음)와 새 서버(필드 + 모르는 키) 모두 로그인이 깨지지 않아야 한다.
        val legacy = gson.fromJson("""{"id":"u","email":"e","plan":"free"}""", AuthUser::class.java)
        assertNull(legacy.personalPromo)
        val fresh = gson.fromJson(
            """{"id":"u","email":"e","plan":"plus","future_field":{"x":1},
                "personal_promo":{"ends_at":"$endsAt","notice_from":"$noticeFrom","extra":{"a":[1,2]},
                "deletes_voices_at_end":false}}""",
            AuthUser::class.java,
        )
        assertEquals("plus", fresh.plan)
        assertEquals(promo.copy(deletesVoicesAtEnd = false), fresh.personalPromo)
        val billing = gson.fromJson(
            """{"subscription":null,"plan":null,"personal_promo":null,"user_plan":"plus"}""",
            BillingSubscriptionResponse::class.java,
        )
        assertNull(billing.personalPromo)
        assertNull(billing.subscription)
    }

    @Test
    fun malformedPersonalPromoNeverFailsLoginMeOrBilling() {
        listOf("\"soon\"", "[]", "[{\"ends_at\":\"$endsAt\"}]", "42", "true").forEach { bad ->
            val login = parseLikeRetrofit(
                """{"token":"t","user":{"id":"u","email":"e","plan":"plus","personal_promo":$bad,
                    "name":"n"}}""",
                AuthTokenResponse::class.java,
            )
            assertEquals(bad, "plus", login.user.plan)
            assertEquals(bad, "n", login.user.name)
            assertNull(bad, login.user.personalPromo)

            val me = parseLikeRetrofit(
                """{"user":{"id":"u","email":"e","plan":"plus","personal_promo":$bad},"token":"t2"}""",
                AuthMeResponse::class.java,
            )
            assertNull(bad, me.user.personalPromo)
            assertEquals(bad, "t2", me.token)

            val billing = parseLikeRetrofit(
                """{"subscription":null,"personal_promo":$bad,"user_plan":"plus"}""",
                BillingSubscriptionResponse::class.java,
            )
            assertNull(bad, billing.personalPromo)
            assertEquals(bad, "plus", billing.userPlan)
        }
    }

    @Test
    fun wronglyTypedPromoFieldsAreDroppedOneByOne() {
        val parsed = gson.fromJson(
            """{"ends_at":"$endsAt","notice_from":17,"deletes_voices_at_end":"no"}""",
            PersonalPromo::class.java,
        )
        assertEquals(PersonalPromo(endsAt = endsAt, noticeFrom = null, deletesVoicesAtEnd = null), parsed)
        val noEnd = gson.fromJson("""{"ends_at":{"at":1},"notice_from":"$noticeFrom"}""", PersonalPromo::class.java)
        assertNull(noEnd.endsAt)
        // 끝을 모르는 프로모는 없는 것이다.
        assertNull(com.alarmtalk.app.network.normalizePersonalPromo(noEnd))
    }

    @Test
    fun computedAtParsesLenientlyAndIsDroppedOnNormalize() {
        val parsed = gson.fromJson(
            """{"ends_at":"$endsAt","notice_from":"$noticeFrom","computed_at":"2026-10-31T14:59:30Z"}""",
            PersonalPromo::class.java,
        )
        assertEquals("2026-10-31T14:59:30Z", parsed.computedAt)
        assertEquals(
            Instant.parse("2026-10-31T14:59:30Z").toEpochMilli(),
            planAnswerStampMillis(parsed, receivedAtMillis = 1L),
        )
        // 모양이 틀리면 그 필드만 없는 것이다 — 로그인이 깨지지 않는다.
        val wrongType = gson.fromJson(
            """{"ends_at":"$endsAt","computed_at":1790000000}""",
            PersonalPromo::class.java,
        )
        assertNull(wrongType.computedAt)
        assertEquals(1L, planAnswerStampMillis(wrongType, receivedAtMillis = 1L))
        // 저장·비교에 쓰는 모양에는 싣지 않는다 — 받는 자리에서 답의 시각으로 바뀐다.
        assertNull(com.alarmtalk.app.network.normalizePersonalPromo(parsed)?.computedAt)
        assertEquals(promo, com.alarmtalk.app.network.normalizePersonalPromo(parsed))
        // 캐시(구독 응답 스냅샷)는 그대로 왕복한다.
        assertEquals(parsed, gson.fromJson(gson.toJson(parsed), PersonalPromo::class.java))
    }

    @Test
    fun promoSurvivesTheSnapshotCacheRoundTrip() {
        val original = promo.copy(deletesVoicesAtEnd = false)
        assertEquals(original, gson.fromJson(gson.toJson(original), PersonalPromo::class.java))
        assertEquals(promo, gson.fromJson(gson.toJson(promo), PersonalPromo::class.java))
    }
}
