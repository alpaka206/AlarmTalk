package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 무료 사용자의 광고 보상 판정(`docs/spec/ad-rewards.md` §1-1 표). iOS `AdRewardGateTests` 와 같은 표를 지킨다. */
class AdRewardGateTest {
    private fun reward(
        credits: Int = 0,
        remaining: Int = 10,
        pending: Int = 0,
        canWatch: Boolean = true,
        reason: String? = null,
    ) = AdRewardStatus(
        credits = credits,
        remainingGrants = remaining,
        monthlyLimit = 10,
        pending = pending,
        canWatch = canWatch,
        unavailableReason = reason,
    )

    @Test
    fun `유료는 보상 수가 0 이다 — 유료는 월 한도를 쓴다`() {
        assertEquals(0, AdRewardGate.credits(freeVoiceTier = false, adReward = reward(credits = 3)))
        assertEquals(3, AdRewardGate.credits(freeVoiceTier = true, adReward = reward(credits = 3)))
    }

    @Test
    fun `광고 제안은 이 빌드의 광고 단위와 서버의 can_watch 가 다 있을 때만이다`() {
        assertTrue(AdRewardGate.canOfferAd(true, reward(), adsConfigured = true))
        // 빈 운영 ID — 광고 제안 자체를 숨긴다.
        assertFalse(AdRewardGate.canOfferAd(true, reward(), adsConfigured = false))
        assertFalse(AdRewardGate.canOfferAd(true, reward(remaining = 0), adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(true, reward(canWatch = false, reason = "disabled"), adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(true, null, adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(false, reward(), adsConfigured = true))
    }

    @Test
    fun `표 — 플러스·체험·관리자 지급이면 광고 없이 30회 규칙`() {
        assertEquals(ManualCreationRoute.PLAN_RULES, AdRewardGate.route(false, 0, reward(), adsConfigured = true))
    }

    @Test
    fun `표 — 기본분이 남으면 기본분, 다 쓰고 보상이 있으면 광고 없이 보상`() {
        assertEquals(ManualCreationRoute.USE_BASE, AdRewardGate.route(true, 2, reward(credits = 1), true))
        assertEquals(ManualCreationRoute.USE_REWARD, AdRewardGate.route(true, 0, reward(credits = 1), true))
    }

    @Test
    fun `표 — 확인 중인 보상이 있으면 광고를 다시 권하지 않는다`() {
        assertEquals(ManualCreationRoute.REWARD_PENDING, AdRewardGate.route(true, 0, reward(pending = 1), true))
    }

    @Test
    fun `표 — 둘 다 0 이고 볼 수 있으면 광고 제안, 못 보면 다음 제공일`() {
        assertEquals(ManualCreationRoute.OFFER_AD, AdRewardGate.route(true, 0, reward(), true))
        assertEquals(
            ManualCreationRoute.NEXT_DATE,
            AdRewardGate.route(true, 0, reward(remaining = 0, canWatch = false, reason = "monthly_limit"), true),
        )
        // 미지원(이 빌드에 광고 없음)·스위치 꺼짐·옛 서버(`ad_reward` 없음)도 다음 제공일 안내다.
        assertEquals(ManualCreationRoute.NEXT_DATE, AdRewardGate.route(true, 0, reward(), adsConfigured = false))
        assertEquals(
            ManualCreationRoute.NEXT_DATE,
            AdRewardGate.route(true, 0, reward(canWatch = false, reason = "disabled"), true),
        )
        assertEquals(ManualCreationRoute.NEXT_DATE, AdRewardGate.route(true, null, null, true))
    }

    @Test
    fun `다음 제공일은 KST 날짜로 읽는다`() {
        val formatted = formatAdRewardNextDate("2026-10-31T15:00:00Z", java.util.Locale.KOREA)
        assertEquals("2026년 11월 1일", formatted)
        assertEquals(null, formatAdRewardNextDate(null))
        assertEquals(null, formatAdRewardNextDate("not-a-date"))
    }
}
