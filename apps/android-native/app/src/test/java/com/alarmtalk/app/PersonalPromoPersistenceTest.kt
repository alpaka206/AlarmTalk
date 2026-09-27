package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.PersonalPromo
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.LocalDate
import java.util.Locale

/**
 * 기간 한정 개인 플랜 — 기기에 남는 것들.
 *
 * 1. 세션은 plan 과 `personal_promo` 를 **한 쌍으로** 저장하고, 없으면 지운다 — 남으면
 *    결제한 뒤에도 옛 종료 시각이 되살아나 진짜 유료 사용자가 그 시각에 잠긴다.
 * 2. '다시 보지 않기' 는 계정별·종료 시각별이다.
 * 3. 날짜는 기기 로케일로 월·일만 그린다(서버 값에서 만든다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PersonalPromoPersistenceTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val promo = PersonalPromo(endsAt = "2026-10-31T15:00:00Z", noticeFrom = "2026-10-24T15:00:00Z")

    @After
    fun deleteTestPrefs() {
        listOf("personal-promo-session-test", "alarmtalk_personal_promo_notice").forEach { name ->
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
            File(context.filesDir.parentFile, "shared_prefs/$name.xml").delete()
        }
    }

    private fun session(user: AuthUser) = AuthSession(
        token = "token-${user.id}",
        provider = AuthSessionStore.PROVIDER_APP,
        user = user,
    )

    @Test
    fun sessionKeepsPlanAndPromoTogetherAndClearsAStaleOne() {
        val store = AuthSessionStore(
            context.getSharedPreferences("personal-promo-session-test", Context.MODE_PRIVATE),
        )
        store.save(session(AuthUser(id = "u1", email = "u1@example.test", plan = "plus", personalPromo = promo)))
        val restored = store.read()
        assertEquals("plus", restored?.user?.plan)
        assertEquals(promo, restored?.user?.personalPromo)

        // 기간 중 쿠폰 등록 → 원시 유료가 되어 서버가 promo 를 더 주지 않는다.
        store.save(session(AuthUser(id = "u1", email = "u1@example.test", plan = "plus")))
        assertNull(store.read()?.user?.personalPromo)
    }

    @Test
    fun promoWithoutEndIsDropped() {
        val store = AuthSessionStore(
            context.getSharedPreferences("personal-promo-session-test", Context.MODE_PRIVATE),
        )
        store.save(
            session(
                AuthUser(
                    id = "u1",
                    email = "u1@example.test",
                    plan = "plus",
                    personalPromo = PersonalPromo(endsAt = " ", noticeFrom = "2026-10-24T15:00:00Z"),
                ),
            ),
        )
        assertNull(store.read()?.user?.personalPromo)
    }

    @Test
    fun dontShowAgainIsPerAccountAndPerEnd() {
        val notices = PersonalPromoNoticeStore(context)
        assertNull(notices.optedOutEndsAt("u1"))
        notices.optOut("u1", promo.endsAt!!)
        assertEquals(promo.endsAt, notices.optedOutEndsAt("u1"))
        // 같은 기기의 다른 계정에는 번지지 않는다.
        assertNull(notices.optedOutEndsAt("u2"))
        // 새 인스턴스(다음 실행)에서도 남아 있다.
        assertEquals(promo.endsAt, PersonalPromoNoticeStore(context).optedOutEndsAt("u1"))
    }

    @Test
    fun dayIsFormattedAsMonthAndDayInTheDeviceLocale() {
        val day = LocalDate.of(2026, 10, 31)
        assertEquals("10월 31일", formatPersonalPromoDay(day, Locale.KOREAN))
        assertEquals("October 31", formatPersonalPromoDay(day, Locale.ENGLISH))
        assertEquals("10月31日", formatPersonalPromoDay(day, Locale.JAPANESE))
    }
}
