package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.BillingSubscriptionResponse
import java.io.File
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 이용권 화면을 iOS 와 맞춘 규칙(2026-11-22 두 앱 통일). 화면·뷰모델은 단위 테스트에서 세울 수 없어 판정을 순수 함수로 뽑아
 * 둔 것만 본다 — 실제로 쓰이는 자리는 각 함수 주석에 적었다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class BillingParityRulesTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `복원은 스토어에 묻지 못한 것과 구매가 없는 것을 가른다`() {
        // 묻지 못했는데 "복원할 구매가 없어요" 라고 하면 결제한 사용자가 구독이 사라진 줄 안다.
        assertEquals(R.string.billing_restore_failed, restoreResultMessageRes(null))
        assertEquals(R.string.billing_restore_none, restoreResultMessageRes(0))
        // 보낸 것이 있으면 확인 결과가 말한다 — 여기서는 아무 말도 하지 않는다.
        assertNull(restoreResultMessageRes(2))
        assertEquals(
            "이전 구매를 복원하지 못했어요. 잠시 후 다시 시도해 주세요.",
            context.getString(R.string.billing_restore_failed),
        )
    }

    @Test
    fun `다른 스토어가 갱신을 쥐고 있을 때만 Play 결제를 막는다`() {
        fun response(providers: List<String>?) =
            BillingSubscriptionResponse(subscription = null, plan = null, storeRenewalProviders = providers)
        assertTrue(otherStoreOwnsRenewal(response(listOf("apple"))))
        assertTrue(otherStoreOwnsRenewal(response(listOf("google", "apple"))))
        assertFalse(otherStoreOwnsRenewal(response(listOf("google"))))
        assertFalse(otherStoreOwnsRenewal(response(emptyList())))
        // 모르는 것(구버전 서버·아직 못 받은 응답)은 여기서 막지 않는다 — 결제 직전에 서버에 새로 묻는다.
        assertFalse(otherStoreOwnsRenewal(response(null)))
        assertFalse(otherStoreOwnsRenewal(null))
    }

    @Test
    fun `결제 거절 문구는 화면의 표, 공용 표, 기본 문구 차례로 고른다`() {
        val fallback = "기본 문구"
        assertEquals(
            "이 결제는 다른 계정으로 구매한 거예요. 그 계정으로 로그인해 주세요.",
            billingFailureMessage(context, "TRANSACTION_ACCOUNT_MISMATCH", fallback),
        )
        assertEquals(
            context.getString(R.string.msg2_billing_fail_transaction_owned_by_other_user),
            billingFailureMessage(context, "TRANSACTION_OWNED_BY_OTHER_USER", fallback),
        )
        // 공용 표에 문구가 있는 코드는 기본 문구로 뭉개지지 않는다(예전에는 건너뛰었다).
        assertEquals(
            context.getString(R.string.msg_cross_store_renewal_active),
            billingFailureMessage(context, "CROSS_STORE_RENEWAL_ACTIVE", fallback),
        )
        assertEquals(
            context.getString(R.string.api_error_rate_limited),
            billingFailureMessage(context, "RATE_LIMITED", fallback),
        )
        assertEquals(fallback, billingFailureMessage(context, "SOMETHING_NEW", fallback))
        assertEquals(fallback, billingFailureMessage(context, null, fallback))
    }

    @Test
    fun `확인하지 못한 결제는 복원으로 다시 붙이라고 말한다`() {
        // iOS `SubscriptionManager` 와 같은 문장이다 — 결제는 스토어가 받았고, 서버가 아직 확인하지 못했을 뿐이다.
        assertEquals(
            "결제는 됐지만 이용권을 아직 확인하지 못했어요. 잠시 후 '이전 구매 복원'을 눌러 주세요.",
            context.getString(R.string.msg_gb_payment_confirm_failed_retry),
        )
    }

    @Test
    fun `해지 알럿의 날짜는 월 일 꼴이다`() {
        // 체험 안내와 같은 꼴이다(`formatMonthDay`). 예전에는 이 자리만 "11/22" 였다.
        val expiresAt = "2026-11-22T03:00:00Z"
        assertEquals("11월 22일", formatPassDay(expiresAt, Locale.KOREAN, ZoneOffset.UTC))
        assertEquals("November 22", formatPassDay(expiresAt, Locale.ENGLISH, ZoneOffset.UTC))
        assertEquals("11月22日", formatPassDay(expiresAt, Locale.JAPANESE, ZoneOffset.UTC))
        // 날짜는 끝 시각의 **기기 날짜**다 — 한국 시간으로는 이미 다음 날이다.
        assertEquals("11월 23일", formatPassDay("2026-11-22T16:00:00Z", Locale.KOREAN, ZoneOffset.ofHours(9)))
        assertNull(formatPassDay(null, Locale.KOREAN))
        assertNull(formatPassDay("not-a-date", Locale.KOREAN))
        // 월·일만, 기기 로케일로 — 연도는 싣지 않는다.
        val day = java.time.LocalDate.of(2026, 10, 31)
        assertEquals("10월 31일", formatMonthDay(day, Locale.KOREAN))
        assertEquals("October 31", formatMonthDay(day, Locale.ENGLISH))
        assertEquals("10月31日", formatMonthDay(day, Locale.JAPANESE))
    }

    @Test
    fun `스토어 이름 뒤에 조사를 띄어 쓰지 않는다`() {
        // "App Store에서"·"Google Play로"·"구독에서" — 한국어 맞춤법(외래어 고유 명사 뒤 조사는 붙여 쓴다).
        val file = File("src/main/res/values/strings.xml")
        assertTrue("values/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        val spaced = Regex("""(App Store|Google Play|구독) (에서|에|로|으로|를|을|의|은|는|이|가)(?=[\s.,·<])""")
        val found = spaced.findAll(file.readText()).map { it.value }.toList()
        assertTrue("스토어 이름 뒤의 띄어 쓴 조사: $found", found.isEmpty())
    }
}
