package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 무료 사용자의 광고 보상 판정(`docs/spec/ad-rewards.md` §1·§4). '직접 입력' 은 잠그지 않는다(2026-10-26). */
class AdRewardGateTest {
    private fun reward(credits: Int = 0, remaining: Int = 10, userId: String = "pk-1") =
        AdRewardStatus(credits = credits, remainingGrants = remaining, monthlyLimit = 10, userId = userId)

    @Test
    fun `유료는 보상 수가 0 이다 — 유료는 월 한도를 쓴다`() {
        assertEquals(0, AdRewardGate.credits(freeVoiceTier = false, adReward = reward(credits = 3)))
        assertEquals(3, AdRewardGate.credits(freeVoiceTier = true, adReward = reward(credits = 3)))
    }

    @Test
    fun `광고 버튼은 광고 단위·계정 PK·이번 달 남은 횟수가 다 있을 때만 붙는다`() {
        assertTrue(AdRewardGate.canOfferAd(true, reward(), adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(true, reward(), adsConfigured = false))
        assertFalse(AdRewardGate.canOfferAd(true, reward(remaining = 0), adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(true, reward(userId = ""), adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(true, null, adsConfigured = true))
        assertFalse(AdRewardGate.canOfferAd(false, reward(), adsConfigured = true))
    }
}
