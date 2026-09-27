package com.alarmtalk.app

import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.PersonalPromo
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 기간 한정 개인 플랜 **종료 안내**의 판정 — 기간·'다시 보지 않기'·진입당 한 번·준비 신호.
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
    fun lastDayIsTheDayBeforeTheExclusiveEnd() {
        // 2026-11-01 00:00 KST(배타) → "10월 31일까지", "11월 1일부터".
        val seoul = ZoneId.of("Asia/Seoul")
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoLastDay(promo, seoul))
        assertEquals(LocalDate.of(2026, 11, 1), personalPromoFreeFromDay(promo, seoul))
        // 다른 시간대 기기는 그 기기의 날짜로 읽는다 — 날짜를 앱에 박지 않는 이유다.
        val utc = ZoneId.of("UTC")
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoLastDay(promo, utc))
        assertEquals(LocalDate.of(2026, 10, 31), personalPromoFreeFromDay(promo, utc))
        assertNull(personalPromoLastDay(PersonalPromo(endsAt = "nope"), seoul))
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
            "다른 모달" to allClear.copy(otherModalOpen = true),
        )
        blocked.forEach { (label, gates) -> assertFalse(label, gates.ready()) }
    }

    @Test
    fun unknownPersonalPromoKeysAndAbsentFieldsParse() {
        // 구버전 서버(필드 없음)와 새 서버(필드 + 모르는 키) 모두 로그인이 깨지지 않아야 한다.
        val gson = Gson()
        val legacy = gson.fromJson("""{"id":"u","email":"e","plan":"free"}""", AuthUser::class.java)
        assertNull(legacy.personalPromo)
        val fresh = gson.fromJson(
            """{"id":"u","email":"e","plan":"plus","future_field":{"x":1},
                "personal_promo":{"ends_at":"$endsAt","notice_from":"$noticeFrom","extra":true}}""",
            AuthUser::class.java,
        )
        assertEquals("plus", fresh.plan)
        assertEquals(promo, fresh.personalPromo)
        val billing = gson.fromJson(
            """{"subscription":null,"plan":null,"personal_promo":null,"user_plan":"plus"}""",
            BillingSubscriptionResponse::class.java,
        )
        assertNull(billing.personalPromo)
        assertNull(billing.subscription)
    }
}
