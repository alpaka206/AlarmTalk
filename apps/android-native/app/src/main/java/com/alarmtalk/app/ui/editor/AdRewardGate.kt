package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus

/**
 * 무료 사용자의 광고 보상 판정(`docs/spec/ad-rewards.md` §1·§4). 편집기가 흩어 쓰지 않게 한곳에 둔다. '직접 입력' 은 더 이상
 * 잠그지 않는다(무료 기본 목소리 월 3회 — `voice-and-message.md` §8).
 *
 * [adReward] 는 `GET /tts/manual-quota` 의 `ad_reward` 다 — 서버는 무료에게만 싣는다. 못 받았으면(옛 서버·오프라인)
 * null 이다.
 */
internal object AdRewardGate {
    /** 지금 쓸 수 있는 보상 수. 유료면 0(유료는 월 한도를 쓴다). */
    fun credits(freeVoiceTier: Boolean, adReward: AdRewardStatus?): Int =
        if (freeVoiceTier) (adReward?.credits ?: 0).coerceAtLeast(0) else 0

    /**
     * 무료가 기본분(월 3회)도 보상도 다 써 서버가 429 로 막은 자리의 게이트에 '광고 보고 한 번 쓰기' 를 붙이는가
     * (2026-10-26 — 그전에는 잠긴 '직접 입력' 행이 이 게이트를 열었다). 이 빌드에 광고 단위가 있고, 서버가 계정 PK 를 줬고,
     * 이번 달에 더 받을 수 있을 때만이다 — 상한에 닿았는데 광고를 보여 주면 보고도 아무것도 못 받는다.
     */
    fun canOfferAd(freeVoiceTier: Boolean, adReward: AdRewardStatus?, adsConfigured: Boolean): Boolean =
        freeVoiceTier &&
            adsConfigured &&
            adReward != null &&
            adReward.userId.isNotBlank() &&
            adReward.remainingGrants > 0
}
