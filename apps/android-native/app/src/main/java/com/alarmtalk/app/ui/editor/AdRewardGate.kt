package com.alarmtalk.app

import com.alarmtalk.app.network.AdRewardStatus

/**
 * 새 직접 입력 제작이 필요할 때 어디로 가나(`docs/spec/ad-rewards.md` §1-1 표). 두 앱이 같은 표를 쓴다 — iOS
 * `AdRewardGate.route` 와 짝이다.
 *
 * ⚠ **본인 결과 재사용은 여기까지 오지 않는다.** 폰의 입력 캐시가 먼저, 그다음 서버가 같은 입력의 내 결과를 세지 않고
 * 돌려준다(`cache_hit`). 이 판정은 서버가 새로 만들어야 한다고 답한 뒤(429 `MANUAL_TTS_QUOTA_EXCEEDED`)의 갈래다.
 */
internal enum class ManualCreationRoute {
    /** 플러스·스토어 체험·관리자 지급 — 월 30회 규칙. 광고를 권하지 않는다. */
    PLAN_RULES,

    /** 무료 월 기본분(3회)이 남았다. */
    USE_BASE,

    /** 기본분은 다 썼고 보상 잔액이 있다 — 광고를 다시 보게 하지 않는다. */
    USE_REWARD,

    /** 끝까지 본 광고의 보상을 서버가 아직 확인 중이다 — '보상을 확인하고 있어요'. 다시 보게 하지 않는다. */
    REWARD_PENDING,

    /** 둘 다 0 이고 지금 광고를 볼 수 있다 — '광고 보고 한 번 쓰기' 를 제안한다. */
    OFFER_AD,

    /** 이번 달 상한·이 빌드에 광고 없음·스위치 꺼짐·재고 없음 — 다음 제공일·만들어 둔 음성·플러스를 말한다. */
    NEXT_DATE,
}

/**
 * 무료 사용자의 광고 보상 판정(`docs/spec/ad-rewards.md` §1·§4). 편집기가 흩어 쓰지 않게 한곳에 둔다. '직접 입력' 은 더 이상
 * 잠그지 않는다(무료 기본 목소리 월 3회 — `voice-and-message.md` §8).
 *
 * [adReward] 는 `GET /tts/manual-quota` 의 `ad_reward` 다 — 서버는 무료에게만 싣는다. 못 받았으면(옛 서버·오프라인)
 * null 이다.
 */
internal object AdRewardGate {
    /** 지금 쓸 수 있는 보상 수. 유료면 0(유료는 월 한도를 쓴다 — 잔액은 서버에 그대로 남는다). */
    fun credits(freeVoiceTier: Boolean, adReward: AdRewardStatus?): Int =
        if (freeVoiceTier) (adReward?.credits ?: 0).coerceAtLeast(0) else 0

    /**
     * 지금 광고를 제안할 수 있는가. 이 빌드에 광고 단위가 있고(없으면 빈 운영 ID — 광고 자체를 숨긴다), 서버가 지금 볼 수
     * 있다고 했을 때만이다(`can_watch` — 운영 스위치·이번 달 자리·열린 세션). 상한인데 광고를 보여 주면 보고도 못 받는다.
     */
    fun canOfferAd(freeVoiceTier: Boolean, adReward: AdRewardStatus?, adsConfigured: Boolean): Boolean =
        freeVoiceTier && adsConfigured && adReward != null && adReward.canWatch && adReward.remainingGrants > 0

    /** §1-1 표 그대로. [baseRemaining] 은 이번 달 남은 기본분(모르면 null — 0 으로 본다). */
    fun route(
        freeVoiceTier: Boolean,
        baseRemaining: Int?,
        adReward: AdRewardStatus?,
        adsConfigured: Boolean,
    ): ManualCreationRoute = when {
        !freeVoiceTier -> ManualCreationRoute.PLAN_RULES
        (baseRemaining ?: 0) > 0 -> ManualCreationRoute.USE_BASE
        (adReward?.credits ?: 0) > 0 -> ManualCreationRoute.USE_REWARD
        (adReward?.pending ?: 0) > 0 -> ManualCreationRoute.REWARD_PENDING
        canOfferAd(freeVoiceTier, adReward, adsConfigured) -> ManualCreationRoute.OFFER_AD
        else -> ManualCreationRoute.NEXT_DATE
    }
}
