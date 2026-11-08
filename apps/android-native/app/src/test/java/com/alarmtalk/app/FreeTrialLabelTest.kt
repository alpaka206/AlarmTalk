package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 스토어 무료 체험(`docs/spec/plan-gates.md` 「신규 1개월 무료 — 스토어 무료 체험」) — Play 가 준 체험 기간(ISO 8601)을
 * 카드 문구로 바꾼다. 못 읽는 기간은 문구를 그리지 않는다(기간을 지어내지 않는다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class FreeTrialLabelTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun readsPlayBillingPeriods() {
        assertEquals("1개월", trialPeriodLabel(context, "P1M"))
        assertEquals("7일", trialPeriodLabel(context, "P7D"))
        assertEquals("2주", trialPeriodLabel(context, "P2W"))
        assertEquals("1년", trialPeriodLabel(context, "P1Y"))
    }

    @Test
    fun unknownPeriodsDrawNothing() {
        assertNull(trialPeriodLabel(context, ""))
        assertNull(trialPeriodLabel(context, "P0M"))
        assertNull(trialPeriodLabel(context, "1M"))
    }

    @Test
    fun cardSaysTheFreePeriodBigThenThePriceWithItsCycle() {
        // 스토어 가격("₩3,900")에는 주기가 없다 — 카드는 `billing_plan_monthly_price` 로 '월' 을 붙인다(`planPriceLabel`).
        val monthly = context.getString(R.string.billing_plan_monthly_price, "₩3,900")
        assertEquals("월 ₩3,900", monthly)
        assertEquals("1개월 무료", context.getString(R.string.billing_plan_trial_headline, trialPeriodLabel(context, "P1M")))
        assertEquals("이후 월 ₩3,900", context.getString(R.string.billing_plan_trial_then, monthly))
        assertEquals("1개월 무료로 시작하기", context.getString(R.string.billing_plan_trial_start, trialPeriodLabel(context, "P1M")))
    }

    @Test
    fun disclosureNamesTheFirstChargeDayPriceAndCancellation() {
        // 첫 결제일 = 오늘 + 체험 기간(2026-11-09 오너 — 넷플릭스·유튜브처럼 언제 얼마가 나가는지 구체적으로).
        assertEquals(
            "오늘은 결제되지 않아요. 12월 9일부터 매월 ₩3,900씩 결제되고, 그 전에 Google Play에서 언제든 해지할 수 있어요.",
            trialDisclosureText(context, "P1M", "₩3,900", today = java.time.LocalDate.of(2026, 11, 9)),
        )
        // 기간을 못 읽으면 날짜를 지어내지 않는다.
        assertNull(trialDisclosureText(context, "1M", "₩3,900"))
        assertNull(trialDisclosureText(context, "P1M", ""))
    }
}
