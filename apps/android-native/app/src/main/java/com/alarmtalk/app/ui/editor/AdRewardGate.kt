package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus

/**
 * 무료 사용자의 '직접 입력' 과 광고 보상의 판정(`docs/spec/ad-rewards.md` §4). 편집기가 흩어 쓰지 않게 한곳에 둔다.
 *
 * [adReward] 는 `GET /tts/manual-quota` 의 `ad_reward` 다 — 서버는 무료에게만 싣는다. 못 받았으면(옛 서버·오프라인)
 * null 이고, 그때는 예전 그대로 잠근다.
 */
internal object AdRewardGate {
    /** 지금 쓸 수 있는 보상 수. 유료면 0(유료는 월 한도를 쓴다). */
    fun credits(freeVoiceTier: Boolean, adReward: AdRewardStatus?): Int =
        if (freeVoiceTier) (adReward?.credits ?: 0).coerceAtLeast(0) else 0

    /** '직접 입력' 행을 잠그는가 — 무료인데 남은 보상이 없을 때. */
    fun manualLocked(freeVoiceTier: Boolean, adReward: AdRewardStatus?): Boolean =
        freeVoiceTier && credits(freeVoiceTier, adReward) <= 0

    /**
     * 잠긴 행이 연 게이트에 '광고 보고 한 번 쓰기' 를 붙이는가. 이 빌드에 광고 단위가 있고, 서버가 계정 PK 를 줬고,
     * 이번 달에 더 받을 수 있을 때만이다 — 상한에 닿았는데 광고를 보여 주면 보고도 아무것도 못 받는다.
     */
    fun canOfferAd(freeVoiceTier: Boolean, adReward: AdRewardStatus?, adsConfigured: Boolean): Boolean =
        freeVoiceTier &&
            adsConfigured &&
            adReward != null &&
            adReward.userId.isNotBlank() &&
            adReward.remainingGrants > 0

    /**
     * 저장 직전(폰에 그 음성이 없어 서버를 불러야 할 때) — 무료인데 쓸 보상이 없어서 막아야 하는가.
     * 현황을 못 읽었으면(null) 막지 않는다. 강제는 서버다(`FREE_PLAN_PRESET_ONLY`) — 이건 헛걸음을 줄이는 것뿐이다.
     */
    fun blocksManualSave(freeVoiceTier: Boolean, adReward: AdRewardStatus?): Boolean =
        freeVoiceTier && adReward != null && adReward.credits <= 0
}
