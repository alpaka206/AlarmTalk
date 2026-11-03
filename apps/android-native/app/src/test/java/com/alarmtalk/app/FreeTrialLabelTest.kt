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
    fun cardLineSaysTheTrialThenThePrice() {
        assertEquals(
            "1개월 무료 체험, 이후 ₩3,900",
            context.getString(R.string.billing_plan_trial_price, trialPeriodLabel(context, "P1M"), "₩3,900"),
        )
    }
}
