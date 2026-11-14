package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.PlanGrant
import com.google.gson.Gson
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

/**
 * 관리자 기간 지급(`docs/spec/billing-lifecycle.md` 「관리자 기간 지급」) — 기기에 남는 기한.
 *
 * 지급으로 받은 `plus` 는 끝이 있다. 앱이 그 끝을 모르면 지급 중에 받은 `plus` 캐시가 끝난 뒤에도 남아, 오프라인 기기(특히
 * 울림 경로)가 등록 목소리를 계속 쓴다(Codex #941 P2). 기간 한정 개인 플랜과 같은 오프라인 기한(`PlanPromoStamp`)으로 자른다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PlanGrantExpiryTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val endsAt = "2026-11-26T05:00:00Z"
    private val endsAtMillis = java.time.Instant.parse(endsAt).toEpochMilli()

    @After
    fun deleteTestPrefs() {
        context.getSharedPreferences("plan-grant-session-test", Context.MODE_PRIVATE).edit().clear().commit()
        File(context.filesDir.parentFile, "shared_prefs/plan-grant-session-test.xml").delete()
    }

    private fun session(user: AuthUser) = AuthSession(token = "t-${user.id}", provider = AuthSessionStore.PROVIDER_APP, user = user)

    @Test
    fun sessionKeepsTheGrantEndWithThePlanAndClearsItWhenGone() {
        val store = AuthSessionStore(context.getSharedPreferences("plan-grant-session-test", Context.MODE_PRIVATE))
        store.save(
            session(AuthUser(id = "u1", email = "u1@example.test", plan = "plus", planGrant = PlanGrant(endsAt = endsAt)))
                .copy(userFetchedAtMillis = endsAtMillis - 60_000L),
        )
        val restored = store.read()
        assertEquals(endsAt, restored?.user?.planGrant?.endsAt)
        assertEquals(PlanPromoStamp(endsAt, endsAtMillis - 60_000L), restored?.planPromoStamp())

        // 결제 등으로 지급 없이 plus 가 오면 옛 끝을 지운다 — 남으면 결제자가 그 시각에 잠긴다.
        store.save(session(AuthUser(id = "u1", email = "u1@example.test", plan = "plus")))
        assertNull(store.read()?.user?.planGrant)
        assertNull(store.read()?.planPromoStamp())
    }

    @Test
    fun aGrantPlusCachedBeforeTheEndIsFreeAfterTheEndWithNoSubscription() {
        val stamp = PlanPromoStamp(endsAt, endsAtMillis - 60_000L)
        val noSubscription = BillingSubscriptionResponse(subscription = null, plan = null)
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(noSubscription, "plus", storeEntitled = false, nowMillis = endsAtMillis - 1L, userPlanPromo = stamp),
        )
        assertEquals(
            PaidVoiceAccess.NotEntitled,
            resolvePaidVoiceAccess(noSubscription, "plus", storeEntitled = false, nowMillis = endsAtMillis, userPlanPromo = stamp),
        )
        // 스토어가 지금 유효한 구독을 확인해 주면 지급 끝과 무관하다.
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(noSubscription, "plus", storeEntitled = true, nowMillis = endsAtMillis + 1L, userPlanPromo = stamp),
        )
    }

    @Test
    fun responsesParseTheGrantLenientlyAndUseTheServerComputedTime() {
        val gson = Gson()
        val user = gson.fromJson(
            """{"id":"u1","email":"a@b.c","plan":"plus","plan_grant":{"ends_at":"$endsAt","computed_at":"2026-11-26T04:59:00Z"}}""",
            AuthUser::class.java,
        )
        assertEquals(endsAt, user.planGrant?.endsAt)
        assertEquals(endsAtMillis - 60_000L, planAnswerStampMillis(null, endsAtMillis + 5_000L, user.planGrant))
        // 모양이 틀린 값은 그 필드만 null 이다 — 응답 전체를 깨지 않는다.
        val broken = gson.fromJson("""{"id":"u1","email":"a@b.c","plan":"plus","plan_grant":"oops"}""", AuthUser::class.java)
        assertNull(broken.planGrant)
        assertEquals("plus", broken.plan)
    }

    @Test
    fun theBillingLineShowsTheLastDayOnlyWhileTheGrantIsLive() {
        val seoul = ZoneId.of("Asia/Seoul")
        assertEquals(LocalDate.of(2026, 11, 26), planGrantLastDay(endsAt, seoul, endsAtMillis - 1L))
        assertNull(planGrantLastDay(endsAt, seoul, endsAtMillis))
        assertNull(planGrantLastDay("not-a-date", seoul, 0L))
    }
}
