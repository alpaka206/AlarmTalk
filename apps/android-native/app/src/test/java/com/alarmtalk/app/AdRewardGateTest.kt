package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 무료 사용자의 '직접 입력' 과 광고 보상 판정(`docs/spec/ad-rewards.md` §4). */
class AdRewardGateTest {
    private fun reward(credits: Int = 0, remaining: Int = 10, userId: String = "pk-1") =
        AdRewardStatus(credits = credits, remainingGrants = remaining, monthlyLimit = 10, userId = userId)

    @Test
    fun `무료는 남은 보상이 있을 때만 직접 입력이 풀린다`() {
        assertTrue(AdRewardGate.manualLocked(freeVoiceTier = true, adReward = reward(credits = 0)))
        assertFalse(AdRewardGate.manualLocked(freeVoiceTier = true, adReward = reward(credits = 1)))
        // 현황을 못 받았으면(옛 서버·오프라인) 예전 그대로 잠근다.
        assertTrue(AdRewardGate.manualLocked(freeVoiceTier = true, adReward = null))
    }

    @Test
    fun `유료는 보상과 무관하게 잠그지 않고 보상 수도 0 이다`() {
        assertFalse(AdRewardGate.manualLocked(freeVoiceTier = false, adReward = null))
        assertEquals(0, AdRewardGate.credits(freeVoiceTier = false, adReward = reward(credits = 3)))
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

    @Test
    fun `저장 전 확인은 무료인데 보상이 없다고 확인됐을 때만 막는다`() {
        assertTrue(AdRewardGate.blocksManualSave(true, reward(credits = 0)))
        assertFalse(AdRewardGate.blocksManualSave(true, reward(credits = 1)))
        // 못 읽었으면 막지 않는다 — 강제는 서버다.
        assertFalse(AdRewardGate.blocksManualSave(true, null))
        assertFalse(AdRewardGate.blocksManualSave(false, reward(credits = 0)))
    }
}
